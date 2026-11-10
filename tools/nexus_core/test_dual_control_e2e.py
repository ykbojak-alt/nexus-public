#!/usr/bin/env python3
"""test_dual_control_e2e.py — W70 standalone e2e для W6 dual-control.

HERETIC не осилил формализацию (W592 placeholder) — этот скрипт
поднимает СВОЙ scratch nexus-core (subprocess, реальный backend —
CORE_MOCK из env снимается) с AEGIS_ADMIN_KEYS на двух principals
и gate-policy.json, затем прогоняет ручной сценарий:

  kill (опасный action) → 202 {dual_control:true, required:2}
  alice approve          → 202 pending decided_by=[alice]
  alice approve повторно → 409 approver already decided
  bob approve            → 200 executed, терминал killed

W72+: deny-path (approved:false → denied, жертва жива —
fail-safe) и TTL-expiry (NEXUS_APPROVAL_TTL_S=5, approve после
sleep → 410 expired, мутация не исполнена).

Контраст single-control: send (не-опасный) при require_approval →
202 БЕЗ dual_control → ОДИН approve → executed.

Запуск:  python tools/nexus_core/test_dual_control_e2e.py [--port N]
Выход:   0 все PASS / 1 есть FAIL / 2 окружение. Только stdlib.
Импорт модуля безопасен (pytest collection не запускает main).
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
POLICY = [
    {"match": {"action": "kill"}, "decision": "require_approval"},
    {"match": {"action": "send"}, "decision": "require_approval"},
]
ADMIN_KEYS = {
    "ka": {"name": "alice", "roles": ["operator"]},
    "kb": {"name": "bob", "roles": ["operator"]},
}
# W76: AEGIS-политика с escalate-правилом — guardian M-of-N путь.
# guardian_vote работает с gate._pending (escalate), НЕ с
# mutation_approvals — отдельная система апрувов.
GUARDIAN_POLICY = {
    "version": "9.9-g",
    "default_outcome": "deny",
    "rules": [{
        "id": "ESC-MUT",
        "description": "escalate all terminal mutations",
        "operation": "core.terminal_mutation",
        "agent": "*",
        "outcome": "escalate",
        "priority": 0,
        "active": True,
    }],
}
GUARDIAN_KEYS = {
    **ADMIN_KEYS,
    "kc": {"name": "carol", "roles": ["operator"]},  # не guardian
}
TIMEOUT = 30

_results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, note: str = "") -> None:
    _results.append((name, ok, note))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}"
          + (f" — {note}" if note else ""))


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def api(port: int, method: str, path: str, body=None,
        aegis_key: str | None = None):
    url = f"http://127.0.0.1:{port}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if aegis_key:
        req.add_header("X-AEGIS-Key", aegis_key)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            raw = r.read()
            try:
                return r.status, json.loads(raw)
            except json.JSONDecodeError:
                return r.status, {"_raw": raw[:200].decode("utf-8", "replace")}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, {"_raw": raw[:200].decode("utf-8", "replace")}


def wait_ready(port: int, proc: subprocess.Popen, deadline: float) -> bool:
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


def term_state(port: int, addr: str) -> str | None:
    st, data = api(port, "GET", "/api/core/terminals")
    if st != 200:
        return None
    terms = data if isinstance(data, list) else data.get("terminals", [])
    for t in terms:
        if t.get("address") == addr:
            return t.get("state")
    return None


def start_daemon(port: int, base: Path, env: dict):
    """Поднять scratch core; вернуть (proc, log-fh)."""
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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=0,
                    help="0 = свободный порт")
    ap.add_argument("--keep", action="store_true",
                    help="не убивать scratch-демон (debug)")
    args = ap.parse_args()
    port = args.port or free_port()
    port2 = port  # W73 может пересадить daemon на второй порт
    base = Path(tempfile.mkdtemp(prefix="nexus-dual-e2e-"))
    (base / "gate-policy.json").write_text(
        json.dumps(POLICY), encoding="utf-8")

    env = dict(os.environ)
    env["AEGIS_ADMIN_KEYS"] = json.dumps(ADMIN_KEYS)
    env["AEGIS_ADMIN_TOKEN"] = ""
    env["NEXUS_CORE_TOKEN"] = ""
    env["NEXUS_CORE_READ_TOKEN"] = ""
    env["NEXUS_APPROVAL_TTL_S"] = "5"  # W72: TTL-expiry сценарий
    env.pop("CORE_MOCK", None)  # реальный backend — настоящий e2e

    proc, log = start_daemon(port, base, env)
    print(f"scratch core: pid={proc.pid} port={port} base={base}")
    try:
        if not wait_ready(port, proc, time.time() + 25):
            print("FAIL: core не поднялся за 25s — см. server.log")
            return 2
        print("core ready\n== dual-control: kill ==")

        st, d = api(port, "POST", "/api/core/run",
                    {"command": ["cmd"], "name": "e2e-victim"})
        check("spawn victim", st == 200, f"{st} {d.get('address', '')}")
        time.sleep(1.5)  # ConPTY init

        st, d = api(port, "POST", "/api/core/kill",
                    {"term": "local/e2e-victim"})
        aid = d.get("approval_id", "")
        check("kill → 202 dual", st == 202
              and d.get("dual_control") is True
              and d.get("required_approvals") == 2,
              f"{st} {d}")
        if not aid:
            return 1

        st, d = api(port, "POST", f"/api/core/approvals/{aid}",
                    {"approved": True}, aegis_key="ka")
        check("alice vote → pending", st == 202
              and d.get("status") == "pending"
              and d.get("decided_by") == ["alice"]
              and d.get("remaining") == 1, f"{st} {d}")
        alive = term_state(port, "local/e2e-victim")
        check("victim still alive", alive not in (None, "exited"),
              f"state={alive}")

        st, d = api(port, "POST", f"/api/core/approvals/{aid}",
                    {"approved": True}, aegis_key="ka")
        check("alice dup → 409", st == 409
              and "already decided" in str(d.get("error", "")),
              f"{st} {d.get('error')}")

        st, d = api(port, "POST", f"/api/core/approvals/{aid}",
                    {"approved": True}, aegis_key="kb")
        check("bob vote → executed", st == 200
              and d.get("status") == "executed", f"{st} {d}")
        deadline = time.time() + 12
        state = term_state(port, "local/e2e-victim")
        while state not in ("exited", "lost") and time.time() < deadline:
            time.sleep(0.5)
            state = term_state(port, "local/e2e-victim")
        check("victim exited", state in ("exited", "lost"),
              f"state={state}")

        print("== deny-path: kill (fail-safe) ==")
        st, d = api(port, "POST", "/api/core/run",
                    {"command": ["cmd"], "name": "e2e-deny"})
        check("spawn deny-term", st == 200, f"{st}")
        time.sleep(1.0)
        st, d = api(port, "POST", "/api/core/kill",
                    {"term": "local/e2e-deny"})
        did = d.get("approval_id", "")
        check("deny kill → 202", st == 202 and bool(did), f"{st} {d}")
        if did:
            st, d = api(port, "POST",
                        f"/api/core/approvals/{did}",
                        {"approved": False}, aegis_key="ka")
            check("alice deny → denied", st == 200
                  and d.get("status") == "denied", f"{st} {d}")
            time.sleep(0.5)
            alive = term_state(port, "local/e2e-deny")
            check("deny victim alive", alive not in (None, "exited"),
                  f"state={alive}")

        print("== TTL-expiry: kill ==")
        st, d = api(port, "POST", "/api/core/run",
                    {"command": ["cmd"], "name": "e2e-ttl"})
        check("spawn ttl-term", st == 200, f"{st}")
        time.sleep(1.0)
        st, d = api(port, "POST", "/api/core/kill",
                    {"term": "local/e2e-ttl"})
        tid = d.get("approval_id", "")
        check("ttl kill → 202", st == 202 and bool(tid), f"{st} {d}")
        if tid:
            time.sleep(6.5)  # NEXUS_APPROVAL_TTL_S=5 + запас
            st, d = api(port, "POST",
                        f"/api/core/approvals/{tid}",
                        {"approved": True}, aegis_key="kb")
            check("approve after TTL → 410 expired", st in (409, 410)
                  and "expired" in str(d.get("error", "")),
                  f"{st} {d}")
            alive = term_state(port, "local/e2e-ttl")
            check("ttl victim alive (not executed)",
                  alive not in (None, "exited"), f"state={alive}")
            st, d = api(port, "POST",
                        f"/api/core/approvals/{tid}",
                        {"approved": True}, aegis_key="ka")
            check("re-approve expired → 410", st == 410,
                  f"{st} {d.get('error')}")

        print("== single-control contrast: send ==")
        st, d = api(port, "POST", "/api/core/run",
                    {"command": ["cmd"], "name": "e2e-snd"})
        check("spawn send-term", st == 200, f"{st}")
        time.sleep(1.0)
        st, d = api(port, "POST", "/api/core/send",
                    {"term": "local/e2e-snd", "text": "hi"})
        sid = d.get("approval_id", "")
        check("send → 202 single (no dual)", st == 202
              and not d.get("dual_control"), f"{st} {d}")
        if sid:
            st, d = api(port, "POST",
                        f"/api/core/approvals/{sid}",
                        {"approved": True}, aegis_key="ka")
            check("one approve → executed", st == 200
                  and d.get("status") == "executed", f"{st} {d}")

        print("== cleanup: kill leftover terms ==")
        for name in ("e2e-deny", "e2e-ttl", "e2e-snd"):
            st, d = api(port, "POST", "/api/core/kill",
                        {"term": f"local/{name}"})
            cid = d.get("approval_id", "")
            if cid:  # dual: ka + kb → executed
                api(port, "POST", f"/api/core/approvals/{cid}",
                    {"approved": True}, aegis_key="ka")
                api(port, "POST", f"/api/core/approvals/{cid}",
                    {"approved": True}, aegis_key="kb")

        print("== W73: approval persistence across restart ==")
        # daemon2/3: TTL обратно на 600 — рестарт не должен съесть
        # pending approval (expires_at фиксируется при создании).
        env2 = dict(env)
        env2.pop("NEXUS_APPROVAL_TTL_S", None)
        port2 = free_port()
        stop_daemon(proc, log)
        proc, log = start_daemon(port2, base, env2)
        up = wait_ready(port2, proc, time.time() + 25)
        check("persist daemon up", up)
        apid = ""
        if up:
            st, d = api(port2, "POST", "/api/core/run",
                        {"command": ["cmd"], "name": "e2e-persist"})
            check("spawn persist-term", st == 200, f"{st}")
            time.sleep(1.0)
            st, d = api(port2, "POST", "/api/core/kill",
                        {"term": "local/e2e-persist"})
            apid = d.get("approval_id", "")
            check("persist kill → 202", st == 202 and bool(apid),
                  f"{st} {d}")
            if apid:
                st, d = api(port2, "POST",
                            f"/api/core/approvals/{apid}",
                            {"approved": True}, aegis_key="ka")
                check("alice vote → pending", st == 202
                      and d.get("decided_by") == ["alice"],
                      f"{st} {d}")
                try:
                    snap = json.loads((base / "approvals.json")
                                      .read_text(encoding="utf-8"))
                    on_disk = apid in snap.get("approvals", {})
                except Exception:
                    on_disk = False
                check("approvals.json has record", on_disk)

                stop_daemon(proc, log)  # kill демона с pending
                proc, log = start_daemon(port2, base, env2)
                up = wait_ready(port2, proc, time.time() + 25)
                check("restart daemon up", up)
                if up:
                    st, d = api(port2, "GET", "/api/core/approvals")
                    muts = (d.get("mutations", [])
                            if isinstance(d, dict) else [])
                    rec = next((m for m in muts
                                if m.get("approval_id") == apid), None)
                    check("approval survives restart",
                          rec is not None
                          and rec.get("decided_by") == ["alice"],
                          f"{rec}")
                    # W89(b): approvals.json disk-roundtrip после
                    # W87 persist-before-consume — файл на диске
                    # парсится и несёт ту же запись (status/decided/
                    # expires_at), не «полу-записанный» state.
                    try:
                        disk = json.loads(
                            (base / "approvals.json")
                            .read_text(encoding="utf-8"))
                        drec = disk.get("approvals", {}).get(apid, {})
                        disk_ok = (drec.get("status") == "pending"
                                   and drec.get("decided_by")
                                   == ["alice"]
                                   and isinstance(
                                       drec.get("expires_at"),
                                       (int, float)))
                    except Exception:
                        disk_ok = False
                    check("approvals.json disk roundtrip", disk_ok)
                    # ждём restore терминала из registry — state
                    # появляется как "restoring" раньше рабочего;
                    # approve во время restoring → replay 409 (flake).
                    deadline = time.time() + 30
                    state = term_state(port2, "local/e2e-persist")
                    while (state in (None, "restoring")
                           and time.time() < deadline):
                        time.sleep(0.5)
                        state = term_state(port2, "local/e2e-persist")
                    check("persist term restored",
                          state not in (None, "restoring"),
                          f"state={state}")
                    st, d = api(port2, "POST",
                                f"/api/core/approvals/{apid}",
                                {"approved": True}, aegis_key="ka")
                    check("alice dup post-restart → 409", st == 409,
                          f"{st} {d.get('error')}")
                    st, d = api(port2, "POST",
                                f"/api/core/approvals/{apid}",
                                {"approved": True}, aegis_key="kb")
                    check("bob approve → executed", st == 200
                          and d.get("status") == "executed",
                          f"{st} {d}")
                    deadline = time.time() + 12
                    state = term_state(port2, "local/e2e-persist")
                    while (state not in ("exited", "lost")
                           and time.time() < deadline):
                        time.sleep(0.5)
                        state = term_state(port2, "local/e2e-persist")
                    check("persist victim exited",
                          state in ("exited", "lost"), f"state={state}")

        # ================= W76: guardian M-of-N vote path =================
        # Отдельный демон БЕЗ gate-policy.json: чистый AEGIS escalate-путь.
        # guardian_vote работает с gate._pending (escalate-аппрувалы),
        # это ОТДЕЛЬНАЯ система от mutation_approvals (gate-policy defer):
        # escalate → клиент ретраит с intent_hash, а не server-side replay.
        print("\n== guardian-vote: AEGIS escalate + guardians ==")
        gbase = Path(tempfile.mkdtemp(prefix="nexus-guardian-e2e-"))
        genv = dict(env)
        genv["AEGIS_ADMIN_KEYS"] = json.dumps(GUARDIAN_KEYS)
        genv["AEGIS_GUARDIANS"] = "alice,bob"       # identity names!
        genv["AEGIS_GUARDIAN_THRESHOLD"] = "2"
        # W77: короткий TTL — expired-permit сценарий (sleep > TTL).
        genv["AEGIS_APPROVAL_TTL_S"] = "8"
        gport = free_port()
        gproc, glog = start_daemon(gport, gbase, genv)
        try:
            if not wait_ready(gport, gproc, time.time() + 25):
                check("guardian daemon up", False, "no ready in 25s")
            else:
                check("guardian daemon up", True)
                # victim создаём под default_policy (permit
                # core.terminal_mutation) — до смены политики
                st, d = api(gport, "POST", "/api/core/run",
                            {"command": ["cmd"], "name": "gv-victim"})
                check("spawn gv-victim", st == 200, f"{st} {d}")
                time.sleep(1.5)  # ConPTY init
                # hot-reload политики: все terminal mutations → escalate
                st, d = api(gport, "POST", "/api/core/policy",
                            {"policy": GUARDIAN_POLICY}, aegis_key="ka")
                check("policy → escalate reloaded", st == 200
                      and d.get("status") == "reloaded", f"{st} {d}")
                # kill → AEGIS escalate → 202 {approval_id, intent_hash}
                st, d = api(gport, "POST", "/api/core/kill",
                            {"term": "local/gv-victim"})
                gaid = d.get("approval_id", "")
                gintent = d.get("intent_hash", "")
                check("kill → 202 escalate", st == 202
                      and d.get("outcome") == "escalate"
                      and bool(gaid) and bool(gintent), f"{st} {d}")
                # pending escalate виден в /approvals
                st, d = api(gport, "GET", "/api/core/approvals")
                check("escalate approval listed",
                      gaid in json.dumps(d), f"{st}")
                if gaid:
                    # carol — admin, но НЕ guardian → 403
                    st, d = api(gport, "POST",
                                f"/api/core/approvals/{gaid}/vote",
                                {"decision": "approve", "note": "intruder"},
                                aegis_key="kc")
                    check("non-guardian vote → 403", st == 403,
                          f"{st} {d}")
                    # guardian1 approve + note → 1/2 pending
                    st, d = api(gport, "POST",
                                f"/api/core/approvals/{gaid}/vote",
                                {"decision": "approve",
                                 "note": "first-ok"},
                                aegis_key="ka")
                    check("g1 approve → pending 1/2", st == 200
                          and d.get("released") is False
                          and d.get("approve_count") == 1
                          and d.get("threshold") == 2, f"{st} {d}")
                    # note виден в votes-status (ответ под ключом "guardian")
                    st, d = api(gport, "GET",
                                f"/api/core/approvals/{gaid}/votes")
                    gs = d.get("guardian") or {}
                    v1 = (gs.get("votes") or {}).get("alice") or {}
                    check("vote note recorded", st == 200
                          and v1.get("decision") == "approve"
                          and v1.get("note") == "first-ok"
                          and gs.get("approve_count") == 1
                          and gs.get("pending") is True, f"{st} {d}")
                    # повторный голос того же guardian → 409
                    st, d = api(gport, "POST",
                                f"/api/core/approvals/{gaid}/vote",
                                {"decision": "approve"}, aegis_key="ka")
                    check("g1 dup vote → 409", st == 409, f"{st} {d}")
                    # guardian2 approve → threshold → release
                    st, d = api(gport, "POST",
                                f"/api/core/approvals/{gaid}/vote",
                                {"decision": "approve",
                                 "note": "second-ok"},
                                aegis_key="kb")
                    check("g2 approve → released", st == 200
                          and d.get("released") is True
                          and d.get("approved") is True, f"{st} {d}")
                    # post-release: pending снят, голоса очищены
                    st, d = api(gport, "GET",
                                f"/api/core/approvals/{gaid}/votes")
                    gs = d.get("guardian") or {}
                    check("votes cleared post-release", st == 200
                          and gs.get("pending") is False
                          and gs.get("votes") == {}, f"{st} {d}")
                    # W77: release → approve() mint'ит consume-on-execute
                    # permit → ретрай с intent_hash ИСПОЛНЯЕТСЯ (200).
                    st, d = api(gport, "POST", "/api/core/kill",
                                {"term": "local/gv-victim",
                                 "intent_hash": gintent})
                    check("retry+intent_hash → EXECUTED", st == 200,
                          f"{st} {d}")
                    deadline = time.time() + 12
                    state = term_state(gport, "local/gv-victim")
                    while (state not in ("exited", "lost")
                           and time.time() < deadline):
                        time.sleep(0.5)
                        state = term_state(gport, "local/gv-victim")
                    check("gv-victim exited", state in ("exited", "lost"),
                          f"state={state}")
                    # повторный идентичный ретрай: permit consumed →
                    # evaluate → новая эскалация (single-use, fail-safe)
                    st, d = api(gport, "POST", "/api/core/kill",
                                {"term": "local/gv-victim",
                                 "intent_hash": gintent})
                    check("permit reuse → re-escalate", st == 202
                          and d.get("outcome") == "escalate"
                          and d.get("approval_id") != gaid,
                          f"{st} {d}")
                    aid2 = d.get("approval_id", "")
                    intent2 = d.get("intent_hash", "")
                    # доводим aid2 до release → второй permit
                    if aid2:
                        api(gport, "POST",
                            f"/api/core/approvals/{aid2}/vote",
                            {"decision": "approve"}, aegis_key="ka")
                        st, d = api(gport, "POST",
                                    f"/api/core/approvals/{aid2}/vote",
                                    {"decision": "approve"},
                                    aegis_key="kb")
                        check("aid2 released → permit2", st == 200
                              and d.get("released") is True, f"{st} {d}")
                    # expired: permit2.expires_at = TTL заявки (8s) —
                    # ждём >TTL и ретраим → permit мёртв → re-escalate
                    time.sleep(10)
                    st, d = api(gport, "POST", "/api/core/kill",
                                {"term": "local/gv-victim",
                                 "intent_hash": intent2})
                    check("expired permit → re-escalate", st == 202
                          and d.get("outcome") == "escalate",
                          f"{st} {d}")
        finally:
            if args.keep:
                print(f"--keep: guardian daemon pid={gproc.pid} "
                      f"port={gport} base={gbase}")
            else:
                stop_daemon(gproc, glog)
                shutil.rmtree(gbase, ignore_errors=True)

        # ============ W83: permit переживает рестарт демона ============
        # escalate → guardian votes → release (permit minted,
        # aegis-windows.json) → kill демона → restart на ТОМ ЖЕ base →
        # re-apply той же политики (canonical → тот же policy_hash) →
        # retry с intent_hash → 200 EXECUTED через permit-consume
        # (evaluate под escalate-политикой дал бы 202). Повторный ретрай
        # → 202: single-use сохраняется и post-restart.
        print("\n== W83: permit restart-edge ==")
        rbase = Path(tempfile.mkdtemp(prefix="nexus-permit-rst-e2e-"))
        renv = dict(env)
        renv["AEGIS_ADMIN_KEYS"] = json.dumps(GUARDIAN_KEYS)
        renv["AEGIS_GUARDIANS"] = "alice,bob"
        renv["AEGIS_GUARDIAN_THRESHOLD"] = "2"
        # TTL большой: restart ~10с не должен экспайрить permit
        renv["AEGIS_APPROVAL_TTL_S"] = "120"
        rport = free_port()
        rproc, rlog = start_daemon(rport, rbase, renv)
        try:
            if not wait_ready(rport, rproc, time.time() + 25):
                check("W83 daemon up", False, "no ready in 25s")
            else:
                check("W83 daemon up", True)
                st, d = api(rport, "POST", "/api/core/run",
                            {"command": ["cmd"], "name": "pr-victim",
                             "keep": True})
                check("spawn pr-victim", st == 200, f"{st} {d}")
                time.sleep(1.5)
                st, d = api(rport, "POST", "/api/core/policy",
                            {"policy": GUARDIAN_POLICY}, aegis_key="ka")
                check("policy → escalate", st == 200
                      and d.get("status") == "reloaded", f"{st} {d}")
                st, d = api(rport, "POST", "/api/core/kill",
                            {"term": "local/pr-victim"})
                paid = d.get("approval_id", "")
                pintent = d.get("intent_hash", "")
                check("kill → 202 escalate", st == 202
                      and bool(paid) and bool(pintent), f"{st} {d}")
                if paid:
                    api(rport, "POST",
                        f"/api/core/approvals/{paid}/vote",
                        {"decision": "approve"}, aegis_key="ka")
                    st, d = api(rport, "POST",
                                f"/api/core/approvals/{paid}/vote",
                                {"decision": "approve"}, aegis_key="kb")
                    check("votes → released (permit minted)", st == 200
                          and d.get("released") is True, f"{st} {d}")
                    # permit на диске до убийства демона
                    wins_path = rbase / "aegis-windows.json"
                    permits = {}
                    try:
                        wins = json.loads(
                            wins_path.read_text(encoding="utf-8"))
                        permits = wins.get("permits") or {}
                    except Exception as we:
                        check("aegis-windows.json readable",
                              False, str(we))
                    live = [p for p in permits.values()
                            if not p.get("consumed")]
                    check("permit persisted on disk", len(live) >= 1,
                          f"permits={len(permits)}")
                    # --- kill демона, restart на том же base ---
                    stop_daemon(rproc, rlog)
                    rproc, rlog = start_daemon(rport, rbase, renv)
                    up = wait_ready(rport, rproc, time.time() + 25)
                    check("W83 restart daemon up", up)
                    if up:
                        # re-apply escalate-политики: canonical() →
                        # детерминированный hash → permit.policy_hash
                        # снова совпадает → consume сработает.
                        st, d = api(rport, "POST", "/api/core/policy",
                                    {"policy": GUARDIAN_POLICY},
                                    aegis_key="ka")
                        check("policy re-applied post-restart", st == 200
                              and d.get("status") == "reloaded",
                              f"{st} {d}")
                        # registry restore асинхронен: мутации по
                        # restoring-терминалу → 409. Ждём выхода
                        # из состояния restoring (keep → respawn shell).
                        rdeadline = time.time() + 30
                        rstate = term_state(rport, "local/pr-victim")
                        while (rstate == "restoring"
                               and time.time() < rdeadline):
                            time.sleep(0.5)
                            rstate = term_state(rport,
                                                "local/pr-victim")
                        check("pr-victim restored", rstate not in
                              (None, "restoring"), f"state={rstate}")
                        # retry → permit-consume → 200 EXECUTED
                        # (evaluate под escalate дал бы 202)
                        st, d = api(rport, "POST", "/api/core/kill",
                                    {"term": "local/pr-victim",
                                     "intent_hash": pintent})
                        check("post-restart retry → EXECUTED", st == 200,
                              f"{st} {d}")
                        deadline = time.time() + 15
                        state = term_state(rport, "local/pr-victim")
                        while (state not in ("exited", "lost")
                               and time.time() < deadline):
                            time.sleep(0.5)
                            state = term_state(rport,
                                               "local/pr-victim")
                        check("pr-victim exited post-restart",
                              state in ("exited", "lost"),
                              f"state={state}")
                        # single-use post-restart: permit consumed →
                        # повторный ретрай → новая эскалация 202
                        st, d = api(rport, "POST", "/api/core/kill",
                                    {"term": "local/pr-victim",
                                     "intent_hash": pintent})
                        check("permit reuse post-restart → 202",
                              st == 202
                              and d.get("outcome") == "escalate",
                              f"{st} {d}")
        finally:
            if args.keep:
                print(f"--keep: W83 daemon pid={rproc.pid} "
                      f"port={rport} base={rbase}")
            else:
                stop_daemon(rproc, rlog)
                shutil.rmtree(rbase, ignore_errors=True)

        print("== approvals list ==")
        st, d = api(port2, "GET", "/api/core/approvals")
        check("GET approvals 200", st == 200, f"{st}")

        failed = [n for n, ok, _ in _results if not ok]
        print(f"\n{'=' * 50}\n"
              f"{len(_results) - len(failed)}/{len(_results)} PASS"
              + (f" — FAIL: {', '.join(failed)}" if failed else ""))
        return 1 if failed else 0
    finally:
        if args.keep:
            print(f"--keep: демон оставлен pid={proc.pid} "
                  f"port={port2} base={base}")
        else:
            stop_daemon(proc, log)
            shutil.rmtree(base, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
