#!/usr/bin/env python3
"""bench_perf.py — W74 perf-snapshot для NEWF-спеки.

Поднимает scratch nexus-core (subprocess, реальный ConPTY backend,
temp-base, БЕЗ gate-policy — чистый AEGIS path), спавнит N_TERMS
cmd-терминалов, прогревает и меряет латенси GET-эндпоинтов:
10 прогонов на эндпоинт → median / p95 (nearest-rank).

Запуск:  python tools/nexus_core/bench_perf.py [--terms N] [--runs N]
Выход:   markdown-таблица в stdout + строка ENV для методики.
Только stdlib (urllib/subprocess). :5684 не используется —
свой свободный порт и temp-base.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import platform
import socket
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
TIMEOUT = 30


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def api(port: int, method: str, path: str, body=None):
    url = f"http://127.0.0.1:{port}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=TIMEOUT) as r:
        return r.status, r.read()


def timed_get(port: int, path: str) -> float:
    t0 = time.perf_counter()
    api(port, "GET", path)
    return (time.perf_counter() - t0) * 1000.0


def wait_ready(port: int, proc: subprocess.Popen, deadline: float) -> bool:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    while time.time() < deadline:
        if proc.poll() is not None:
            return False
        try:
            with opener.open(
                    f"http://127.0.0.1:{port}/api/core/server",
                    timeout=2) as r:
                if r.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(0.3)
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--terms", type=int, default=20)
    ap.add_argument("--runs", type=int, default=10)
    args = ap.parse_args()

    port = free_port()
    base = Path(tempfile.mkdtemp(prefix="nexus-perf-"))
    env = dict(os.environ)
    env["NEXUS_CORE_TOKEN"] = ""
    env["NEXUS_CORE_READ_TOKEN"] = ""
    env.pop("CORE_MOCK", None)  # реальный backend

    log = open(base / "server.log", "wb")
    proc = subprocess.Popen(
        [sys.executable, "-m", "tools.nexus_core.api",
         "--port", str(port), "--base", str(base)],
        cwd=str(REPO), env=env, stdout=log, stderr=subprocess.STDOUT)
    try:
        if not wait_ready(port, proc, time.time() + 25):
            print("FAIL: core не поднялся")
            return 2

        # 20 живых терминалов
        for i in range(args.terms):
            api(port, "POST", "/api/core/run",
                {"command": ["cmd"], "name": f"perf-{i}"})
        time.sleep(2.0)  # ConPTY init
        # лёгкое заполнение экранов (best-effort)
        for i in range(args.terms):
            try:
                api(port, "POST", "/api/core/send",
                    {"term": f"local/perf-{i}",
                     "text": f"echo PERF-{i}-MARK", "enter": True})
            except Exception:
                pass
        time.sleep(1.0)

        endpoints = [
            ("screens?terms=all&lines=50",
             "/api/core/screens?terms=all&lines=50"),
            ("terminals/summary?limit=500",
             "/api/core/terminals/summary?limit=500"),
            ("health", "/api/core/health"),
            ("diag", "/api/core/diag"),
            ("terminals (full)", "/api/core/terminals"),
        ]
        # прогрев: 3 GET на эндпоинт (не в статистику)
        for _, path in endpoints:
            for _ in range(3):
                timed_get(port, path)

        print("| endpoint | n | median ms | p95 ms | min | max |")
        print("|---|---|---|---|---|---|")
        for name, path in endpoints:
            samples = [timed_get(port, path) for _ in range(args.runs)]
            samples.sort()
            med = statistics.median(samples)
            p95 = samples[max(0, math.ceil(0.95 * len(samples)) - 1)]
            print(f"| `{name}` | {len(samples)} | {med:.1f} | "
                  f"{p95:.1f} | {samples[0]:.1f} | {samples[-1]:.1f} |")

        ver = "?"
        try:
            _, raw = api(port, "GET", "/api/core/server")
            ver = json.loads(raw).get("version", "?")
        except Exception:
            pass
        print(f"\nENV python={platform.python_version()} "
              f"aiohttp=3.14.5 os={platform.system()} "
              f"{platform.release()} cpu={platform.processor() or '?'} "
              f"core={ver} terms={args.terms} runs={args.runs} "
              f"port={port} base={base}")
        return 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        log.close()
        import shutil
        shutil.rmtree(base, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
