#!/usr/bin/env python3
"""W93: screen-marker flake stats — N прогонов test_e2e_chain, каждый на
СВЕЖЕМ scratch-демоне (изоляция: общий демон упирается в cap терминалов
и каскадит FAIL — не flake, а dirty-state). Полный вывод в
D:\\Temp\\w93-runs\\run-NN.log; сводка JSON в stdout.

Использование: python tools/nexus_core/w93_flake_loop.py [--runs N]
"""
import argparse, json, os, shutil, subprocess, sys, time, urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("--runs", type=int, default=12)
ap.add_argument("--port", type=int, default=5697)
ap.add_argument("--script", default=os.path.join(os.path.dirname(__file__), "test_e2e_chain.py"))
ap.add_argument("--outdir", default=r"D:\Temp\w93-runs")
ap.add_argument("--state-root", default=r"D:\Temp\w93-state")
args = ap.parse_args()

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
API = os.path.join(REPO, "tools", "nexus_core", "api.py")
PY = sys.executable
BASE = f"http://127.0.0.1:{args.port}"
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def wait_up(timeout=30):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            with _opener.open(f"{BASE}/api/core/server", timeout=2) as r:
                if r.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(0.5)
    return False


os.makedirs(args.outdir, exist_ok=True)
results = []
for i in range(args.runs):
    state = os.path.join(args.state_root, f"run-{i+1:02d}")
    shutil.rmtree(state, ignore_errors=True)
    os.makedirs(state, exist_ok=True)
    env = dict(os.environ, PYTHONPATH=REPO)
    srv = subprocess.Popen(
        [PY, API, "--port", str(args.port), "--base", state],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
    try:
        if not wait_up():
            results.append({"run": i + 1, "ok": False, "error": "daemon no-up"})
            print(f"[{i+1}/{args.runs}] DAEMON NO-UP", flush=True)
            continue
        t0 = time.time()
        p = subprocess.run([PY, args.script], capture_output=True,
                           text=True, timeout=600,
                           env=dict(os.environ, NEXUS_CORE_URL=BASE))
        dt = time.time() - t0
        out = (p.stdout or "") + ("\n--- STDERR ---\n" + p.stderr if p.stderr else "")
        log = os.path.join(args.outdir, f"run-{i+1:02d}.log")
        with open(log, "w", encoding="utf-8") as f:
            f.write(out)
        screen_line = next((l.strip() for l in out.splitlines()
                            if "screen:" in l and "marker" in l), "")
        summary = next((l.strip() for l in out.splitlines()
                        if l.startswith("PASS:")), "")
        ok = p.returncode == 0
        results.append({"run": i + 1, "rc": p.returncode,
                        "sec": round(dt, 1), "ok": ok,
                        "screen": screen_line, "summary": summary})
        print(f"[{i+1}/{args.runs}] rc={p.returncode} {dt:.0f}s "
              f"{screen_line} {summary}", flush=True)
    finally:
        srv.terminate()
        try:
            srv.wait(timeout=8)
        except subprocess.TimeoutExpired:
            srv.kill()

n_ok = sum(r["ok"] for r in results)
print(json.dumps({"runs": args.runs, "pass": n_ok,
                  "rate": round(n_ok / args.runs, 3),
                  "fails": [r["run"] for r in results if not r["ok"]]}, indent=2))
