"""W80: латенси SSE-стрима terminal/{t}/stream — input → первый screen-event.

Scratch-демон (stdlib-only, urllib+subprocess+http.client), fresh temp-base,
БЕЗ CORE_MOCK — реальный ConPTY backend. 10 итераций: подписка → drain
начального screen-event → POST /send → замер до следующего event: screen.

Метрики: median / p95 в ms. Цель: <150 ms (после патча throttle
0.15→0.03, sleep 0.05→0.02 в handle_screen_stream).

Запуск: python tools/nexus_core/bench_stream_latency.py [--port N] [--keep]
"""
from __future__ import annotations

import argparse
import http.client
import json
import os
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ITERATIONS = 10
TIMEOUT = 20


def api(port: int, method: str, path: str, body=None):
    url = f"http://127.0.0.1:{port}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            raw = r.read()
            try:
                return r.status, json.loads(raw)
            except json.JSONDecodeError:
                return r.status, {"_raw": raw[:200].decode("utf-8", "replace")}
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read()[:200].decode("utf-8", "replace")}


def free_port() -> int:
    import socket
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_ready(port: int, proc: subprocess.Popen, deadline: float) -> bool:
    while time.time() < deadline:
        if proc.poll() is not None:
            return False
        try:
            with urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/api/core/health",
                    timeout=2) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.3)
    return False


def read_until_screen_event(resp: http.client.HTTPResponse,
                            buf: bytearray, deadline: float) -> int | None:
    """Читаем SSE-поток до первого 'event: screen' фрейма.

    buf — накопленный хвост между вызовами (фрейм может быть разрезан
    по TCP-границам). Возвращает seq из data-payload или None."""
    while time.time() < deadline:
        idx = buf.find(b"event: screen")
        if idx >= 0:
            end = buf.find(b"\n\n", idx)
            if end < 0:
                # фрейм разрезан по TCP — ждём продолжения
                try:
                    chunk = resp.read1(65536)
                except Exception:
                    return None
                if not chunk:
                    return None
                buf.extend(chunk)
                continue
            frame = bytes(buf[idx:end])
            del buf[:end + 2]
            try:
                data_line = next(
                    ln for ln in frame.split(b"\n")
                    if ln.startswith(b"data: "))
                return int(json.loads(
                    data_line[6:].decode("utf-8", "replace"))
                    .get("seq", 0))
            except Exception:
                return 0
        try:
            chunk = resp.read1(65536)
        except Exception:
            return None
        if not chunk:
            return None
        buf.extend(chunk)
        if len(buf) > 4 * 1024 * 1024:  # screen-кадры тяжёлые — страховка
            del buf[:-1024 * 1024]
    return None


def measure_once(port: int, addr: str, marker: str) -> float | None:
    """Одна итерация: подписка → drain → send → первый screen-event.

    Возвращает латенси в секундах или None при таймауте/ошибке."""
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=TIMEOUT)
    try:
        conn.request("GET", f"/api/core/terminal/{addr}/stream")
        resp = conn.getresponse()
        if resp.status != 200:
            return None
        buf = bytearray()
        # drain: начальный screen-event подписки — не считаем
        seq0 = read_until_screen_event(resp, buf, time.time() + TIMEOUT)
        if seq0 is None:
            return None
        # вход → первый screen-event ПОСЛЕ send (seq строго больше —
        # отсекает stale-кадры, уже лежавшие в буфере)
        t0 = time.time()
        st, _ = api(port, "POST", "/api/core/send",
                    {"term": addr, "text": f"echo {marker}", "enter": True})
        if st != 200:
            return None
        while True:
            seq = read_until_screen_event(resp, buf, t0 + TIMEOUT)
            if seq is None:
                return None
            if seq > seq0:
                return time.time() - t0
    except Exception:
        return None
    finally:
        try:
            conn.close()
        except Exception:
            pass


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--iterations", type=int, default=ITERATIONS)
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()

    port = args.port or free_port()
    base = Path(tempfile.mkdtemp(prefix="nexus-streamlat-"))
    env = dict(os.environ)
    env.pop("CORE_MOCK", None)          # реальный ConPTY backend
    env["NEXUS_CORE_TOKEN"] = ""
    env["NEXUS_CORE_READ_TOKEN"] = ""
    env["AEGIS_ADMIN_TOKEN"] = ""
    env["AEGIS_ADMIN_KEYS"] = ""

    log = open(base / "server.log", "wb")
    proc = subprocess.Popen(
        [sys.executable, "-m", "tools.nexus_core.api",
         "--port", str(port), "--base", str(base)],
        cwd=str(REPO), env=env, stdout=log, stderr=subprocess.STDOUT)
    print(f"scratch core: pid={proc.pid} port={port} base={base}")
    try:
        if not wait_ready(port, proc, time.time() + 30):
            print("FAIL: core не поднялся за 30s — см. server.log")
            return 2
        st, d = api(port, "POST", "/api/core/run",
                    {"command": ["cmd"], "name": "lat-term"})
        addr = d.get("address", "")
        print(f"spawn: {st} {addr}")
        if st != 200 or not addr:
            print(f"FAIL spawn: {d}")
            return 2
        time.sleep(2.0)  # ConPTY init

        # warmup: первый send прогревает ConPTY/cmd prompt — в замер
        # не идёт (стандартная практика, фиксируется в отчёте)
        measure_once(port, addr, f"WARM-{os.getpid() % 10000}")
        time.sleep(0.5)

        lat_ms: list[float] = []
        for i in range(args.iterations):
            dt = measure_once(port, addr, f"LAT{i}-{os.getpid() % 10000}")
            if dt is None:
                print(f"  iter {i + 1}: TIMEOUT/ERR")
                continue
            lat_ms.append(dt * 1000.0)
            print(f"  iter {i + 1}: {dt * 1000.0:7.1f} ms")
            time.sleep(0.4)  # дать cmd проглотить echo

        if not lat_ms:
            print("FAIL: ни одной успешной итерации")
            return 1
        lat_ms.sort()
        med = statistics.median(lat_ms)
        p95 = lat_ms[min(len(lat_ms) - 1,
                         int(0.95 * len(lat_ms) + 0.9999) - 1)]
        print(f"\n{'=' * 46}\n"
              f"n={len(lat_ms)} median={med:.1f} ms  p95={p95:.1f} ms\n"
              f"target <150 ms: {'PASS' if p95 < 150 else 'FAIL'}")
        return 0 if p95 < 150 else 1
    finally:
        if args.keep:
            print(f"--keep: pid={proc.pid} port={port} base={base}")
        else:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
            log.close()
            shutil.rmtree(base, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
