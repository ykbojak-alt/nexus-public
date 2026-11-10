#!/usr/bin/env python3
"""iikuznitsa-agentic — воспроизводимый demo-stand (skeleton).

Сценарий (IIKUZNITSA-APPLICATION-DRAFT.md §3):
  1. Чистый core-state: запуск nexus-core на отдельной базе, два
     агентных терминала (agent-a / agent-b) в nx-рантайме.
  2. Handoff-документ: A пишет версию N → B читает ту же версию;
     показ номера версии и CAS-отказа на устаревшем base_version.
  3. Gated Core-операция: B запрашивает kill prod-db → deny 403;
     B запрашивает doc_put/kill → require_approval (202) →
     approvals → approve → мутация исполняется один раз.
  4. Видимый след: SSE-событие `policy` + gate-аудит с HMAC-цпочкой
     (audit.jsonl) + verify-эндпоинт /api/core/audit/verify.
  5. Honest offline/empty state: пустая база → 404 «no document yet»;
     до старта сервера обращение падает с ошибкой соединения.
     Фейк-данных нет: empty == пусто.

Использует ТОЛЬКО существующие API nexus_core (routes из api.py):
  GET  /api/core/server              — health
  GET  /api/core/doc/latest          — latest версия
  GET  /api/core/doc?version=N       — версия N
  POST /api/core/doc                 — запись {content, base_version?}
  POST /api/core/run                 — spawn терминала {name, command, labels}
  POST /api/core/kill                — {term, stage}
  GET  /api/core/approvals           — pending approvals
  POST /api/core/approvals/{id}      — {approved, by?} + X-AEGIS-Key
  GET  /api/core/events              — SSE (replay при подключении)
  GET  /api/core/audit               — gate trail
  GET  /api/core/audit/verify        — aegis-chain + gate-trail verify
Политика — hot-read base/gate-policy.json (см. _gate_policy_match).

Запуск:
  python demo_stand.py [--port 5801] [--base _state] [--keep-state]
Возвращает 0 при полном PASS, 1 при любом FAIL.
Reset: удалить базу (по умолчанию пересоздаётся при каждом запуске).
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ADMIN_KEYS = json.dumps({
    "demo1": {"name": "operator1", "roles": ["operator"]},
    "demo2": {"name": "operator2", "roles": ["operator"]},
})
# Политика: deny для kill prod-db; require_approval для doc_put и kill
# (kill — dual-control по W6 built-in списку опасных действий).
GATE_POLICY = [
    {"match": {"action": "kill", "subject": "prod-db"},
     "decision": "deny"},
    {"match": {"action": "doc_put"},
     "decision": "require_approval"},
    {"match": {"action": "kill"},
     "decision": "require_approval", "dual_control": True},
]

PASS = 0
FAIL = 0
SKIP = 0

# ConPTY-доступность (Windows): если бинарники отсутствуют, терминальные
# сценарии честно пропускаются, а не падают.
def conpty_available() -> bool:
    p = os.path.join(ROOT, "tools", "nexus_core", "conpty")
    return (os.path.isfile(os.path.join(p, "conpty.dll"))
            and os.path.isfile(os.path.join(p, "x64", "OpenConsole.exe")))

def report(label: str, ok: bool, extra: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  [PASS] {label}" + (f"  — {extra}" if extra else ""))
    else:
        FAIL += 1
        print(f"  [FAIL] {label}" + (f"  — {extra}" if extra else ""))

def report_skip(label: str, reason: str = "нужен ConPTY (Windows)") -> None:
    global SKIP
    SKIP += 1
    print(f"  [SKIP] {label}  — {reason}")


def api(base: str, method: str, path: str, payload=None,
        headers=None, timeout: int = 15):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    hdr = {"Content-Type": "application/json"} if data is not None else {}
    hdr.update(headers or {})
    req = urllib.request.Request(base + path, data=data, method=method,
                                 headers=hdr)
    # Прямой коннект: игнорируем http_proxy (локальный сервер).
    proxy = urllib.request.ProxyHandler({})
    opener = urllib.request.build_opener(proxy)
    try:
        with opener.open(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8", "replace")
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"error": raw}
    except Exception as e:                      # соединение/таймаут
        return 0, {"error": str(e)}


def sse_replay(url: str, seconds: float = 2.5) -> list:
    """Захват SSE с /api/core/events (replay при подключении).

    urllib читает поток построчно; события вида
        event: <type>
        data: <json>
    Прямой коннект (без http_proxy): локальный сервер.
    """
    req = urllib.request.Request(url + "/api/core/events")
    try:
        resp = urllib.request.urlopen(req, timeout=seconds + 5)
    except Exception:
        return []
    events = []
    current_type = None
    start = time.monotonic()
    while time.monotonic() - start < seconds:
        try:
            line = resp.readline()
        except Exception:
            break
        if not line:
            break
        text = line.decode("utf-8", "replace").rstrip("\r\n")
        if text.startswith("event: "):
            current_type = text[len("event: "):]
        elif text.startswith("data: "):
            payload = text[len("data: "):]
            try:
                obj = json.loads(payload)
                if "type" not in obj and current_type:
                    obj["type"] = current_type
                events.append(obj)
            except Exception:
                pass
    resp.close()
    return events


def wait_server(url: str, timeout: float = 30.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        st, _ = api(url, "GET", "/api/core/server")
        if st == 200:
            return True
        time.sleep(0.5)
    return False


# ---------------------------------------------------------------------------
# Agentic mode: реальные LLM-агенты через NexusLink (OpenAI/Anthropic
# compatible /v1/messages). Deterministic-режим остаётся fallback'ом
# (offline / без LLM): main() вызывает `agent_*`-колбэки, которые в
# scripted-режиме возвращают фиксированные значения, в agentic — решения
# модели (модель сама выбирает поля handoff-документа / содержимое запроса).
# ---------------------------------------------------------------------------

_LLM_DEFAULT_CONFIG = os.path.join(
    os.path.expanduser("~"), ".nexuslink", "config.json")


class LLMUnavailable(Exception):
    pass


class LLMClient:
    """Минимальный клиент NexusLink /v1/messages (Anthropic-совместимый
    вход). Токен читается из config.json (incoming_token). Прямой
    коннект (без http_proxy), как и api().
    """

    def __init__(self, config_path: Optional[str] = None,
                 model: str = "claude-sonnet-5"):
        cfg_path = config_path or _LLM_DEFAULT_CONFIG
        if not os.path.isfile(cfg_path):
            raise LLMUnavailable(
                f"config.json не найден: {cfg_path} — agentic требует "
                f"NexusLink-конфиг (incoming_token)")
        with open(cfg_path, "r", encoding="utf-8") as stream:
            cfg = json.load(stream)
        token = cfg.get("incoming_token")
        port = int(cfg.get("port") or 5679)
        if not token:
            raise LLMUnavailable("config.json: incoming_token пуст")
        self._url = f"http://127.0.0.1:{port}/v1/messages"
        self._headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        self.model = model
        self.proxy = urllib.request.ProxyHandler({})

    def chat(self, prompt: str, max_tokens: int = 512) -> str:
        """Один вызов; возвращает склеенный текст (без thinking-блоков)."""
        payload = {
            "model": self.model,
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(self._url, data=data, method="POST",
                                     headers=self._headers)
        opener = urllib.request.build_opener(self.proxy)
        try:
            with opener.open(req, timeout=60) as resp:
                body = json.loads(resp.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:300]
            raise LLMUnavailable(f"NexusLink HTTP {exc.code}: {detail}") from exc
        except Exception as exc:
            raise LLMUnavailable(f"NexusLink connection: {exc}") from exc
        blocks = body.get("content") or []
        text = "".join(
            b.get("text", "") for b in blocks if b.get("type") == "text")
        if not text.strip():
            err = body.get("error") or body
            raise LLMUnavailable(f"NexusLink empty reply: {err}")
        return text.strip()

    def chat_json(self, prompt: str, max_tokens: int = 512) -> dict:
        """Ответ модели как JSON-объект: ищем первый {...}-блок в тексте.
        До 2 повторов при неудачном парсинге."""
        for attempt in range(3):
            text = self.chat(prompt, max_tokens=max_tokens)
            start, end = text.find("{"), text.rfind("}")
            if start >= 0 and end > start:
                try:
                    obj = json.loads(text[start:end + 1])
                    if isinstance(obj, dict):
                        return obj
                except json.JSONDecodeError:
                    pass
            prompt = (prompt + "\n\nYour previous reply was not valid JSON. "
                      "Reply with ONLY a JSON object.")
        raise LLMUnavailable("LLM не дал валидный JSON за 3 попытки")


def _agent_write_doc_v1(api_base: str, llm: Optional[LLMClient]) -> tuple[str, str]:
    """A → handoff-doc v1. Scripted: фиксированная строка. Agentic: LLM
    сам выбирает поля (JSON-документ). Возвращает (content, label)."""
    if llm is None:
        return ("task-42: step-1 done by agent-A", "scripted")
    doc = llm.chat_json(
        "You are agent A in NEXUS. Your task: 'task-42' — подготовить "
        "handoff-документ для агента B (общий контекст). Напиши документ "
        "в формате JSON, ПОЛЯ ВЫБЕРИ САМ (например task_id, status, "
        "description, steps, owner). Ответь ТОЛЬКО JSON-объектом.")
    return json.dumps(doc, ensure_ascii=False), f"agentic(LLM {llm.model})"


def _agent_write_doc_v2(api_base: str, llm: Optional[LLMClient]) -> tuple[str, str]:
    """A → handoff-doc v2 (CAS base_version=1)."""
    if llm is None:
        return ("task-42: step-2, continue by agent-B", "scripted")
    doc = llm.chat_json(
        "You are agent A in NEXUS. Task 'task-42' шаг 2: продолжи записи "
        "handoff-документа (тот JSON-объект, добавь/обнови поля: status и "
        "steps). Ответь ТОЛЬКО JSON-объектом.")
    return json.dumps(doc, ensure_ascii=False), f"agentic(LLM {llm.model})"


def _agent_request_kill_proddb(api_base: str, llm: Optional[LLMClient]) -> tuple[dict, str]:
    """B → gated-запрос kill prod-db. Ожидается deny 403."""
    if llm is None:
        return ({"term": "prod-db", "stage": "terminate"}, "scripted")
    req = llm.chat_json(
        "You are agent B in NEXUS. Тебе нужно запросить core-операцию: "
        "завершить терминал prod-db. Сформируй запрос JSON: "
        '{"action":"kill","term":"prod-db","stage":"terminate"}. '
        "Ответь ТОЛЬКО JSON-объектом.")
    req.setdefault("action", "kill")
    req.setdefault("term", "prod-db")
    req.setdefault("stage", "terminate")
    return req, f"agentic(LLM {llm.model})"


def _agent_request_doc_put(api_base: str, llm: Optional[LLMClient]) -> tuple[dict, str]:
    """B → gated-запрос doc_put (require_approval). Ожидается 202 → approve."""
    if llm is None:
        return ({"action": "doc_put",
                 "content": "agent-B proposes handoff update (gated)"},
                "scripted")
    req = llm.chat_json(
        "You are agent B in NEXUS. Ты прочитал handoff-документ от агента A. "
        "Запроси обновление документа (операция doc_put). Сформируй JSON: "
        '{"action":"doc_put","content":"<краткое обновление>"}. '
        "Ответь ТОЛЬКО JSON-объектом.")
    req.setdefault("action", "doc_put")
    if not req.get("content"):
        req["content"] = "agent-B proposes handoff update (gated)"
    return req, f"agentic(LLM {llm.model})"



def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=5801)
    ap.add_argument("--base", default=None)
    ap.add_argument("--keep-state", action="store_true")
    ap.add_argument("--api-exe", default="python")
    ap.add_argument("--agentic", action="store_true",
                    help="agentic-режим: agent A/B — реальные LLM-агенты "
                         "через NexusLink (по умолчанию — scripted/deterministic)")
    ap.add_argument("--agentic-model", default="claude-sonnet-5",
                    help="слот модели в NexusLink (default: claude-sonnet-5)")
    ap.add_argument("--agentic-config", default=None,
                    help="путь к config.json NexusLink (default: ~/.nexuslink/config.json)")
    args = ap.parse_args()

    url = f"http://127.0.0.1:{args.port}"
    base = args.base or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "_state")
    base = os.path.abspath(base)

    llm = None
    mode = "scripted"
    if args.agentic:
        try:
            llm = LLMClient(args.agentic_config, model=args.agentic_model)
            mode = f"agentic (LLM {llm.model} via NexusLink)"
        except LLMUnavailable as exc:
            print(f"agentic недоступен: {exc}")
            print("→ падаю в deterministic scripted-режим (fallback)")
            llm = None

    print("=" * 76)
    print("IIKUZNITSA-AGENTIC demo-stand (skeleton, source-work)")
    print(f"mode:     {mode}")
    print(f"core api: {url}")
    print(f"base:     {base}")
    print("=" * 76)

    # ------------------------------------------------------------------
    # SCENE-0: honest offline/empty state
    # ------------------------------------------------------------------
    print("\n[SCENE-0] offline/empty state (честный пустой след)")
    st, _ = api(url, "GET", "/api/core/server", timeout=3)
    report("до старта сервера соединение отсутствует (0/ECONNREFUSED)",
           st == 0, f"status={st}")

    if os.path.isdir(base) and not args.keep_state:
        shutil.rmtree(base)
    os.makedirs(base, exist_ok=True)

    # ------------------------------------------------------------------
    # Start core
    # ------------------------------------------------------------------
    logf = open(os.path.join(base, "core.log"), "w", encoding="utf-8")
    env = dict(os.environ)
    env["PYTHONPATH"] = ROOT
    env["AEGIS_ADMIN_KEYS"] = ADMIN_KEYS
    env["AEGIS_ALLOW_UNATTESTED"] = "1"
    proc = subprocess.Popen(
        [args.api_exe, os.path.join(ROOT, "tools", "nexus_core", "api.py"),
         "--port", str(args.port), "--base", base],
        stdout=logf, stderr=subprocess.STDOUT, env=env)
    if not wait_server(url):
        print("FAIL: core не поднялся за 30s")
        proc.terminate()
        return 1
    print("core: running (fresh state)")

    # ------------------------------------------------------------------
    # SCENE-1: два агентных роли (терминалы в nx runtime)
    # ------------------------------------------------------------------
    print("\n[SCENE-1] два агента в nx runtime")
    if not conpty_available():
        report_skip("терминал agent-a создан (role=writer)")
        report_skip("терминал agent-b создан (role=reader)")
        report_skip("оба терминала лив в /terminals")
    else:
        for name, role in (("agent-a", "writer"), ("agent-b", "reader")):
            st, d = api(url, "POST", "/api/core/run",
                        {"name": name, "command": ["cmd.exe"],
                         "labels": {"role": role, "space": "agents"}})
            report(f"терминал {name} создан (role={role})",
                   st == 200 and d.get("address"), d.get("address"))
        st, d = api(url, "GET", "/api/core/terminals")
        names = [t.get("name") for t in d.get("terminals", [])]
        report("оба терминала лив в /terminals",
               "agent-a" in names and "agent-b" in names, ",".join(names))

    # ------------------------------------------------------------------
    # SCENE-2: handoff-doc (A пишет N → B читает ту же N)
    # ------------------------------------------------------------------
    print("\n[SCENE-2] handoff-документ: A → N, B читает N")

    # A пишет v1 (scripted: фиксированная строка; agentic: LLM сам
    # выбирает поля документа)
    content1, label1 = _agent_write_doc_v1(url, llm)
    st, d = api(url, "POST", "/api/core/doc",
                {"content": content1})
    report(f"A пишет версию 1 [{label1}]", st == 200
           and d.get("version") == 1, json.dumps(d))
    v1 = d.get("version")

    content2, label2 = _agent_write_doc_v2(url, llm)
    st, d = api(url, "POST", "/api/core/doc",
                {"content": content2, "base_version": v1})
    report(f"A пишет версию 2 (CAS base_version=1) [{label2}]",
           st == 200 and d.get("version") == 2, json.dumps(d))
    v2 = d.get("version")

    st, d = api(url, "GET", "/api/core/doc/latest")
    content_ok = d.get("content") == "task-42: step-2, continue by agent-B"
    if llm is not None:
        # agentic: содержимое динамическое (LLM выбирает поля), проверяем
        # только версию и что документ непустой.
        content_ok = bool(d.get("content"))
    report("B читает latest = версию 2",
           st == 200 and d.get("version") == 2 and content_ok,
           f"v{d.get('version')} · content={str(d.get('content'))[:70]!r}")

    st, d = api(url, "GET", f"/api/core/doc?version={v1}")
    report(f"B читает ту же версию N={v1} (old)", st == 200
           and d.get("version") == v1, f"v{d.get('version')}")

    st, d = api(url, "POST", "/api/core/doc",
                {"content": "stale write on v1", "base_version": v1})
    report("CAS-отказ: устаревший base_version → 409",
           st == 409 and "version conflict" in str(d.get("error")),
           f"status={st}")

    # ------------------------------------------------------------------
    # SCENE-3: gated Core-операция (deny / require_approval / approve)
    # ------------------------------------------------------------------
    print("\n[SCENE-3] gated Core-операция: deny → approval → executed")

    # 3.0 — политика hot-read (после создания состояния)
    with open(os.path.join(base, "gate-policy.json"), "w", encoding="utf-8") as f:
        json.dump(GATE_POLICY, f, indent=2)
    print("  gate-policy.json установлен (hot-read)")

    # 3.1 — deny: kill prod-db
    if not conpty_available():
        report_skip("терминал prod-db создан")
        report_skip("B запрашивает kill prod-db → deny 403")
        report_skip("deny имеет policy_hash (verifiable)")
        report_skip("B запрашивает doc_put → 202 pending")
        report_skip("approval виден в /approvals")
        report_skip("approve(demo1) → мутация выполнена (doc v3)")
        report_skip("терминал victim1 создан")
        report_skip("kill victim1 → 202 dual-control")
        report_skip("голос demo1 → pending 1/2")
        report_skip("повторный голос demo1 → 409 (dual-control)")
        report_skip("голос demo2 → kill выполнен")
        report_skip("victim1 после kill → exited")
        report_skip("prod-db остался жив (deny не исполнился)")
    else:
        # 3.1 — deny: kill prod-db
        st, d = api(url, "POST", "/api/core/run",
                    {"name": "prod-db", "command": ["cmd.exe"]})
        report("терминал prod-db создан", st == 200, d.get("address"))
        req_kill, label_kill = _agent_request_kill_proddb(url, llm)
        payload_kill = {k: v for k, v in req_kill.items() if k != "action"}
        st, d = api(url, "POST", "/api/core/kill", payload_kill)
        report(f"B запрашивает kill prod-db → deny 403 [{label_kill}]",
               st == 403 and d.get("outcome") == "deny",
               f"rule={d.get('rule_id')} status={st}")
        report("deny имеет policy_hash (verifiable)",
               bool(d.get("policy_hash")), d.get("policy_hash", "")[:16])

        # 3.2 — require_approval: doc_put (один approver)
        req_doc, label_doc = _agent_request_doc_put(url, llm)
        st, d = api(url, "POST", "/api/core/doc",
                    {"content": req_doc.get("content")})
        report(f"B запрашивает doc_put → 202 pending [{label_doc}]",
               st == 202 and d.get("status") == "pending"
               and d.get("approval_id"),
               f"approval_id={d.get('approval_id','')[:20]}…")
        aid = d.get("approval_id")

        st, d = api(url, "GET", "/api/core/approvals")
        pending = [m for m in d.get("mutations", [])
                   if m.get("approval_id") == aid]
        report("approval виден в /approvals",
               len(pending) == 1 and pending[0]["status"] == "pending",
               f"action={pending[0]['action'] if pending else None}")

        st, d = api(url, "POST", f"/api/core/approvals/{aid}",
                    {"approved": True}, headers={"X-AEGIS-Key": "demo1"})
        report("approve(demo1) → мутация выполнена (doc v3)",
               st == 200 and d.get("status") == "executed"
               and d.get("result", {}).get("version") == 3,
               json.dumps(d.get("result")))

        # 3.3 — require_approval dual-control: kill (два approver'а)
        st, d = api(url, "POST", "/api/core/run",
                    {"name": "victim1", "command": ["cmd.exe"]})
        report("терминал victim1 создан", st == 200, d.get("address"))
        st, d = api(url, "POST", "/api/core/kill",
                    {"term": "victim1", "stage": "terminate"})
        report("kill victim1 → 202 dual-control",
               st == 202 and d.get("dual_control") is True
               and d.get("required_approvals") == 2,
               f"required={d.get('required_approvals')}")
        aid2 = d.get("approval_id")

        st, d = api(url, "POST", f"/api/core/approvals/{aid2}",
                    {"approved": True}, headers={"X-AEGIS-Key": "demo1"})
        report("голос demo1 → pending 1/2",
               st == 202 and d.get("status") == "pending"
               and d.get("remaining") == 1, f"remaining={d.get('remaining')}")

        st, d = api(url, "POST", f"/api/core/approvals/{aid2}",
                    {"approved": True}, headers={"X-AEGIS-Key": "demo1"})
        report("повторный голос demo1 → 409 (dual-control)",
               st == 409, f"status={st}")

        st, d = api(url, "POST", f"/api/core/approvals/{aid2}",
                    {"approved": True}, headers={"X-AEGIS-Key": "demo2"})
        report("голос demo2 → kill выполнен", st == 200
           and d.get("status") == "executed", json.dumps(d.get("result")))

        st, d = api(url, "GET", "/api/core/terminals")
        victims = {t.get("name"): t.get("state")
                   for t in d.get("terminals", [])}
        report("victim1 после kill → exited",
               victims.get("victim1") == "exited", f"state={victims.get('victim1')}")
        report("prod-db остался жив (deny не исполнился)",
               victims.get("prod-db") in ("idle", "running"),
               f"state={victims.get('prod-db')}")

    # ------------------------------------------------------------------
    # SCENE-4: видимый след — SSE + audit + verify
    # ------------------------------------------------------------------
    print("\n[SCENE-4] след: SSE-событие + GateAuditTrail + verify")
    events = sse_replay(url)
    policy_ev = [e for e in events if e.get("type") == "policy"]
    doc_ev = [e for e in events if e.get("type") == "doc"]
    if not conpty_available():
        report_skip("SSE: событие `policy` есть (gate-вердикт)")
        report_skip("SSE: policy-события несут outcome (aegis-вердикт)")
        report_skip("SSE: policy-события несут HMAC content_hash (строго)")
        report("SSE: событие `doc` есть (версии документа)",
               len(doc_ev) > 0, f"count={len(doc_ev)}")
    else:
        report("SSE: событие `policy` есть (gate-вердикт)",
               len(policy_ev) > 0, f"count={len(policy_ev)}")
        report("SSE: событие `doc` есть (версии документа)",
               len(doc_ev) > 0, f"count={len(doc_ev)}")
        report("SSE: policy-события несут outcome (aegis-вердикт)",
               len(policy_ev) > 0
               and all(e.get("outcome") for e in policy_ev),
               f"count={len(policy_ev)}")
        report("SSE: policy-события несут HMAC content_hash (строго)",
               len(policy_ev) > 0
               and all(bool(e.get("content_hash")) for e in policy_ev),
               f"count={len(policy_ev)}")

    st, d = api(url, "GET", "/api/core/audit")
    entries = d.get("entries", [])
    denied = [e for e in entries if e.get("decision") == "deny"]
    approved = [e for e in entries if e.get("decision") == "allow"]
    if not conpty_available():
        report_skip("audit: gate-решения записаны")
        report_skip("audit: содержит deny (prod-db)")
        report_skip("audit: содержит approval_approved")
    else:
        report("audit: gate-решения записаны",
               len(entries) >= 8, f"entries={len(entries)}")
        report("audit: содержит deny (prod-db)",
               any(e.get("action") == "kill"
                   and e.get("decision") == "deny" for e in entries),
               f"deny entries={len(denied)}")
        report("audit: содержит approval_approved",
               any(e.get("action") == "approval_approved" for e in entries),
               f"allow entries={len(approved)}")

    st, d = api(url, "GET", "/api/core/audit/verify")
    report("verify endpoint: ok=True (aegis + gate_trail)",
           st == 200 and d.get("ok") is True,
           f"ok={d.get('ok')} aegis={d.get('aegis',{}).get('ok')} "
           f"gate_trail={d.get('gate_trail',{}).get('ok')}")

    # audit.jsonl — физическая HMAC-цепочка на диске
    trail_f = os.path.join(base, "audit.jsonl")
    trail_ok = os.path.exists(trail_f) and os.path.getsize(trail_f) > 0
    report("audit.jsonl существует на диске (append-only)", trail_ok,
           trail_f if trail_ok else "")

    # ------------------------------------------------------------------
    # SCENE-5: honest offline — после остановки сервера
    # ------------------------------------------------------------------
    print("\n[SCENE-5] honest offline (mirror down → нет фейк-данных)")
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)
    time.sleep(1.0)
    st, d = api(url, "GET", "/api/core/doc/latest", timeout=3)
    report("после остановки core обращения падают (0)",
           st == 0, f"status={st}")

    # ------------------------------------------------------------------
    print("\n" + "=" * 76)
    total = PASS + FAIL + SKIP
    print(f"RESULT: {PASS}/{total} PASS, {FAIL} FAIL, {SKIP} SKIP")
    if FAIL > 0:
        print("STAND: FAIL")
        return 1
    print("STAND: PASS")
    if SKIP > 0:
        print(f"(пропущено {SKIP}: нужен ConPTY/Windows)")
    if not args.keep_state:
        shutil.rmtree(base, ignore_errors=True)
        print(f"(база очищена: {base})")
    else:
        print(f"(база сохранена: {base})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
