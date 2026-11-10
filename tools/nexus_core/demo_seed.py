#!/usr/bin/env python3
"""demo_seed.py — W85 v2: 6-терминальная multi-space демо-сцена.

Поднимает scratch nexus-core и засевает живую NEWF-сцену:

  spaces:  ops · dev · agents   (custom spaces через /api/core/space,
           членство — POST /terminal/{n}/migrate)
  terms:   t1 ops-deploy   → ops    (victim: pending dual-control kill)
           t2 ops-watch    → ops    (idle monitor)
           t3 dev-build    → dev    (busy: ping -n 600 → live output)
           t4 dev-test     → dev    (echo marker, idle)
           t5 agent-sage   → agents (echo marker)
           t6 agent-heretic→ agents (echo marker)

AEGIS-слой (как v1): AEGIS_ADMIN_KEYS demo1/demo2 (JSON!), webhook
на exited t1, gate-policy dual_control на *, pending kill t1 —
DEMO_WALKTHROUGH flow воспроизводим.

Запуск:  python tools/nexus_core/demo_seed.py --port 5799 [--keep]
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

# name → (space, role-label, cmd-argv, input-text|None)
SCENE = [
    ("t1", "ops",     "deploy",   ["cmd.exe"],            "echo OPS-DEPLOY-READY"),
    ("t2", "ops",     "monitor",  ["cmd.exe"],            "echo OPS-WATCH-IDLE"),
    ("t3", "dev",     "builder",  ["cmd.exe"],            "ping -n 600 127.0.0.1"),
    ("t4", "dev",     "qa",       ["cmd.exe"],            "echo DEV-TEST-OK"),
    ("t5", "agents",  "sage",     ["cmd.exe"],            "echo AGENT-SAGE-ONLINE"),
    ("t6", "agents",  "heretic",  ["cmd.exe"],            "echo AGENT-HERETIC-ONLINE"),
]
SPACES = ["ops", "dev", "agents"]
VICTIM = "t1"


def api(method, path, payload=None, timeout=15):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url + path, data=data, method=method, headers={"Content-Type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8", "replace")
            return r.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"error": raw}
    except Exception as e:
        return 0, {"error": str(e)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=5799)
    ap.add_argument("--base", default=None)
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()
    base = args.base or os.path.join(os.getcwd(), f"nc-seed-{args.port}")
    os.makedirs(base, exist_ok=True)
    global url
    url = f"http://127.0.0.1:{args.port}"
    # no initial gate-policy: create resources first, then add policy.
    log = open(os.path.join(base, "seed.log"), "w")
    admin_keys = json.dumps({
        "demo1": {"name": "demo1", "roles": ["operator"]},
        "demo2": {"name": "demo2", "roles": ["operator"]},
    })
    proc = subprocess.Popen([sys.executable, os.path.join(ROOT, "tools", "nexus_core", "api.py"), "--port", str(args.port), "--base", base],
                           stdout=log, stderr=subprocess.STDOUT, env=dict(os.environ, PYTHONPATH=ROOT, AEGIS_ADMIN_KEYS=admin_keys))
    for _ in range(30):
        try:
            urllib.request.urlopen(url + "/api/core/server", timeout=1).read()
            break
        except Exception:
            time.sleep(0.5)
    else:
        proc.terminate(); proc.wait(timeout=10); log.close(); print("daemon not ready", file=sys.stderr); sys.exit(1)

    # --- spaces ---
    for sp in SPACES:
        st, d = api("POST", "/api/core/space", {"name": sp})
        print(f"space {sp}: {st} {d.get('id', d.get('error', ''))}")

    # --- terminals: spawn → migrate → activity ---
    for name, space, role, cmd, text in SCENE:
        st, d = api("POST", "/api/core/run",
                    {"name": name, "command": cmd,
                     "labels": {"space": space, "role": role}})
        print(f"run {name}: {st} {d.get('address', d.get('error', ''))}")
        time.sleep(0.4)
        st, d = api("POST", f"/api/core/terminal/{name}/migrate",
                    {"space": space})
        print(f"  migrate→{space}: {st} eff={d.get('effective_space', d.get('error', ''))}")
        if text:
            api("POST", "/api/core/send", {"term": name, "text": text, "enter": True})
    time.sleep(1.5)  # дать ConPTY осесть и echo/маркиерам появиться

    # --- webhook на exited t1 (как v1) ---
    api("POST", "/api/core/terminal/t1/on-event", {"url": "http://127.0.0.1:8787/hook", "events": ["exited"], "secret": "demo-secret"})

    # --- gate-policy только ПОСЛЕ создания ресурсов (как v1) ---
    gp = os.path.join(base, "gate-policy.json")
    with open(gp, "w", encoding="utf-8") as f:
        json.dump([{"match": {"action": "*"}, "decision": "require_approval", "dual_control": True}], f)
    # trigger pending approval
    api("POST", "/api/core/kill", {"term": VICTIM, "stage": "terminate"})
    status, appr = api("GET", "/api/core/approvals")
    pending = len(appr.get("approvals", [])) + len(appr.get("mutations", [])) if isinstance(appr, dict) else 0
    print(f"DEMO READY: {url} (base={base})")
    print(f"spaces: {', '.join(SPACES)}; terminals: {', '.join(n for n, *_ in SCENE)}")
    print(f"scene: t1=ops-deploy(victim), t2=ops-watch, t3=dev-build(ping-busy), t4=dev-test, t5=agent-sage, t6=agent-heretic")
    print(f"webhook armed on t1; pending approvals: {pending}")
    if not args.keep:
        proc.terminate(); proc.wait(timeout=10)
    log.close()


if __name__ == "__main__":
    main()
