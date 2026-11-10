#!/usr/bin/env python3
"""test_ws_roundtrip.py — W90 API-roundtrip workspace export→import→restore.

HERETIC W725 оставил tools/workspace_export.py как PARTIAL
(CLI-zip, «E2E roundtrip pending (API-driven)»). Эта проба
доводит roundtrip до чистого API на ДВУХ scratch-демонах
(реальный ConPTY backend, без CORE_MOCK):

  A: spaces ops/dev → terminals wst1/wst2 → migrate → marker
     → POST /workspace/snapshot {name, scrollback:true}
     → GET  /workspace/snapshot/<name>.json   (export-read, W90)
  B: POST /workspace/import {snapshot}        (import, W90)
     → GET  /workspace/restore/preview        (would_spawn)
     → POST /workspace/restore                (execute)
     → verify: terminals живы, space-членство, scrollback-маркер

Запуск:  python tools/nexus_core/test_ws_roundtrip.py [--keep]
Выход:   0 все PASS / 1 есть FAIL / 2 окружение. Только stdlib.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
TIMEOUT = 30
SNAP_NAME = "wsr-a"

_results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, note: str = "") -> None:
    _results.append((name, ok, note))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}"
          + (f" — {note}" if note else ""))


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


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
                return r.status, {"_raw": raw[:300].decode(
                    "utf-8", "replace")}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, {"_raw": raw[:300].decode(
                "utf-8", "replace")}


def wait_ready(port: int, proc: subprocess.Popen,
               deadline: float) -> bool:
    while time.time() < deadline:
        if proc.poll() is not None:
            return False
        try:
            with urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/api/core/server",
                    timeout=2) as r:
                if r.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(0.4)
    return False


def start_daemon(port: int, base: Path):
    env = dict(os.environ)
    env["NEXUS_CORE_TOKEN"] = ""
    env["NEXUS_CORE_READ_TOKEN"] = ""
    env.pop("CORE_MOCK", None)
    log = open(base / f"server-{port}.log", "wb")
    proc = subprocess.Popen(
        [sys.executable, "-m", "tools.nexus_core.api",
         "--port", str(port), "--base", str(base)],
        cwd=str(REPO), env=env, stdout=log, stderr=subprocess.STDOUT)
    return proc, log


def stop_daemon(proc, log) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
    log.close()


def term_map(port: int) -> dict:
    st, d = api(port, "GET", "/api/core/terminals")
    if st != 200:
        return {}
    terms = d if isinstance(d, list) else d.get("terminals", [])
    return {t.get("address"): t for t in terms}


def wait_marker(port: int, term: str, marker: str,
                timeout: float = 15.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        st, d = api(port, "GET",
                    f"/api/core/terminal/{term}/dump")
        if st == 200:
            text = json.dumps(d, ensure_ascii=False)
            if marker in text:
                return True
        time.sleep(0.6)
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", action="store_true",
                    help="не убивать scratch-демоны (debug)")
    args = ap.parse_args()

    base_a = Path(tempfile.mkdtemp(prefix="nexus-ws-a-"))
    base_b = Path(tempfile.mkdtemp(prefix="nexus-ws-b-"))
    port_a, port_b = free_port(), free_port()
    env_note = "real ConPTY backend"

    proc_a = proc_b = None
    log_a = log_b = None
    try:
        proc_a, log_a = start_daemon(port_a, base_a)
        print(f"daemon A: pid={proc_a.pid} port={port_a} "
              f"base={base_a} ({env_note})")
        if not wait_ready(port_a, proc_a, time.time() + 25):
            print("FAIL: daemon A не поднялся")
            return 2

        # --- A: сцена ---
        print("\n== A: workspace scene ==")
        for sp in ("ops", "dev"):
            st, d = api(port_a, "POST", "/api/core/space",
                        {"name": sp})
            check(f"space {sp}", st == 201, f"{st} {d}")
        for name, space in (("wst1", "ops"), ("wst2", "dev")):
            st, d = api(port_a, "POST", "/api/core/run",
                        {"command": ["cmd"], "name": name})
            check(f"spawn {name}", st == 200, f"{st}")
            time.sleep(1.0)  # ConPTY init
            st, d = api(port_a, "POST",
                        f"/api/core/terminal/{name}/migrate",
                        {"space": space})
            check(f"migrate {name}→{space}", st == 200,
                  f"{st} {d.get('space', d)}")
            st, d = api(port_a, "POST", "/api/core/send",
                        {"term": f"local/{name}",
                         "text": f"echo WSR-MARKER-{name[-1]}",
                         "enter": True})
            check(f"seed {name}", st in (200, 202), f"{st}")
        ok = all(wait_marker(port_a, f"local/{n}",
                             f"WSR-MARKER-{n[-1]}")
                 for n in ("wst1", "wst2"))
        check("A markers on screen", ok)

        # --- A: snapshot + export-read ---
        print("\n== A: export ==")
        st, d = api(port_a, "POST", "/api/core/workspace/snapshot",
                    {"name": SNAP_NAME, "scrollback": True})
        check("snapshot create", st == 201
              and d.get("file") == f"{SNAP_NAME}.json",
              f"{st} {d}")
        st, snap = api(port_a, "GET",
                       f"/api/core/workspace/snapshot/{SNAP_NAME}.json")
        check("snapshot GET (export-read)",
              st == 200 and snap.get("v") == 2
              and len(snap.get("terminals", [])) == 2
              and len(snap.get("spaces", [])) == 2,
              f"{st} terms={len(snap.get('terminals', [])) if isinstance(snap, dict) else '?'}")
        payload = snap if isinstance(snap, dict) else {}

        # --- B: import ---
        print("\n== B: import + restore ==")
        proc_b, log_b = start_daemon(port_b, base_b)
        print(f"daemon B: pid={proc_b.pid} port={port_b} "
              f"base={base_b}")
        if not wait_ready(port_b, proc_b, time.time() + 25):
            print("FAIL: daemon B не поднялся")
            return 2

        st, d = api(port_b, "POST", "/api/core/workspace/import",
                    {"snapshot": payload})
        check("import", st == 201
              and d.get("file") == f"{SNAP_NAME}.json",
              f"{st} {d}")

        st, d = api(port_b, "GET",
                    "/api/core/workspace/snapshots")
        check("B snapshots list", st == 200
              and any(s.get("name") == SNAP_NAME
                      for s in d.get("snapshots", [])),
              f"{st} {d.get('count')}")

        st, d = api(port_b, "GET",
                    f"/api/core/workspace/restore/preview"
                    f"?name={SNAP_NAME}")
        spawn = sorted(d.get("would_spawn", [])) \
            if isinstance(d, dict) else []
        check("restore preview", st == 200
              and spawn == ["wst1", "wst2"]
              and d.get("would_skip") == [],
              f"{st} spawn={spawn} skip={d.get('would_skip')}")

        st, d = api(port_b, "POST", "/api/core/workspace/restore",
                    {"name": SNAP_NAME})
        created = sorted(d.get("created", [])) \
            if isinstance(d, dict) else []
        sres = sorted(d.get("spaces_restored", [])) \
            if isinstance(d, dict) else []
        check("restore execute", st == 200
              and created == ["local/wst1", "local/wst2"]
              and not d.get("failed")
              and sres == ["dev", "ops"],
              f"{st} created={created} spaces={sres} "
              f"failed={d.get('failed')}")

        # --- B: verify terminals живы ---
        print("\n== B: verify ==")
        deadline = time.time() + 20
        states = {}
        while time.time() < deadline:
            tm = term_map(port_b)
            states = {a: t.get("state")
                      for a, t in tm.items()
                      if a in ("local/wst1", "local/wst2")}
            if len(states) == 2 and all(
                    s not in (None, "restoring")
                    for s in states.values()):
                break
            time.sleep(0.7)
        check("B terminals restored",
              set(states) == {"local/wst1", "local/wst2"}
              and all(s not in (None, "restoring", "exited")
                      for s in states.values()),
              f"{states}")

        tm = term_map(port_b)
        spaces_ok = all(
            (tm.get(f"local/{n}") or {}).get("space") == sp
            for n, sp in (("wst1", "ops"), ("wst2", "dev")))
        check("B space membership", spaces_ok,
              f"wst1={ (tm.get('local/wst1') or {}).get('space') } "
              f"wst2={ (tm.get('local/wst2') or {}).get('space') }")

        # scrollback roundtrip: маркер из A виден в dump на B
        m1 = wait_marker(port_b, "wst1", "WSR-MARKER-1", timeout=8)
        m2 = wait_marker(port_b, "wst2", "WSR-MARKER-2", timeout=8)
        check("B scrollback markers", m1 and m2,
              f"wst1={m1} wst2={m2}")

        # spaces.json на B: custom entries ops/dev созданы restore'ом
        st, d = api(port_b, "GET", "/api/core/spaces")
        space_ids = {s.get("id") for s in
                     (d.get("spaces", []) if isinstance(d, dict)
                      else [])}
        check("B spaces visible", {"ops", "dev"} <= space_ids,
              f"{sorted(space_ids)}")
    finally:
        for proc, log in ((proc_a, log_a), (proc_b, log_b)):
            if proc is not None:
                stop_daemon(proc, log)
        if not args.keep:
            for b in (base_a, base_b):
                shutil.rmtree(b, ignore_errors=True)

    print("\n" + "=" * 50)
    fails = [n for n, ok, _ in _results if not ok]
    print(f"{len(_results) - len(fails)}/{len(_results)} PASS"
          + (f" — FAIL: {', '.join(fails)}" if fails else ""))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
