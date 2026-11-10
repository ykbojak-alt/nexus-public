#!/usr/bin/env python3
"""
tools/nexus_core/api.py — API-слой nexus-core (N2+N3, REST + SSE).

Поверх супервизора v1 (N1). Mock-совместимость: CORE_MOCK=1
(create_app берёт MockPTYBackend автоматически).

Endpoints:
  GET  /api/core/terminals|machines|agents|spaces — живые списки
  GET  /api/core/machines/{name}      — одна машина реестра
  PUT  /api/core/machines/{name}      {host?} — обновление машины
  DELETE /api/core/machines/{name}    — забыть машину (терминалы целы)
  POST /api/core/machines/{name}/connect — регистрация ssh + probe
  POST /api/core/exec                 {machine, argv, timeout?} — machine.exec
  GET  /api/core/file/read?path=&offset=&limit= — чтение файла (sandbox)
  POST /api/core/worktree           {repo?, name} — worktree + терминал (#549)
  GET  /api/core/worktrees          ?repo= — список worktree'ев
  DELETE /api/core/worktree         ?name=&repo=&force= — remove + kill term
  POST /api/core/file/write            {path, content} — атомарно
  POST /api/core/file/edit             {path, pairs: [[old, new]]} — exact-once
  GET  /api/core/programs           — launcher-реестр (#551b, hot-edit)
  POST /api/core/run-program        {program, name?, cwd?} — spawn из реестра (#562)
  GET  /api/core/terminal/<name>/dump?lines=N — transcript dump, text/plain (#562)
  GET  /api/core/server                — статус ядра (версия/uptime/counts)
  POST /api/core/run              {name, command, labels, cwd, machine,
                                   keep, parent, die_with_parent,
                                   outlive_parent}
  POST /api/core/send             {term, text, enter?, queue?}
  GET  /api/core/send-queues      — глубины send-очередей (W56)
  DELETE /api/core/send-queue/<n> — сброс очереди (W56)
  POST /api/core/keys             {term, keys: [...]}
  POST /api/core/put              {term, text} — alias send (интерактив)
  POST /api/core/putfile          {term, name, data_b64} — hc file-drop
                                  (#515): файл в files/<machine>/<term>/
  POST /api/core/park             {term}
  POST /api/core/keep             {term, keep: bool}
  POST /api/core/wait             {term, timeout?, children?, output?}
  POST /api/core/kill             {term, stage?} — эскалация hangup→terminate→kill
  POST /api/core/interrupt        {term}
  POST /api/core/label            {term, labels: {..}}
  POST /api/core/terminal/<name>/rename {new_name} — #550 key-rename
  POST /api/core/terminal/<name>/resize {cols,rows} — PTY resize
  POST /api/core/terminal/<name>/spawn-child {command, name?, cwd?,
       die_with_parent?} — дочерний терминал (#566)
  POST /api/core/terminal/<name>/send-file {path|content, name?, send?}
                                     — file-drop в files/<m>/<t>/ + опц.
                                       send пути в терминал (W2)
  POST /api/core/terminal/<name>/clone {name?} — копия спеки терминала (W4)
  GET  /api/core/terminal/<name>/info — полная спека, env с маской
                                       секретов (W6)
  POST /api/core/terminal/<name>/snapshot — spec+scrollback →
                                       snapshots/<n>-<ts>.json (W7)
  POST /api/core/terminal/<name>/restore-snapshot {file} — терминал
                                       по снапшоту + экран (W7)
  POST /api/core/group — групповые kill/respawn/rename-prefix по
                         match.label|match.names (W8)
  POST /api/core/terminal/<a>/pipe {to:"<b>"|null} — output→stdin
                         pipe (W9); GET /api/core/pipes — список
  POST /api/core/send-broadcast {terms,text,enter?} — рассылка
                         живым терминалам (W10)
  GET  /api/core/presets — spawn-пресеты (W11, hot-edit)
  POST /api/core/spawn-preset {preset,name?,cwd?,args?,env?,labels?}
                         — терминал по пресету (W11)
  POST /api/core/terminal/<n>/marker {label} — закладка в scrollback (W12)
  POST /api/core/terminal/<n>/replay — replay send-истории (W20)
  POST /api/core/replay-file — replay команд из файла (W40)
  POST /api/core/terminal/<n>/freeze|resume — suspend pump (W21)
  GET  /api/core/terminal/<n>/export[?format=bundle] — {config+scrollback}
      или tar.gz spec+scrollback+meta (W22/W42)
  POST /api/core/terminal/import — spawn из export-JSON (W23)
  GET  /api/core/terminal/<n>/cost — output bytes/state-time (W24)
  GET  /api/core/cost-report?top=N — агрегат по всем terms (W44)
  GET  /api/core/diff/{a}/{b}       — расхождение скринов (W13)
  GET  /api/core/terminal/<n>/metrics?points&since — метрики (W14)
  POST /api/core/terminal/<n>/on-exit {url} — webhook на exited (W15)
  GET  /api/core/screens?terms=a,b,c — мульти-скрин кадр (W16)
  POST /api/core/purge-exited {ttl_seconds?,dry_run?} — compaction (W18)
  GET  /api/core/search-all?q= — grep по скроллбэкам (W19/W50)
  GET  /api/core/merge?a=&b= — слияние двух сессий в ленту (W53)
  GET  /api/core/stats — сводка по space/machine (W54)
  POST /api/core/terminal/<n>/pipe-file {path} — вывод в файл (W25)
  GET  /api/core/pipe-files — список file-pipes (W25)
  GET  /api/core/alert-rules — правила pattern→action + errors (W26/W46)
  POST /api/core/alert-rules/test — DSL dry-run без side-effects (W46)
  GET  /api/core/capacity — оценка свободных слотов (W28)
  GET  /api/core/capacity/forecast — тренд → прогноз (W47)
  GET  /api/core/metrics — counters/gauges экспорт (W34)
  POST /api/core/backup + GET /backups[/{name}] — бэкап state-dir (W38)
  POST|GET|DELETE /api/core/send-schedule — отложенная рассылка (W30)
  PUT|GET|DELETE /api/core/group[s]/{name} — именованные группы (W27)
  POST /api/core/group/{name}/send|kill — групповые send/kill (W27)
  GET  /api/core/events[?types=csv] — SSE-поток (status/attention/done/lost/...;
                                     #570 фильтр типов + data.term)
  GET  /api/core/doc[?version=]   — версионируемый документ (latest по умолчанию)
  PUT|POST /api/core/doc          {content} — новая версия (монотонно)
  GET  /api/core/templates        — список .md-персон
  POST /api/core/templates/<name>/run {args: [...]} — запуск шаблона
"""

from __future__ import annotations

import asyncio
import base64
import bisect
import binascii
import contextvars
import difflib
import hashlib
import hmac
import json
import os
_WEBHOOK_STATS = {"sent":0,"failed":0,"dead":0,"by_event":{}}
import re
import sys
import threading
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qsl, urlsplit

from aiohttp import ClientSession, ClientTimeout, streams, web
from aiohttp.test_utils import make_mocked_request
from unittest import mock

from tools.nexus_core.doc_store import DocConflictError, DocStore
from tools.nexus_core.events import (
    KNOWN_EVENT_TYPES,
    MAX_SUBSCRIBERS,
    SupervisorEventStream,
)
from tools.nexus_core.file_ops import (
    FileOps,
    FileOpsError,
    FileOpsNotFound,
    FileOpsTooLarge,
)
from tools.nexus_core import git_ops
from tools.nexus_core import programs as programs_mod
from tools.nexus_core import presets as presets_mod
from tools.nexus_core.git_ops import (
    GitError,
    GitUnavailable,
    WorktreeNotFound,
)
from tools.nexus_core.machine_registry import (
    HOST_RE,
    LOCAL_MACHINE,
    TRANSPORTS,
    VALID_NAME_RE,
    MachineError,
    MachineRegistry,
    RemoteNotSupportedError,
    machine_exec,
)
from tools.nexus_core.supervisor_v1 import (
    RECENT_OUTPUT_CAP, REGISTRY_SCHEMA_VERSION, SupervisorV1,
    Terminal, scrollback_all)
from tools.nexus_core.templates import TemplateStore
from tools.nexus_core.ratings import IdempotencyConflict, RatingsStore
from tools.nexus_core.ssh_ops import (
    RemoteExecError,
    SshOps,
)
from tools.nexus_core.aegis import (
    COND_ALWAYS,
    AegisGuard,
    OperationProposal,
    Policy,
    PolicyCondition,
    PolicyRule,
)


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 5684
DEFAULT_BASE = Path(__file__).resolve().parent / "state"
CORE_APPROVAL_TTL_S = int(os.environ.get("NEXUS_APPROVAL_TTL_S", "600"))
CORE_APPROVAL_MAX_PENDING = 100
CORE_APPROVAL_BODY_MAX_BYTES = 1024 * 1024

_CURRENT_GATE_REQUEST: contextvars.ContextVar[Any] = contextvars.ContextVar(
    "nexus_core_gate_request", default=None)
_APPROVED_POLICY_REPLAY: contextvars.ContextVar[Any] = contextvars.ContextVar(
    "nexus_core_approved_policy_replay", default=None)

SERVER_START = time.time()

# -- core authz (HERETIC #406 → #407, SSE #414) -------------------------------
# Mutating endpoints (любой non-GET под /api/core/*, кроме AEGIS-семейства
# с собственным authZ) требуют заголовок X-Nexus-Key == env NEXUS_CORE_TOKEN
# (hmac.compare_digest). Без токена — dev-режим: записи открыты ТОЛЬКО при
# loopback-bind; non-loopback bind без токена отклоняется в run_server,
# middleware — defense-in-depth для create_app(host=non-loopback).
# Read-endpoints (GET) открыты, если не задан NEXUS_CORE_READ_TOKEN.
# /api/core/events (SSE — утечка terminal-статусов) — sensitive read:
# закрыт, если задан ХОТЯ БЫ один из двух токенов (принимает любой).

_CORE_MUTATING_EXEMPT = (
    "/api/core/proposals",   # agent attestation (AEGIS_AGENT_KEYS)
    "/api/core/approvals",   # AEGIS_ADMIN_TOKEN
    "/api/core/policy",      # AEGIS_ADMIN_TOKEN
    "/api/core/ratings",     # AEGIS_ADMIN_TOKEN на score; GET — read scope
    "/api/core/panic",       # AEGIS_ADMIN_TOKEN (#468 W3 circuit-breaker)
    "/api/core/verdicts",    # AEGIS_ADMIN_TOKEN (#468 W1 attestation)
)

_LOOPBACK_HOSTS = {"localhost", "::1"}


def _is_loopback_host(host: str) -> bool:
    h = (host or "").strip().lower()
    return h in _LOOPBACK_HOSTS or h.startswith("127.")


def _key_matches(key: str, token: str) -> bool:
    return bool(token) and hmac.compare_digest(key, token)


# CORS (#403): config-driven allow-list. Дефолт — только loopback-origin'ы
# (localhost/127.0.0.1, любой порт). Никогда не "*" для всех.
_CORS_ALLOWED_ORIGINS_DEFAULT = (
    "http://localhost:*,https://localhost:*"
    ",http://127.0.0.1:*,https://127.0.0.1:*"
)
_CORS_ENV = "NEXUS_CORE_ALLOWED_ORIGINS"
_CORS_ALLOW_METHODS = "GET, HEAD, POST, PUT, DELETE, OPTIONS"
_CORS_ALLOW_HEADERS = "content-type, x-nexus-key"
_CORS_MAX_AGE = "3600"


def _cors_allowed_origins() -> tuple[str, ...]:
    raw = os.environ.get(_CORS_ENV) or _CORS_ALLOWED_ORIGINS_DEFAULT
    return tuple(part.strip() for part in raw.split(",") if part.strip())


def _cors_origin_allowed(origin: str) -> bool:
    o = (origin or "").strip().rstrip("/")
    if not o:
        return False
    for allow in _cors_allowed_origins():
        p = allow.strip().rstrip("/")
        if not p:
            continue
        if p.endswith(":*"):
            prefix = p[:-2]
            if o.startswith(prefix) and o[len(prefix):].startswith(":"):
                if o[len(prefix) + 1:].isdigit():
                    return True
        elif o == p:
            return True
    return False


@web.middleware
async def _cors(request: web.Request, handler):
    """CORS-политика (config-driven allow-list). Preflight OPTIONS
    обрабатывается здесь, до роутинга; на все ответы разрешённым
    origin'ам заголовки добавляются в on_response_prepare (включая
    SSE-стримы /api/core/events)."""
    origin = request.headers.get("Origin", "")
    if request.method != "OPTIONS" or not _cors_origin_allowed(origin):
        return await handler(request)
    return web.Response(status=204, headers={
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": _CORS_ALLOW_METHODS,
        "Access-Control-Allow-Headers": _CORS_ALLOW_HEADERS,
        "Access-Control-Max-Age": _CORS_MAX_AGE,
        "Vary": "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
    })


async def _cors_prepare(request: web.Request, response: web.StreamResponse) -> None:
    """Добавляет ACAO до финализации заголовков ответа — работает и для
    SSE-стримов (поток стартует внутри handler, после prepare)."""
    origin = request.headers.get("Origin", "")
    if _cors_origin_allowed(origin):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"


@web.middleware
async def _core_authz(request: web.Request, handler):
    """AuthZ-матрица core API (см. блок констант выше)."""
    method = request.method.upper()
    path = request.path
    core_token = os.environ.get("NEXUS_CORE_TOKEN") or ""
    read_token = os.environ.get("NEXUS_CORE_READ_TOKEN") or ""

    if method not in ("GET", "HEAD", "OPTIONS"):
        if not path.startswith("/api/core/"):
            return await handler(request)
        if any(path == p or path.startswith(p + "/") for p in _CORE_MUTATING_EXEMPT):
            return await handler(request)
        if path.startswith("/api/core/machines/"):
            # HERETIC #438: machines-мутации пишут в доверенный реестр
            # (ssh host → subprocess argv) — token ВСЕГДА, включая
            # loopback dev-mode; без NEXUS_CORE_TOKEN → 503, иначе
            # локальный процесс обходит file-HMAC через API.
            if not core_token:
                return _error(
                    "machine registry mutations require "
                    "NEXUS_CORE_TOKEN", status=503)
            key = request.headers.get("X-Nexus-Key", "")
            if not _key_matches(key, core_token):
                return _error("X-Nexus-Key required", status=401)
            return await handler(request)
        if not core_token:
            state = request.app.get("state")
            bind = str(getattr(state, "bind_host", None) or DEFAULT_HOST)
            if _is_loopback_host(bind):
                return await handler(request)
            return _error(
                "mutating endpoints disabled: non-loopback bind "
                "without NEXUS_CORE_TOKEN", status=503)
        key = request.headers.get("X-Nexus-Key", "")
        if not _key_matches(key, core_token):
            return _error("X-Nexus-Key required", status=401)
        return await handler(request)

    if method == "GET" and path.startswith("/api/core/"):
        if path == "/api/core/events":
            candidates = [t for t in (read_token, core_token) if t]
            if candidates:
                key = request.headers.get("X-Nexus-Key", "")
                if not any(_key_matches(key, t) for t in candidates):
                    return _error("X-Nexus-Key required", status=401)
        elif read_token:
            key = request.headers.get("X-Nexus-Key", "")
            if not _key_matches(key, read_token):
                return _error("X-Nexus-Key required", status=401)
    return await handler(request)


@web.middleware
async def _gate_request_context(request: web.Request, handler):
    """Expose the already-authorized request to the synchronous gate path."""
    token = _CURRENT_GATE_REQUEST.set(request)
    try:
        return await handler(request)
    finally:
        _CURRENT_GATE_REQUEST.reset(token)


class AppState:
    """Состояние API-приложения (супервизор + doc + шаблоны + события
    + машины + файловые операции)."""

    def __init__(
        self,
        base: Path,
        supervisor: Optional[SupervisorV1] = None,
        templates_dir: Optional[Path] = None,
    ) -> None:
        self.base = base
        self.supervisor = supervisor if supervisor is not None else SupervisorV1()
        self.doc = DocStore(base)
        self.templates = TemplateStore(templates_dir) if templates_dir is not None else TemplateStore()
        self.machines = MachineRegistry(base, supervisor=self.supervisor)
        self.files = FileOps(base)
        # W25: file-pipe sink — supervisor отдаёт сырые байты вывода,
        # FileOps пишет в sandbox-файл (append).
        self.supervisor.file_sink = (
            lambda rel, data: self.files.append_bytes(rel, data))
        # W45: ротация pipe-file path → path.1 при file_pipe_max.
        self.supervisor.file_rotator = (
            lambda rel: self.files.rotate(rel))
        # Core gate decision trail is separate from AEGIS's hash-chain and
        # keeps a bounded 2000-entry read buffer plus append-only JSONL.
        self.audit_trail = GateAuditTrail(base / "audit.jsonl")
        # W73: approvals.json — pending-очередь переживает рестарт
        # (replay-spec вместо request/handler, lazy-expire при чтении).
        self.mutation_approvals: dict[str, dict] = {}
        _load_mutation_approvals(self)
        # N4: remote machine.exec/file.* через SSH (ssh_ops); лог путей
        self.ssh_log: list[str] = []
        if not hasattr(self, "last_drain_ts"):
            self.last_drain_ts = 0.0
        if not hasattr(self, "pump_errors"):
            self.pump_errors = 0
        self.ssh = SshOps(self.machines, log_fn=self.ssh_log.append)
        self.events = SupervisorEventStream(self.supervisor)
        # проброс событий супервизора в канал
        self.supervisor.event_sink = self.events.channel.publish
        # уже накопленные события (до подключения сина) — в историю канала
        self.events.start()
        # AEGIS — детерминистический policy-gate перед исполнением (deny-by-default).
        # JSONL-аудит переживает рестарт (ротация по размеру).
        # #468: W3 panic circuit-breaker (owner+cooldown) и W1 verdict-
        # attestation (reviewers/attested ops) — env-конфиг, дефолт off.
        self.gate = AegisGuard(
            event_sink=self.events.channel.publish,
            audit_path=str(base / "aegis-audit.jsonl"),
            state_path=str(base / "aegis-windows.json"),
            panic_owner=os.environ.get("AEGIS_PANIC_OWNER", "owner"),
            panic_cooldown_s=float(
                os.environ.get("AEGIS_PANIC_COOLDOWN_S", "300") or 300),
            reviewers=_env_name_set("AEGIS_REVIEWERS"),
            attested_operations=_env_name_set("AEGIS_ATTESTED_OPS"),
            guardians=_env_name_set("AEGIS_GUARDIANS"),
            guardian_threshold=(
                int(os.environ["AEGIS_GUARDIAN_THRESHOLD"])
                if os.environ.get("AEGIS_GUARDIAN_THRESHOLD") else None),
            # W77: TTL escalate-заявок (и minted permits) — env для
            # e2e/ops, default 3600 как APPROVAL_TTL_S.
            approval_ttl_s=float(
                os.environ.get("AEGIS_APPROVAL_TTL_S", "3600") or 3600),
            # FIX-69 PC-1 (#472): двухчеловечность включается только при
            # ролевых admin-идентичностях (AEGIS_ADMIN_KEYS)
            two_person_required=bool(os.environ.get("AEGIS_ADMIN_KEYS")),
        )
        # NEWF_SPEC §6 — orchestrator-scored agent ratings (persist ratings.json).
        self.ratings = RatingsStore(base)


# =============================================================================
# Handlers
# =============================================================================

def _state(request: web.Request) -> AppState:
    return request.app["state"]


def _term(request: web.Request, data: dict) -> str:
    term = data.get("term")
    if not isinstance(term, str) or not term.strip():
        raise ValueError("term required")
    return term.strip()




def _locked_guard(state: AppState, term: str) -> Optional[web.Response]:
    _t = state.supervisor.get_terminal(term)
    if _t is not None and getattr(_t, "locked", False):
        return _error("terminal locked", status=409)
    return None


def _terminal_restore_guard(state: AppState, address: str) -> Optional[web.Response]:
    """Reject writes while a registry terminal is queued but has no PTY yet."""
    term = state.supervisor.get_terminal(address)
    if term is not None and term.state == "restoring":
        return _error("terminal restoring", status=409)
    return None


async def _read_json(request: web.Request) -> dict:
    try:
        data = await request.json()
    except Exception:
        raise ValueError("Invalid JSON body")
    if not isinstance(data, dict):
        raise ValueError("JSON object expected")
    return data


def _error(message: str, status: int = 400) -> web.Response:
    return web.json_response({"error": message}, status=status)


class GateAuditTrail:
    """Bounded in-memory view plus append-only JSONL for core gate decisions.

    Stable entry schema (v1): ``{v, seq, ts, action, subject, decision,
    detail, prev_hash, hash}``; HMAC-SHA256 signs canonical JSON without
    the final ``hash`` field. The 32-byte key persists next to the JSONL
    as ``<name>.key`` (audit.jsonl → audit.key, mode 0600 on POSIX) so the
    chain survives restarts. Legacy unsigned rows are kept readable but
    are outside the hash chain.
    ``subject`` is a sanitized resource name; request payloads are never stored.
    """

    _KEY_BYTES = 32

    def __init__(self, path: Path, maxlen: int = 2000) -> None:
        self.path = Path(path)
        self._entries = deque(maxlen=maxlen)
        self._lock = threading.Lock()
        self._seq = 0
        self._last_hash: Optional[str] = None
        self._key = self._load_key()
        self._load()

    @property
    def maxlen(self) -> int:
        return int(self._entries.maxlen or 0)

    @staticmethod
    def _valid(entry: Any) -> bool:
        return (
            isinstance(entry, dict)
            and entry.get("v") == 1
            and isinstance(entry.get("ts"), (int, float))
            and isinstance(entry.get("action"), str)
            and (entry.get("subject") is None
                 or isinstance(entry.get("subject"), str))
            and entry.get("decision") in ("allow", "deny", "vote")
            and "detail" in entry
        )

    @staticmethod
    def _canonical(body: dict) -> bytes:
        return json.dumps(
            body, sort_keys=True, separators=(",", ":"),
            ensure_ascii=False).encode("utf-8")

    def _load_key(self) -> Optional[bytes]:
        key_path = self.path.with_suffix(".key")
        try:
            key = key_path.read_bytes()
            if len(key) == self._KEY_BYTES:
                return key
        except OSError:
            pass
        self.path.parent.mkdir(parents=True, exist_ok=True)
        key = os.urandom(self._KEY_BYTES)
        fd = os.open(
            str(key_path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(key)
        if os.name == "posix":
            os.chmod(key_path, 0o600)
        return key

    def _load(self) -> None:
        try:
            with self.path.open("r", encoding="utf-8") as stream:
                for line in stream:
                    try:
                        entry = json.loads(line)
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        continue
                    if not self._valid(entry):
                        continue
                    record = {
                        "v": 1,
                        "ts": entry["ts"],
                        "action": entry["action"],
                        "subject": entry["subject"],
                        "decision": entry["decision"],
                        "detail": entry["detail"],
                    }
                    for chain_key in ("seq", "prev_hash", "hash"):
                        if chain_key in entry:
                            record[chain_key] = entry[chain_key]
                    self._entries.append(record)
                    self._seq += 1
                    if (isinstance(entry.get("seq"), int)
                            and entry["seq"] > self._seq):
                        self._seq = entry["seq"]
                    if isinstance(entry.get("hash"), str):
                        self._last_hash = entry["hash"]
        except FileNotFoundError:
            return
        except OSError:
            # Startup/read-only errors do not prevent the core from starting;
            # appends still fail closed before a gated operation is executed.
            return

    def append(self, entry: dict) -> None:
        if not self._valid(entry):
            raise ValueError("invalid gate audit entry")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            self._seq += 1
            record = {
                "v": 1,
                "seq": self._seq,
                "ts": entry["ts"],
                "action": entry["action"],
                "subject": entry["subject"],
                "decision": entry["decision"],
                "detail": entry["detail"],
                "prev_hash": self._last_hash,
            }
            record["hash"] = hmac.new(
                self._key, self._canonical(record),
                hashlib.sha256).hexdigest()
            line = json.dumps(
                record, ensure_ascii=False, separators=(",", ":"))
            with self.path.open("a", encoding="utf-8", newline="\n") as stream:
                stream.write(line + "\n")
                stream.flush()
            self._entries.append(record)
            self._last_hash = record["hash"]

    def query(self, limit: int = 100,
              action: Optional[str] = None) -> tuple[list[dict], int]:
        bounded = max(0, min(int(limit), self.maxlen))
        with self._lock:
            matches = [entry for entry in reversed(self._entries)
                       if action is None or entry["action"] == action]
        return [dict(entry) for entry in matches[:bounded]], len(matches)

    def verify(self) -> dict:
        """Перепроверяет HMAC-цепочку сохранённых записей.

        Legacy-строки без ``hash`` (до появления подписи) пропускаются —
        цепочка их не покрывает и не считает их поломкой.
        """
        verified = 0
        prev_hash: Optional[str] = None
        broken_at = None
        detail: Optional[str] = None
        with self._lock:
            entries = list(self._entries)
        for index, entry in enumerate(entries):
            if "hash" not in entry:
                continue
            digest = entry.get("hash")
            body = {k: v for k, v in entry.items() if k != "hash"}
            expected = hmac.new(
                self._key, self._canonical(body), hashlib.sha256
            ).hexdigest()
            if (not isinstance(digest, str)
                    or not hmac.compare_digest(digest, expected)
                    or entry.get("prev_hash") != prev_hash):
                broken_at = entry.get("seq", index + 1)
                detail = "gate audit hash-chain mismatch"
                break
            prev_hash = digest
            verified += 1
        return {
            "ok": broken_at is None,
            "verified": verified,
            "broken_at": broken_at,
            "detail": detail,
        }


_AUDIT_ACTION_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,80}$")
_AUDIT_SUBJECT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$")


def _audit_action(operation_type: str, payload: dict) -> str:
    candidate = payload.get("action")
    if not isinstance(candidate, str) or not candidate.strip():
        candidate = operation_type
    candidate = candidate.strip()
    if _AUDIT_ACTION_RE.fullmatch(candidate):
        return candidate
    fallback = re.sub(r"[^A-Za-z0-9_.:-]", "_", str(operation_type))[:80]
    return fallback or "unknown"


def _audit_subject(payload: dict) -> Optional[str]:
    """Keep only a short resource name; omit command, path, and input fields."""
    for key in ("term", "name", "agent_id", "machine", "space",
                "schedule", "group"):
        value = payload.get(key)
        if not isinstance(value, str) or not value.strip():
            continue
        # Terminal addresses can include a machine prefix; paths are never
        # selected as subjects and only the final safe name is retained.
        candidate = re.split(r"[/\\]", value.strip())[-1]
        if _AUDIT_SUBJECT_RE.fullmatch(candidate):
            return candidate
    return None


def _audit_detail(reason: Any, rule_id: Any, outcome: str) -> dict:
    clean_reason = re.sub(r"[\r\n\t]+", " ", str(reason or "gate denied"))[:240]
    return {
        "reason": clean_reason or "gate denied",
        "rule_id": str(rule_id or "")[:80],
        "gate_outcome": str(outcome)[:32],
    }


# W6 dual-control: действия, которые при require_approval ВСЕГДА
# требуют двух разных approver'ов (даже без dual_control-флага в
# политике). space-batch считается опасным только при op=kill —
# проверяется отдельно в _dual_control_required (payload["op"]).
# "clear-all" endpoint'а нет; ближайший bulk-destructive —
# purge-exited, включён сюда.
_DUAL_CONTROL_ACTIONS = frozenset({
    "kill", "group-kill", "space-delete", "purge-exited",
})


def _dual_control_required(operation_type: str, payload: dict) -> bool:
    """W6: True — решение по этой мутации требует двух разных
    approver'ов. Срабатывает для встроенного списка опасных
    действий; policy-правило с ``dual_control:true`` помечает
    dual ЛЮБОЕ действие (см. _gate_policy_match)."""
    action = _audit_action(operation_type, payload)
    if action in _DUAL_CONTROL_ACTIONS:
        return True
    return action == "space-batch" and payload.get("op") == "kill"


def _gate_policy_match(
    state: "AppState", operation_type: str, payload: dict,
) -> Optional[dict]:
    """Read ``base/gate-policy.json`` on every decision (hot-edit).

    Stable schema: ``[{"match":{"action":"kill","subject":"*"},
    "decision":"allow"|"deny"|"require_approval",
    "dual_control":true?}]``. ``decision`` также принимает dual-формы
    ``{"dual":true}`` / ``{"dual_control":true}`` — нормализуются в
    ``require_approval`` + ``dual_control:true`` в ответе.
    First matching rule wins. ``allow`` passes to AEGIS and cannot override
    its deny; ``deny`` short-circuits. No match preserves the AEGIS path.
    ``require_approval`` defers the matched core request into the existing
    approvals API; ``dual_control`` (флаг или опасный action) требует
    двух разных approver'ов — decided_by[] в записи, повторный approve
    от того же principal → 409 (W6).
    """
    path = Path(state.base) / "gate-policy.json"
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except (OSError, UnicodeError) as exc:
        raise ValueError("invalid gate policy: file unreadable") from exc

    def _unique_object(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError("duplicate object key")
            value[key] = item
        return value

    try:
        rules = json.loads(raw, object_pairs_hook=_unique_object)
    except json.JSONDecodeError as exc:
        raise ValueError("invalid gate policy: malformed JSON") from exc
    except RecursionError as exc:
        raise ValueError("invalid gate policy: malformed JSON") from exc
    except ValueError as exc:
        raise ValueError("invalid gate policy: duplicate object key") from exc
    if not isinstance(rules, list):
        raise ValueError("invalid gate policy: expected a rule list")

    normalized_rules = []
    for index, rule in enumerate(rules, start=1):
        if (not isinstance(rule, dict)
                or not {"match", "decision"}.issubset(rule)
                or not set(rule).issubset(
                    {"match", "decision", "dual_control"})
                or not isinstance(rule.get("match"), dict)):
            raise ValueError(f"invalid gate policy: malformed rule {index}")
        match = rule["match"]
        if not match or not set(match).issubset({"action", "subject"}):
            raise ValueError(f"invalid gate policy: malformed match {index}")
        for key, pattern in match.items():
            regex = _AUDIT_ACTION_RE if key == "action" else _AUDIT_SUBJECT_RE
            if not (isinstance(pattern, str) and (
                    pattern == "*" or bool(regex.fullmatch(pattern)))):
                raise ValueError(f"invalid gate policy: malformed match {index}")

        decision = rule["decision"]
        valid_decision = (
            isinstance(decision, str)
            and decision in ("allow", "deny", "require_approval")
        )
        dual_decision = (
            isinstance(decision, dict)
            and (
                (set(decision) == {"dual"}
                 and decision.get("dual") is True)
                or (set(decision) == {"dual_control"}
                    and decision.get("dual_control") is True)
            )
        )
        if not (valid_decision or dual_decision):
            raise ValueError(f"invalid gate policy: malformed decision {index}")
        dual_flag = rule.get("dual_control", False)
        if dual_flag not in (True, False):
            raise ValueError(
                f"invalid gate policy: malformed dual_control {index}")
        if dual_flag and valid_decision and decision != "require_approval":
            raise ValueError(
                f"invalid gate policy: dual_control requires "
                f"require_approval decision {index}")
        is_dual = dual_flag or dual_decision
        normalized_rules.append((index, match, decision, is_dual))

    action = _audit_action(operation_type, payload)
    subject = _audit_subject(payload)
    for index, match, decision, is_dual in normalized_rules:
        action_matches = (
            "action" not in match or match["action"] == "*"
            or match["action"] == action
        )
        subject_matches = (
            "subject" not in match or match["subject"] == "*"
            or match["subject"] == subject
        )
        if action_matches and subject_matches:
            out = {
                "decision": ("require_approval" if is_dual
                             else decision),
                "rule_id": f"POLICY-{index}",
                "policy_hash": hashlib.sha256(
                    raw.encode("utf-8")).hexdigest(),
            }
            if is_dual:
                out["dual_control"] = True
            return out
    return None


def _record_mutation_approval_event(
    state: "AppState", event: str, subject: Optional[str],
    decision: str, approval_id: str, rule_id: str,
    by: Optional[str] = None,
) -> Optional[web.Response]:
    """Write approval lifecycle metadata without command/body/credential data.

    W6: ``event="approval_vote"`` — промежуточный голос dual-control
    (approval ещё pending); trail decision "vote" — не allow и не deny.
    ``by`` — имя admin-идентичности (не секрет), для аудита кто голосовал.
    """
    trail_decision = (
        "allow" if event == "approval_approved" and decision == "approved"
        else "vote" if event == "approval_vote"
        else "deny"
    )
    detail = {"approval_id": approval_id, "rule_id": rule_id,
              "status": decision}
    if by:
        detail["by"] = str(by)[:80]
    try:
        state.audit_trail.append({
            "v": 1, "ts": time.time(), "action": event,
            "subject": subject, "decision": trail_decision,
            "detail": detail,
        })
    except OSError:
        return _error("gate audit unavailable", status=503)
    return None


# --- W73: persistence mutation-approvals (approvals.json) --------------------
#
# Запись в памяти держит request+handler для replay «в лоб». На диск
# уходит JSON-safe копия: decision-state + replay-spec
# {method, path, body_b64, content_type}. После рестарта handler
# восстанавливается через app.router.resolve синтетического request
# (make_mocked_request), а _gate_check replay-binding
# (payload_hash+rule_id+policy_hash) гарантирует, что исполнится
# ровно тот запрос, что был отложен.

def _approval_record_to_dict(record: dict) -> dict:
    return {k: v for k, v in record.items()
            if k not in ("request", "handler")}


def _save_mutation_approvals(state: "AppState") -> None:
    """Best-effort snapshot очереди → <base>/approvals.json (atomic)."""
    try:
        snap = {"v": 1, "approvals": {
            aid: _approval_record_to_dict(rec)
            for aid, rec in state.mutation_approvals.items()}}
        target = Path(state.base) / "approvals.json"
        tmp = target.parent / (target.name + ".tmp")
        tmp.write_text(json.dumps(snap, ensure_ascii=False),
                       encoding="utf-8")
        os.replace(tmp, target)
    except (OSError, ValueError):
        pass  # диск недоступен — очередь живёт в памяти как раньше


def _load_mutation_approvals(state: "AppState") -> None:
    """Восстановить очередь из approvals.json; expired грузим тоже —
    _expire_mutation_approvals пометит их при первом обращении."""
    try:
        raw = json.loads(
            (Path(state.base) / "approvals.json").read_text(
                encoding="utf-8"))
    except (OSError, ValueError):
        return
    approvals = raw.get("approvals") if isinstance(raw, dict) else None
    if not isinstance(approvals, dict):
        return
    for aid, rec in approvals.items():
        if not isinstance(rec, dict):
            continue
        rec = dict(rec)
        rec.pop("request", None)
        rec.pop("handler", None)
        rec.setdefault("decided_by", [])
        rec.setdefault("required_approvals", 1)
        state.mutation_approvals[str(aid)] = rec


async def _request_from_replay_spec(
    state: "AppState", spec: dict,
) -> "tuple[Optional[web.Request], Any]":
    """Синтетический request + handler для approval, пережившего
    рестарт. None — спека битая или роут больше не существует."""
    try:
        body = base64.b64decode(str(spec.get("body_b64") or ""))
    except (binascii.Error, ValueError):
        return None, None
    app = getattr(state, "app", None)
    if app is None:
        return None, None
    protocol = mock.Mock()
    stream = streams.StreamReader(
        protocol, limit=CORE_APPROVAL_BODY_MAX_BYTES,
        loop=asyncio.get_running_loop())
    stream.feed_data(body)
    stream.feed_eof()
    path = str(spec.get("path") or "/")
    headers = {"Content-Type": str(spec.get("content_type")
                                   or "application/json")}
    req = make_mocked_request(
        str(spec.get("method") or "POST"), path, headers=headers,
        app=app, payload=stream)
    match_info = await app.router.resolve(req)
    if getattr(match_info, "http_exception", None) is not None:
        return None, None
    handler = getattr(match_info, "handler", None)
    if handler is None:
        return None, None
    req._match_info = match_info
    match_info.add_app(app)  # router.resolve не вешает app — делает сервер
    return req, handler


def _expire_mutation_approvals(state: "AppState") -> Optional[web.Response]:
    now = time.time()
    changed = False
    for approval_id, record in state.mutation_approvals.items():
        if record["status"] == "pending" and record["expires_at"] <= now:
            error = _record_mutation_approval_event(
                state, "approval_expired", record["subject"], "expired",
                approval_id, record["rule_id"])
            if error is not None:
                return error
            record.update(status="expired", request=None, handler=None)
            changed = True
    if changed:
        _save_mutation_approvals(state)
    return None


async def _defer_policy_mutation(
    state: "AppState", operation_type: str, payload: dict,
    policy_rule: dict,
) -> web.Response:
    request = _CURRENT_GATE_REQUEST.get()
    if (not _aegis_admin_enabled() or request is None
            or request.match_info.handler is None):
        return _error("approval route unavailable", status=503)
    expiry_error = _expire_mutation_approvals(state)
    if expiry_error is not None:
        return expiry_error
    if len([r for r in state.mutation_approvals.values()
            if r["status"] == "pending"]) >= CORE_APPROVAL_MAX_PENDING:
        return _error("approval queue full", status=503)
    try:
        body = await request.read()
    except Exception:
        return _error("approval request cannot be deferred", status=503)
    if len(body) > CORE_APPROVAL_BODY_MAX_BYTES:
        return _error("approval request too large", status=413)
    if body and request.content_type != "application/json":
        return _error("only JSON mutations can be deferred", status=503)
    approval_id = "mutation-" + uuid.uuid4().hex
    action, subject = (_audit_action(operation_type, payload),
                       _audit_subject(payload))
    is_dual = bool(policy_rule.get("dual_control"))
    record = {
        "status": "pending", "expires_at": time.time() + CORE_APPROVAL_TTL_S,
        "action": action, "subject": subject,
        "operation_type": operation_type,
        "payload_hash": AegisGuard._payload_hash(payload),
        "rule_id": policy_rule["rule_id"],
        "policy_hash": policy_rule["policy_hash"],
        "dual_control": is_dual,
        "decided_by": [],
        "required_approvals": 2 if is_dual else 1,
        "request": request, "handler": request.match_info.handler,
        # W73: сериализуемая копия для replay после рестарта —
        # handler восстановится через router.resolve по path+method.
        "replay": {
            "method": request.method,
            "path": (request.path
                     + (f"?{request.query_string}"
                        if request.query_string else "")),
            "body_b64": base64.b64encode(body).decode("ascii"),
            "content_type": (request.content_type
                             or "application/json"),
        },
    }
    error = _record_mutation_approval_event(
        state, "approval_requested", subject, "pending", approval_id,
        record["rule_id"])
    if error is not None:
        return error
    state.mutation_approvals[approval_id] = record
    if len(state.mutation_approvals) > 1000:
        oldest = next((key for key, value in state.mutation_approvals.items()
                       if value["status"] != "pending"), None)
        if oldest is not None:
            state.mutation_approvals.pop(oldest, None)
    _save_mutation_approvals(state)
    body = {"approval_id": approval_id, "status": "pending"}
    if is_dual:
        body["dual_control"] = True
        body["required_approvals"] = 2
    return web.json_response(body, status=202)


def _record_gate_decision(
    state: "AppState", operation_type: str, payload: dict,
    decision: str, detail: Optional[dict],
) -> Optional[web.Response]:
    record = {
        "v": 1,
        "ts": time.time(),
        "action": _audit_action(operation_type, payload),
        "subject": _audit_subject(payload),
        "decision": decision,
        "detail": detail,
    }
    try:
        state.audit_trail.append(record)
    except OSError:
        # Do not execute an allowed mutation when its persistent audit append
        # failed; callers receive a retryable service error instead.
        return _error("gate audit unavailable", status=503)
    return None


# N4: RemoteExecError.kind → HTTP status (ssh_ops-контракт)
_REMOTE_ERROR_STATUS = {
    "machine_not_found": 404,
    "machine_not_ssh": 400,
    "invalid_args": 400,
    "edit_invalid": 400,
    "remote_file_not_found": 404,
    "remote_limit_exceeded": 413,
    "ssh_timeout": 504,
    # ssh_unreachable / ssh_error / прочее → 502
}


def _remote_error(exc: RemoteExecError) -> web.Response:
    return web.json_response(
        {"error": exc.kind, "message": exc.message},
        status=_REMOTE_ERROR_STATUS.get(exc.kind, 502))


def _is_remote(machine: str) -> bool:
    return (machine or LOCAL_MACHINE).strip() != LOCAL_MACHINE


def _env_name_set(name: str) -> List[str]:
    """env-список имён через запятую или JSON-массив → list[str]."""
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return []
    if raw.startswith("["):
        try:
            data = json.loads(raw)
            if isinstance(data, list):
                return [str(x) for x in data]
        except json.JSONDecodeError:
            pass
    return [p.strip() for p in raw.split(",") if p.strip()]


async def _gate_check(
    state: "AppState",
    operation_type: str,
    payload: Dict[str, Any],
    agent: str = "core-api",
    intent_hash: Optional[str] = None,
) -> Optional[web.Response]:
    """#468 gate coverage: mutating-операция через AEGIS до исполнения.

    permit → None (handler продолжает); deny → 403; AEGIS escalate → 202
    {approval_id, intent_hash} — клиент повторяет запрос после approve.
    ``gate-policy.json`` require_approval вместо этого сохраняет исходный
    JSON-запрос на 10 минут и запускает его через тот же handler по approve.
    Каждое решение аудируется gate'ом, включая panic-заморозку.

    FIX-69 PC-3.1 (#472): если клиент прислал intent_hash (полученный в
    202-ответе на первый заход), сервер ПЕРЕСЧИТЫВАЕТ канонический хэш
    фактического gate-payload и сверяет ДО evaluate — расхождение =
    deny intent_hash_mismatch, мутация не исполняется и окна не жгутся.
    Это связывает повтор с содержимым, которое уходило на эскалацию;
    полная consume-on-execute (tier 3.2, permits-store) — owner-решение.

    Отдельный trail v1 имеет стабильную форму записи
    {v:1, ts, action, subject, decision, detail}. В него не попадает payload:
    только action, безопасное имя ресурса и краткая причина отказа.
    """
    try:
        policy_rule = _gate_policy_match(state, operation_type, payload)
    except ValueError as exc:
        policy_rule = {"decision": "deny", "rule_id": "POLICY",
                       "reason": str(exc)}
    replay = _APPROVED_POLICY_REPLAY.get()
    is_replay = replay is not None and replay.get("state") is state
    if is_replay:
        replay_matches = (
            policy_rule is not None
            and policy_rule.get("decision") == "require_approval"
            and replay.get("operation_type") == operation_type
            and replay.get("payload_hash") == AegisGuard._payload_hash(payload)
            and replay.get("rule_id") == policy_rule.get("rule_id")
            and replay.get("policy_hash") == policy_rule.get("policy_hash")
            and not replay.get("used")
        )
        if not replay_matches:
            _record_mutation_approval_event(
                state, "approval_approved", replay.get("subject"), "stale",
                replay.get("approval_id", ""), replay.get("rule_id", ""))
            return _error("approval no longer matches request or policy",
                          status=409)
        replay["used"] = True
    if policy_rule is not None:
        policy_decision = policy_rule["decision"]
        if policy_decision == "deny":
            policy_reason = "denied by gate policy"
        elif policy_decision == "require_approval":
            if not is_replay:
                if (not policy_rule.get("dual_control")
                        and _dual_control_required(operation_type, payload)):
                    policy_rule = {**policy_rule, "dual_control": True}
                return await _defer_policy_mutation(
                    state, operation_type, payload, policy_rule)
            policy_reason = ""
        elif isinstance(policy_decision, dict):
            policy_reason = "dual approval policy is not wired yet; denied fail-closed"
        else:
            policy_reason = ""
        if policy_reason:
            rule_id = policy_rule["rule_id"]
            reason = policy_rule.get("reason", policy_reason)
            audit_error = _record_gate_decision(
                state, operation_type, payload, "deny",
                _audit_detail(reason, rule_id, "deny"))
            if audit_error is not None:
                return audit_error
            return web.json_response({
                "outcome": "deny",
                "rule_id": rule_id,
                "reason": reason,
                "policy_hash": state.gate.policy_hash,
            }, status=403)

    expected = AegisGuard._payload_hash(payload)
    if intent_hash is not None and str(intent_hash) != expected:
        reason = ("intent_hash_mismatch: повтор не совпадает с "
                  "каноническим хэшем payload — перезапросите операцию")
        audit_error = _record_gate_decision(
            state, operation_type, payload, "deny",
            _audit_detail(reason, "INTENT-HASH", "deny"))
        if audit_error is not None:
            return audit_error
        return web.json_response({
            "outcome": "deny",
            "rule_id": "INTENT-HASH",
            "reason": reason,
            "policy_hash": state.gate.policy_hash,
        }, status=403)
    # W77 consume-on-execute permits: approve()/guardian-release mint'ят
    # permit по {operation_type, payload_hash} — ретрай исполняется
    # один раз. Нет/expired/consumed/stale-policy → evaluate заново
    # (re-escalate, fail-safe). Проверка после intent_hash-mismatch:
    # подделанный ретрай не может сжечь живой permit.
    permit_id = state.gate.consume_permit(operation_type, expected)
    if permit_id is not None:
        audit_error = _record_gate_decision(
            state, operation_type, payload, "allow",
            _audit_detail(f"permit {permit_id[:12]} consumed",
                          "PERMIT", "allow"))
        if audit_error is not None:
            return audit_error
        return None
    decision = state.gate.evaluate(
        OperationProposal(operation_type, agent, payload), {})
    if decision.outcome == "permit":
        allow_detail = None
        if (policy_rule is not None
                and policy_rule["decision"] == "allow"):
            allow_detail = _audit_detail(
                "allowed by gate policy", policy_rule["rule_id"], "allow")
        audit_error = _record_gate_decision(
            state, operation_type, payload, "allow", allow_detail)
        if audit_error is not None:
            return audit_error
        return None
    audit_error = _record_gate_decision(
        state, operation_type, payload, "deny",
        _audit_detail(decision.reason, decision.rule_id, decision.outcome))
    if audit_error is not None:
        return audit_error
    body = {
        "outcome": decision.outcome,
        "rule_id": decision.rule_id,
        "reason": decision.reason,
        "policy_hash": decision.policy_hash,
    }
    if decision.outcome == "escalate":
        body["approval_id"] = decision.approval_id
        body["intent_hash"] = expected
        return web.json_response(body, status=202)
    return web.json_response(body, status=403)


def _payload_sha(value: Any) -> str:
    """sha256 canonical-JSON → 16 hex. Для больших/чувствительных полей
    gate-payload (#469b): gate-аудит хранит весь payload — file content
    и terminal text могут быть мегабайтами и содержать секреты (пароли,
    токены из paste). В payload_hash/pending уходит хэш поля, не само
    значение — привязка к содержимому сохраняется, утечки в JSONL нет."""
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()[:16]


# -- списки ----------------------------------------------------------------

async def handle_terminals(request: web.Request) -> web.Response:
    """GET /api/core/terminals — живые терминалы из супервизора."""
    state = _state(request)
    terms = [t.to_dict() for t in state.supervisor.list_terminals()]
    now = time.time()
    for t in terms:
        t["idle_seconds"] = round(max(0.0, now - float(t.get("last_output_at", now))), 3)
        t["uptime_seconds"] = round(max(0.0, now - float(t.get("created_at", now))), 3)
    live = sum(1 for t in terms if t["state"] not in ("exited",))
    return web.json_response({"terminals": terms, "count": len(terms), "live": live})


def _machines_detail(state: AppState) -> web.Response:
    """W3: детальный список машин — [{name, terminals, uptime_s, state, …}].

    Реальные данные: terminals = живые (не exited) терминалы машины;
    uptime_s = возраст текущего state (since_ms → now); у local
    дополнительно metrics — cpu/mem/OS-uptime из system_metrics.
    """
    from tools.nexus_core.system_metrics import get_system_metrics
    now_ms = time.time() * 1000
    live_by_machine: dict = {}
    for term in state.supervisor.terminals.values():
        if term.state != "exited":
            live_by_machine[term.machine] = (
                live_by_machine.get(term.machine, 0) + 1)
    registry = {m.name: m for m in state.machines.list_all()}
    names = sorted(set(registry) | set(live_by_machine)
                   | {t.machine for t in state.supervisor.terminals.values()})
    local_metrics = None
    out = []
    for name in names:
        m = registry.get(name)
        if m is not None:
            entry = {
                "name": name,
                "host": m.host,
                "transport": m.transport,
                "state": m.state,
                "since_ms": m.since_ms,
                "why": m.why,
                "labels": dict(m.labels),
                "uptime_s": round(
                    max(0.0, (now_ms - (m.since_ms or now_ms)) / 1000.0), 1),
            }
        else:
            # терминалы есть, записи в реестре нет — синтез connected
            entry = {
                "name": name, "host": None, "transport": None,
                "state": "connected", "since_ms": None, "why": None,
                "labels": {}, "uptime_s": None,
            }
        entry["terminals"] = live_by_machine.get(name, 0)
        if name == LOCAL_MACHINE:
            if local_metrics is None:
                local_metrics = get_system_metrics().collect()
            mem_total = local_metrics["mem_total"] or 0
            entry["metrics"] = {
                "cpu_pct": local_metrics["cpu_pct"],
                "mem_used": local_metrics["mem_used"],
                "mem_total": mem_total,
                "mem_used_pct": (
                    round(local_metrics["mem_used"] / mem_total * 100, 1)
                    if mem_total else None),
                "uptime_s": local_metrics["uptime_s"],
            }
        out.append(entry)
    return web.json_response({"machines": out, "count": len(out)})


async def handle_machines(request: web.Request) -> web.Response:
    """GET /api/core/machines[?detail=1] — машины.

    Дефолт — merge-шейп, замороженный HERETIC #482:
    {machines: {name: {terminals, state, host, transport, since_ms,
    why}}, count}. ?detail=1 — W3-список с реальными данными
    (см. _machines_detail); старый шейп не тронут."""
    state = _state(request)
    if request.query.get("detail") in ("1", "true", "yes"):
        return _machines_detail(state)
    machines = {}
    for term in state.supervisor.terminals.values():
        machines.setdefault(term.machine, {"state": "connected", "terminals": 0})
        machines[term.machine]["terminals"] += 1
    for m in state.machines.list_all():
        entry = machines.setdefault(m.name, {"terminals": 0})
        entry.update({
            "host": m.host,
            "transport": m.transport,
            "state": m.state,
            "since_ms": m.since_ms,
            "why": m.why,
        })
    return web.json_response({"machines": machines, "count": len(machines)})


async def handle_machines_schema(request: web.Request) -> web.Response:
    """Expose the machine registry's validation rules to NEWF clients."""
    return web.json_response({
        "name_pattern": VALID_NAME_RE.pattern,
        "host_pattern": HOST_RE.pattern,
        "transports": list(TRANSPORTS),
        "host_default_to_name": True,
    })


async def handle_machine_get(request: web.Request) -> web.Response:
    """GET /api/core/machines/{name} — одна машина реестра."""
    state = _state(request)
    name = request.match_info["name"]
    machine = state.machines.get(name)
    if machine is None:
        return _error(f"machine not found: {name}", status=404)
    return web.json_response(machine.to_dict())


async def handle_machine_put(request: web.Request) -> web.Response:
    """PUT /api/core/machines/{name} {host?, transport?} — upsert машины."""
    state = _state(request)
    name = request.match_info["name"]
    try:
        data = await _read_json(request)
        host = data.get("host")
        transport = data.get("transport")
        labels = data.get("labels")
        if host is not None and not isinstance(host, str):
            raise ValueError("host must be a string")
        if transport is not None and transport not in ("ssh", "local"):
            raise ValueError("transport must be 'ssh' or 'local'")
        if labels is not None:
            if not isinstance(labels, dict) or not all(
                    isinstance(k, str) and isinstance(v, str)
                    for k, v in labels.items()):
                raise ValueError("labels must be an object of strings")
            labels = {str(k): str(v) for k, v in labels.items()}
    except ValueError as exc:
        return _error(str(exc))
    # #468: machine-мутация через AEGIS gate (audit + panic coverage).
    denied = await _gate_check(state, "core.machine_mutation", {
        "action": "put", "name": name, "host": host,
        "transport": transport or "ssh",
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    try:
        if state.machines.get(name) is None:
            machine = state.machines.add(
                name,
                host or name,
                transport=transport or "ssh",
                labels=labels,
            )
        else:
            machine = state.machines.update(
                name, host=host, transport=transport, labels=labels)
    except MachineError as exc:
        return _error(str(exc), status=409)
    return web.json_response(machine.to_dict())


async def handle_machine_delete(request: web.Request) -> web.Response:
    """DELETE /api/core/machines/{name} — забыть машину (терминалы целы)."""
    state = _state(request)
    name = request.match_info["name"]
    denied = await _gate_check(state, "core.machine_mutation",
                               {"action": "delete", "name": name})
    if denied is not None:
        return denied
    try:
        machine = state.machines.rm(name)
    except MachineError as exc:
        return _error(str(exc), status=404)
    return web.json_response({"removed": machine.to_dict()})


async def handle_machine_rename(request: web.Request) -> web.Response:
    """POST /api/core/machines/{name}/rename {name: new} — breaking rename + remap."""
    state = _state(request)
    old = request.match_info["name"]
    try:
        data = await _read_json(request)
        new = str(data.get("name", "")).strip()
        if not new:
            raise ValueError("new name required")
    except ValueError as exc:
        return _error(str(exc))
    denied = await _gate_check(state, "core.machine_mutation", {
        "action": "rename", "name": old, "new_name": new,
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    try:
        machine = state.machines.rename(old, new)
    except MachineError as exc:
        return _error(str(exc), status=404)
    return web.json_response({"renamed": machine.to_dict()})


async def handle_machine_connect(request: web.Request) -> web.Response:
    """POST /api/core/machines/{name}/connect — регистрация + probe ssh.

    transport=ssh: добавить в реестр и проверить доступность
    (`ssh -o BatchMode true`). Реальные remote-терминалы — N4.
    """
    state = _state(request)
    name = request.match_info["name"]
    try:
        data = await _read_json(request)
        host = str(data.get("host", "")).strip()
        transport = data.get("transport", "ssh")
        if not host:
            raise ValueError("host required")
        if transport not in ("ssh", "local"):
            raise ValueError("transport must be 'ssh' or 'local'")
    except ValueError as exc:
        return _error(str(exc))
    denied = await _gate_check(state, "core.machine_mutation", {
        "action": "connect", "name": name, "host": host,
        "transport": transport,
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    try:
        if state.machines.get(name) is None:
            state.machines.add(name, host, transport=transport)
        machine = await asyncio.to_thread(state.machines.probe, name)
    except MachineError as exc:
        return _error(str(exc), status=409)
    return web.json_response(machine.to_dict())


async def handle_exec(request: web.Request) -> web.Response:
    """POST /api/core/exec {machine, argv, timeout?} — machine.exec (N3).

    local — прямой spawn (subprocess), результат {stdout, stderr,
    exit_code, duration_ms}; remote — честная ошибка (N4+).
    """
    state = _state(request)
    try:
        data = await _read_json(request)
        machine = str(data.get("machine", "local")).strip()
        argv = data.get("argv")
        if not isinstance(argv, list) or not argv:
            raise ValueError("argv must be a non-empty list")
        if not all(isinstance(a, str) for a in argv):
            raise ValueError("argv must be a list of strings")
        timeout = data.get("timeout")
        if timeout is not None:
            timeout = float(timeout)
            if timeout <= 0:
                raise ValueError("timeout must be > 0")
    except ValueError as exc:
        return _error(str(exc))
    # #468: exec — самый sensitive core endpoint (произвольная команда):
    # через gate для audit/panic/будущих argv-правил.
    denied = await _gate_check(state, "core.exec", {
        "machine": machine, "argv": argv, "timeout": timeout,
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    try:
        if _is_remote(machine):
            # N4: remote — SSH через реестр машин (ssh_ops)
            result = await asyncio.to_thread(
                state.ssh.exec, machine, argv, timeout)
        else:
            result = await asyncio.to_thread(
                machine_exec, machine, argv, timeout)
    except RemoteExecError as exc:
        return _remote_error(exc)
    except RemoteNotSupportedError as exc:
        return _error(str(exc), status=501)
    except (ValueError, MachineError) as exc:
        return _error(str(exc))
    return web.json_response(result)


async def handle_file_read(request: web.Request) -> web.Response:
    """GET /api/core/file/read?path=&offset=&limit= — чтение файла (N3)."""
    state = _state(request)
    path = request.query.get("path", "")
    if not path:
        return _error("path required")
    try:
        offset = int(request.query.get("offset", "1"))
        limit_raw = request.query.get("limit")
        limit = int(limit_raw) if limit_raw is not None else None
    except ValueError:
        return _error("offset/limit must be integers")
    machine = request.query.get("machine", LOCAL_MACHINE)
    try:
        if _is_remote(machine):
            result = await asyncio.to_thread(
                state.ssh.read, machine, path, offset, limit)
        else:
            result = state.files.read(path, offset=offset, limit=limit)
    except RemoteExecError as exc:
        return _remote_error(exc)
    except FileOpsNotFound as exc:
        return _error(str(exc), status=404)
    except (FileOpsError, ValueError) as exc:
        return _error(str(exc))
    return web.json_response(result)


async def handle_files_list(request: web.Request) -> web.Response:
    """GET /api/core/file/list?path=&depth=&limit= — перечислить песочницу (N8).

    Алиас GET /api/core/files — тот же хендлер (директива #478 называет путь
    /files, design #475 §2.1 — /file/list; реализуем оба, чтобы не выбирать
    за клиента). READ-ONLY: file-мутации и gate-ветку не трогает.
    """
    state = _state(request)
    path = request.query.get("path", ".") or "."
    try:
        depth = int(request.query.get("depth", "1"))
        limit_raw = request.query.get("limit")
        limit = int(limit_raw) if limit_raw is not None else None
    except ValueError:
        return _error("depth/limit must be integers")
    machine = request.query.get("machine", LOCAL_MACHINE)
    if _is_remote(machine):
        # §2 конвенции: remote-ветку объявляем явно, а не молчим (до N4)
        return _error(
            f"remote listing not supported until N4: machine {machine!r}",
            status=501)
    try:
        result = await asyncio.to_thread(
            state.files.list, path, depth=depth, limit=limit)
    except FileOpsNotFound as exc:
        return _error(str(exc), status=404)
    except FileOpsTooLarge as exc:
        return _error(str(exc), status=413)
    except (FileOpsError, ValueError) as exc:
        return _error(str(exc))
    return web.json_response(result)


async def handle_changes(request: web.Request) -> web.Response:
    """GET /api/core/changes?cwd=&limit=&stat= — git-статус копии (N8).

    Только чтение: git запускается с --no-optional-locks (чужой index.lock не
    трогается), ошибка git ⇒ fail-closed «dirty», а не «чисто».
    """
    state = _state(request)
    cwd = request.query.get("cwd", "")
    if not cwd.strip():
        return _error("cwd required")     # ядро не знает, какой репо показывать
    try:
        limit_raw = request.query.get("limit")
        limit = int(limit_raw) if limit_raw is not None else git_ops.DEFAULT_CHANGE_LIMIT
    except ValueError:
        return _error("limit must be an integer")
    stat = request.query.get("stat", "").lower() in ("1", "true", "yes", "on")
    machine = request.query.get("machine", LOCAL_MACHINE)
    if _is_remote(machine):
        return _error(
            f"remote changes not supported until N4: machine {machine!r}",
            status=501)
    try:
        target = state.files.resolve_dir(cwd)
    except FileOpsNotFound as exc:
        return _error(str(exc), status=404)
    except (FileOpsError, ValueError) as exc:
        return _error(str(exc))
    try:
        result = await asyncio.to_thread(
            git_ops.changes, state.files.root, target, cwd, limit, stat)
    except GitUnavailable as exc:
        # 503, чтобы клиент НЕ рисовал «всё чисто» при недоступном git
        return web.json_response(
            {"cwd": cwd, "state": "git_unavailable", "error": str(exc),
             "changes": [], "count": 0}, status=503)
    except (ValueError, OSError) as exc:
        return _error(str(exc))
    return web.json_response(result)


# -- worktrees (#549) ---------------------------------------------------------
#
# POST   /api/core/worktree     {repo?, name} — git worktree add + spawn term
# GET    /api/core/worktrees    ?repo=         — git worktree list --porcelain
# DELETE /api/core/worktree     ?name=&repo=&force= — remove + kill term
#
# repo опционален: env NEXUS_REPO → cwd процесса. Worktree-каталог
# детерминирован: sibling `<repo>-wt/<name>` (D:\nexus → D:\nexus-wt\<name>).


def _resolve_repo(raw: Any) -> Path:
    repo_raw = raw if isinstance(raw, str) and raw.strip() else (
        os.environ.get("NEXUS_REPO") or os.getcwd()
    )
    return Path(repo_raw).expanduser()


def _wt_term_name(supervisor: SupervisorV1, name: str) -> str:
    """Имя терминала для worktree: `wt-<sanitized>`, ≤32 [a-z0-9_-], уникально."""
    import re as _re
    base = _re.sub(r"[^a-z0-9_-]+", "-", name.lower()).strip("-_") or "wt"
    base = ("wt-" + base)[:32].rstrip("-_") or "wt"
    candidate, i = base, 2
    while candidate in supervisor.terminals:
        suffix = f"-{i}"
        candidate = (base[: 32 - len(suffix)] + suffix)
        i += 1
    return candidate


async def handle_worktrees(request: web.Request) -> web.Response:
    """GET /api/core/worktrees?repo= — список worktree'ев репозитория.

    W5: каждая запись несёт status {ahead, behind, dirty, branch} —
    porcelain + rev-list против ветки main-worktree."""
    state = _state(request)
    repo = _resolve_repo(request.query.get("repo"))
    try:
        entries = await asyncio.to_thread(git_ops.list_worktrees, repo)
    except GitUnavailable as exc:
        return web.json_response(
            {"repo": str(repo), "worktrees": [], "error": str(exc)},
            status=503)
    except GitError as exc:
        return _error(str(exc), status=409)
    base_ref = next(
        (e.get("branch") for e in entries if e.get("main")), None)
    statuses = await asyncio.gather(*(
        asyncio.to_thread(
            git_ops.worktree_status, repo, entry, base_ref)
        for entry in entries
    ))
    for entry, status in zip(entries, statuses):
        entry["status"] = status
    return web.json_response({"repo": str(repo), "worktrees": entries})


async def handle_worktree_create(request: web.Request) -> web.Response:
    """POST /api/core/worktree {repo?, name} — worktree + терминал в нём."""
    state = _state(request)
    try:
        data = await _read_json(request)
        name = str(data.get("name", "")).strip()
        if not name:
            raise ValueError("name required")
        repo = _resolve_repo(data.get("repo"))
    except ValueError as exc:
        return _error(str(exc))
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "worktree_create", "name": name, "repo": str(repo),
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    try:
        info = await asyncio.to_thread(git_ops.add_worktree, repo, name)
    except ValueError as exc:
        return _error(str(exc))
    except GitUnavailable as exc:
        return web.json_response({"error": str(exc)}, status=503)
    except GitError as exc:
        return _error(str(exc), status=409)
    # Терминал внутри worktree: label wt=<name> — HERETIC ctx-меню
    # находит его по labels.wt; cwd sanitized супервизором.
    term_name = _wt_term_name(state.supervisor, name)
    try:
        term = state.supervisor.create_terminal(
            name=term_name,
            command=None,
            cwd=info["path"],
            labels={"wt": name},
        )
    except Exception as exc:
        # rollback: worktree без терминала — убираем, чтобы не плодить мусор
        try:
            await asyncio.to_thread(
                git_ops.remove_worktree, repo, name, True)
        except Exception:
            pass
        return _error(str(exc), status=409)
    return web.json_response(
        {"worktree": info, "terminal": term.to_dict()}, status=201)


async def handle_worktree_delete(request: web.Request) -> web.Response:
    """DELETE /api/core/worktree?name=&repo=&force= — kill terms + remove."""
    state = _state(request)
    name = (request.query.get("name") or "").strip()
    if not name:
        return _error("name required")
    repo = _resolve_repo(request.query.get("repo"))
    force = request.query.get("force", "").lower() in ("1", "true", "yes")
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "worktree_delete", "name": name, "repo": str(repo),
        "force": force,
    }, intent_hash=request.query.get("intent_hash"))
    if denied is not None:
        return denied
    # Путь worktree нужен ДО kill — match по labels.wt и по cwd внутри него.
    try:
        wt_path = await asyncio.to_thread(
            git_ops.worktree_path, repo, name)
    except GitUnavailable as exc:
        return web.json_response({"error": str(exc)}, status=503)
    except GitError as exc:
        return _error(str(exc), status=409)
    except WorktreeNotFound:
        return _error(f"worktree not found: {name}", status=404)
    wt_res = wt_path.resolve()
    targets = []
    for term in state.supervisor.terminals.values():
        if term.labels.get("wt") == name:
            targets.append(term)
            continue
        cwd = term.cwd
        if cwd:
            try:
                if Path(cwd).resolve().is_relative_to(wt_res):
                    targets.append(term)
            except OSError:
                pass
    killed: list[str] = []
    for term in targets:
        try:
            await asyncio.to_thread(
                state.supervisor.escalate_kill, term.address)
            killed.append(term.address)
        except Exception:
            killed.append(f"{term.address} (kill failed)")
    try:
        info = await asyncio.to_thread(
            git_ops.remove_worktree, repo, name, force)
    except GitUnavailable as exc:
        return web.json_response(
            {"error": str(exc), "killed": killed}, status=503)
    except WorktreeNotFound:
        return _error(f"worktree not found: {name}", status=404)
    except GitError as exc:
        return web.json_response(
            {"error": str(exc), "killed": killed}, status=409)
    return web.json_response({"removed": info, "killed": killed})


async def handle_file_write(request: web.Request) -> web.Response:
    """POST /api/core/file/write {path, content} — атомарная запись (N3)."""
    state = _state(request)
    try:
        data = await _read_json(request)
        path = str(data.get("path", "")).strip()
        content = data.get("content")
        machine = str(data.get("machine", LOCAL_MACHINE))
        if not path:
            raise ValueError("path required")
        if not isinstance(content, str):
            raise ValueError("content must be a string")
    except ValueError as exc:
        return _error(str(exc))
    # #469b: file-мутация через gate; content → sha (аудит не хранит файл)
    denied = await _gate_check(state, "core.file_mutation", {
        "action": "write", "path": path, "machine": machine,
        "content_sha": _payload_sha(content), "content_len": len(content),
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    try:
        if _is_remote(machine):
            result = await asyncio.to_thread(
                state.ssh.write, machine, path, content)
        else:
            result = state.files.write(path, content)
    except RemoteExecError as exc:
        return _remote_error(exc)
    except (FileOpsError, ValueError) as exc:
        return _error(str(exc))
    return web.json_response(result)


async def handle_file_edit(request: web.Request) -> web.Response:
    """POST /api/core/file/edit {path, pairs: [[old, new], ...]} — exact-once (N3)."""
    state = _state(request)
    try:
        data = await _read_json(request)
        path = str(data.get("path", "")).strip()
        pairs = data.get("pairs")
        machine = str(data.get("machine", LOCAL_MACHINE))
        if not path:
            raise ValueError("path required")
        if not isinstance(pairs, list) or not pairs:
            raise ValueError("pairs required (list of [old, new])")
        normalized = []
        for pair in pairs:
            if not isinstance(pair, (list, tuple)) or len(pair) != 2:
                raise ValueError("each pair must be [old, new]")
            old, new = pair
            if not isinstance(old, str) or not isinstance(new, str):
                raise ValueError("old and new must be strings")
            normalized.append((old, new))
    except ValueError as exc:
        return _error(str(exc))
    # #469b: pairs → sha (сами строки могут быть большими)
    denied = await _gate_check(state, "core.file_mutation", {
        "action": "edit", "path": path, "machine": machine,
        "pairs_sha": _payload_sha(normalized),
        "pairs_count": len(normalized),
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    try:
        if _is_remote(machine):
            result = await asyncio.to_thread(
                state.ssh.edit, machine, path, normalized)
        else:
            result = state.files.edit(path, normalized)
    except RemoteExecError as exc:
        return _remote_error(exc)
    except FileOpsNotFound as exc:
        return _error(str(exc), status=404)
    except (FileOpsError, ValueError) as exc:
        return _error(str(exc))
    return web.json_response(result)


async def handle_programs(request: web.Request) -> web.Response:
    """GET /api/core/programs — launcher-реестр (#551b, hot-edit).

    Читает programs.json на каждый запрос: правки файла подхватываются
    без рестарта. `available` — резолв detect.exe/where через which/exists.
    """
    entries = await asyncio.to_thread(programs_mod.load_programs)
    return web.json_response({"programs": entries, "count": len(entries)})


async def handle_presets(request: web.Request) -> web.Response:
    """GET /api/core/presets — spawn-пресеты (W11, hot-edit).

    presets.json читается на каждый запрос. env в выдаче проходит
    _masked_env — пресеты могут нести секретоподобные ключи.
    """
    entries = await asyncio.to_thread(presets_mod.load_presets)
    out = []
    for p in entries:
        item = dict(p)
        if "env" in item:
            item["env"] = _masked_env(item["env"])
        out.append(item)
    return web.json_response({"presets": out, "count": len(out)})


async def handle_server_status(request: web.Request) -> web.Response:
    """GET /api/core/server — статус ядра: версия, аптайм, counts.

    terminals/machines/events (N3). restart — честно unimplemented
    (нет безопасного self-respawn пути), отдельного ручки нет.
    """
    state = _state(request)
    terminals = state.supervisor.list_terminals()
    return web.json_response({
        "version": "N3",
        "state": "running",
        "uptime_s": round(time.time() - SERVER_START, 3),
        "terminals": len(terminals),
        "machines": len(state.machines.list_all()),
        "events": len(state.supervisor.events),
        "restore": state.supervisor.restore_status,
        "registry_schema": REGISTRY_SCHEMA_VERSION,  # W67
    })


async def handle_system(request: web.Request) -> web.Response:
    """GET /api/core/system — метрики хоста для System-панели (#537).

    {cpu_pct, mem_used, mem_total, disks[], net{rx_bps,tx_bps},
     gpu{pct,vram_used,vram_total,temp}|null, uptime_s}.
    Сбор — tools/nexus_core/system_metrics.py (ctypes, без psutil).
    """
    from tools.nexus_core.system_metrics import get_system_metrics
    # collect() синхронный и может дёрнуть nvidia-smi (~300мс) —
    # выносим в executor, чтобы не блокировать event loop.
    metrics = await asyncio.get_running_loop().run_in_executor(
        None, get_system_metrics().collect
    )
    return web.json_response(metrics)


async def handle_agents(request: web.Request) -> web.Response:
    """GET /api/core/agents — агенты (терминалы с labels)."""
    state = _state(request)
    agents = []
    for term in state.supervisor.list_terminals():
        # листинг агентов = наблюдение (RFC §11.1 K2-1: done → idle)
        state.supervisor.mark_observed(term.address)
        d = term.to_dict()
        agents.append({
            "address": d["address"],
            "name": d["name"],
            "state": d["state"],
            "attention": d["attention"],
            "labels": d["labels"],
            "parent": d["parent"],
        })
    return web.json_response({"agents": agents, "count": len(agents)})


async def handle_space_batch(request: web.Request) -> web.Response:
    """POST /api/core/space/{id}/batch — W60 batch-операции в space.

    {op: "send"|"kill"|"freeze"|"resume", text?, enter?, stage?}
    Члены space = term.space==id ИЛИ (без space и machine==id).
    op=send → только живым (exited → per-term error);
    kill → escalate_kill (stage опц.); freeze/resume → флаг+registry.
    Ответ {space, op, results:[{term,ok,error?}], ok, count}.
    Один gate core.terminal_mutation action="space-batch".
    """
    state = _state(request)
    space_id = request.match_info.get("id", "")
    try:
        data = await _read_json(request)
        op = data.get("op")
        if op not in ("send", "kill", "freeze", "resume"):
            raise ValueError(
                "op must be send|kill|freeze|resume")
    except ValueError as exc:
        return _error(str(exc))
    sup = state.supervisor
    members = [t for t in sup.terminals.values()
               if (t.space or t.machine) == space_id]
    if not members:
        return _error(f"space not found or empty: {space_id}",
                      status=404)
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "space-batch", "space": space_id, "op": op,
        "count": len(members),
        "text_sha": _payload_sha(str(data.get("text", ""))),
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    results = []
    if op == "send":
        text = data.get("text")
        if not isinstance(text, str):
            return _error("text required (string)", status=400)
        enter = bool(data.get("enter", True))
        for t in members:
            if t.state == "exited" or t.handle is None:
                results.append({"term": t.address, "ok": False,
                                "error": "not live"})
                continue
            results.append({"term": t.address, "ok": sup.send(
                t.address, text, enter=enter)})
    elif op == "kill":
        stage = data.get("stage")
        for t in members:
            try:
                r = await asyncio.to_thread(
                    sup.escalate_kill, t.address, stage)
                results.append({"term": t.address, "ok": True,
                                "result": r})
            except Exception as exc:
                results.append({"term": t.address, "ok": False,
                                "error": str(exc)[:200]})
    else:  # freeze | resume
        freeze = op == "freeze"
        for t in members:
            t.frozen = freeze
            results.append({"term": t.address, "ok": True,
                            "frozen": freeze})
            sup._emit("frozen" if freeze else "resumed", {
                "address": t.address, "frozen": freeze})
        sup._save_registry()
    return web.json_response({
        "space": space_id, "op": op, "results": results,
        "ok": all(r["ok"] for r in results),
        "count": len(results)})


async def handle_spaces(request: web.Request) -> web.Response:
    """GET /api/core/spaces — спейсы по машинам."""
    state = _state(request)
    spaces = []
    # W48: членство терминала в space = term.space или его machine
    def _eff_space(t) -> str:
        return t.space or t.machine
    for machine in sorted({_eff_space(t) for t in
                           state.supervisor.terminals.values()}):
        spaces.append({
            "id": machine,
            "machine": machine,
            "state": "connected",
            "terminals": sum(1 for t in state.supervisor.terminals.values() if _eff_space(t) == machine),
        })
    custom = _load_custom_spaces(state)
    idle_ttls = _space_idle_ttls(state)  # W37
    seen = {s.get("id") for s in spaces}
    for s in custom.get("spaces", []):
        if s.get("id") not in seen:
            spaces.append(s)
            seen.add(s.get("id"))
        else:
            # W66: custom space с id==machine-derived (члены
            # мигрированы) — обогащаем machine-запись полями
            # custom (labels/name/state), счётчик terminals
            # machine-записи сохраняем.
            for m in spaces:
                if m.get("id") == s.get("id"):
                    for k, v in s.items():
                        if k != "terminals":
                            m[k] = v
                    break
    for s in spaces:
        key = str(s.get("machine") or s.get("id"))
        if key in idle_ttls:
            s["idle_ttl"] = idle_ttls[key]
        if isinstance(s.get("labels"), dict):
            s["labels"] = dict(s["labels"])
    return web.json_response({"spaces": spaces})

import json as _json

_SPACES_FILE_NAME = "spaces.json"


def _spaces_path(state) -> object:
    return state.base / _SPACES_FILE_NAME


def _load_custom_spaces(state) -> dict:
    path = _spaces_path(state)
    try:
        if path.exists():
            return _json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {"spaces": []}


def _save_custom_spaces(state, data) -> None:
    try:
        _spaces_path(state).write_text(_json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


def _space_labels(state, space_id: str) -> dict:
    """W66: labels кастомного space {k:v} (default-ы для членов)."""
    if not space_id:
        return {}
    for s in _load_custom_spaces(state).get("spaces", []):
        if str(s.get("id")) == space_id:
            lbl = s.get("labels")
            if isinstance(lbl, dict):
                return {str(k): str(v) for k, v in lbl.items()}
            return {}
    return {}


def _apply_space_labels(state, term, space_id: str) -> int:
    """W66: наследование space→terminal labels.

    Space-лейблы — DEFAULT-ы: setdefault, явные лейблы терминала
    всегда выигрывают. Возвращает сколько ключей добавлено.
    """
    added = 0
    for k, v in _space_labels(state, space_id).items():
        if k not in term.labels:
            term.labels[k] = v
            added += 1
    return added


def _space_idle_ttls(state) -> dict:
    """W37: {machine: ttl_seconds} из spaces.json top-level idle_ttl."""
    raw = _load_custom_spaces(state).get("idle_ttl", {})
    out = {}
    if isinstance(raw, dict):
        for k, v in raw.items():
            try:
                out[str(k)] = float(v)
            except (TypeError, ValueError):
                continue
    return out


async def handle_space_idle_policy(request) -> web.Response:
    """PUT /api/core/space/{id}/idle-policy — W37 per-space TTL.

    {"ttl_seconds": N|null} — N>0: idle-kick для терминалов этого
    space (machine) через N сек без вывода; 0 → kick выключен для
    space; null → снять политику (наследовать global/label).
    Персистится в spaces.json idle_ttl + supervisor.space_idle_ttl.
    """
    state = _state(request)
    space_id = request.match_info["id"]
    try:
        data = await _read_json(request)
    except ValueError as exc:
        return _error(str(exc))
    if "ttl_seconds" not in data:
        return _error("ttl_seconds required")
    ttl = data.get("ttl_seconds")
    # space существует? machine-derived или custom
    known = {t.machine for t in state.supervisor.terminals.values()}
    custom = _load_custom_spaces(state)
    for s in custom.get("spaces", []):
        known.add(str(s.get("machine") or s.get("id")))
    known.add(space_id)
    # ключ TTL = machine терминалов space'а: для custom — его
    # machine/id, для machine-space — сам id
    cspace = next((s for s in custom.get("spaces", [])
                   if s.get("id") == space_id), None)
    key = str((cspace or {}).get("machine") or space_id)
    policies = dict(custom.get("idle_ttl", {}))
    ttl_f = None
    if ttl is not None:
        try:
            ttl_f = float(ttl)
        except (TypeError, ValueError):
            return _error("ttl_seconds must be a number or null")
    denied = await _gate_check(
        state, "core.terminal_mutation",
        {"action": "space-idle-policy", "space": space_id,
         "ttl_seconds": ttl_f},
        intent_hash=data.get("intent_hash"))
    if denied:
        return denied
    if ttl_f is None:
        policies.pop(key, None)
        state.supervisor.space_idle_ttl.pop(key, None)
    else:
        policies[key] = ttl_f
        state.supervisor.space_idle_ttl[key] = ttl_f
    custom["idle_ttl"] = policies
    _save_custom_spaces(state, custom)
    state.events.channel.publish({
        "type": "policy", "id": space_id, "idle_ttl": ttl})
    return web.json_response({
        "id": space_id, "machine": key,
        "idle_ttl": policies.get(key)})


async def handle_space_create(request) -> web.Response:
    state = _state(request)
    try:
        data = await _read_json(request)
    except ValueError as exc:
        return _error(str(exc))
    name = str(data.get("name", "")).strip()
    if not name or not VALID_NAME_RE.fullmatch(name):
        return _error("bad name", status=400)
    custom = _load_custom_spaces(state)
    existing = [s for s in custom["spaces"] if s.get("name") == name or s.get("id") == name]
    if existing:
        return _error("space exists", status=409)
    # W66: опциональные labels — наследуются терминалами space
    labels = data.get("labels") or {}
    if not isinstance(labels, dict) or not all(
            isinstance(k, str) and isinstance(v, str)
            for k, v in labels.items()):
        return _error("labels must be {str:str}", status=400)
    denied = await _gate_check(
        state, "core.terminal_mutation",
        {"action": "space-create", "name": name,
         "labels_count": len(labels)},
        intent_hash=data.get("intent_hash"))
    if denied:
        return denied
    custom["spaces"].append({"id": name, "name": name,
                             "machine": name, "state": "connected",
                             "labels": dict(labels)})
    _save_custom_spaces(state, custom)
    state.events.channel.publish({"type": "space_created", "id": name, "state": "connected"})
    return web.json_response({"id": name, "name": name}, status=201)


async def handle_space_labels(request) -> web.Response:
    """PUT /api/core/space/{id}/labels {labels:{k:v}|null} — W66.

    Устанавливает space-лейблы (default-ы членов). null/{} → снять.
    Пропагация: текущие члены получают только ОТСУТСТВУЮЩИЕ ключи
    (явные лейблы терминала не затираются). Ответ {space, labels,
    propagated}.
    """
    state = _state(request)
    space_id = request.match_info["id"]
    try:
        data = await _read_json(request)
    except ValueError as exc:
        return _error(str(exc))
    labels = data.get("labels")
    if labels is None:
        labels = {}
    if not isinstance(labels, dict) or not all(
            isinstance(k, str) and isinstance(v, str)
            for k, v in labels.items()):
        return _error("labels must be {str:str} or null",
                      status=400)
    custom = _load_custom_spaces(state)
    entry = next((s for s in custom.get("spaces", [])
                  if str(s.get("id")) == space_id), None)
    if entry is None:
        return _error(f"space not found: {space_id}", status=404)
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "space-labels", "space": space_id,
        "labels": len(labels)}, intent_hash=None)
    if denied is not None:
        return denied
    if labels:
        entry["labels"] = dict(labels)
    else:
        entry.pop("labels", None)
    _save_custom_spaces(state, custom)
    # пропагация default-ов на текущих членов
    propagated = 0
    for t in state.supervisor.terminals.values():
        if (t.space or t.machine) == space_id:
            propagated += _apply_space_labels(state, t, space_id)
    state.supervisor._save_registry()
    state.events.channel.publish({
        "type": "space_labels", "id": space_id,
        "labels": len(labels)})
    return web.json_response({
        "space": space_id, "labels": labels,
        "propagated": propagated})


async def handle_space_rename(request) -> web.Response:
    state = _state(request)
    space_id = request.match_info["id"]
    try:
        data = await _read_json(request)
    except ValueError as exc:
        return _error(str(exc))
    new_name = str(data.get("new_name", "")).strip()
    if not new_name or not VALID_NAME_RE.fullmatch(new_name):
        return _error("bad new_name", status=400)
    custom = _load_custom_spaces(state)
    for s in custom["spaces"]:
        if s.get("id") == space_id:
            denied = await _gate_check(
                state, "core.terminal_mutation",
                {"action": "space-rename", "space": space_id,
                 "new_name": new_name},
                intent_hash=data.get("intent_hash"))
            if denied:
                return denied
            s["id"] = new_name
            s["name"] = new_name
            s["machine"] = new_name
            _save_custom_spaces(state, custom)
            state.events.channel.publish({"type": "space_renamed", "old": space_id, "new": new_name})
            return web.json_response({"id": new_name, "name": new_name})
    return _error("space not found", status=404)


async def handle_space_delete(request) -> web.Response:
    state = _state(request)
    space_id = request.match_info["id"]
    force = request.query.get("force") in ("1", "true", "yes")
    # W6: space-delete — опасное действие; gate даёт policy
    # require_approval/dual_control контроль (раньше мутация шла
    # вообще без gate — дыра #468-coverage).
    denied = await _gate_check(state, "core.terminal_mutation",
                               {"action": "space-delete",
                                "space": space_id, "force": force},
                               intent_hash=request.query.get(
                                   "intent_hash"))
    if denied is not None:
        return denied
    custom = _load_custom_spaces(state)
    before = len(custom["spaces"])
    custom["spaces"] = [s for s in custom["spaces"] if s.get("id") != space_id]
    if len(custom["spaces"]) == before:
        return _error("space not found", status=404)
    # Not-empty check only if any terminals belong to space; here conservative: ok.
    if not force:
        _save_custom_spaces(state, custom)
        state.events.channel.publish({"type": "space_deleted", "id": space_id})
        return web.json_response({"id": space_id, "deleted": True})
    _save_custom_spaces(state, custom)
    state.events.channel.publish({"type": "space_deleted", "id": space_id})
    return web.json_response({"id": space_id, "deleted": True})




async def handle_terminal_migrate(request: web.Request) -> web.Response:
    """POST /api/core/terminal/<n>/migrate — W48.

    {"space": "<id>"|null} — перенос терминала между spaces.
    space=null → назад в space своей machine. Целевой space
    должен существовать: custom-спейс из spaces.json или
    machine-спейс (t.machine). PTY/адрес не меняются — только
    членство. Persist в registry (to_dict.space), рестарт
    сохраняет назначение. Gate core.terminal_mutation.
    """
    state = _state(request)
    raw = request.match_info.get("name", "")
    term = state.supervisor.get_terminal(raw)
    if term is None:
        return _error(f"terminal not found: {raw}", status=404)
    try:
        data = await _read_json(request)
    except ValueError as exc:
        return _error(str(exc))
    if "space" not in data:
        return _error("space required (id or null)")
    target = data.get("space")
    if target is not None and not isinstance(target, str):
        return _error("space must be string or null", status=400)
    target = target.strip() if isinstance(target, str) else None
    if target == "":
        target = None
    if target is not None:
        # space должен существовать: machine-спейс или custom
        known = {t.machine for t in state.supervisor.terminals.values()}
        known.add(state.supervisor.machine)
        for s in _load_custom_spaces(state).get("spaces", []):
            known.add(str(s.get("id")))
        if target not in known:
            return _error(
                f"space not found: {target!r}", status=404)
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "migrate", "term": term.address,
        "space": target,
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    old = term.space or term.machine
    term.space = target
    # W66: space-лейблы наследуются при входе в space
    inherited = _apply_space_labels(
        state, term, target or term.machine)
    state.supervisor._save_registry()
    # _emit → sup.events + event_sink → SSE channel (как у supervisor)
    state.supervisor._emit("space_migrated", {
        "term": term.address, "address": term.address,
        "from": old, "to": target or term.machine})
    return web.json_response({
        "term": term.address, "space": term.space,
        "effective_space": term.space or term.machine,
        "labels_inherited": inherited})


async def handle_capabilities(request: web.Request) -> web.Response:
    state = _state(request)
    backend_name = type(state.supervisor.backend).__name__.lower()
    backend = "conpty" if "conpty" in backend_name else ("mock" if "mock" in backend_name else backend_name)
    return web.json_response({
        "version": "N3",
        "endpoints": {
            "screen": True, "stream": True, "scrollback": True, "dump": True,
            "resize": True, "rename": True, "restart": True, "keys": True,
            "worktree": True, "programs": True, "run_program": True, "spaces": True,
            "attention": True, "restore_status": True,
        },
        "pty": {"backend": backend, "resize_sig": hasattr(state.supervisor, "resize_terminal")},
    })


async def handle_roster(request: web.Request) -> web.Response:
    """GET /v1/roster.json — roster по RFC-001 §25.1 (8 полей на агента).

    Отличается от /api/core/agents: 8-полевой контракт UI-шва
    (agent_id, role, status, machine, term, cwd, labels, turn).
    """
    state = _state(request)
    events = state.supervisor.events
    roster = []
    for term in state.supervisor.list_terminals():
        turn = sum(1 for e in events if e.get("address") == term.address)
        roster.append({
            "agent_id": term.name,
            "role": term.labels.get("role"),
            "status": term.state,
            "machine": term.machine,
            "term": term.name,
            "cwd": term.cwd,
            "labels": dict(term.labels),
            "turn": turn,
        })
    return web.json_response({"roster": roster, "count": len(roster)})


_MARKER_LINE_RE = re.compile(
    r"^\[MARKER ts=([0-9.]+) label=(.*)\]$")


def _marker_positions(all_lines: list) -> list[dict]:
    """W32: позиции маркеров в scrollback-кадре.

    [{idx, ts, label}] — idx = 0-based индекс строки в all_lines
    (полный scrollback, до lines-обрезки); UI маппит бейджи."""
    out = []
    for i, line in enumerate(all_lines):
        m = _MARKER_LINE_RE.match(line)
        if m:
            out.append({"idx": i, "ts": float(m.group(1)),
                        "label": m.group(2)})
    return out


async def handle_screen(request: web.Request) -> web.Response:
    """GET /api/core/screen/{term} — хвост экрана (recent_output), как `hc read --tail`.

    Формат ответа совпадает с hc-bridge /api/bus/screen/<term>: {"term", "screen"} —
    NEWF-пейн работает через один шов на обоих бэкендах. term принимает ОБЕ
    формы адреса (N3.5): полную "machine/term" (`{term:.+}` — слэш в сегменте)
    и голое имя "term" — обе идут через get_terminal.
    """
    state = _state(request)
    raw = request.match_info["term"]
    term = state.supervisor.get_terminal(raw)
    if term is None:
        return _error(f"no terminal {raw!r}", 404)
    # чтение экрана = наблюдение (RFC §11.1 K2-1: done → idle)
    state.supervisor.mark_observed(term.address)
    # Clear attention flag on successful screen read.
    term.attention = False
    # Scrollback: поддержка ?lines=N (default=viewport/rows)
    import urllib.parse
    # support lines param via request.query
    raw_lines = int(request.query.get("lines", str(getattr(term, "rows", 24) or 24)))
    n = max(1, min(raw_lines, 5000))
    all_lines = (scrollback_all(term)
                    or term.recent_output.splitlines())
    truncated = len(all_lines) > n
    screen_text = "\n".join(all_lines[-n:]) if n < len(all_lines) else "\n".join(all_lines) if all_lines else term.recent_output
    return web.json_response({"term": term.address, "screen": screen_text, "lines": n, "truncated": truncated,
                              "markers": _marker_positions(all_lines)})


async def handle_screen_stream(request: web.Request) -> web.Response:
    state = _state(request)
    term_name = request.match_info["term"]
    term = state.supervisor.get_terminal(term_name)
    if term is None:
        return _error(f"no terminal {term_name!r}", 404)
    resp = web.StreamResponse(status=200, headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive"})
    await resp.prepare(request)
    seq = 0
    last_screen = None
    last_emit = 0.0
    last_heartbeat = time.time()
    try:
        while True:
            t = state.supervisor.get_terminal(term_name)
            if t is None:
                break
            now = time.time()
            screen = t.recent_output
            if screen != last_screen and now - last_emit >= 0.03:
                seq += 1
                payload = json.dumps({"term": t.address, "seq": seq, "screen": screen}, ensure_ascii=False)
                await resp.write(f"event: screen\ndata: {payload}\n\n".encode("utf-8"))
                last_emit = now
                last_screen = screen
            if now - last_heartbeat >= 15:
                await resp.write(b": ping\n\n")
                last_heartbeat = now
            if t.state == "exited":
                # final
                if screen != last_screen:
                    seq += 1
                    payload = json.dumps({"term": t.address, "seq": seq, "screen": screen}, ensure_ascii=False)
                    await resp.write(f"event: screen\ndata: {payload}\n\n".encode("utf-8"))
                await resp.write_eof()
                break
            await asyncio.sleep(0.02)
    except (asyncio.CancelledError, ConnectionError, RuntimeError):
        pass
    finally:
        try:
            await resp.write_eof()
        except (ConnectionError, RuntimeError):
            pass
    return resp


# #562: ANSI-стрип для transcript dump. Порядок альтернатив важен:
# OSC/DCS раньше CSI и общего ESC-final, иначе `\x1b]`/`\x1bP`
# съедались бы как короткая ESC-последовательность.
_ANSI_RE = re.compile(
    r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\|$)"   # OSC … BEL | ST | конец буфера
    r"|\x1bP[^\x1b]*\x1b\\"                  # DCS … ST
    r"|\x1b\[[0-?]*[ -/]*[@-~]"              # CSI: params/intermediates/final
    r"|\x1b[\x20-\x2f]*[\x30-\x7e]"          # ESC + intermediates + final (Fe/Fs)
)
# C0/C1-остатки без ESC: BS/VT/FF/CR/NUL/DEL и пр. — \t и \n сохраняем.
_DUMP_CTRL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


def _strip_ansi(text: str) -> str:
    """Грубый, но достаточный для evidence-дампа стрип ANSI/OSC/DCS."""
    return _DUMP_CTRL_RE.sub("", _ANSI_RE.sub("", text))


async def handle_terminal_dump(request: web.Request) -> web.Response:
    """GET /api/core/terminal/<name>/dump?lines=N — #562 transcript dump.

    Отдаёт text/plain: скроллбэк (deque 2000, #559) или recent_output,
    если скроллбэк пуст. ?lines=N — последние N строк (default — весь
    буфер). ANSI/OSC стрипаются — дамп читается как текст. Уходит
    attachment'ом: filename="<name>.txt".
    """
    state = _state(request)
    raw = request.match_info.get("term", "")
    term = state.supervisor.get_terminal(raw)
    if term is None:
        return _error(f"no terminal {raw!r}", 404)
    lines_raw = request.query.get("lines")
    lines: Optional[int] = None
    if lines_raw is not None:
        try:
            lines = int(lines_raw)
        except ValueError:
            return _error("lines must be an integer", status=400)
        if lines < 1:
            return _error("lines must be >= 1", status=400)
    buf = (scrollback_all(term) or term.recent_output.splitlines())
    if lines is not None:
        buf = buf[-lines:]
    text = _strip_ansi("\n".join(buf))
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", term.name) or "term"
    return web.Response(
        text=text,
        content_type="text/plain",
        headers={"Content-Disposition":
                 f'attachment; filename="{safe_name}.txt"'})

async def handle_terminal_compress_scrollback(
        request: web.Request) -> web.Response:
    """POST /api/core/terminal/<n>/compress-scrollback — W62.

    {min_lines?, force?} → gzip scrollback_deque в scrollback_gz
    (in-memory архив; читатели видят scrollback_all()). force →
    сжать даже <min_lines. Идемпотентно (already:true).
    Авто-режим: step_once, idle>NEXUS_SBC_IDLE сек и
    deque≥NEXUS_SBC_MIN строк. Gate core.terminal_mutation
    action="compress-scrollback".
    """
    state = _state(request)
    raw = request.match_info.get("name", "")
    term = state.supervisor.get_terminal(raw)
    if term is None:
        return _error(f"terminal not found: {raw}", status=404)
    min_lines = 0
    force = False
    try:
        data = await _read_json(request)
        if data:
            ml = data.get("min_lines", 0)
            if (isinstance(ml, bool)
                    or not isinstance(ml, int) or ml < 0
                    or ml > 100000):
                raise ValueError("min_lines must be int 0..100000")
            min_lines = ml
            force = bool(data.get("force", False))
    except ValueError as exc:
        return _error(str(exc))
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "compress-scrollback", "term": term.address,
        "force": force, "min_lines": min_lines,
    }, intent_hash=None)
    if denied is not None:
        return denied
    result = state.supervisor.compress_scrollback(
        term, min_lines=min_lines, force=force)
    return web.json_response({
        "term": term.address, **result})


async def handle_state_migrate(request: web.Request) -> web.Response:
    """POST /api/core/state/migrate — W68 state-dir upgrade tool.

    {src: "<dir>", dst?: "<dir>", copy_files?: bool} — прогоняет
    state_migrate.migrate_state: registry.json → текущая схема
    (v0/v1→v2 + миграции), sidecar-файлы и scripts/workspaces
    копируются. dst default "<src>-migrated". Ответ = report
    {files[], warnings[], ok}. Gate core.file_mutation
    action="state-migrate". Запуск в to_thread — копии могут
    быть большими.
    """
    state = _state(request)
    try:
        data = await _read_json(request)
        src = str(data.get("src") or "").strip()
        if not src:
            raise ValueError("src required")
        dst = str(data.get("dst") or "").strip() or None
        copy_files = bool(data.get("copy_files", False))
    except ValueError as exc:
        return _error(str(exc))
    src_path = Path(src)
    if not src_path.is_dir():
        return _error(f"src not a directory: {src}", status=404)
    dst_path = Path(dst) if dst else src_path.parent / (
        src_path.name + "-migrated")
    denied = await _gate_check(state, "core.file_mutation", {
        "action": "state-migrate", "src": str(src_path),
        "dst": str(dst_path), "copy_files": copy_files,
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    from tools.nexus_core.state_migrate import migrate_state
    try:
        report = await asyncio.to_thread(
            migrate_state, src_path, dst_path, copy_files)
    except Exception as exc:
        return _error(str(exc), status=500)
    return web.json_response(report)


# -- sharing tokens (W63) ---------------------------------------------------


async def handle_share_create(request: web.Request) -> web.Response:
    """POST /api/core/share {term, scopes?, ttl_s?} — W63.

    Read-only view-токен: scopes ⊆ {screen,dump,info} (default все),
    ttl_s clamp 60..86400 (default 3600). Публичные GET
    /view/<token>/{screen,dump,info} — БЕЗ core-token (это и есть
    смысл share-ссылки), только scope+expiry. In-memory.
    Gate core.terminal_mutation action="share".
    """
    state = _state(request)
    try:
        data = await _read_json(request)
        term = _term(request, data)
        scopes = data.get("scopes")
        if scopes is None:
            scopes = ["screen", "dump", "info"]
        if (not isinstance(scopes, list)
                or not all(isinstance(s, str) for s in scopes)):
            raise ValueError("scopes must be a list of strings")
        bad = [s for s in scopes
               if s not in state.supervisor.SHARE_SCOPES]
        if bad or not scopes:
            raise ValueError(
                "scopes must be non-empty subset of "
                "screen,dump,info")
        ttl = data.get("ttl_s", state.supervisor.share_ttl_default)
        if (isinstance(ttl, bool)
                or not isinstance(ttl, (int, float)) or ttl <= 0):
            raise ValueError("ttl_s must be positive number")
    except ValueError as exc:
        return _error(str(exc))
    resolved = state.supervisor.get_terminal(term)
    if resolved is None:
        return _error(f"terminal not found: {term}", status=404)
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "share", "term": resolved.address,
        "scopes": sorted(set(scopes)), "ttl_s": ttl,
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    rec = state.supervisor.create_share(
        resolved.address, scopes, float(ttl))
    return web.json_response({
        "token": rec["token"], "term": rec["term"],
        "scopes": rec["scopes"], "expires_at": rec["expires_at"],
        "view_url": f"/view/{rec['token']}/{rec['scopes'][0]}",
        "view_urls": {s: f"/view/{rec['token']}/{s}"
                      for s in rec["scopes"]}}, status=201)


async def handle_shares(request: web.Request) -> web.Response:
    """GET /api/core/shares — W63 список токенов (prefix only)."""
    state = _state(request)
    return web.json_response({
        "shares": state.supervisor.list_shares(),
        "count": len(state.supervisor.share_tokens)})


async def handle_share_revoke(request: web.Request) -> web.Response:
    """DELETE /api/core/share/{token} — W63 отозвать токен."""
    state = _state(request)
    token = request.match_info.get("token", "")
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "share-revoke", "token": token[:8]},
        intent_hash=None)
    if denied is not None:
        return denied
    if not state.supervisor.revoke_share(token):
        return _error("share not found", status=404)
    return web.json_response({"revoked": True})


async def _view_guard(request: web.Request) -> tuple:
    """W63: токен → (term, scope) или Response-ошибка."""
    state = _state(request)
    token = request.match_info.get("token", "")
    rec = state.supervisor.resolve_share(token)
    if rec is None:
        return None, _error("invalid or expired share token",
                           status=404)
    scope = request.match_info.get("scope", "")
    if scope not in rec["scopes"]:
        return None, _error("scope not granted", status=403)
    term = state.supervisor.get_terminal(rec["term"])
    if term is None:
        return None, _error("terminal gone", status=410)
    return (term, scope), None


async def handle_view(request: web.Request) -> web.Response:
    """GET /view/<token>/{screen,dump,info} — W63 публичный read-only.

    Вне /api/core — core-token не нужен (share-ссылка). Только
    scope из токена; expired/revoked → 404, нет scope → 403.
    """
    state = _state(request)
    guard, err = await _view_guard(request)
    if err is not None:
        return err
    term, scope = guard
    if scope == "info":
        return web.json_response({
            "term": term.address, "state": term.state,
            "cols": term.cols, "rows": term.rows,
            "title": term.title})
    if scope == "dump":
        lines = (scrollback_all(term)
                 or term.recent_output.splitlines())
        n = request.query.get("lines")
        if n:
            try:
                lines = lines[-max(1, min(int(n), 5000)):]
            except ValueError:
                return _error("lines must be int")
        text = _strip_ansi("\n".join(lines))
        safe = re.sub(r"[^A-Za-z0-9._-]", "_",
                      term.name) or "term"
        return web.Response(
            text=text, content_type="text/plain",
            headers={"Content-Disposition":
                     f'attachment; filename="{safe}.txt"'})
    # screen
    rows = int(getattr(term, "rows", 24) or 24)
    n = min(int(request.query.get("lines", rows)), 5000)
    all_lines = (scrollback_all(term)
                 or term.recent_output.splitlines())
    text = ("\n".join(all_lines[-n:]) if all_lines
            else term.recent_output)
    return web.json_response({
        "term": term.address, "screen": text,
        "lines": n, "truncated": len(all_lines) > n})


async def handle_terminal_scrollback_info(
        request: web.Request) -> web.Response:
    """GET /api/core/terminal/<n>/scrollback-info — W62 статус."""
    state = _state(request)
    raw = request.match_info.get("name", "")
    term = state.supervisor.get_terminal(raw)
    if term is None:
        return _error(f"terminal not found: {raw}", status=404)
    return web.json_response({
        "term": term.address,
        "compressed": term.scrollback_gz is not None,
        "archived_lines": term.scrollback_gz_count,
        "gz_bytes": (len(term.scrollback_gz)
                     if term.scrollback_gz else 0),
        "live_lines": len(term.scrollback)})


# -- операции ---------------------------------------------------------------

def _terminal_dim(value, name: str, lo: int, hi: int) -> int:
    """cols/rows из /run: строгий int в диапазоне (bool — не int)."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{name} must be an integer")
    if not lo <= value <= hi:
        raise ValueError(f"{name} out of range {lo}..{hi}")
    return value


async def handle_run(request: web.Request) -> web.Response:
    """POST /api/core/run — запуск терминала."""
    state = _state(request)
    try:
        data = await _read_json(request)
        name = str(data.get("name", "")).strip()
        if not name:
            raise ValueError("name required")
        if not VALID_NAME_RE.fullmatch(name):
            raise ValueError(
                f"invalid terminal name {name!r} (1-32 of a-z 0-9 _ -)"
            )
        command = data.get("command")
        if command is not None and not isinstance(command, list):
            raise ValueError("command must be a list of strings")
        labels = data.get("labels") or {}
        if not isinstance(labels, dict):
            raise ValueError("labels must be an object")
        if not all(isinstance(k, str) and isinstance(v, str)
                   for k, v in labels.items()):
            raise ValueError("labels keys and values must be strings")
        cwd = data.get("cwd")
        machine = data.get("machine")
        keep = data.get("keep")
        parent = data.get("parent")
        die_with_parent = data.get("die_with_parent")
        outlive_parent = bool(data.get("outlive_parent", False))
        env = data.get("env")
        cols = _terminal_dim(data.get("cols", 120), "cols", 1, 500)
        rows = _terminal_dim(data.get("rows", 30), "rows", 1, 200)
    except ValueError as exc:
        return _error(str(exc))
    if parent:
        paddr = str(parent)
        if "/" not in paddr:
            base_m = str(machine) if machine else state.supervisor.machine
            paddr = f"{base_m}/{paddr}"
        if paddr not in state.supervisor.terminals:
            return _error(f"parent terminal not found: {parent}",
                          status=404)
    # #469b: terminal-мутация через gate (command/cwd в payload_hash)
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "run", "name": name,
        "command": [str(c) for c in command] if command is not None else None,
        "machine": str(machine) if machine else None,
        "cwd": str(cwd) if cwd else None,
        "parent": str(parent) if parent else None,
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    try:
        term = state.supervisor.create_terminal(
            name=name,
            command=[str(c) for c in command] if command is not None else None,
            labels={str(k): str(v) for k, v in labels.items()},
            cwd=str(cwd) if cwd else None,
            machine=str(machine) if machine else None,
            keep=keep,
            env=env,
            parent=str(parent) if parent else None,
            die_with_parent=die_with_parent,
            outlive_parent=outlive_parent,
            cols=cols,
            rows=rows,
        )
    except Exception as exc:
        return _error(str(exc), status=409)
    return web.json_response(term.to_dict())


def _unique_term_name(state: AppState, base: str,
                      fallback: str = "term") -> str:
    """'<base>-<N>' — первый свободный номер под VALID_NAME_RE (≤32).

    base санитизируется под a-z0-9_- (пробелы/'.'→'_'), обрезается до
    28 — остаётся место под '-<N>' (N ≤ 999 → ≤32 суммарно).
    """
    base = re.sub(r"[^a-z0-9_-]", "_", base.lower())[:28] or fallback
    n = 1
    while state.supervisor.get_terminal(f"{base}-{n}") is not None:
        n += 1
        if n > 999:
            raise ValueError("no free terminal name")
    return f"{base}-{n}"


def _program_term_name(state: AppState, program_id: str) -> str:
    """Авто-имя программы '<id>-<counter>' (#562, см. _unique_term_name)."""
    return _unique_term_name(state, program_id, fallback="prog")


async def handle_run_program(request: web.Request) -> web.Response:
    """POST /api/core/run-program {program, name?, cwd?} — #562.

    Резолвит launcher из programs.json (#551b, hot-edit) и спавнит
    терминал обычным create_terminal path — закрывает UX-дыру
    «ввёл ALICE → WinError 2»: фронт выбирает id, argv уже известны.

    cwd: p.cwd ?? arg.cwd — cwd из конфига программы приоритетнее
    переданного в запросе (как в спеке #562). name: arg.name ??
    '<id>-<counter>' уникализированное. Ответ = term.to_dict() +
    {"program": id}.
    """
    state = _state(request)
    try:
        data = await _read_json(request)
        program_id = data.get("program")
        if not isinstance(program_id, str) or not program_id.strip():
            raise ValueError("program required")
        program_id = program_id.strip()
        name = data.get("name")
        if name is not None and not isinstance(name, str):
            raise ValueError("name must be a string")
        name = name.strip() if name else None
        cwd = data.get("cwd")
        if cwd is not None and not isinstance(cwd, str):
            raise ValueError("cwd must be a string")
        cwd = cwd.strip() if cwd else None
    except ValueError as exc:
        return _error(str(exc))
    entries = await asyncio.to_thread(programs_mod.load_programs)
    prog = next((p for p in entries if p.get("id") == program_id), None)
    if prog is None:
        return _error(f"unknown program: {program_id!r}", status=400)
    if not prog.get("available", True):
        return web.json_response(
            {"error": "program unavailable",
             "resolved": prog.get("resolved")},
            status=409)
    if name is not None:
        if not VALID_NAME_RE.fullmatch(name):
            return _error(
                f"invalid terminal name {name!r} "
                "(1-32 of a-z 0-9 _ -)", status=400)
    else:
        try:
            name = _program_term_name(state, program_id)
        except ValueError as exc:
            return _error(str(exc), status=409)
    cwd_eff = prog.get("cwd") or cwd
    # #469b: тот же gate, что и /run — command/cwd в payload_hash.
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "run-program", "name": name, "program": program_id,
        "command": [str(c) for c in prog["cmd"]],
        "cwd": str(cwd_eff) if cwd_eff else None,
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    try:
        term = state.supervisor.create_terminal(
            name=name,
            command=[str(c) for c in prog["cmd"]],
            cwd=str(cwd_eff) if cwd_eff else None,
        )
    except Exception as exc:
        return _error(str(exc), status=409)
    out = term.to_dict()
    out["program"] = program_id
    return web.json_response(out)


async def handle_spawn_preset(request: web.Request) -> web.Response:
    """POST /api/core/spawn-preset — W11 спавн по именованному пресету.

    {"preset": "<id>", "name"?, "cwd"?, "args"?: [str],
     "env"?, "labels"?, "intent_hash"?}

    command = preset.command ++ args (args — хвост argv, напр.
    ["-k","foo"] к pytest-пресету). cwd = arg.cwd ?? preset.cwd.
    env = preset.env ← arg.env (arg перекрывает). labels аналогично.
    name = arg.name ?? '<id>-<N>' (_unique_term_name).
    preset unavailable → 409 {error, resolved}; unknown → 400.
    Gate core.terminal_mutation action="spawn-preset".
    Ответ term.to_dict() + {"preset": id}.
    """
    state = _state(request)
    try:
        data = await _read_json(request)
        preset_id = data.get("preset")
        if not isinstance(preset_id, str) or not preset_id.strip():
            raise ValueError("preset required")
        preset_id = preset_id.strip()
        name = data.get("name")
        if name is not None and not isinstance(name, str):
            raise ValueError("name must be a string")
        name = name.strip() if name else None
        cwd = data.get("cwd")
        if cwd is not None and not isinstance(cwd, str):
            raise ValueError("cwd must be a string")
        cwd = cwd.strip() if cwd else None
        args = data.get("args")
        if args is not None and not (
                isinstance(args, list)
                and all(isinstance(a, str) for a in args)):
            raise ValueError("args must be a list of strings")
        env_arg = data.get("env")
        if env_arg is not None and not (
                isinstance(env_arg, dict)
                and all(isinstance(k, str) and isinstance(v, str)
                        for k, v in env_arg.items())):
            raise ValueError("env must be an object of strings")
        labels_arg = data.get("labels")
        if labels_arg is not None and not (
                isinstance(labels_arg, dict)
                and all(isinstance(k, str) and isinstance(v, str)
                        for k, v in labels_arg.items())):
            raise ValueError("labels must be an object of strings")
    except ValueError as exc:
        return _error(str(exc))
    entries = await asyncio.to_thread(presets_mod.load_presets)
    preset = next((p for p in entries if p.get("id") == preset_id), None)
    if preset is None:
        return _error(f"unknown preset: {preset_id!r}", status=400)
    if not preset.get("available", True):
        return web.json_response(
            {"error": "preset unavailable",
             "resolved": preset.get("resolved")},
            status=409)
    if name is not None:
        if not VALID_NAME_RE.fullmatch(name):
            return _error(
                f"invalid terminal name {name!r} "
                "(1-32 of a-z 0-9 _ -)", status=400)
    else:
        try:
            name = _unique_term_name(state, preset_id, fallback="preset")
        except ValueError as exc:
            return _error(str(exc), status=409)
    command = [str(c) for c in preset["command"]]
    if args:
        command += [str(a) for a in args]
    env = dict(preset.get("env") or {})
    if env_arg:
        env.update(env_arg)
    labels = dict(preset.get("labels") or {})
    if labels_arg:
        labels.update(labels_arg)
    cwd_eff = cwd or preset.get("cwd")
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "spawn-preset", "name": name, "preset": preset_id,
        "command": command,
        "cwd": str(cwd_eff) if cwd_eff else None,
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    try:
        term = state.supervisor.create_terminal(
            name=name,
            command=command,
            cwd=str(cwd_eff) if cwd_eff else None,
            env=env or None,
            labels=labels or None,
        )
    except Exception as exc:
        return _error(str(exc), status=409)
    out = term.to_dict()
    out["preset"] = preset_id
    return web.json_response(out)


async def handle_send(request: web.Request) -> web.Response:
    """POST /api/core/send {term, text, enter?} — paste+enter."""
    state = _state(request)
    try:
        data = await _read_json(request)
        term = _term(request, data)
        text = data.get("text")
        if text is None:
            raise ValueError("text required")
        enter = data.get("enter", True)
    except ValueError as exc:
        return _error(str(exc))
    restoring = _terminal_restore_guard(state, term)
    if restoring is not None:
        return restoring
    # #469b: text → sha — paste может содержать секреты, аудит их не видит
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "send", "term": term,
        "text_sha": _payload_sha(str(text)), "enter": bool(enter),
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    locked = _locked_guard(state, term)
    if locked is not None:
        return locked
    # W56: queue:true → буфер вместо немедленной записи;
    # drain в step_once (терминал жив, не frozen).
    if data.get("queue"):
        q = state.supervisor.queue_send(
            term, str(text), enter=bool(enter),
            priority=data.get("priority", 5))
        if q is None:
            return _error(f"terminal not found: {term}",
                          status=404)
        return web.json_response({
            "term": term, "status": "queued",
            "id": q["id"], "depth": q["depth"],
            "priority": q["priority"]})
    ok = state.supervisor.send(term, str(text), enter=bool(enter))
    if not ok:
        return _error(f"terminal not found: {term}", status=404)
    return web.json_response({"term": term, "status": "sent", "characters": len(str(text))})


async def handle_send_queues(request: web.Request) -> web.Response:
    """GET /api/core/send-queues — W56 глубины очередей.

    {queues: {address: depth}} — только непустые.
    """
    state = _state(request)
    return web.json_response({
        "queues": state.supervisor.send_queue_depths()})


async def handle_send_queue_clear(request: web.Request) -> web.Response:
    """DELETE /api/core/send-queue/{term} — W56 сброс очереди.

    {cleared: N} — сколько сообщений снято.
    """
    state = _state(request)
    term = request.match_info.get("name", "")
    resolved = state.supervisor.get_terminal(term)
    if resolved is None:
        return _error(f"terminal not found: {term}", status=404)
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "sendqueue-clear", "term": resolved.address,
    }, intent_hash=request.query.get("intent_hash"))
    if denied is not None:
        return denied
    n = state.supervisor.clear_send_queue(resolved.address)
    return web.json_response({
        "term": resolved.address, "cleared": n})


_SCRIPT_NAME_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")


def _script_dir(state) -> Path:
    d = Path(state.base) / "scripts"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _load_script(state, name: str) -> dict | None:
    if not _SCRIPT_NAME_RE.match(name or ""):
        return None
    p = _script_dir(state) / f"{name}.json"
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


async def _run_script_steps(state, steps: list) -> list[dict]:
    """W58: исполняет шаги runbook'а последовательно.

    Шаг: {term, text?, enter?, keys?, delay_ms?}. Каждый send/keys
    через supervisor — input_log/audit сохраняются. Ошибка шага
    не прерывает скрипт — result ok:false + продолжаем.
    """
    results = []
    for i, step in enumerate(steps):
        if not isinstance(step, dict):
            results.append({"step": i, "ok": False,
                            "error": "step must be object"})
            continue
        term = step.get("term") or step.get("name")
        resolved = state.supervisor.get_terminal(str(term)) \
            if term else None
        if resolved is None:
            results.append({"step": i, "term": term, "ok": False,
                            "error": "terminal not found"})
            continue
        delay = step.get("delay_ms", 0)
        if isinstance(delay, (int, float)) and delay > 0:
            await asyncio.sleep(min(delay, 30000) / 1000.0)
        ok = True
        text = step.get("text")
        if text is not None:
            ok = state.supervisor.send(
                resolved.address, str(text),
                enter=bool(step.get("enter", True)))
        keys = step.get("keys")
        if ok and isinstance(keys, list) and keys:
            ok = state.supervisor.keys(
                resolved.address, [str(k) for k in keys])
        results.append({"step": i, "term": resolved.address,
                        "ok": bool(ok),
                        **({"error": "write failed"} if not ok
                           else {})})
    return results


async def handle_script(request: web.Request) -> web.Response:
    """POST /api/core/script — W58 runbook одной командой.

    {steps: [{term, text?, enter?, keys?, delay_ms?}],
     save?: "name"} → {results:[{step,term,ok}], saved?, name?}
    save → scripts/<name>.json (GET /scripts, POST /script/run).
    """
    state = _state(request)
    try:
        data = await _read_json(request)
        steps = data.get("steps")
        if not isinstance(steps, list) or not steps:
            raise ValueError("steps must be a non-empty list")
        if len(steps) > 200:
            raise ValueError("too many steps (max 200)")
    except ValueError as exc:
        return _error(str(exc))
    save = data.get("save")
    name = None
    if save:
        name = str(save)
        if not _SCRIPT_NAME_RE.match(name):
            return _error("invalid script name", status=400)
        _script_dir(state).joinpath(f"{name}.json").write_text(
            json.dumps({"name": name, "steps": steps},
                       ensure_ascii=False, indent=2),
            encoding="utf-8")
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "script", "steps": len(steps),
        "save": name}, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    results = await _run_script_steps(state, steps)
    return web.json_response({
        "results": results,
        "ok": all(r["ok"] for r in results),
        "steps": len(results),
        **({"saved": name} if name else {})})


async def handle_scripts(request: web.Request) -> web.Response:
    """GET /api/core/scripts — W58 список сохранённых runbook'ов."""
    state = _state(request)
    out = []
    for p in sorted(_script_dir(state).glob("*.json")):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            out.append({"name": d.get("name", p.stem),
                        "steps": len(d.get("steps") or []),
                        "file": p.name})
        except (OSError, json.JSONDecodeError):
            continue
    return web.json_response({"scripts": out, "count": len(out)})


async def handle_script_run(request: web.Request) -> web.Response:
    """POST /api/core/script/run {name} — W58 запуск сохранённого."""
    state = _state(request)
    try:
        data = await _read_json(request)
    except ValueError as exc:
        return _error(str(exc))
    name = str(data.get("name") or "")
    script = _load_script(state, name)
    if script is None:
        return _error(f"script not found: {name}", status=404)
    steps = script.get("steps")
    if not isinstance(steps, list) or not steps:
        return _error("script has no steps", status=400)
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "script-run", "name": name,
        "steps": len(steps)}, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    results = await _run_script_steps(state, steps[:200])
    return web.json_response({
        "name": name, "results": results,
        "ok": all(r["ok"] for r in results),
        "steps": len(results)})


async def handle_send_broadcast(request: web.Request) -> web.Response:
    """POST /api/core/send-broadcast — W10 рассылка текста терминалам.

    {"terms": [addr|name, ...], "text": str, "enter"?: bool}
    terms="all" — все терминалы. Шлём ТОЛЬКО живым: неизвестный →
    per-term ошибка, exited/мёртвый handle → skipped. enter по
    умолчанию true (как /send). Один gate core.terminal_mutation
    action="send-broadcast" {count, text_sha} — текст в аудит
    не попадает (sha, как у /send).
    """
    state = _state(request)
    try:
        data = await _read_json(request)
        text = data.get("text")
        if not isinstance(text, str):
            raise ValueError("text required (string)")
        enter = bool(data.get("enter", True))
        terms_raw = data.get("terms")
        if terms_raw == "all":
            names = [t.address for t in state.supervisor.list_terminals()]
        elif isinstance(terms_raw, list) and all(
                isinstance(x, str) for x in terms_raw):
            names = [x.strip() for x in terms_raw]
        else:
            raise ValueError("terms must be a list of strings or 'all'")
    except ValueError as exc:
        return _error(str(exc))
    if not names:
        return web.json_response({
            "action": "send-broadcast", "sent": 0, "skipped": 0,
            "results": {}})
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "send-broadcast", "count": len(names),
        "text_sha": _payload_sha(text), "enter": enter,
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    results: dict[str, dict] = {}
    sent = skipped = 0
    for raw in names:
        term = state.supervisor.get_terminal(raw)
        if term is None:
            results[raw] = {"ok": False, "error": "terminal not found"}
            skipped += 1
            continue
        # terminal lock gate (W15)
        if getattr(term, "locked", False):
            results[term.address] = {"ok": False, "skipped": True, "error": "terminal locked"}
            skipped += 1
            continue
        # «живой»: не exited и handle на месте — send() сам проверит
        # но заранее даём понятный skipped-статус.
        live = (term.state != "exited"
                and term.handle is not None
                and term.handle.alive())
        if not live:
            results[term.address] = {
                "ok": False, "skipped": True,
                "error": f"not live (state={term.state})"}
            skipped += 1
            continue
        try:
            ok = await asyncio.to_thread(
                state.supervisor.send, term.address, text, enter)
        except Exception as exc:
            ok = False
            results[term.address] = {"ok": False, "error": str(exc)}
            skipped += 1
            continue
        if ok:
            results[term.address] = {"ok": True, "status": "sent"}
            sent += 1
        else:
            results[term.address] = {
                "ok": False, "skipped": True, "error": "send failed"}
            skipped += 1
    return web.json_response({
        "action": "send-broadcast",
        "sent": sent, "skipped": skipped,
        "results": results,
    })


async def handle_keys(request: web.Request) -> web.Response:
    """POST /api/core/keys {term, keys: [...]}."""
    state = _state(request)
    try:
        data = await _read_json(request)
        term = _term(request, data)
        keys = data.get("keys")
        if not isinstance(keys, list) or not keys:
            raise ValueError("non-empty keys list required")
    except ValueError as exc:
        return _error(str(exc))
    restoring = _terminal_restore_guard(state, term)
    if restoring is not None:
        return restoring
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "keys", "term": term, "keys": [str(k) for k in keys],
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    locked = _locked_guard(state, term)
    if locked is not None:
        return locked
    ok = state.supervisor.keys(term, [str(k) for k in keys])
    if not ok:
        return _error(f"terminal not found: {term}", status=404)
    return web.json_response({"term": term, "status": "keys_sent", "keys": [str(k) for k in keys]})


async def handle_put(request: web.Request) -> web.Response:
    """POST /api/core/put {term, text} — интерактивный вход (alias send)."""
    state = _state(request)
    try:
        data = await _read_json(request)
        term = _term(request, data)
        text = data.get("text")
        if text is None:
            raise ValueError("text required")
    except ValueError as exc:
        return _error(str(exc))
    restoring = _terminal_restore_guard(state, term)
    if restoring is not None:
        return restoring
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "put", "term": term,
        "text_sha": _payload_sha(str(text)),
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    # terminal lock
    _t = state.supervisor.get_terminal(term)
    if _t is not None and getattr(_t, "locked", False):
        return _error("terminal locked", status=409)
    ok = state.supervisor.send(term, str(text), enter=False)
    if not ok:
        return _error(f"terminal not found: {term}", status=404)
    return web.json_response({"term": term, "status": "put"})


# hc `put <TERM> <FILE>` (#515): file-drop рядом с терминалом. Бинарь идёт
# base64 → bytes без UTF-8-прогонки; путь — files/<machine>/<term>/<name>
# внутри FileOps-песочницы ядра. Remote-машины → 501 (как file/list).
MAX_PUTFILE_BYTES = 64 * 1024 * 1024


async def handle_putfile(request: web.Request) -> web.Response:
    """POST /api/core/putfile {term, name, data_b64} — доставка файла."""
    state = _state(request)
    try:
        data = await _read_json(request)
        term_addr = _term(request, data)
        name = str(data.get("name", "")).strip()
        b64 = data.get("data_b64")
        if (not name or name in (".", "..")
                or "/" in name or "\\" in name):
            raise ValueError("name must be a plain file name")
        if not isinstance(b64, str):
            raise ValueError("data_b64 required")
    except ValueError as exc:
        return _error(str(exc))
    terminal = state.supervisor.get_terminal(term_addr)
    if terminal is None:
        return _error(f"terminal not found: {term_addr}", status=404)
    try:
        raw = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError):
        return _error("data_b64: invalid base64")
    if len(raw) > MAX_PUTFILE_BYTES:
        return _error(f"file exceeds {MAX_PUTFILE_BYTES} bytes", status=413)
    machine = terminal.machine
    if _is_remote(machine):
        return _error(
            f"remote file drop not supported until N4: machine {machine!r}",
            status=501)
    rel = f"files/{machine}/{terminal.name}/{name}"
    # #469b: file-мутация через gate; содержимое → sha256 (не в аудите)
    denied = await _gate_check(state, "core.file_mutation", {
        "action": "putfile", "path": rel, "machine": machine,
        "term": terminal.address, "bytes": len(raw),
        "data_sha": hashlib.sha256(raw).hexdigest()[:16],
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    try:
        result = state.files.write_bytes(rel, raw)
    except (FileOpsError, ValueError) as exc:
        return _error(str(exc))
    return web.json_response({
        "term": terminal.address,
        "machine": machine,
        "path": rel,
        "bytes": result["bytes"],
        "status": "delivered",
    })


async def handle_park(request: web.Request) -> web.Response:
    """POST /api/core/park {term} — парковка (keep off)."""
    state = _state(request)
    try:
        data = await _read_json(request)
        term = _term(request, data)
    except ValueError as exc:
        return _error(str(exc))
    denied = await _gate_check(state, "core.terminal_mutation",
                               {"action": "park", "term": term}, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    if not state.supervisor.park(term):
        return _error(f"terminal not found: {term}", status=404)
    return web.json_response({"term": term, "status": "parked"})


async def handle_keep(request: web.Request) -> web.Response:
    """POST /api/core/keep {term, keep} — keep-alive on/off."""
    state = _state(request)
    try:
        data = await _read_json(request)
        term = _term(request, data)
    except ValueError as exc:
        return _error(str(exc))
    terminal = state.supervisor.get_terminal(term)
    if terminal is None:
        return _error(f"terminal not found: {term}", status=404)
    keep = bool(data.get("keep", True))
    denied = await _gate_check(state, "core.terminal_mutation",
                               {"action": "keep", "term": term,
                                "keep": keep}, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    if not state.supervisor.set_keep(term, keep):
        return _error(f"terminal not found: {term}", status=404)
    return web.json_response({"term": term, "keep": keep})


async def _wait_for_api(state: AppState, address: str,
                        timeout: Optional[float] = None,
                        children: Optional[str] = None,
                        output: Optional[str] = None) -> Optional[dict]:
    """Async wait loop so API requests and the PTY pump keep making progress.

    The pump may have already drained output into recent_output; the direct
    SupervisorV1.wait_for_exit loop cannot see those bytes. This API adapter
    checks the shared screen buffer and only reads the handle when needed.
    """
    deadline = None if timeout is None else time.monotonic() + timeout
    wait_set = (state.supervisor.children(address) if children
                else [address])
    pending = set(wait_set)
    while True:
        if deadline is not None and time.monotonic() >= deadline:
            return None

        candidates = ([state.supervisor.get_terminal(address)] if not children
                      else [state.supervisor.get_terminal(a)
                            for a in list(pending)])
        if output is not None:
            for terminal in candidates:
                if terminal is None:
                    continue
                if output in terminal.recent_output:
                    return {"state": "output_match", "matched": output}
                if terminal.handle is not None:
                    try:
                        chunk = terminal.handle.read(timeout=0)
                    except Exception:
                        chunk = b""
                    if chunk:
                        text = chunk.decode("utf-8", errors="replace")
                        terminal.recent_output = (
                            terminal.recent_output + text
                        )[-65536:]
                        if output in text:
                            return {"state": "output_match",
                                    "matched": output}

        finished = []
        for addr in list(pending):
            terminal = state.supervisor.get_terminal(addr)
            if terminal is None or terminal.handle is None:
                finished.append(addr)
                pending.discard(addr)
            elif not terminal.handle.alive() or terminal.handle.closed:
                finished.append(addr)
                pending.discard(addr)

        if children:
            if children == "any" and finished:
                return {"state": "exited", "children": sorted(finished)}
            if not pending:
                return {"state": "exited", "children": sorted(wait_set)}
        elif finished:
            terminal = state.supervisor.get_terminal(address)
            return {
                "state": "exited",
                "exit_code": terminal.exit_code if terminal is not None else None,
            }
        await asyncio.sleep(0.02)


async def handle_wait(request: web.Request) -> web.Response:
    """POST /api/core/wait {term, timeout?, children?, output?}."""
    state = _state(request)
    try:
        data = await _read_json(request)
        term = _term(request, data)
        timeout = data.get("timeout")
        if timeout is not None:
            timeout = float(timeout)
            if timeout < 0:
                raise ValueError("timeout must be >= 0")
        children = data.get("children")
        if children is not None and children not in ("all", "any"):
            raise ValueError("children must be 'all' or 'any'")
        output = data.get("output")
        if output is not None and not isinstance(output, str):
            raise ValueError("output must be a string")
    except ValueError as exc:
        return _error(str(exc))
    # FIX-69 PC-2 (#472): wait — чистое опрашивание (QODER: OPEN, не
    # мутация) — gate не нужен, блокирующий wait под panic заморозил бы
    # и legitimate polling.
    result = await _wait_for_api(state, term, timeout=timeout,
                                 children=children, output=output)
    if result is None:
        return web.json_response({"term": term, "state": "timeout", "timed_out": True})
    return web.json_response({"term": term, **result})


async def handle_kill(request: web.Request) -> web.Response:
    """POST /api/core/kill {term, stage?} — эскалация hangup→terminate→kill.

    Выполняется в потоке: эскалация включает RFC-ожидания (≤10s после
    hangup, ≤5s после terminate), чтобы не блокировать event loop.
    """
    state = _state(request)
    try:
        data = await _read_json(request)
        term = _term(request, data)
        stage = data.get("stage")
        if stage is not None and stage not in ("hangup", "terminate", "kill"):
            return _error("stage must be one of hangup/terminate/kill")
    except ValueError as exc:
        return _error(str(exc))
    restoring = _terminal_restore_guard(state, term)
    if restoring is not None:
        return restoring
    denied = await _gate_check(state, "core.terminal_mutation",
                               {"action": "kill", "term": term,
                                "stage": stage}, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    try:
        result = await asyncio.to_thread(state.supervisor.escalate_kill, term, stage)
    except KeyError:
        return _error(f"terminal not found: {term}", status=404)
    return web.json_response(result)


async def handle_restart(request: web.Request) -> web.Response:
    state = _state(request)
    data = {}
    try:
        raw = await request.text()
        if raw.strip():
            data = json.loads(raw)
            if not isinstance(data, dict):
                return _error("JSON object expected")
    except Exception:
        return _error("Invalid JSON body")
    term = request.match_info.get("term") or (data.get("term") if isinstance(data, dict) else None)
    if not (isinstance(term, str) and term.strip()):
        return _error("term required")
    term = term.strip()
    restoring = _terminal_restore_guard(state, term)
    if restoring is not None:
        return restoring
    denied = await _gate_check(state, "core.terminal_mutation",
                               {"action": "restart", "term": term}, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    try:
        result = await asyncio.to_thread(state.supervisor.restart_terminal, term)
    except (ValueError, KeyError, Exception) as exc:
        st = str(exc)
        if "terminal still running" in st:
            return _error(st, status=409)
        return _error(st, status=404)
    return web.json_response(result.to_dict())


async def handle_labels(request: web.Request) -> web.Response:
    state = _state(request)
    try:
        data = await _read_json(request)
        term_name = request.match_info.get("term") or _term(request, data)
    except ValueError as exc:
        return _error(str(exc))
    if not term_name:
        return _error("term required")
    if not isinstance(data.get("labels"), dict):
        return _error("labels must be an object")
    labels = data["labels"]
    term = state.supervisor.get_terminal(term_name)
    if term is None:
        return _error(f"terminal not found: {term_name}", status=404)
    restoring = _terminal_restore_guard(state, term_name)
    if restoring is not None:
        return restoring
    denied = await _gate_check(state, "core.terminal_mutation",
                               {"action": "labels", "term": term_name}, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    for key, value in labels.items():
        if not isinstance(key, str):
            return _error("label keys must be strings")
        if value is None:
            term.labels.pop(key, None)
        elif isinstance(value, str):
            term.labels[key] = value
        else:
            return _error("label values must be string or null")
    state.supervisor._emit("labels", {"address": term.address, "labels": dict(term.labels)})
    state.supervisor._save_registry()
    return web.json_response(term.to_dict())


async def handle_wait_longpoll(request: web.Request) -> web.Response:
    state = _state(request)
    raw_term = request.match_info.get("term")
    term_name = raw_term or request.query.get("term")
    term = state.supervisor.get_terminal(term_name) if isinstance(term_name, str) else None
    if term is None:
        return _error("terminal not found", status=404)
    try:
        since = int(request.query.get("since", "0"))
    except ValueError:
        since = 0
    try:
        timeout = float(request.query.get("timeout", "30"))
    except ValueError:
        timeout = 30.0
    timeout = max(0.1, min(timeout, 60.0))
    init_state = term.state
    init_len = len(term.recent_output)
    changed = False
    deadline = time.time() + timeout
    while time.time() < deadline:
        t = state.supervisor.get_terminal(term.address)
        if t is None:
            return _error("terminal not found", status=404)
        if len(t.recent_output) != init_len or t.state != init_state:
            changed = True
            term = t
            break
        await asyncio.sleep(0.25)
    t = state.supervisor.get_terminal(term.address)
    if t is None:
        return _error("terminal not found", status=404)
    return web.json_response({
        "changed": changed,
        "seq": len(t.recent_output),
        "state": t.state,
        "screen": t.recent_output if changed else None,
    })



async def handle_batch(request: web.Request) -> web.Response:
    state = _state(request)
    try:
        data = await _read_json(request)
    except ValueError as exc:
        return _error(str(exc))
    action = str(data.get("action", "")).strip()
    if not action:
        return _error("action required")
    if data.get("terms") == "all" or data.get("terms") is None:
        terms = [t.address for t in state.supervisor.list_terminals()]
    else:
        terms = data.get("terms", [])
        if not isinstance(terms, list) or not all(isinstance(x, str) for x in terms):
            return _error("terms must be a list or 'all'")
    if action in ("kill", "respawn"):
        denied = await _gate_check(
            state, "core.terminal_mutation",
            {"action": "batch", "op": action, "count": len(terms)},
            intent_hash=data.get("intent_hash"))
        if denied:
            return denied
    results = {}
    for term in terms:
        try:
            if action == "kill":
                await asyncio.to_thread(state.supervisor.escalate_kill, term, "kill")
                results[term] = {"ok": True}
            elif action == "respawn":
                await asyncio.to_thread(state.supervisor.restart_terminal, term)
                results[term] = {"ok": True}
            else:
                results[term] = {"ok": False, "error": f"unknown action {action}"}
        except Exception as exc:
            results[term] = {"ok": False, "error": str(exc)}
    return web.json_response({"action": action, "results": results})


GROUP_ACTIONS = ("kill", "respawn", "rename-prefix")


async def handle_group(request: web.Request) -> web.Response:
    """POST /api/core/group — W8 групповые операции над терминалами.

    {"match": {"label": {"k": "v", ...}} | {"names": [addr|name, ...]},
     "action": "kill" | "respawn" | "rename-prefix",
     "prefix": "<p>"?, "intent_hash"?}

    match.label — терминал матчится, если ВСЕ пары k→v равны его
    labels (str-сравнение). match.names (также top-level names) —
    явные адреса/имена; unknown → per-term ошибка в results.
    Оба ключа можно combined — дедуп по адресу.

    action:
      kill          — escalate_kill(stage="kill")
      respawn       — restart_terminal (только exited/failed;
                      running → per-term ошибка, семантика /restart)
      rename-prefix — rename_terminal на "<prefix>-<name>"; prefix
                      обязателен, валидируется VALID_NAME_RE; коллизии
                      и переполнение 32 chars → per-term ошибки.

    Один gate core.terminal_mutation action="group" на всю операцию;
    per-term результаты {addr: {ok, ...}|{ok:false,error}}.
    """
    state = _state(request)
    try:
        data = await _read_json(request)
    except ValueError as exc:
        return _error(str(exc))
    match = data.get("match")
    if match is not None and not isinstance(match, dict):
        return _error("match must be an object")
    match = match or {}
    action = str(data.get("action", "")).strip()
    if action not in GROUP_ACTIONS:
        return _error(
            f"action must be one of {', '.join(GROUP_ACTIONS)}")
    label_spec = match.get("label")
    names_spec = match.get("names", data.get("names"))
    if label_spec is None and names_spec is None:
        return _error("match.label or match.names required")
    if label_spec is not None and not (
            isinstance(label_spec, dict)
            and all(isinstance(k, str) and isinstance(v, str)
                    for k, v in label_spec.items())):
        return _error("match.label must be an object of string pairs")
    targets: dict[str, Terminal] = {}
    unresolved: list[str] = []
    if names_spec is not None:
        if not isinstance(names_spec, list) or not all(
                isinstance(x, str) for x in names_spec):
            return _error("match.names must be a list of strings")
        for raw in names_spec:
            t = state.supervisor.get_terminal(raw.strip())
            if t is None:
                unresolved.append(raw.strip())
            else:
                targets[t.address] = t
    if label_spec:
        for t in state.supervisor.list_terminals():
            if all(str(t.labels.get(k)) == v
                   for k, v in label_spec.items()):
                targets[t.address] = t
    if not targets and not unresolved:
        return web.json_response({
            "action": action, "matched": 0, "results": {}})
    prefix = data.get("prefix")
    if action == "rename-prefix":
        if not isinstance(prefix, str) \
                or not VALID_NAME_RE.fullmatch(prefix):
            return _error(
                "rename-prefix requires valid 'prefix' "
                "(1-32 of a-z 0-9 _ -)")
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "group", "op": action,
        "matched": len(targets) + len(unresolved),
        "label": label_spec, "names": names_spec,
        "prefix": prefix if action == "rename-prefix" else None,
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    results: dict[str, dict] = {}
    for raw in unresolved:
        results[raw] = {"ok": False, "error": "terminal not found"}
    for address, term in targets.items():
        try:
            if action == "kill":
                res = await asyncio.to_thread(
                    state.supervisor.escalate_kill, term.address, "kill")
                results[address] = {"ok": True, "kill": res}
            elif action == "respawn":
                await asyncio.to_thread(
                    state.supervisor.restart_terminal, term.address)
                results[address] = {"ok": True}
            else:  # rename-prefix
                new_name = f"{prefix}-{term.name}"
                renamed = await asyncio.to_thread(
                    state.supervisor.rename_terminal,
                    term.address, new_name)
                results[address] = {
                    "ok": True, "new": renamed.address}
        except Exception as exc:
            results[address] = {"ok": False, "error": str(exc)}
    return web.json_response({
        "action": action,
        "matched": len(results),
        "results": results,
    })


# -- named groups (W27) ------------------------------------------------------


def _group_view(g: dict) -> dict:
    return {"name": g["name"], "members": list(g["members"]),
            "labels": dict(g.get("labels", {})),
            "count": len(g["members"]),
            "created_at": g["created_at"],
            "updated_at": g["updated_at"]}


def _resolve_group_members(sup: SupervisorV1,
                           raw: Any) -> tuple[list[str], list[str]]:
    """members:[name|addr|"group:<g>"] → (entries, unresolved).

    W31: "group:<name>" — вложенная группа (валидируется, что
    группа существует); терминалы → адреса; dedup."""
    if not isinstance(raw, list) or not all(
            isinstance(x, str) for x in raw):
        raise ValueError("members must be a list of strings")
    entries: list[str] = []
    unresolved: list[str] = []
    for x in raw:
        x = x.strip()
        if x.startswith("group:"):
            gname = x[6:]
            if gname not in sup.groups:
                unresolved.append(x)
            elif x not in entries:
                entries.append(x)
            continue
        t = sup.get_terminal(x)
        if t is None:
            unresolved.append(x)
        elif t.address not in entries:
            entries.append(t.address)
    return entries, unresolved


def _expand_group_members(sup: SupervisorV1,
                          members: list[str],
                          _seen: frozenset = frozenset(),
                          _depth: int = 0) -> tuple[list[str], list[str]]:
    """W31: members → плоский список адресов; group:<g> разворачивается
    рекурсивно (cycle-safe через _seen, depth≤8)."""
    if _depth > 8:
        return [], ["<max nesting depth>"]
    addrs: list[str] = []
    unresolved: list[str] = []
    seen_groups = set(_seen)
    for m in members:
        if m.startswith("group:"):
            gname = m[6:]
            if gname in seen_groups:
                unresolved.append(f"cycle:{gname}")
                continue
            g = sup.groups.get(gname)
            if g is None:
                unresolved.append(m)
                continue
            sub_addrs, sub_err = _expand_group_members(
                sup, g["members"],
                _seen | {gname}, _depth + 1)
            for a in sub_addrs:
                if a not in addrs:
                    addrs.append(a)
            unresolved.extend(sub_err)
        elif m not in addrs:
            addrs.append(m)
    return addrs, unresolved


async def handle_group_upsert(request: web.Request) -> web.Response:
    """PUT /api/core/group/{name} — W27 create-or-replace группу.

    {"members": [name|addr, ...]} — члены резолвятся в адреса;
    unknown → 400 со списком (строго, без частичного приёма).
    Пустой members = группа без членов (валидно)."""
    state = _state(request)
    name = request.match_info["name"]
    if not VALID_NAME_RE.fullmatch(name):
        return _error("invalid group name "
                      "(1-32 of a-z 0-9 _ -)")
    try:
        data = await _read_json(request)
        members, unresolved = _resolve_group_members(
            state.supervisor, data.get("members", []))
        labels_raw = data.get("labels")
        if labels_raw is not None and not (
                isinstance(labels_raw, dict) and all(
                    isinstance(k, str) and isinstance(v, str)
                    for k, v in labels_raw.items())):
            raise ValueError(
                "labels must be an object of string pairs")
    except ValueError as exc:
        return _error(str(exc))
    if unresolved:
        return web.json_response(
            {"error": "unknown terminals or groups",
             "unresolved": unresolved},
            status=400)
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "group-upsert", "group": name,
        "members": len(members)},
        intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    now = time.time()
    prev = state.supervisor.groups.get(name)
    state.supervisor.groups[name] = {
        "name": name, "members": members,
        # labels: None → сохранить прежние; dict (вкл. {}) → заменить
        "labels": (dict(labels_raw) if labels_raw is not None
                   else dict(prev.get("labels", {})) if prev else {}),
        "created_at": prev["created_at"] if prev else now,
        "updated_at": now}
    return web.json_response(
        _group_view(state.supervisor.groups[name]))


async def handle_group_get(request: web.Request) -> web.Response:
    """GET /api/core/group/{name} — W27: группа или 404."""
    state = _state(request)
    g = state.supervisor.groups.get(request.match_info["name"])
    if g is None:
        return _error("group not found", status=404)
    return web.json_response(_group_view(g))


async def handle_groups_list(request: web.Request) -> web.Response:
    """GET /api/core/groups — W27: все группы."""
    state = _state(request)
    groups = [_group_view(g)
              for g in state.supervisor.groups.values()]
    groups.sort(key=lambda g: g["name"])
    return web.json_response({"groups": groups, "count": len(groups)})


async def handle_group_delete(request: web.Request) -> web.Response:
    """DELETE /api/core/group/{name} — W27."""
    state = _state(request)
    name = request.match_info["name"]
    if name not in state.supervisor.groups:
        return _error("group not found", status=404)
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "group-delete", "group": name})
    if denied is not None:
        return denied
    del state.supervisor.groups[name]
    return web.json_response({"deleted": name})


async def _group_or_404(state: AppState, name: str):
    g = state.supervisor.groups.get(name)
    if g is None:
        return None, _error("group not found", status=404)
    return g, None


async def handle_group_send(request: web.Request) -> web.Response:
    """POST /api/core/group/{name}/send — W27 рассылка в группу.

    {"text": str, "enter"?: bool} — семантика /send-broadcast:
    шлём только живым членам, lock/exited → per-term skipped.
    """
    state = _state(request)
    name = request.match_info["name"]
    g, err = await _group_or_404(state, name)
    if err is not None:
        return err
    try:
        data = await _read_json(request)
        text = data.get("text")
        if not isinstance(text, str):
            raise ValueError("text required (string)")
        enter = bool(data.get("enter", True))
    except ValueError as exc:
        return _error(str(exc))
    # W31: вложенные group:<g> разворачиваются рекурсивно
    members, gerr = _expand_group_members(
        state.supervisor, g["members"])
    if gerr:
        return web.json_response(
            {"error": "group expansion failed",
             "unresolved": gerr}, status=409)
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "group-send", "group": name,
        "count": len(members), "text_sha": _payload_sha(text),
        "enter": enter}, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    results: dict[str, dict] = {}
    sent = skipped = 0
    for addr in members:
        term = state.supervisor.get_terminal(addr)
        if term is None:
            results[addr] = {"ok": False, "error": "terminal not found"}
            skipped += 1
            continue
        if getattr(term, "locked", False):
            results[addr] = {"ok": False, "skipped": True,
                             "error": "terminal locked"}
            skipped += 1
            continue
        live = (term.state != "exited" and term.handle is not None
                and term.handle.alive())
        if not live:
            results[addr] = {"ok": False, "skipped": True,
                             "error": f"not live (state={term.state})"}
            skipped += 1
            continue
        try:
            ok = await asyncio.to_thread(
                state.supervisor.send, term.address, text, enter)
        except Exception as exc:
            results[addr] = {"ok": False, "error": str(exc)}
            skipped += 1
            continue
        if ok:
            results[addr] = {"ok": True, "status": "sent"}
            sent += 1
        else:
            results[addr] = {"ok": False, "skipped": True,
                             "error": "send failed"}
            skipped += 1
    return web.json_response({
        "action": "group-send", "group": name,
        "sent": sent, "skipped": skipped, "results": results})


async def handle_group_kill(request: web.Request) -> web.Response:
    """POST /api/core/group/{name}/kill — W27 kill всех членов.

    Per-term escalate_kill(stage="kill"); мёртвые/unknown →
    per-term ошибка/skipped (как W8 group kill)."""
    state = _state(request)
    name = request.match_info["name"]
    g, err = await _group_or_404(state, name)
    if err is not None:
        return err
    members, gerr = _expand_group_members(
        state.supervisor, g["members"])
    if gerr:
        return web.json_response(
            {"error": "group expansion failed",
             "unresolved": gerr}, status=409)
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "group-kill", "group": name,
        "count": len(members)})
    if denied is not None:
        return denied
    results: dict[str, dict] = {}
    for addr in members:
        term = state.supervisor.get_terminal(addr)
        if term is None:
            results[addr] = {"ok": False, "error": "terminal not found"}
            continue
        try:
            res = await asyncio.to_thread(
                state.supervisor.escalate_kill, term.address, "kill")
            results[addr] = {"ok": True, "kill": res}
        except Exception as exc:
            results[addr] = {"ok": False, "error": str(exc)}
    return web.json_response({
        "action": "group-kill", "group": name,
        "killed": sum(1 for r in results.values() if r.get("ok")),
        "results": results})


# -- output pipes (W9) -------------------------------------------------------

async def handle_terminal_pipe(request: web.Request) -> web.Response:
    """POST /api/core/terminal/<a>/pipe — W9 output→stdin pipe.

    {"to": "<b>"} — добавить pipe a→b (идемпотентно): каждый чанк
    вывода a пишется в stdin b на step_once (сырые байты, как
    tmux pipe-pane). {"to": null} или пустое тело — снять ВСЕ pipes
    от a. {"to": "b", "remove": true} — снять конкретный a→b.

    Валидация: оба терминала существуют и локальные (machine ==
    supervisor.machine — remote transport не поддержан); src != dst
    (иначе feedback-loop). dst может быть exited — pipe живёт,
    запись возобновится при respawn. Gate core.terminal_mutation
    action="pipe".
    """
    state = _state(request)
    raw = request.match_info.get("name", "")
    src = state.supervisor.get_terminal(raw)
    if src is None:
        return _error(f"terminal not found: {raw}", status=404)
    try:
        data = await _read_json(request) if request.can_read_body else {}
    except ValueError as exc:
        return _error(str(exc))
    to = data.get("to")
    remove_mode = data.get("remove") is True or to is None
    if src.machine != state.supervisor.machine:
        return _error("remote source unsupported", status=400)
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "pipe", "src": src.address,
        "dst": to if isinstance(to, str) else None,
        "remove": remove_mode,
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    if remove_mode:
        specific = to if isinstance(to, str) else None
        if specific is not None:
            dst = state.supervisor.get_terminal(specific)
            if dst is None:
                return _error(
                    f"terminal not found: {specific}", status=404)
            n = state.supervisor.remove_pipe(src.address, dst.address)
            return web.json_response({
                "src": src.address, "dst": dst.address,
                "removed": n, "active": state.supervisor.list_pipes()})
        n = state.supervisor.remove_pipe(src.address)
        return web.json_response({
            "src": src.address, "dst": None,
            "removed": n, "active": state.supervisor.list_pipes()})
    if not isinstance(to, str) or not to.strip():
        return _error("to required (terminal address) or null to remove")
    dst = state.supervisor.get_terminal(to.strip())
    if dst is None:
        return _error(f"terminal not found: {to}", status=404)
    if dst.machine != state.supervisor.machine:
        return _error("remote target unsupported", status=400)
    if dst.address == src.address:
        return _error("pipe src == dst (feedback loop)", status=400)
    state.supervisor.add_pipe(src.address, dst.address)
    return web.json_response({
        "src": src.address, "dst": dst.address,
        "active": state.supervisor.list_pipes()})


# -- output markers (W12) ----------------------------------------------------

_MARKER_LABEL_MAX = 200


async def handle_terminal_marker(request: web.Request) -> web.Response:
    """POST /api/core/terminal/<name>/marker {"label": str} — W12.

    Закладка в scrollback: в deque добавляется строка
    `[MARKER ts=<unix> label=<label>]` (видна в dump/screen-history),
    плюс запись в term.markers [{ts,label}] для W32/UI.
    label: обязательная непустая строка ≤200 chars, одна строка
    (\n/\r срезаются). recent_output НЕ трогаем — он зеркалит
    PTY-вывод, маркер — не вывод терминала. Gate
    core.terminal_mutation action="marker".
    """
    state = _state(request)
    raw = request.match_info.get("name", "")
    term = state.supervisor.get_terminal(raw)
    if term is None:
        return _error(f"terminal not found: {raw}", status=404)
    try:
        data = await _read_json(request)
        label = data.get("label")
        if not isinstance(label, str) or not label.strip():
            raise ValueError("label required (non-empty string)")
        label = " ".join(label.split())[:_MARKER_LABEL_MAX]
    except ValueError as exc:
        return _error(str(exc))
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "marker", "term": term.address, "label": label,
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    ts = time.time()
    line = f"[MARKER ts={ts:.3f} label={label}]"
    state.supervisor.scrollback_extend(term, [line])
    term.markers.append({"ts": ts, "label": label})
    return web.json_response({
        "term": term.address,
        "marker": {"ts": ts, "label": label},
        "markers_total": len(term.markers),
        "status": "marked",
    })


# -- terminal diff (W13) -----------------------------------------------------

_DIFF_MAX_HUNKS = 50
_DIFF_MAX_HUNK_LINES = 40
_DIFF_MAX_DETAIL = 400  # W33: суммарный cap line-level detail


def _screen_lines(term) -> List[str]:
    """recent_output → список строк (пустой экран → [])."""
    out = getattr(term, "recent_output", "") or ""
    return out.splitlines()


async def handle_terminal_diff(request: web.Request) -> web.Response:
    """GET /api/core/diff/{a}/{b} — W13 расхождение скринов двух
    терминалов. Сравниваются recent_output (то, что видит /screen).
    difflib opcodes → hunks [{tag,a_lines,b_lines,a_start,b_start}];
    identical=true при полном совпадении. Оба имени — короткие
    (<name>) или полные адреса; один сегмент пути, '/' не нужен.
    """
    state = _state(request)
    a_name = request.match_info.get("a", "")
    b_name = request.match_info.get("b", "")
    ta = state.supervisor.get_terminal(a_name)
    tb = state.supervisor.get_terminal(b_name)
    if ta is None:
        return _error(f"terminal not found: {a_name}", status=404)
    if tb is None:
        return _error(f"terminal not found: {b_name}", status=404)
    la, lb = _screen_lines(ta), _screen_lines(tb)
    sm = difflib.SequenceMatcher(None, la, lb, autojunk=False)
    ops = [op for op in sm.get_opcodes() if op[0] != "equal"]
    hunks_total = len(ops)
    truncated = hunks_total > _DIFF_MAX_HUNKS
    # W33: intra-hunk line-level diff — позиции КАЖДОЙ расходящейся
    # строки (1-based), cap _DIFF_MAX_DETAIL по сумме.
    detail_budget = _DIFF_MAX_DETAIL

    def _hunk_detail(tag, i1, i2, j1, j2):
        nonlocal detail_budget
        seg_a, seg_b = la[i1:i2], lb[j1:j2]
        if tag == "replace":
            sub = difflib.SequenceMatcher(
                None, seg_a, seg_b, autojunk=False)
            subops = [o for o in sub.get_opcodes()
                      if o[0] != "equal"]
        else:
            subops = [(tag, 0, len(seg_a), 0, len(seg_b))]
        out = []
        for stag, si1, si2, sj1, sj2 in subops:
            if detail_budget <= 0:
                break
            # rep: парные строки до min(len); хвосты — del/ins
            pairs = min(si2 - si1, sj2 - sj1)
            for k in range(pairs):
                if detail_budget <= 0:
                    break
                out.append({
                    "tag": "rep", "a": i1 + si1 + k + 1,
                    "b": j1 + sj1 + k + 1,
                    "a_text": seg_a[si1 + k],
                    "b_text": seg_b[sj1 + k]})
                detail_budget -= 1
            for k in range(pairs, si2 - si1):
                if detail_budget <= 0:
                    break
                out.append({"tag": "del", "a": i1 + si1 + k + 1,
                            "b": None, "a_text": seg_a[si1 + k],
                            "b_text": None})
                detail_budget -= 1
            for k in range(pairs, sj2 - sj1):
                if detail_budget <= 0:
                    break
                out.append({"tag": "ins", "a": None,
                            "b": j1 + sj1 + k + 1,
                            "a_text": None,
                            "b_text": seg_b[sj1 + k]})
                detail_budget -= 1
        return out[:_DIFF_MAX_HUNK_LINES]

    hunks = []
    for tag, i1, i2, j1, j2 in ops[:_DIFF_MAX_HUNKS]:
        h = {
            "tag": tag, "a_start": i1 + 1, "a_end": i2,
            "b_start": j1 + 1, "b_end": j2,
            "a_lines": la[i1:i2][:_DIFF_MAX_HUNK_LINES],
            "b_lines": lb[j1:j2][:_DIFF_MAX_HUNK_LINES],
        }
        if detail_budget > 0:
            h["detail"] = _hunk_detail(tag, i1, i2, j1, j2)
        hunks.append(h)
    identical = hunks_total == 0
    # similarity: доля совпавших строк от max(len); identical → 1.0
    matched = sum(m.size for m in sm.get_matching_blocks())
    denom = max(len(la), len(lb), 1)
    similarity = 1.0 if identical else round(matched / denom, 4)
    return web.json_response({
        "a": ta.address, "b": tb.address,
        "identical": identical, "similarity": similarity,
        "lines": {"a": len(la), "b": len(lb)},
        "hunks_total": hunks_total,
        "hunks": hunks, "truncated": truncated,
    })


# -- metrics history (W14) ---------------------------------------------------

_METRICS_MAX_POINTS = 1440


# -- cost tracker (W24) ------------------------------------------------------


async def handle_terminal_cost(request: web.Request) -> web.Response:
    """GET /api/core/terminal/<n>/cost — W24.

    Per-term cost: out_bytes — кумулятивные output-байты (PTY read,
    включая pipe-форвардинг? нет — считаются на src при read);
    state_time — секунды по состояниям (тик-гранулярность ~50ms);
    out_mb — байты/1e6. Персистится через registry (to_dict).
    """
    state = _state(request)
    raw = request.match_info.get("name", "")
    term = state.supervisor.get_terminal(raw)
    if term is None:
        return _error(f"terminal not found: {raw}", status=404)
    return web.json_response({
        "term": term.address,
        "state": term.state,
        "out_bytes": term.out_bytes,
        "out_mb": round(term.out_bytes / 1_000_000, 4),
        "state_time": dict(term.state_time),
        "state_time_total": round(sum(term.state_time.values()), 2),
        "uptime_s": round(time.time() - term.created_at, 1),
    })


async def handle_cost_report(request: web.Request) -> web.Response:
    """GET /api/core/cost-report?top=N — W44.

    Агрегация W24-метрик по всем терминалам: totals (out_bytes,
    out_mb, terms count по состояниям), state_time по состояниям
    (суммарно), per-term таблица отсортированная по out_bytes desc
    (top=N, default 20, cap 200). exited-терминалы включены —
    их накопленная стоимость реальна.
    """
    state = _state(request)
    try:
        top = int(request.query.get("top", "20"))
    except ValueError:
        return _error("top must be int", status=400)
    top = max(1, min(top, 200))
    terms = sorted(
        state.supervisor.terminals.values(),
        key=lambda t: t.out_bytes, reverse=True)
    by_state: dict[str, dict] = {}
    state_time_totals: dict[str, float] = {}
    total_bytes = 0
    for t in terms:
        total_bytes += t.out_bytes
        st = by_state.setdefault(t.state, {
            "terms": 0, "out_bytes": 0})
        st["terms"] += 1
        st["out_bytes"] += t.out_bytes
        for sname, secs in t.state_time.items():
            state_time_totals[sname] = (
                state_time_totals.get(sname, 0.0) + secs)
    return web.json_response({
        "terms_total": len(terms),
        "out_bytes": total_bytes,
        "out_mb": round(total_bytes / 1_000_000, 4),
        "by_state": by_state,
        "state_time": {
            k: round(v, 2)
            for k, v in sorted(state_time_totals.items())},
        "top": [{
            "term": t.address,
            "state": t.state,
            "out_bytes": t.out_bytes,
            "out_mb": round(t.out_bytes / 1_000_000, 4),
            "state_time_total": round(
                sum(t.state_time.values()), 2),
        } for t in terms[:top]],
    })


# -- freeze/resume (W21) -----------------------------------------------------


async def _handle_freeze_toggle(request: web.Request,
                                freeze: bool) -> web.Response:
    """POST /api/core/terminal/<n>/freeze|resume — W21.

    frozen=True → step_once пропускает терминал: PTY-вывод не
    читается (копится в OS-буфере), OSC-статусы/респаун/idle-kick/
    метрики не применяются. resume → накопленное дочитывается
    следующим тиком. Остальные терминалы работают штатно.
    Идемпотентно. Gate core.terminal_mutation action=freeze|resume.
    """
    state = _state(request)
    raw = request.match_info.get("name", "")
    term = state.supervisor.get_terminal(raw)
    if term is None:
        return _error(f"terminal not found: {raw}", status=404)
    action = "freeze" if freeze else "resume"
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": action, "term": term.address,
    }, intent_hash=None)
    if denied is not None:
        return denied
    term.frozen = freeze
    state.supervisor._save_registry()  # W41: freeze-state в registry
    state.supervisor._emit("frozen" if freeze else "resumed", {
        "address": term.address, "frozen": freeze})
    return web.json_response({
        "term": term.address, "frozen": term.frozen,
        "status": "frozen" if freeze else "resumed"})


async def handle_terminal_freeze(request: web.Request) -> web.Response:
    return await _handle_freeze_toggle(request, True)


async def handle_terminal_resume(request: web.Request) -> web.Response:
    return await _handle_freeze_toggle(request, False)


# -- exit webhooks (W15) -----------------------------------------------------

_WEBHOOK_URL_MAX = 2048
_WEBHOOK_TIMEOUT = ClientTimeout(total=5)


def _valid_webhook_url(url: str) -> bool:
    try:
        parts = urlsplit(url)
    except Exception:
        return False
    return (parts.scheme in ("http", "https")
            and bool(parts.netloc)
            and len(url) <= _WEBHOOK_URL_MAX)


async def handle_terminal_on_exit(request: web.Request) -> web.Response:
    """POST /api/core/terminal/<n>/on-exit {url} — W15.

    Регистрирует webhook: при exited-событии терминала (любой путь —
    kill/exit/die_with_parent) URL получает POST JSON
    {event,term,exit_code,why,ts}. url:null/"" → снять. Только
    http(s). In-memory — после рестарта регистрация теряется.
    Gate core.terminal_mutation action="on-exit".
    """
    state = _state(request)
    raw = request.match_info.get("name", "")
    term = state.supervisor.get_terminal(raw)
    if term is None:
        return _error(f"terminal not found: {raw}", status=404)
    try:
        data = await _read_json(request)
        url = data.get("url")
        if url is not None and not isinstance(url, str):
            raise ValueError("url must be string or null")
    except ValueError as exc:
        return _error(str(exc))
    if url in (None, ""):
        denied = await _gate_check(state, "core.terminal_mutation", {
            "action": "on-exit-clear", "term": term.address,
        }, intent_hash=data.get("intent_hash"))
        if denied is not None:
            return denied
        term.exit_webhook = None
        return web.json_response({
            "term": term.address, "webhook": None,
            "status": "cleared"})
    url = url.strip()
    if not _valid_webhook_url(url):
        return _error("url must be http(s) URL")
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "on-exit", "term": term.address, "url": url,
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    term.exit_webhook = url
    return web.json_response({
        "term": term.address, "webhook": url, "status": "armed"})


_LIFECYCLE_HOOK_MAX = 10


async def handle_terminal_on_event(request: web.Request) -> web.Response:
    """POST/GET /api/core/terminal/<n>/on-event — W61 lifecycle hooks.

    POST {url, events:[...]} — подписка: каждое событие терминала
    из списка → POST JSON (полный event) на url через
    pending_webhooks/drain. events ⊆ KNOWN_EVENT_TYPES, непустой.
    {url:null} → снять все hooks терминала. Max 10 hooks/терминал.
    GET → список hooks. In-memory. Gate core.terminal_mutation
    action="on-event".
    """
    state = _state(request)
    raw = request.match_info.get("name", "")
    term = state.supervisor.get_terminal(raw)
    if term is None:
        return _error(f"terminal not found: {raw}", status=404)
    if request.method == "GET":
        masked = []
        for h in term.lifecycle_webhooks:
            d = dict(h)
            d["secret_set"] = bool(d.pop("secret", None))
            masked.append(d)
        return web.json_response({
            "term": term.address,
            "hooks": masked})
    try:
        data = await _read_json(request)
    except ValueError as exc:
        return _error(str(exc))
    url = data.get("url")
    if url in (None, ""):
        denied = await _gate_check(state, "core.terminal_mutation", {
            "action": "on-event-clear", "term": term.address,
        }, intent_hash=data.get("intent_hash"))
        if denied is not None:
            return denied
        n = len(term.lifecycle_webhooks)
        term.lifecycle_webhooks.clear()
        return web.json_response({
            "term": term.address, "hooks": [], "cleared": n})
    if not isinstance(url, str):
        return _error("url must be string or null")
    url = url.strip()
    if not _valid_webhook_url(url):
        return _error("url must be http(s) URL")
    events = data.get("events")
    if (not isinstance(events, list) or not events
            or not all(isinstance(e, str) for e in events)):
        return _error("events must be a non-empty list of strings")
    bad = [e for e in events if e not in KNOWN_EVENT_TYPES]
    if bad:
        return _error(
            "unknown event types: " + ", ".join(sorted(set(bad))))
    if len(term.lifecycle_webhooks) >= _LIFECYCLE_HOOK_MAX:
        return _error("too many hooks (max "
                      f"{_LIFECYCLE_HOOK_MAX})", status=409)
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "on-event", "term": term.address, "url": url,
        "events": sorted(set(events)),
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    hook = {"url": url, "events": sorted(set(events))}
    secret = data.get("secret")
    if isinstance(secret, str) and secret:
        hook["secret"] = secret
    term.lifecycle_webhooks.append(hook)
    resp_hook = dict(hook)
    resp_hook["secret_set"] = bool(resp_hook.pop("secret", None))
    return web.json_response({
        "term": term.address, "hook": resp_hook,
        "hooks": len(term.lifecycle_webhooks), "status": "armed"}, status=201)


_WEBHOOK_MAX_ATTEMPTS = 5
_WEBHOOK_BACKOFF_S = (1.0, 2.0, 4.0, 8.0, 16.0)  # W35


async def _post_webhook(session: ClientSession, hook: dict) -> bool:
    try:
        import hashlib, hmac, json as _j
        raw = _j.dumps(hook.get("payload", {}), ensure_ascii=False).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        secret = hook.get("secret")
        if isinstance(secret, str) and secret:
            sig = hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()
            headers["X-Nexus-Signature"] = "sha256=" + sig
        async with session.post(
                hook["url"], data=raw, headers=headers,
                timeout=_WEBHOOK_TIMEOUT) as resp:
            if resp.status >= 400:
                print(f"nexus-core: webhook {hook['url']} → "
                      f"HTTP {resp.status}", file=sys.stderr)
                return False
            return True
    except Exception as exc:
        print(f"nexus-core: webhook {hook['url']} failed: "
              f"{exc!r}", file=sys.stderr)
        return False


async def drain_pending_webhooks(supervisor, session: ClientSession) -> int:
    """W15+W35: разбирает supervisor.pending_webhooks → POST каждому url.

    W35 retry: неудача → attempts+1, next_retry_at = now+backoff
    (1,2,4,8,16с); после _WEBHOOK_MAX_ATTEMPTS — drop с логом.
    Not-due хуки пропускаются и возвращаются в очередь (порядок
    сохраняется). Возвращает число успешных отправок.
    """
    sent = 0
    now = time.time()
    deferred = deque()
    while supervisor.pending_webhooks:
        hook = supervisor.pending_webhooks.popleft()
        if hook.get("next_retry_at", 0.0) > now:
            deferred.append(hook)
            continue
        if await _post_webhook(session, hook):
            sent += 1
            typ = str(hook.get("payload", {}).get("type")
                      or hook.get("payload", {}).get("event") or "")
            _WEBHOOK_STATS["sent"] = _WEBHOOK_STATS.get("sent", 0) + 1
            _WEBHOOK_STATS["by_event"][typ] = (
                _WEBHOOK_STATS["by_event"].get(typ, 0) + 1)
            continue
        attempts = int(hook.get("attempts", 0)) + 1
        if attempts < _WEBHOOK_MAX_ATTEMPTS:
            hook["attempts"] = attempts
            hook["next_retry_at"] = now + _WEBHOOK_BACKOFF_S[
                min(attempts - 1, len(_WEBHOOK_BACKOFF_S) - 1)]
            deferred.append(hook)
        else:
            print(f"nexus-core: webhook {hook['url']} dropped "
                  f"after {attempts} attempts", file=sys.stderr)
            try:
                supervisor.dead_webhooks.append(hook)
            except Exception:
                pass
            _WEBHOOK_STATS["failed"] = _WEBHOOK_STATS.get("failed", 0) + 1
            _WEBHOOK_STATS["dead"] = len(
                getattr(supervisor, "dead_webhooks", []))
    for hook in deferred:
        supervisor.pending_webhooks.append(hook)
    return sent


async def _webhook_drain_loop(app: web.Application) -> None:
    """W15: тик ~0.25с — drain exit-webhooks очереди supervisor."""
    state = app["state"]
    async with ClientSession() as session:
        # restore initial snapshot
        try:
            pth = state.base / "webhooks.json"
            if pth.exists():
                snap = _json.loads(pth.read_text(encoding="utf-8"))
                for w in snap.get("pending", []):
                    state.supervisor.pending_webhooks.append(w)
                state.supervisor.dead_webhooks.extend(snap.get("dead", []))
        except Exception:
            pass
        state.last_drain_ts = time.time()
        _last_save = time.time()
        while True:
            await asyncio.sleep(0.25)
            try:
                await drain_pending_webhooks(state.supervisor, session)
                state.last_drain_ts = time.time()
            except Exception:
                import traceback as _tb
                _tb.print_exc()
                print("nexus-core: webhook drain tick crashed "
                      "\u2014 continuing", file=sys.stderr, flush=True)
                await asyncio.sleep(1.0)
            # debounced snapshot every 5s
            if time.time() - _last_save >= 5.0:
                try:
                    snapshot = {
                        "pending": [dict(w) for w in state.supervisor.pending_webhooks],
                        "dead": [dict(w) for w in state.supervisor.dead_webhooks],
                    }
                    (state.base / "webhooks.json").write_text(_json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")
                    _last_save = time.time()
                except Exception:
                    pass


# -- batch screens (W16) -----------------------------------------------------

_SCREENS_MAX_TERMS = 100


# -- cross-grep (W19) --------------------------------------------------------

_SEARCH_MAX_MATCHES = 50


def _term_search_index(term):
    """W49: ленивый индекс scrollback → (lines, blob, offsets).

    fingerprint (len, first, last) — scrollback мутирует только
    append-right + evict-left (deque maxlen), поэтому дешевле
    пересобрать при смене fingerprint, чем поддерживать
    инкрементально. blob = '\\n'.join(lines), offsets[i] =
    старт-офсет строки i (0-based) — line из офсета через
    bisect. substring-поиск идёт str.find по blob (C-speed)
    вместо Python-цикла по строкам.
    """
    lines = (scrollback_all(term) or term.recent_output.splitlines())
    key = (len(lines),
           lines[0] if lines else "",
           lines[-1] if lines else "")
    if term._sidx_key == key and term._sidx_lines is not None:
        return term._sidx_lines, term._sidx_blob, term._sidx_offsets
    blob = "\n".join(lines)
    offsets = [0] * len(lines)
    pos = 0
    for i, ln in enumerate(lines):
        offsets[i] = pos
        pos += len(ln) + 1
    term._sidx_key = key
    term._sidx_lines = lines
    term._sidx_blob = blob
    term._sidx_offsets = offsets
    return lines, blob, offsets
_SEARCH_LINE_CAP = 200
_SEARCH_MAX_CTX = 20  # W39
_SEARCH_FIELDS = ("from", "label", "state")  # W50


def _parse_search_query(q: str) -> tuple[str, dict]:
    """W50: query-язык — `field:value` токены → фильтры.

    Поддержано: from:<addr|name|machine>, label:<k>|<k=v>,
    state:<s>[,<s>...]. Токены с НЕИЗВЕСТНЫМ полем остаются
    частью текста (обратная совместимость: "error:404" —
    литерал). Значения без пробелов. Пустой текст после
    фильтров → фильтр-запрос (terms-only ответ).
    """
    filters: dict[str, list[str]] = {}
    rest: list[str] = []
    for tok in q.split():
        if ":" in tok:
            f, _, v = tok.partition(":")
            if f in _SEARCH_FIELDS and v:
                filters.setdefault(f, []).append(v)
                continue
        rest.append(tok)
    return " ".join(rest), filters


def _term_search_filters(term, filters: dict) -> bool:
    """W50: терминал проходит фильтры from/label/state."""
    for v in filters.get("from", []):
        if not (term.address == v or term.name == v
                or term.machine == v
                or term.address.startswith(v + "/")):
            return False
    for v in filters.get("label", []):
        if "=" in v:
            k, _, want = v.partition("=")
            if term.labels.get(k) != want:
                return False
        elif v not in term.labels:
            return False
    for v in filters.get("state", []):
        if term.state not in v.split(","):
            return False
    return True


async def handle_search_all(request: web.Request) -> web.Response:
    """GET /api/core/search-all?q=<substr>[&ic=1][&re=1][&ctx=N] — W19+.

    W50 query-язык: `field:value` токены в q — from:/label:/state:
    фильтруют терминалы до скана (_parse_search_query); остаток —
    текст поиска. Фильтр-запрос без текста → terms-only список.
    Поиск подстроки по scrollback всех терминалов (включая exited —
    читаем sup.terminals напрямую, без lazy-purge). Для каждого
    терминала с совпадениями: {term,matches:[{line,text}],total}.
    line — 1-based номер в scrollback; text обрезан до 200 chars.
    Кап 50 matches/терминал, ic=1 — case-insensitive.
    """
    state = _state(request)
    q_raw = request.query.get("q", "")
    if not q_raw:
        return _error("q param required")
    q, filters = _parse_search_query(q_raw)  # W50
    ic = request.query.get("ic", "") in ("1", "true", "yes")
    # W39: re=1 — q как regex; ctx=N — N строк контекста вокруг match
    use_re = request.query.get("re", "") in ("1", "true", "yes")
    try:
        ctx = max(0, min(int(request.query.get("ctx", "0") or 0),
                         _SEARCH_MAX_CTX))
    except ValueError:
        return _error("ctx must be a number")
    if not q:
        # W50: фильтр-запрос без текста поиска — terms-only список
        terms_out = [{
            "term": t.address, "state": t.state,
            "machine": t.machine, "labels": dict(t.labels),
        } for t in state.supervisor.terminals.values()
            if _term_search_filters(t, filters)]
        return web.json_response({
            "query": q_raw, "text": "", "filters": filters,
            "terms_matched": len(terms_out),
            "matches_total": 0, "results": terms_out,
            "filter_only": True})
    rx = None
    if use_re:
        flags = re.IGNORECASE if ic else 0
        try:
            rx = re.compile(q, flags)
        except re.error as exc:
            return _error(f"bad regex: {exc}")
        needle = None
    else:
        needle = q.lower() if ic else q
    results = []
    for term in state.supervisor.terminals.values():
        if not _term_search_filters(term, filters):  # W50
            continue
        lines, blob, offsets = _term_search_index(term)
        matches = []
        total = 0
        if rx is not None or ic:
            # regex и case-insensitive — построчный скан
            # (re-семантика ^/$, ic lower() может менять длину
            # строки → blob-офсеты не валидны)
            for i, line in enumerate(lines):
                if rx is not None:
                    hit = rx.search(line) is not None
                else:
                    hit = needle in line.lower()
                if hit:
                    total += 1
                    if len(matches) < _SEARCH_MAX_MATCHES:
                        entry = {
                            "line": i + 1,
                            "text": line[:_SEARCH_LINE_CAP],
                        }
                        if ctx:
                            entry["context"] = {
                                "before": [
                                    {"line": j + 1,
                                     "text": lines[j][:_SEARCH_LINE_CAP]}
                                    for j in range(max(0, i - ctx), i)],
                                "after": [
                                    {"line": j + 1,
                                     "text": lines[j][:_SEARCH_LINE_CAP]}
                                    for j in range(i + 1,
                                                   min(len(lines),
                                                       i + 1 + ctx))],
                            }
                        matches.append(entry)
        elif "\n" not in needle:
            # W49: case-sensitive substring — str.find по blob
            # (C-speed), офсет→line через bisect; total = число
            # строк с ≥1 совпадением (как раньше). needle с \n
            # не може матчити один рядок — пропускаємо (стара
            # семантика: вход містив \n → жодного hit).
            pos = 0
            last_ln = -1
            while True:
                j = blob.find(needle, pos)
                if j < 0:
                    break
                ln_idx = bisect.bisect_right(offsets, j) - 1
                pos = j + 1
                if ln_idx == last_ln:
                    continue
                last_ln = ln_idx
                total += 1
                if len(matches) < _SEARCH_MAX_MATCHES:
                    i = ln_idx
                    entry = {
                        "line": i + 1,
                        "text": lines[i][:_SEARCH_LINE_CAP],
                    }
                    if ctx:
                        entry["context"] = {
                            "before": [
                                {"line": k + 1,
                                 "text": lines[k][:_SEARCH_LINE_CAP]}
                                for k in range(max(0, i - ctx), i)],
                            "after": [
                                {"line": k + 1,
                                 "text": lines[k][:_SEARCH_LINE_CAP]}
                                for k in range(i + 1,
                                               min(len(lines),
                                                   i + 1 + ctx))],
                        }
                    matches.append(entry)
        if total:
            results.append({
                "term": term.address, "matches": matches,
                "total": total,
                "truncated": total > len(matches),
                "state": term.state,
            })
    results.sort(key=lambda r: -r["total"])
    return web.json_response({
        "query": q_raw, "text": q, "filters": filters,
        "ic": ic, "re": use_re, "ctx": ctx,
        "terms_matched": len(results),
        "matches_total": sum(r["total"] for r in results),
        "results": results,
    })


async def handle_stats_aggregation(request: web.Request) -> web.Response:
    """GET /api/core/stats — W54 сводка по space/machine.

    Один проход по terminals → две группировки:
      - by_machine: {machine: {terms, live, exited, states{},
        out_bytes, out_mb, respawns}};
      - by_space: то же по эффективному space (t.space или
        t.machine — как /spaces и migrate).
    Плюс totals. Read-only, gate не нужен.
    """
    state = _state(request)

    def _bucket() -> dict:
        return {"terms": 0, "live": 0, "exited": 0,
                "states": {}, "out_bytes": 0, "respawns": 0}

    def _add(b: dict, t) -> None:
        b["terms"] += 1
        b["out_bytes"] += t.out_bytes
        b["respawns"] += t.respawn_count
        if t.state == "exited":
            b["exited"] += 1
        else:
            b["live"] += 1
        b["states"][t.state] = b["states"].get(t.state, 0) + 1

    by_machine: dict[str, dict] = {}
    by_space: dict[str, dict] = {}
    totals = _bucket()
    for t in state.supervisor.terminals.values():
        _add(totals, t)
        bm = by_machine.setdefault(t.machine, _bucket())
        _add(bm, t)
        eff = t.space or t.machine
        bs = by_space.setdefault(eff, _bucket())
        _add(bs, t)

    def _fmt(groups: dict) -> dict:
        return {k: {**v, "out_mb": round(v["out_bytes"] / 1e6, 4)}
                for k, v in sorted(groups.items())}

    return web.json_response({
        "terminals_total": totals["terms"],
        "totals": {**totals,
                   "out_mb": round(totals["out_bytes"] / 1e6, 4)},
        "by_machine": _fmt(by_machine),
        "by_space": _fmt(by_space),
    })


# -- session merge (W53) -----------------------------------------------------

_MERGE_MAX_LINES = 4000


async def handle_session_merge(request: web.Request) -> web.Response:
    """GET /api/core/merge?a=<t>&b=<t>[&order=concat|interleave] — W53.

    Слияние scrollback двух сессий в единую ленту. Внутри каждого
    источника порядок строк сохраняется; межисточниковой
    хронологии нет (у строк scrollback нет ts) — order:
      - concat (default): все строки A, затем все B;
      - interleave: поочерёдно A[i], B[i].
    Каждая строка: {src:"a"|"b", line:<1-based в источнике>,
    text}. Кап _MERGE_MAX_LINES суммарно. Read-only, gate не
    нужен. 404 на unknown источник.
    """
    state = _state(request)
    a_name = request.query.get("a", "")
    b_name = request.query.get("b", "")
    if not a_name or not b_name:
        return _error("a and b params required")
    ta = state.supervisor.get_terminal(a_name)
    tb = state.supervisor.get_terminal(b_name)
    if ta is None:
        return _error(f"terminal not found: {a_name}", status=404)
    if tb is None:
        return _error(f"terminal not found: {b_name}", status=404)
    order = request.query.get("order", "concat")
    if order not in ("concat", "interleave"):
        return _error("order must be concat|interleave", status=400)

    def _lines(t):
        return (scrollback_all(t) or t.recent_output.splitlines())

    la, lb = _lines(ta), _lines(tb)
    feed: list[dict] = []
    if order == "concat":
        for src, lines in (("a", la), ("b", lb)):
            for i, text in enumerate(lines):
                if len(feed) >= _MERGE_MAX_LINES:
                    break
                feed.append({"src": src, "line": i + 1,
                             "text": text[:_SEARCH_LINE_CAP]})
            if len(feed) >= _MERGE_MAX_LINES:
                break
    else:
        for i in range(max(len(la), len(lb))):
            if len(feed) >= _MERGE_MAX_LINES:
                break
            if i < len(la):
                feed.append({"src": "a", "line": i + 1,
                             "text": la[i][:_SEARCH_LINE_CAP]})
            if i < len(lb) and len(feed) < _MERGE_MAX_LINES:
                feed.append({"src": "b", "line": i + 1,
                             "text": lb[i][:_SEARCH_LINE_CAP]})
    return web.json_response({
        "a": ta.address, "b": tb.address, "order": order,
        "a_lines": len(la), "b_lines": len(lb),
        "feed_lines": len(feed),
        "truncated": len(feed) >= _MERGE_MAX_LINES
        and (len(la) + len(lb)) > _MERGE_MAX_LINES,
        "feed": feed,
        "note": "per-source order preserved; no cross-source "
                "timestamps in scrollback"})


# -- registry compaction (W18) -----------------------------------------------


async def handle_purge_exited(request: web.Request) -> web.Response:
    """POST /api/core/purge-exited {ttl_seconds?, dry_run?} — W18.

    Ручной запуск compaction: удаляет exited-терминалы старше
    ttl_seconds (default = supervisor.exit_ttl / env NEXUS_EXIT_TTL,
    60с). dry_run:true → только считает кандидатов. Авто-путь уже
    был: lazy в list_terminals + debounce 30с в step_once; здесь —
    on-demand + dry_run. Persist — registry.json через _save_registry.
    Gate core.terminal_mutation action="purge-exited".
    """
    state = _state(request)
    try:
        data = await _read_json(request)
        ttl = data.get("ttl_seconds")
        if ttl is not None:
            ttl = float(ttl)
            if ttl < 0:
                raise ValueError("ttl_seconds must be >= 0")
        dry_run = bool(data.get("dry_run", False))
    except (ValueError, TypeError) as exc:
        return _error(f"bad request: {exc}")
    effective_ttl = ttl if ttl is not None else state.supervisor.exit_ttl
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "purge-exited", "ttl_seconds": effective_ttl,
        "dry_run": dry_run,
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    removed = state.supervisor.purge_exited(effective_ttl, dry_run)
    return web.json_response({
        "removed": removed, "dry_run": dry_run,
        "ttl_seconds": effective_ttl,
        "terminals_total": len(state.supervisor.terminals),
    })


async def handle_screens(request: web.Request) -> web.Response:
    """GET /api/core/screens?terms=a,b,c[&lines=N] — W16.

    Мульти-скрин одним кадром: для каждого терминала та же логика,
    что у /screen (scrollback-хвост, mark_observed, attention→False),
    плюс state/attention. terms="all" — все терминалы; неизвестные —
    per-term {"term","error"} запись (не валит весь запрос, как
    send-broadcast). Кап 100 терминалов.
    """
    state = _state(request)
    raw_terms = request.query.get("terms", "")
    if not raw_terms.strip():
        return _error("terms param required (csv or 'all')")
    fmt = request.query.get("format", "full")
    if fmt not in ("full", "diff"):
        return _error("format must be 'full' or 'diff'")
    try:
        n = max(1, min(int(request.query.get("lines", "0") or 0)
                       or 500, 5000))
    except ValueError:
        return _error("lines must be a number")
    sup = state.supervisor
    if raw_terms.strip().lower() == "all":
        names = list(sup.terminals.keys())
    else:
        names = [t.strip() for t in raw_terms.split(",") if t.strip()]
    if len(names) > _SCREENS_MAX_TERMS:
        return _error(f"too many terms (max {_SCREENS_MAX_TERMS})")
    screens = []
    seen = set()
    for name in names:
        term = sup.get_terminal(name)
        if term is None:
            screens.append({"term": name, "error": "no terminal"})
            continue
        if term.address in seen:
            continue
        seen.add(term.address)
        had_attention = term.attention
        sup.mark_observed(term.address)
        term.attention = False
        rows = int(getattr(term, "rows", 24) or 24)
        limit = n if request.query.get("lines") else rows
        all_lines = (scrollback_all(term)
                     or term.recent_output.splitlines())
        truncated = len(all_lines) > limit
        text = ("\n".join(all_lines[-limit:]) if all_lines
                else term.recent_output)
        if fmt == "diff":
            # W36 compact-diff: vs prev scrollback-снимок term'а.
            prev = sup.screen_prev.get(term.address)
            cur = list(all_lines)
            sup.screen_prev[term.address] = cur
            entry = {
                "term": term.address, "screen": text,
                "lines": limit, "truncated": truncated,
                "state": term.state, "attention": had_attention,
                "hash": hashlib.sha1(
                    "\n".join(cur).encode("utf-8",
                                          errors="replace")).hexdigest()[:12],
                "first": prev is None,
            }
            if prev is not None:
                sm = difflib.SequenceMatcher(
                    None, prev, cur, autojunk=False)
                ops = [o for o in sm.get_opcodes() if o[0] != "equal"]
                matched = sum(m.size for m in sm.get_matching_blocks())
                denom = max(len(prev), len(cur), 1)
                entry["changed"] = bool(ops)
                entry["similarity"] = (
                    1.0 if not ops else round(matched / denom, 4))
                entry["hunks"] = [{
                    "tag": tag, "a_start": i1 + 1, "a_end": i2,
                    "b_start": j1 + 1, "b_end": j2,
                    "lines": (cur[j1:j2] if tag != "delete"
                              else prev[i1:i2])[:_DIFF_MAX_HUNK_LINES],
                } for tag, i1, i2, j1, j2 in ops[:_DIFF_MAX_HUNKS]]
                entry["hunks_total"] = len(ops)
            screens.append(entry)
            continue
        screens.append({
            "term": term.address, "screen": text,
            "lines": limit, "truncated": truncated,
            "state": term.state, "attention": had_attention,
            "markers": _marker_positions(all_lines),  # W32
        })
    return web.json_response({"count": len(screens),
                              "format": fmt, "screens": screens})


async def handle_terminal_metrics(request: web.Request) -> web.Response:
    """GET /api/core/terminal/<n>/metrics?points=N&since=TS — W14.

    Time-series per terminal: samples ~1с {ts,state,out_bps}
    (out_bps — байт/сек вывода за интервал) + state_changes журнал
    {ts,from,to}. points — сколько последних сэмплов (default 300,
    max 1440 = час при 1с); since — unix-ts фильтр. In-memory only:
    после рестарта серия пустая (реестр метрики не хранит).
    """
    state = _state(request)
    raw = request.match_info.get("name", "")
    term = state.supervisor.get_terminal(raw)
    if term is None:
        return _error(f"terminal not found: {raw}", status=404)
    try:
        points = int(request.query.get("points", "300"))
        points = max(1, min(points, _METRICS_MAX_POINTS))
        since = float(request.query.get("since", "0") or 0)
    except ValueError:
        return _error("points/since must be numbers")
    samples = [s for s in term.metrics if s["ts"] >= since]
    samples = samples[-points:]
    changes = [c for c in term.state_changes if c["ts"] >= since]
    changes = changes[-points:]
    states = sorted({s["state"] for s in term.metrics})
    return web.json_response({
        "term": term.address,
        "points": len(samples),
        "samples": samples,
        "changes": changes,
        "changes_total": len(term.state_changes),
        "states_seen": states,
        "current": {
            "state": term.state,
            "out_bps": samples[-1]["out_bps"] if samples else 0.0,
        },
    })


# -- pipe-file (W25) ---------------------------------------------------------


async def handle_terminal_pipe_file(request: web.Request) -> web.Response:
    """POST /api/core/terminal/<n>/pipe-file {path} — W25.

    Сырой PTY-вывод терминала live-дозаписывается в sandbox-файл
    (FileOps root = state-base; append_bytes). {path:null}/"" →
    снять. Файл создаётся сразу (touch) — невалидный/abs путь →
    400 через FileOpsError. Один файл на терминал — повторный
    pipe-file перенацеливает. Кап 256MB → file_pipe_full event.
    Gate core.terminal_mutation action="pipe-file".
    """
    state = _state(request)
    raw = request.match_info.get("name", "")
    term = state.supervisor.get_terminal(raw)
    if term is None:
        return _error(f"terminal not found: {raw}", status=404)
    try:
        data = await _read_json(request)
        path = data.get("path")
        if path is not None and not isinstance(path, str):
            raise ValueError("path must be string or null")
    except ValueError as exc:
        return _error(str(exc))
    if path in (None, ""):
        existed = state.supervisor.remove_file_pipe(term.address)
        return web.json_response({
            "term": term.address, "path": None,
            "status": "removed" if existed else "none"})
    path = path.strip()
    try:
        state.files.append_bytes(path, b"")  # touch+validate
    except FileOpsError as exc:
        return _error(str(exc))
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "pipe-file", "term": term.address, "path": path,
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    state.supervisor.add_file_pipe(term.address, path)
    return web.json_response({
        "term": term.address, "path": path, "status": "piped"})


async def handle_pipe_files(request: web.Request) -> web.Response:
    """GET /api/core/pipe-files — активные file-pipes (W25)."""
    state = _state(request)
    pipes = state.supervisor.list_file_pipes()
    return web.json_response({"pipes": pipes, "count": len(pipes)})


async def handle_capacity(request: web.Request) -> web.Response:
    """GET /api/core/capacity — W28 оценка свободных слотов.

    Реального hard-cap на терминалы в core нет — оценка по RAM:
    per_terminal_mb (env NEXUS_TERM_MB, default 48 — ConPTY+shell)
    против свободной памяти из system_metrics. Если задан
    NEXUS_MAX_TERMS (>0) — slots = min(mem_slots, max-live).
    """
    state = _state(request)
    terms = state.supervisor.list_terminals()
    live = sum(1 for t in terms if t.state != "exited")
    exited = len(terms) - live
    try:
        per_mb = float(os.environ.get("NEXUS_TERM_MB", "48"))
    except ValueError:
        per_mb = 48.0
    per_mb = max(per_mb, 1.0)
    try:
        from tools.nexus_core.system_metrics import get_system_metrics
        m = get_system_metrics().collect()
        mem_total = int(m.get("mem_total") or 0)
        mem_free = max(0, mem_total - int(m.get("mem_used") or 0))
    except Exception:
        mem_total = mem_free = 0
    mem_free_mb = mem_free // (1024 * 1024)
    mem_slots = int(mem_free_mb // per_mb) if mem_free else 0
    max_terms = 0
    try:
        max_terms = int(os.environ.get("NEXUS_MAX_TERMS", "0"))
    except ValueError:
        max_terms = 0
    if max_terms > 0:
        slots = max(0, min(mem_slots, max_terms - live))
    else:
        slots = mem_slots
    return web.json_response({
        "live": live, "exited": exited, "total": len(terms),
        "per_terminal_mb": per_mb,
        "mem_total_mb": mem_total // (1024 * 1024),
        "mem_free_mb": mem_free_mb,
        "mem_slots_estimate": mem_slots,
        "max_terms": max_terms or None,
        "slots_estimate": slots,
        "estimate": True,
        "note": "RAM-based estimate; no hard terminal cap in core"})


def _lin_slope(points: list[tuple[float, float]]) -> float:
    """Least-squares slope y/x; 0.0 при <2 точках."""
    if len(points) < 2:
        return 0.0
    n = len(points)
    sx = sum(p[0] for p in points)
    sy = sum(p[1] for p in points)
    sxx = sum(p[0] * p[0] for p in points)
    sxy = sum(p[0] * p[1] for p in points)
    den = n * sxx - sx * sx
    if abs(den) < 1e-9:
        return 0.0
    return (n * sxy - sx * sy) / den


async def handle_capacity_forecast(
        request: web.Request) -> web.Response:
    """GET /api/core/capacity/forecast?window=300 — W47.

    Тренд usage → прогноз. Читает capacity_history (5с-сэмплы
    step_once: {ts,live,mem_free_mb}). Least-squares slope по
    mem_free_mb и live за window секунд:
      - mem_slope_mb_per_s <0 → eta_mem_exhaust_s (оценка до
        slots≈0 при текущем тренде);
      - live_slope_per_s → projected live через 1ч.
    <3 сэмплов → slopes нулевые, estimate всё равно true.
    """
    state = _state(request)
    try:
        window = float(request.query.get("window", "300"))
    except ValueError:
        return _error("window must be a number", status=400)
    window = min(max(window, 30.0), 86400.0)
    now = time.time()
    hist = [p for p in state.supervisor.capacity_history
            if now - p["ts"] <= window]
    if not hist:
        return web.json_response({
            "samples": 0, "window_s": window,
            "estimate": True,
            "note": "no capacity samples yet"})
    first_ts = hist[0]["ts"]
    pts_mem = [(p["ts"] - first_ts, p["mem_free_mb"])
               for p in hist]
    pts_live = [(p["ts"] - first_ts, p["live"]) for p in hist]
    mem_slope = _lin_slope(pts_mem)
    live_slope = _lin_slope(pts_live)
    last = hist[-1]
    mem_now = last["mem_free_mb"]
    live_now = last["live"]
    # прогноз на +1ч от последнего сэмпла
    horizon = 3600.0
    eta_exhaust = None
    if mem_slope < -1e-9 and mem_now > 0:
        eta_exhaust = round(-mem_now / mem_slope, 1)
    return web.json_response({
        "samples": len(hist),
        "window_s": window,
        "span_s": round(last["ts"] - first_ts, 1),
        "mem_free_mb_now": mem_now,
        "live_now": live_now,
        "mem_slope_mb_per_s": round(mem_slope, 4),
        "live_slope_per_s": round(live_slope, 6),
        "eta_mem_exhaust_s": eta_exhaust,
        "projected": {
            "mem_free_mb_1h": max(
                0, round(mem_now + mem_slope * horizon)),
            "live_1h": max(
                0, round(live_now + live_slope * horizon, 1)),
        },
        "estimate": True,
        "note": "linear trend on 5s samples; RAM-based estimate"})


async def handle_core_metrics(request: web.Request) -> web.Response:
    """GET /api/core/metrics — W34 counters/gauges экспорт.

    counters — кумулятивные за жизнь процесса (created/exited/
    events + bytes_out_total из суммы term.out_bytes);
    gauges — текущие (live/exited по state, pipes/file_pipes/
    groups/scheduled, uptime_s). In-memory: рестарт обнуляет.
    """
    state = _state(request)
    sup = state.supervisor
    terms = sup.list_terminals()
    by_state: dict[str, int] = {}
    bytes_out = 0
    respawns = 0
    for t in terms:
        by_state[t.state] = by_state.get(t.state, 0) + 1
        bytes_out += t.out_bytes
        respawns += t.respawn_count
    live = sum(1 for t in terms if t.state != "exited")
    return web.json_response({
        "counters": {
            "terminals_created": sup._counters["created"],
            "terminals_exited": sup._counters["exited"],
            "events_total": sup._counters["events"],
            "bytes_out_total": bytes_out,
            "respawns_total": respawns,
        },
        "gauges": {
            "terminals_live": live,
            "terminals_total": len(terms),
            "by_state": by_state,
            "pipes": len(sup.list_pipes()),
            "file_pipes": len(sup.list_file_pipes()),
            "groups": len(sup.groups),
            "scheduled_sends": len(sup.scheduled_sends),
        },
        "uptime_s": round(time.time() - sup.started_at, 1)
        if getattr(sup, "started_at", None) else None,
    })


# -- registry backup (W38) ---------------------------------------------------

_BACKUP_INCLUDE = ("registry.json", "pipes.json", "spaces.json")
_BACKUP_MAX_FILES = 50


async def handle_backup_create(request: web.Request) -> web.Response:
    """POST /api/core/backup — W38: tar.gz state-dir → backups/.

    Включает registry.json/pipes.json/spaces.json + прочие *.json
    верхнего уровня state-base (doc-store и пр.). Без files/,
    snapshots/, backups/ — только конфиг-состояние. Пишет
    backups/backup-<unixts>.tar.gz, gate core.file_mutation.
    """
    state = _state(request)
    base = Path(state.base)
    files: list[tuple[str, Path]] = []
    seen = set()
    for p in sorted(base.glob("*.json")):
        if p.name in seen or len(files) >= _BACKUP_MAX_FILES:
            continue
        seen.add(p.name)
        files.append((p.name, p))
    files.sort(key=lambda x: (x[0] not in _BACKUP_INCLUDE, x[0]))
    if not files:
        return _error("nothing to backup", status=404)
    denied = await _gate_check(state, "core.file_mutation", {
        "action": "backup", "files": [n for n, _ in files]})
    if denied is not None:
        return denied
    import io
    import tarfile
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for arc, p in files:
            tf.add(p, arcname=arc)
    data = buf.getvalue()
    outdir = base / "backups"
    outdir.mkdir(parents=True, exist_ok=True)
    out = outdir / f"backup-{int(time.time())}.tar.gz"
    out.write_bytes(data)
    return web.json_response({
        "path": f"backups/{out.name}", "bytes": len(data),
        "files": [n for n, _ in files]})


async def handle_backups_list(request: web.Request) -> web.Response:
    """GET /api/core/backups — W38: список бэкапов."""
    base = Path(_state(request).base)
    bdir = base / "backups"
    items = (sorted(bdir.glob("*.tar.gz"),
                    key=lambda p: p.stat().st_mtime)
             if bdir.is_dir() else [])
    return web.json_response({"backups": [{
        "name": p.name, "bytes": p.stat().st_size,
        "ts": round(p.stat().st_mtime, 1)} for p in items[-100:]],
        "count": min(len(items), 100)})


async def handle_backup_download(request: web.Request) -> web.Response:
    """GET /api/core/backups/{name} — W38: скачать tar.gz."""
    base = Path(_state(request).base)
    name = request.match_info["name"]
    if not re.fullmatch(r"backup-\d+\.tar\.gz", name):
        return _error("bad name", status=400)
    p = base / "backups" / name
    if not p.is_file():
        return _error("not found", status=404)
    return web.Response(
        body=p.read_bytes(), content_type="application/gzip",
        headers={"Content-Disposition":
                 f'attachment; filename="{name}"'})


# -- scheduled broadcast (W30) -----------------------------------------------


async def handle_send_schedule(request: web.Request) -> web.Response:
    """POST /api/core/send-schedule — W30 отложенная рассылка.

    {"terms": [name|addr]|"all", "text": str, "enter"?: bool,
     "at_ts": unix, "group"?: str}
    group — развернуть членов именованной группы (W27).
    at_ts обязан быть в будущем. Ответ {id, at_ts, count}.
    """
    state = _state(request)
    try:
        data = await _read_json(request)
        text = data.get("text")
        if not isinstance(text, str):
            raise ValueError("text required (string)")
        enter = bool(data.get("enter", True))
        at_ts = data.get("at_ts")
        if not isinstance(at_ts, (int, float)) \
                or isinstance(at_ts, bool):
            raise ValueError("at_ts required (unix timestamp)")
        if at_ts <= time.time():
            raise ValueError("at_ts must be in the future")
        gname = data.get("group")
        terms_raw = data.get("terms")
        names: list[str] = []
        if gname is not None:
            if not isinstance(gname, str):
                raise ValueError("group must be a string")
            g = state.supervisor.groups.get(gname)
            if g is None:
                raise ValueError(f"unknown group: {gname}")
            # W31: group:<g> внутри — разворачиваем рекурсивно
            sub, _ = _expand_group_members(
                state.supervisor, g["members"])
            names.extend(sub)
        if terms_raw == "all":
            names.extend(t.address for t in
                         state.supervisor.list_terminals())
        elif isinstance(terms_raw, list) and all(
                isinstance(x, str) for x in terms_raw):
            names.extend(x.strip() for x in terms_raw)
        elif terms_raw is not None:
            raise ValueError("terms must be a list or 'all'")
        # резолв → адреса; unknown → 400 (строго, как group upsert)
        addrs: list[str] = []
        unresolved: list[str] = []
        for raw in names:
            t = state.supervisor.get_terminal(raw)
            if t is None:
                unresolved.append(raw)
            elif t.address not in addrs:
                addrs.append(t.address)
        if unresolved:
            return web.json_response(
                {"error": "unknown terminals",
                 "unresolved": unresolved}, status=400)
        if not addrs:
            raise ValueError("no target terminals")
    except ValueError as exc:
        return _error(str(exc))
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "send-schedule", "count": len(addrs),
        "at_ts": at_ts, "text_sha": _payload_sha(text),
        "enter": enter, "group": data.get("group")},
        intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    item = state.supervisor.schedule_send(
        addrs, text, enter, float(at_ts))
    return web.json_response({
        "id": item["id"], "at_ts": item["at_ts"],
        "count": len(addrs), "terms": addrs})


async def handle_send_schedule_list(request: web.Request) -> web.Response:
    """GET /api/core/send-schedule — W30: ожидающие рассылки."""
    state = _state(request)
    items = state.supervisor.list_scheduled()
    return web.json_response({"scheduled": items,
                              "count": len(items)})


async def handle_send_schedule_cancel(request: web.Request) -> web.Response:
    """DELETE /api/core/send-schedule/{id} — W30: отмена."""
    state = _state(request)
    sid = request.match_info["id"]
    if not any(item.get("id") == sid
               for item in state.supervisor.list_scheduled()):
        return _error("scheduled send not found", status=404)
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "schedule-clear", "name": sid,
    }, intent_hash=request.query.get("intent_hash"))
    if denied is not None:
        return denied
    if not state.supervisor.cancel_scheduled(sid):
        return _error("scheduled send not found", status=404)
    return web.json_response({"cancelled": sid})


# -- alert rules (W26) -------------------------------------------------------


async def handle_alert_rules(request: web.Request) -> web.Response:
    """GET /api/core/alert-rules — W26+W46: правила + ошибки DSL.

    Hot-edit rules.json: load_rules кэширует по mtime — GET отражает
    файл без рестарта. Ответ {rules[],count,errors[]} — W46:
    невалидные записи видны с index+reason, а не молча отброшены.
    """
    from tools.nexus_core.alert_rules import load_rules_detailed
    return web.json_response(load_rules_detailed())


async def handle_alert_rule_test(request: web.Request) -> web.Response:
    """POST /api/core/alert-rules/test — W46 DSL dry-run.

    Body {pattern, term?, action?, lines?}: компилирует regex и
    прогоняет по scrollback терминала (или recent_output всех
    терминов если term не задан). Никаких side-effects — только
    валидация + matches. Ответ {valid, matches[], scanned}.
    """
    state = _state(request)
    try:
        data = await _read_json(request)
    except ValueError as exc:
        return _error(str(exc))
    pattern = data.get("pattern")
    if not isinstance(pattern, str) or not pattern:
        return _error("pattern required", status=400)
    try:
        rx = re.compile(pattern)
    except re.error as exc:
        return web.json_response(
            {"valid": False, "error": f"bad regex: {exc}",
             "matches": [], "scanned": 0})
    term_name = data.get("term")
    targets: list = []
    if term_name:
        t = state.supervisor.get_terminal(str(term_name))
        if t is None:
            return _error(f"terminal not found: {term_name}",
                          status=404)
        targets = [t]
    else:
        targets = list(state.supervisor.terminals.values())
    max_lines = min(int(data.get("lines") or 500), 5000)
    matches: list[dict] = []
    scanned = 0
    for t in targets:
        lines = scrollback_all(t) or t.recent_output.splitlines()
        for i, line in enumerate(lines[-max_lines:]):
            scanned += 1
            m = rx.search(line)
            if m:
                matches.append({
                    "term": t.address,
                    "line": len(lines) - min(len(lines), max_lines) + i,
                    "match": m.group(0)[:120]})
                if len(matches) >= 100:
                    break
        if len(matches) >= 100:
            break
    return web.json_response({
        "valid": True, "matches": matches,
        "scanned": scanned, "truncated": len(matches) >= 100})


async def handle_pipes(request: web.Request) -> web.Response:
    """GET /api/core/pipes — активные output-pipes (W9)."""
    state = _state(request)
    pipes = state.supervisor.list_pipes()
    return web.json_response({"pipes": pipes, "count": len(pipes)})



async def handle_env_update(request: web.Request) -> web.Response:
    state = _state(request)
    try:
        data = await _read_json(request)
        term_name = request.match_info.get("term") or _term(request, data)
    except ValueError as exc:
        return _error(str(exc))
    if not isinstance(data.get("env"), dict):
        return _error("env must be an object")
    term = state.supervisor.get_terminal(term_name)
    if term is None:
        return _error(f"terminal not found: {term_name}", status=404)
    env = data["env"]
    for k, v in env.items():
        if not isinstance(k, str) or not isinstance(v, str):
            return _error("env keys and values must be strings", status=400)
    denied = await _gate_check(
        state, "core.terminal_mutation",
        {"action": "terminal-env", "term": term.address,
         "env_count": len(env), "env_sha": _payload_sha(env)},
        intent_hash=data.get("intent_hash"))
    if denied:
        return denied
    new_env = dict(term.env or {})
    new_env.update(env)
    term.env = new_env
    try:
        state.supervisor._save_registry()
    except Exception:
        pass
    return web.json_response(term.to_dict())



async def handle_workspace_templates(request: web.Request) -> web.Response:
    state = _state(request)
    base = state.base
    path = base / "workspace-templates.json"
    try:
        data = _json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"templates": []}
    except Exception:
        data = {"templates": []}
    if request.method == "POST":
        try:
            body = await _read_json(request)
        except ValueError as exc:
            return _error(str(exc))
        name = str(body.get("name", "")).strip()
        if not name:
            return _error("name required")
        terms = body.get("terms")
        if not isinstance(terms, list):
            terms = []
        denied = await _gate_check(
            state, "core.terminal_mutation",
            {"action": "workspace-template", "name": name,
             "terms_count": len(terms)},
            intent_hash=body.get("intent_hash"))
        if denied:
            return denied
        templates = data.get("templates", [])
        templates = [t for t in templates if t.get("name") != name]
        templates.append({"name": name, "terms": terms})
        data["templates"] = templates
        try:
            path.write_text(_json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as exc:
            return _error(str(exc))
        return web.json_response({"name": name, "created": True}, status=201)
    return web.json_response(data)


async def handle_workspace_spawn(request: web.Request) -> web.Response:
    state = _state(request)
    try:
        data = await _read_json(request)
    except ValueError as exc:
        return _error(str(exc))
    name = str(data.get("name", "")).strip()
    base = state.base
    path = base / "workspace-templates.json"
    try:
        store = _json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"templates": []}
    except Exception:
        store = {"templates": []}
    tmpl = next((t for t in store.get("templates", []) if t.get("name") == name), None)
    if tmpl is None:
        return _error("template not found", status=404)
    denied = await _gate_check(
        state, "core.terminal_mutation",
        {"action": "workspace-spawn", "name": name,
         "terms_count": len(tmpl.get("terms", []))},
        intent_hash=data.get("intent_hash"))
    if denied:
        return denied
    created = []
    for spec in tmpl.get("terms", []):
        term_name = str(spec.get("name", "")).strip()
        if not term_name:
            continue
        try:
            term = state.supervisor.create_terminal(
                term_name,
                command=spec.get("command") or ["cmd.exe"],
                cwd=spec.get("cwd"),
                cols=int(spec.get("cols", 120)),
                rows=int(spec.get("rows", 30)),
            )
            created.append(term.to_dict())
        except Exception as exc:
            created.append({"name": term_name, "error": str(exc)})
    return web.json_response({"name": name, "created": created}, status=201)


async def handle_spawn_remote(request: web.Request) -> web.Response:
    """POST /api/core/spawn-remote — W65 multi-machine spawn stub.

    {machine, name?, command, cwd?} — machine обязан быть в
    machine_registry и ≠ local. Реальный транспорт — N4; stub
    создаёт ЛОКАЛЬНЫЙ терминал-ретранслятор `relay-<machine>-<name>`
    с labels {_relay_machine, _remote_command}: PTY локальный,
    send/keys идут в input_log как обычно — точка, куда N4-транспорт
    подставит удалённый backend, уже работает. Честный stub:
    ответ помечен relay:true/stub:N4.
    Gate core.terminal_mutation action="spawn-remote".
    """
    state = _state(request)
    try:
        data = await _read_json(request)
        machine = str(data.get("machine") or "").strip()
        command = data.get("command")
        if not isinstance(command, list) or not command \
                or not all(isinstance(c, str) for c in command):
            raise ValueError("command must be non-empty list[str]")
        name = str(data.get("name") or "").strip()
    except ValueError as exc:
        return _error(str(exc))
    if machine == LOCAL_MACHINE:
        return _error("machine must be remote (use /run for local)",
                      status=400)
    if state.machines.get(machine) is None:
        return _error(f"unknown machine: {machine}", status=404)
    if not name:
        name = _unique_term_name(state, f"relay-{machine}")
    elif not VALID_NAME_RE.fullmatch(name):
        return _error("bad name", status=400)
    if state.supervisor.get_terminal(name):
        return _error(f"terminal already exists: {name}",
                      status=409)
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "spawn-remote", "machine": machine,
        "name": name, "command": command,
        "cwd": data.get("cwd"),
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    labels = {"_relay_machine": machine,
              "_remote_command": " ".join(command)[:500]}
    try:
        term = state.supervisor.create_terminal(
            name=name, command=["cmd"],
            cwd=data.get("cwd"), labels=labels)
    except Exception as exc:
        return _error(str(exc), status=409)
    state.supervisor._emit("relay_spawn", {
        "address": term.address, "machine": machine,
        "remote_command": " ".join(command)[:200]})
    d = term.to_dict()
    d["relay"] = True
    d["stub"] = "N4"
    d["machine"] = machine
    return web.json_response(d, status=201)


async def handle_relay_status(request: web.Request) -> web.Response:
    """GET /api/core/relay-status — W65 relay-терминалы по машинам.

    {machines: {name: {terms:[addr], count}}, relay_total}.
    """
    state = _state(request)
    out: dict[str, dict] = {}
    total = 0
    for t in state.supervisor.terminals.values():
        m = t.labels.get("_relay_machine")
        if not m:
            continue
        slot = out.setdefault(m, {"terms": [], "count": 0})
        slot["terms"].append(t.address)
        slot["count"] += 1
        total += 1
    return web.json_response({"machines": out,
                              "relay_total": total})


# -- workspace snapshot v2 (W64) ---------------------------------------------

_WS_MAX_TERMS = 200
_WS_MAX_SCROLLBACK = 5000


def _ws_dir(state) -> Path:
    d = Path(state.base) / "workspaces"
    d.mkdir(parents=True, exist_ok=True)
    return d


async def handle_workspace_snapshot(request: web.Request) -> web.Response:
    """POST /api/core/workspace/snapshot {name?, scrollback?} — W64.

    Полный слепок workspace → workspaces/<name>-<ms>.json:
    {v:2, name, ts, spaces, terminals:[{spec…, space, scrollback?}]}
    spec = SNAPSHOT_SPEC_KEYS + name + space. scrollback опционально
    (scrollback_all, cap 5000/терминал). cap 200 терминалов.
    Gate core.file_mutation action="workspace-snapshot".
    """
    state = _state(request)
    try:
        data = await _read_json(request)
    except ValueError:
        data = {}
    terms = list(state.supervisor.terminals.values())
    if len(terms) > _WS_MAX_TERMS:
        return _error(f"too many terminals ({len(terms)} > "
                      f"{_WS_MAX_TERMS})", status=413)
    want_sb = bool(data.get("scrollback", False))
    snap_name = str(data.get("name") or "").strip()
    if snap_name and not re.fullmatch(r"[A-Za-z0-9_-]{1,64}",
                                      snap_name):
        return _error("bad snapshot name", status=400)
    denied = await _gate_check(state, "core.file_mutation", {
        "action": "workspace-snapshot", "terms": len(terms),
        "scrollback": want_sb, "name": snap_name or None,
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    entries = []
    for t in terms:
        spec = {k: getattr(t, k) for k in SNAPSHOT_SPEC_KEYS}
        spec["name"] = t.name
        entry = {"spec": spec, "space": t.space,
                 "state": t.state}
        if want_sb:
            lines = (scrollback_all(t)
                     or t.recent_output.splitlines())
            entry["scrollback"] = lines[-_WS_MAX_SCROLLBACK:]
        entries.append(entry)
    spaces = _load_custom_spaces(state).get("spaces", [])
    payload = {"v": 2, "name": snap_name or None,
               "snap_ts": time.time(), "machine":
               state.supervisor.machine,
               "spaces": spaces, "terminals": entries}
    fname = (snap_name or f"ws-{int(time.time()*1000)}") \
        + ".json"
    path = _ws_dir(state) / fname
    path.write_text(json.dumps(payload, ensure_ascii=False,
                               indent=2, default=str),
                    encoding="utf-8")
    return web.json_response({
        "file": fname, "terminals": len(entries),
        "spaces": len(spaces), "scrollback": want_sb},
        status=201)


async def handle_workspace_snapshots(request: web.Request) -> web.Response:
    """GET /api/core/workspace/snapshots — W64 список слепков."""
    state = _state(request)
    out = []
    for p in sorted(_ws_dir(state).glob("*.json")):
        try:
            head = json.loads(p.read_text(encoding="utf-8"))
            out.append({"file": p.name,
                        "name": head.get("name"),
                        "snap_ts": head.get("snap_ts"),
                        "terminals": len(head.get("terminals", [])),
                        "v": head.get("v")})
        except (OSError, json.JSONDecodeError):
            continue
    return web.json_response({"snapshots": out, "count": len(out)})


async def handle_workspace_restore(request: web.Request) -> web.Response:
    """POST /api/core/workspace/restore {file|name, scrollback?} — W64.

    Восстанавливает терминалы из слепка: create_terminal со spec;
    существующие имена → skipped (не затираем); space — через
    term.space напрямую (memberships сохраняются); scrollback
    заливается если был в слепке ИЛИ arg.scrollback. Parent-связи
    не восстанавливаются (как W23 import — осознанно).
    """
    state = _state(request)
    try:
        data = await _read_json(request)
    except ValueError as exc:
        return _error(str(exc))
    ref = str(data.get("file") or data.get("name") or "")
    if not ref:
        return _error("file or name required")
    if not ref.endswith(".json"):
        ref += ".json"
    if "/" in ref or "\\" in ref or ".." in ref:
        return _error("bad snapshot ref", status=400)
    path = _ws_dir(state) / ref
    if not path.is_file():
        return _error(f"snapshot not found: {ref}", status=404)
    try:
        snap = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return _error("corrupt snapshot", status=400)
    if snap.get("v") != 2:
        return _error("unsupported snapshot version", status=400)
    entries = snap.get("terminals") or []
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "workspace-restore", "file": ref,
        "terms": len(entries)}, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    created, skipped, failed = [], [], []
    sup = state.supervisor
    for e in entries[:_WS_MAX_TERMS]:
        spec = e.get("spec") or {}
        name = str(spec.get("name") or "")
        if not name:
            skipped.append("?")
            continue
        existing = sup.get_terminal(name)
        if existing is not None and existing.state != "exited":
            skipped.append(existing.address)
            continue
        if existing is not None:
            # exited-запись занимает имя — вытесняем и воссоздаём
            sup.terminals.pop(existing.address, None)
        try:
            spec = dict(spec)
            spec.pop("parent", None)   # parent-цепочки не воскрешаем
            term = sup.create_terminal(
                name=name,
                command=spec.get("command") or ["sh"],
                cwd=spec.get("cwd"),
                env=spec.get("env"),
                labels=spec.get("labels"),
                keep=bool(spec.get("keep", False)),
                machine=spec.get("machine"),
                cols=int(spec.get("cols") or 120),
                rows=int(spec.get("rows") or 30),
                die_with_parent=bool(
                    spec.get("die_with_parent", False)),
                outlive_parent=bool(
                    spec.get("outlive_parent", False)))
            if e.get("space"):
                term.space = str(e["space"])
            sb = e.get("scrollback")
            if isinstance(sb, list) and sb:
                state.supervisor.scrollback_extend(
                    term, (str(x) for x in sb[-_WS_MAX_SCROLLBACK:]))
            sup._save_registry()
            created.append(term.address)
        except Exception as exc:
            failed.append({"name": name, "error": str(exc)[:200]})
    # W90: custom spaces из слепка — досоздаём отсутствующие
    # (id/name/machine/state/labels), workspace-roundtrip полный.
    spaces_restored = []
    custom = _load_custom_spaces(state)
    known_ids = {str(s.get("id"))
                 for s in custom.get("spaces", [])}
    for s in snap.get("spaces") or []:
        if not isinstance(s, dict):
            continue
        sid = str(s.get("id") or s.get("name") or "")
        if (not sid or sid in known_ids
                or not VALID_NAME_RE.fullmatch(sid)):
            continue
        entry = {"id": sid,
                 "name": str(s.get("name") or sid),
                 "machine": str(s.get("machine") or sid),
                 "state": str(s.get("state") or "connected")}
        if isinstance(s.get("labels"), dict):
            entry["labels"] = {str(k): str(v)
                               for k, v in s["labels"].items()}
        custom["spaces"].append(entry)
        known_ids.add(sid)
        spaces_restored.append(sid)
    if spaces_restored:
        _save_custom_spaces(state, custom)
    return web.json_response({
        "file": ref, "created": created, "skipped": skipped,
        "failed": failed,
        "spaces_restored": spaces_restored,
        "ok": not failed})


# W10: session record (asciicast v2)
import asyncio as _aio
_RECORDINGS = {}


async def _record_loop(rec: dict) -> None:
    term_name = rec["term"]
    path = rec["path"]
    prev = ""
    try:
        # header already written; append deltas
        with open(path, "a", encoding="utf-8") as f:
            while not rec.get("stop"):
                await _aio.sleep(0.5)
                t = None
                try:
                    t = rec["state"].supervisor.get_terminal(term_name)
                except Exception:
                    continue
                if t is None:
                    continue
                cur = t.recent_output or ""
                prev = rec.get("prev_len", 0)
                if len(cur) > prev:
                    delta = cur[prev:]
                    f.write(__import__('json').dumps([time.time() - rec["started"], "o", delta]) + chr(10))
                    f.flush()
                    rec["prev_len"] = len(cur)
    except asyncio.CancelledError:
        pass
    except Exception:
        pass


async def handle_record_start(request: web.Request) -> web.Response:
    state = _state(request)
    try:
        data = await _read_json(request)
    except ValueError as exc:
        return _error(str(exc))
    term = str(data.get("term", "")).strip()
    if not term or state.supervisor.get_terminal(term) is None:
        return _error("terminal not found", status=404)
    denied = await _gate_check(
        state, "core.terminal_mutation",
        {"action": "record-start", "term": term},
        intent_hash=data.get("intent_hash"))
    if denied:
        return denied
    rid = f"rec-{int(time.time()*1000)}"
    rec_dir = state.base / "recordings"
    rec_dir.mkdir(parents=True, exist_ok=True)
    path = rec_dir / f"{rid}.cast"
    # write header now (sync) so file always exists
    try:
        path.write_text(__import__("json").dumps({"version": 2, "width": 120, "height": 30, "timestamp": time.time()}) + chr(10), encoding="utf-8")
    except Exception as exc:
        return _error(str(exc))
    rec = {"id": rid, "term": term, "started": time.time(), "path": path, "state": state, "task": None, "stop": False, "prev_len": 0}
    rec["task"] = _aio.create_task(_record_loop(rec))
    _RECORDINGS[rid] = rec
    return web.json_response({"id": rid, "path": str(path)}, status=201)


async def handle_record_stop(request: web.Request) -> web.Response:
    rid = request.match_info.get("id", "").strip()
    rec = _RECORDINGS.get(rid)
    if rec is None:
        return _error("recording not found", status=404)
    denied = await _gate_check(
        rec["state"], "core.terminal_mutation",
        {"action": "record-stop", "term": rec.get("term", "")},
        intent_hash=request.query.get("intent_hash"))
    if denied:
        return denied
    rec["stop"] = True
    try:
        await rec["task"]
    except Exception:
        pass
    return web.json_response({"id": rid, "stopped": True, "path": str(rec["path"])})


async def handle_record_list(request: web.Request) -> web.Response:
    return web.json_response({"recordings": [{"id": r["id"], "term": r["term"], "path": str(r["path"])} for r in _RECORDINGS.values()]})


async def handle_record_read(request: web.Request) -> web.Response:
    rid = request.match_info.get("id", "").strip()
    rec = _RECORDINGS.get(rid)
    if rec is None:
        return _error("recording not found", status=404)
    path = rec["path"]
    if not path.exists():
        return _error("file missing", status=404)
    return web.Response(body=path.read_bytes(), headers={"Content-Type": "application/x-asciicast", "Content-Disposition": f'attachment; filename="{path.name}"'})


async def handle_note(request: web.Request) -> web.Response:
    state = _state(request)
    try:
        data = await _read_json(request)
        term_name = request.match_info.get("term") or _term(request, data)
    except ValueError as exc:
        return _error(str(exc))
    if not isinstance(term_name, str) or not term_name.strip():
        return _error("term required")
    term_name = term_name.strip()
    text = data.get("text")
    if text is None:
        text = ""
    if not isinstance(text, str):
        return _error("text must be string")
    term = state.supervisor.get_terminal(term_name)
    if term is None:
        return _error(f"terminal not found: {term_name}", status=404)
    denied = await _gate_check(
        state, "core.terminal_mutation",
        {"action": "terminal-note", "term": term.address,
         "text_sha": _payload_sha(text)},
        intent_hash=data.get("intent_hash"))
    if denied:
        return denied
    # store note on terminal object if dynamic attribute allowed; fallback labels['note']
    setattr(term, "note", text)
    term.labels["note"] = text
    term.note = text
    try:
        state.supervisor._save_registry()
    except Exception:
        pass
    return web.json_response(term.to_dict()) # note not in to_dict yet
# -- handled by next handler --



async def handle_dead_webhooks(request: web.Request) -> web.Response:
    state = _state(request)
    dead = getattr(state.supervisor, "dead_webhooks", [])
    return web.json_response({"webhooks": list(dead), "count": len(dead)})



async def handle_webhooks_pending(request: web.Request) -> web.Response:
    state = _state(request)
    pending = [dict(w) for w in state.supervisor.pending_webhooks]
    oldest = None
    if pending:
        oldest = min((float(w.get("ts", time.time())) for w in pending), default=None)
    return web.json_response({"webhooks": pending, "count": len(pending), "oldest_ts": oldest})



async def handle_event_types(request: web.Request) -> web.Response:
    try:
        from tools.nexus_core.events import KNOWN_EVENT_TYPES
        types = sorted(KNOWN_EVENT_TYPES)
    except Exception:
        types = []
    return web.json_response({"types": types})



async def handle_webhook_stats(request: web.Request) -> web.Response:
    state = _state(request)
    stats = _WEBHOOK_STATS
    return web.json_response({
        "sent": stats.get("sent",0),
        "failed": stats.get("failed",0),
        "dead": stats.get("dead",0),
        "pending": len(state.supervisor.pending_webhooks),
        "by_event": stats.get("by_event",{}),
    })


async def handle_webhook_test(request: web.Request) -> web.Response:
    state = _state(request)
    term_name = request.match_info.get("term") or None
    term = state.supervisor.get_terminal(term_name) if term_name else None
    if term is None:
        return _error(f"terminal not found: {term_name}", status=404)
    hooks = list(getattr(term, "lifecycle_webhooks", []))
    if not hooks:
        return _error("no hooks registered", status=404)
    denied = await _gate_check(
        state, "core.terminal_mutation",
        {"action": "on-event-test", "term": term.address},
        intent_hash=request.query.get("intent_hash"))
    if denied:
        return denied
    enqueued = 0
    for hook in hooks:
        events = hook.get("events") or []
        if events and "webhook_test" not in events:
            continue
        hp = dict(hook)
        hp["payload"] = {"event": "webhook_test", "address": term.address, "test": True, "ts": time.time()}
        try:
            state.supervisor.pending_webhooks.append(hp)
            enqueued += 1
        except Exception:
            pass
    state.supervisor._emit("webhook_test", {"address": term.address, "test": True})
    return web.json_response({"term": term.address, "enqueued": enqueued})



async def handle_config(request: web.Request) -> web.Response:
    import json as _jc
    import os, sys
    mod = globals()
    consts = {}
    for k, v in globals().items():
        if k.startswith("__") or not k.isupper():
            continue
        if isinstance(v, (int, float, str)) and not callable(v):
            consts[k] = v
    env = {}
    for k, v in os.environ.items():
        if k.upper().startswith("NEXUS_"):
            if any(t in k.upper() for t in ("TOKEN", "SECRET", "KEY", "PASSWORD")):
                env[k] = "***"
            else:
                env[k] = v
    return web.json_response({
        "version": "N3",
        "constants": consts,
        "env": env,
        "pump_interval_s": PUMP_INTERVAL_S if "PUMP_INTERVAL_S" in globals() else None,
    })



async def handle_health(request: web.Request) -> web.Response:
    state = _state(request)
    now = time.time()
    pump_age = now - getattr(state.supervisor, "last_step_ts", 0.0)
    drain_age = now - getattr(state, "last_drain_ts", 0.0)
    terminals = state.supervisor.list_terminals()
    pending = len(state.supervisor.pending_webhooks)
    dead = len(getattr(state.supervisor, "dead_webhooks", []))
    live_count = sum(1 for t in terminals if t.state not in ("exited", "archived"))
    return web.json_response({
        "version": "N3",
        "pump": {"alive": getattr(state.supervisor, "last_step_ts", 0.0) > 0 and pump_age < 5.0,
                 "last_tick_age_s": round(pump_age, 3),
                 "errors": getattr(state, "pump_errors", 0)},
        "drain": {"alive": getattr(state, "last_drain_ts", 0.0) > 0 and drain_age < 5.0,
                  "pending": pending, "dead": dead,
                  "last_tick_age_s": round(drain_age, 3)},
        "terminals": {"live": live_count, "total": len(terminals),
                      "exited": sum(1 for t in terminals if t.state == "exited")},
        "restore": {"done": int(getattr(state.supervisor, "_registry_restored", False)),
                     "failed": getattr(state.supervisor, "_restore_failed", 0)},
        "uptime_s": round(now - SERVER_START, 3),
    })



async def handle_webhook_requeue(request: web.Request) -> web.Response:
    state = _state(request)
    try:
        data = await _read_json(request)
    except ValueError as exc:
        return _error(str(exc))
    if data.get("confirm") is not True:
        return _error("confirm:true required (dangerous op)", status=400)
    url = data.get("url")
    idx = data.get("index")
    denied = await _gate_check(state, "core.terminal_mutation", {"action": "webhook-requeue"}, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    dead = getattr(state.supervisor, "dead_webhooks", [])
    to_move = []
    if idx is not None:
        try:
            i = int(idx)
        except (TypeError, ValueError):
            return _error("index must be int")
        if i < 0 or i >= len(dead):
            return _error("index out of range", status=404)
        to_move = [dead.pop(i)]
    elif url:
        url = str(url)
        to_move = [h for h in dead if h.get("url") == url]
        for h in to_move:
            try:
                dead.remove(h)
            except ValueError:
                pass
    else:
        to_move = list(dead)
        dead[:] = []
    count = 0
    for h in to_move:
        hook = dict(h)
        hook.pop("attempts", None)
        hook.pop("next_retry_at", None)
        hook["attempts"] = 0
        hook["next_retry_at"] = 0.0
        state.supervisor.pending_webhooks.append(hook)
        count += 1
    try:
        _WEBHOOK_STATS["requeued"] = _WEBHOOK_STATS.get("requeued", 0) + count
    except Exception:
        pass
    return web.json_response({"requeued": count, "dead_remaining": len(dead)})



async def handle_alerts(request: web.Request) -> web.Response:
    state = _state(request)
    try:
        limit = int(request.query.get("limit", "50"))
    except ValueError:
        return _error("limit must be integer", status=400)
    if limit < 1 or limit > 200:
        return _error("limit out of range 1..200", status=400)
    hist = getattr(state.supervisor, "alert_history", [])
    items = list(hist)[-limit:]
    rules = []
    try:
        from tools.nexus_core.alert_rules import load_rules
        rules = load_rules(getattr(state.supervisor, "alert_rules_path", None))
    except Exception:
        rules = []
    return web.json_response({"alerts": items, "count": len(hist), "rules_loaded": len(rules)})



async def handle_alert_rules(request: web.Request) -> web.Response:
    state = _state(request)
    try:
        from tools.nexus_core.alert_rules import load_rules
        file_rules = load_rules(getattr(state.supervisor, "alert_rules_path", None))
    except Exception:
        file_rules = []
    extra = getattr(state.supervisor, "alert_rules_extra", [])
    rules = list(file_rules) + list(extra)
    disabled = getattr(state.supervisor, "alert_rule_disabled", set())
    out = []
    for i, r in enumerate(rules):
        d = {"idx": i, "pattern": r.get("pattern"), "action": r.get("action"), "disabled": i in disabled, "runtime": bool(r.get("runtime", i >= len(file_rules)))}
        out.append(d)
    return web.json_response({"rules": out, "count": len(out)})


async def handle_alert_toggle(request: web.Request) -> web.Response:
    state = _state(request)
    try:
        idx_raw = request.match_info.get("idx", "")
        idx = int(idx_raw)
    except (TypeError, ValueError):
        return _error("invalid idx", status=400)
    try:
        data = await _read_json(request)
    except ValueError as exc:
        # allow empty
        data = {}
    # track idx max via rules
    from tools.nexus_core.alert_rules import load_rules
    rules = load_rules(getattr(state.supervisor, "alert_rules_path", None))
    if idx < 0 or idx >= len(rules):
        return _error("rule not found", status=404)
    enabled = data.get("enabled")
    if enabled is None:
        return _error("enabled required", status=400)
    denied = await _gate_check(state, "core.terminal_mutation", {"action": "alert-toggle", "idx": idx}, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    disabled = getattr(state.supervisor, "alert_rule_disabled", set())
    if enabled:
        disabled.discard(idx)
    else:
        disabled.add(idx)
    state.supervisor.alert_rule_disabled = disabled
    return web.json_response({"idx": idx, "disabled": idx in disabled})



async def handle_alert_rule_add(request: web.Request) -> web.Response:
    state = _state(request)
    try:
        data = await _read_json(request)
    except ValueError as exc:
        return _error(str(exc))
    pattern = data.get("pattern")
    action = data.get("action")
    if not (isinstance(pattern, str) and pattern.strip()):
        return _error("pattern required")
    if action not in ("notify", "label", "kill"):
        return _error("action must be notify/label/kill")
    # validate regex
    try:
        import re as _re
        _re.compile(pattern)
    except re.error:
        return _error("invalid regex pattern")
    rule = {"pattern": pattern, "action": action, "enabled": True, "runtime": True}
    if action == "label":
        label_key = data.get("label_key")
        label_value = data.get("label_value")
        if not (isinstance(label_key, str) and isinstance(label_value, str)):
            return _error("label_key and label_value required for label")
        rule["label_key"] = label_key
        rule["label_value"] = label_value
    denied = await _gate_check(state, "core.terminal_mutation", {"action": "alert-add", "pattern": pattern}, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    state.supervisor.alert_rules_extra.append(rule)
    try:
        state.supervisor._save_registry()
    except Exception:
        pass
    # index is last
    idx = len(load_rulesSafe := __import__("tools.nexus_core.alert_rules", fromlist=["load_rules"]).load_rules(getattr(state.supervisor, "alert_rules_path", None))) + len(state.supervisor.alert_rules_extra) - 1
    return web.json_response({"idx": idx, "rule": rule, "runtime": True}, status=201)



async def handle_diag(request: web.Request) -> web.Response:
    state = _state(request)
    now = time.time()
    terminals = state.supervisor.list_terminals()
    states = {}
    for t in terminals:
        states[t.state] = states.get(t.state, 0) + 1
    try:
        health_like = {
            "pump_alive": getattr(state.supervisor, "last_step_ts", 0.0) > 0 and now - getattr(state.supervisor, "last_step_ts", 0.0) < 5.0,
            "drain_alive": getattr(state, "last_drain_ts", 0.0) > 0 and now - getattr(state, "last_drain_ts", 0.0) < 5.0,
        }
    except Exception:
        health_like = {}
    stats = _WEBHOOK_STATS if "_WEBHOOK_STATS" in globals() else {}
    try:
        custom = _load_custom_spaces(state)
        spaces_count = len(custom.get("spaces", [])) + len({t.machine for t in terminals})
    except Exception:
        spaces_count = len({t.machine for t in terminals})
    rules = []
    try:
        from tools.nexus_core.alert_rules import load_rules
        rules = load_rules(getattr(state.supervisor, "alert_rules_path", None))
    except Exception:
        rules = []
    rules = list(rules) + list(getattr(state.supervisor, "alert_rules_extra", []))
    events_total = len(getattr(state.supervisor, "events", []))
    return web.json_response({
        "ts": round(now, 3),
        "version": "N3",
        "uptime_s": round(now - SERVER_START, 3),
        "health": health_like,
        "stats": {
            "sent": stats.get("sent", 0),
            "failed": stats.get("failed", 0),
            "dead": len(getattr(state.supervisor, "dead_webhooks", [])),
            "pending": len(state.supervisor.pending_webhooks),
        },
        "terminals": {"live": sum(1 for t in terminals if t.state not in ("exited", "archived")), "total": len(terminals), "exited": sum(1 for t in terminals if t.state == "exited"), "states": states},
        "spaces": spaces_count,
        "alerts": {"rules": len(rules), "history_count": len(getattr(state.supervisor, "alert_history", []))},
        "config": {"pump_interval_s": globals().get("PUMP_INTERVAL_S"), "rate_limit": globals().get("_RATE_LIMIT_MAX"), "scrollback_maxlen": 2000},
        "events_total": events_total,
    })



async def handle_input_log(request: web.Request) -> web.Response:
    state = _state(request)
    term_name = request.match_info.get("term")
    term = state.supervisor.get_terminal(term_name) if term_name else None
    if term is None:
        return _error(f"terminal not found: {term_name}", status=404)
    try:
        limit = int(request.query.get("limit", "100"))
    except ValueError:
        return _error("limit must be integer", status=400)
    if limit < 1 or limit > 500:
        return _error("limit out of range 1..500", status=400)
    entries = list(getattr(term, "input_log", []))[-limit:]
    return web.json_response({"term": term.address, "entries": entries, "count": len(entries)})



async def handle_events_cursor(request: web.Request) -> web.Response:
    state = _state(request)
    raw_since = request.query.get("since")
    try:
        since = float(raw_since) if raw_since is not None else 0.0
    except (TypeError, ValueError):
        return _error("since must be float", status=400)
    try:
        limit = int(request.query.get("limit", "200"))
    except ValueError:
        return _error("limit must be integer", status=400)
    if limit < 1 or limit > 1000:
        return _error("limit out of range 1..1000", status=400)
    history = []
    try:
        history = list(state.events.channel.replay(after_seq=None))
    except Exception:
        history = []
    if not history:
        history = list(state.supervisor.events)
    filtered = [e for e in history if float(e.get("ts", 0.0)) > since]
    filtered.sort(key=lambda e: float(e.get("ts", 0.0)))
    selected = filtered[:limit]
    cursor = since
    if selected:
        cursor = max(float(e.get("ts", since)) for e in selected)
    return web.json_response({
        "events": selected,
        "cursor": cursor,
        "total_seen": len(history),
    })



async def handle_ratelimit_view(request: web.Request) -> web.Response:
    out = []
    now = time.time()
    buckets = request.app.get("rate_limit_buckets") or {}
    for key, bucket in list(buckets.items()):
        active = [t for t in bucket if now - t < _RATE_LIMIT_WINDOW]
        masked = key
        if key != "anon" and len(key) > 6:
            masked = key[:6] + "..."
        oldest = min(active) if active else None
        out.append({"key": masked, "count": len(active), "oldest_ts": oldest})
    return web.json_response({
        "window_s": _RATE_LIMIT_WINDOW,
        "max": _RATE_LIMIT_MAX,
        "buckets": out,
    })



async def handle_children(request: web.Request) -> web.Response:
    state = _state(request)
    term_name = request.match_info.get("term") or request.query.get("term")
    term = state.supervisor.get_terminal(term_name) if term_name else None
    if term is None:
        return _error(f"terminal not found: {term_name}", status=404)
    children = []
    for t in state.supervisor.list_terminals():
        if getattr(t, "parent", None) == term.address or getattr(t, "parent", None) == term_name:
            children.append({"term": t.address, "state": t.state, "created_at": t.created_at})
    return web.json_response({"parent": term.address, "children": children, "count": len(children)})



async def handle_workspace_restore_preview(request: web.Request) -> web.Response:
    state = _state(request)
    ref = str(request.query.get("name") or request.query.get("file") or "")
    if not ref:
        return _error("name required", status=400)
    if not ref.endswith(".json"):
        ref = ref + ".json"
    if "/" in ref or "\\" in ref or ".." in ref:
        return _error("bad snapshot ref", status=400)
    path = _ws_dir(state) / ref
    if not path.is_file():
        return _error(f"snapshot not found: {ref}", status=404)
    try:
        snap = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return _error("corrupt snapshot", status=400)
    if snap.get("v") != 2:
        return _error("unsupported snapshot version", status=400)
    entries = snap.get("terminals") or []
    live = {t.address for t in state.supervisor.list_terminals()}
    would_spawn = []
    would_skip = []
    for e in entries:
        spec = e.get("spec") or {}
        name = str(spec.get("name") or "")
        if not name:
            continue
        addr = name if "/" in name else f"{state.supervisor.machine}/{name}"
        if addr in live:
            would_skip.append(name)
        else:
            would_spawn.append(name)
    return web.json_response({
        "name": snap.get("name"),
        "file": path.name,
        "would_spawn": would_spawn,
        "would_skip": would_skip,
        "spaces": snap.get("spaces", []),
        "conflicts": len(would_skip),
    })



async def handle_workspace_snapshot_get(request: web.Request) -> web.Response:
    """GET /api/core/workspace/snapshot/{name} — W90 export-read.

    Отдаёт содержимое слепка workspaces/<name>.json как JSON —
    вторая половина API-roundtrip (snapshot→import на другом
    инстансе). Read-only, path-traversal guard как у preview.
    """
    state = _state(request)
    ref = str(request.match_info.get("name") or "")
    if not ref:
        return _error("name required", status=400)
    if not ref.endswith(".json"):
        ref += ".json"
    if "/" in ref or "\\" in ref or ".." in ref:
        return _error("bad snapshot ref", status=400)
    path = _ws_dir(state) / ref
    if not path.is_file():
        return _error(f"snapshot not found: {ref}", status=404)
    try:
        snap = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return _error("corrupt snapshot", status=400)
    if snap.get("v") != 2:
        return _error("unsupported snapshot version", status=400)
    return web.json_response(snap)


async def handle_workspace_import(request: web.Request) -> web.Response:
    """POST /api/core/workspace/import — W90 import side of roundtrip.

    Body: snapshot-JSON v2 напрямую ИЛИ {"snapshot": {...}}.
    Валидирует v==2/terms-cap, пишет в workspaces/<name>.json
    (name из слепка, sanitize; коллизия → суффикс). После импорта
    доступны restore/preview + restore — полный API-roundtrip
    export A → import B без файловой системы. Gate
    core.file_mutation action="workspace-import".
    """
    state = _state(request)
    try:
        data = await _read_json(request)
    except ValueError as exc:
        return _error(str(exc))
    snap = data.get("snapshot") if isinstance(data, dict) else None
    if not isinstance(snap, dict):
        snap = data if isinstance(data, dict) else {}
    if snap.get("v") != 2 or not isinstance(snap.get("terminals"), list):
        return _error("snapshot must be v2 with terminals[]",
                      status=400)
    entries = snap["terminals"]
    if len(entries) > _WS_MAX_TERMS:
        return _error(f"too many terminals ({len(entries)} > "
                      f"{_WS_MAX_TERMS})", status=413)
    # имя файла: из слепка, иначе импорт-<ms>; только безопасные
    raw_name = str(snap.get("name") or "").strip()
    if raw_name and not re.fullmatch(r"[A-Za-z0-9_-]{1,64}",
                                     raw_name):
        raw_name = ""
    fname = (raw_name or f"import-{int(time.time()*1000)}") \
        + ".json"
    path = _ws_dir(state) / fname
    n = 1
    while path.exists():
        path = _ws_dir(state) / f"{fname[:-5]}-{n}.json"
        n += 1
    denied = await _gate_check(state, "core.file_mutation", {
        "action": "workspace-import", "file": path.name,
        "terms": len(entries),
        "spaces": len(snap.get("spaces") or [])},
        intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    path.write_text(json.dumps(snap, ensure_ascii=False,
                               indent=2, default=str),
                    encoding="utf-8")
    return web.json_response({
        "file": path.name, "terminals": len(entries),
        "spaces": len(snap.get("spaces") or [])},
        status=201)


async def handle_space_stats(request: web.Request) -> web.Response:
    state = _state(request)
    space_id = request.match_info.get("id")
    if not space_id:
        space_id = request.query.get("space")
    if not space_id:
        return _error("space required", status=400)
    terminals = [t for t in state.supervisor.list_terminals() if getattr(t, "machine", None) == space_id or (getattr(t, "labels", {}) or {}).get("space") == space_id]
    if not terminals:
        try:
            custom = _load_custom_spaces(state)
            known = {s.get("id") for s in custom.get("spaces", [])}
        except Exception:
            known = set()
        if space_id not in known:
            return _error(f"space not found: {space_id}", status=404)
    out_bytes = sum(len(getattr(t, "recent_output", "") or "") for t in terminals)
    states = {}
    for t in terminals:
        states[t.state] = states.get(t.state,0)+1
    return web.json_response({
        "space": space_id,
        "terms": len(terminals),
        "live": sum(1 for t in terminals if t.state not in ("exited","archived")),
        "exited": sum(1 for t in terminals if t.state=="exited"),
        "states": states,
        "out_bytes": out_bytes,
        "out_mb": round(out_bytes/(1024*1024),3),
        "labels": list({k:v for t in terminals for k,v in (getattr(t,"labels",{}) or {}).items()}.items()),
    })



async def handle_terminals_top(request: web.Request) -> web.Response:
    state = _state(request)
    by = request.query.get("by", "out_bytes")
    if by not in ("out_bytes", "uptime", "state_time"):
        return _error("bad by", status=400)
    try:
        limit = int(request.query.get("limit", "20"))
    except ValueError:
        return _error("limit must be integer", status=400)
    if limit < 1 or limit > 100:
        return _error("limit out of range 1..100", status=400)
    now = time.time()
    terms = list(state.supervisor.list_terminals())
    entries = []
    for t in terms:
        if by == "out_bytes":
            val = len(getattr(t, "recent_output", "") or "")
        elif by == "uptime":
            val = max(0.0, now - float(getattr(t, "created_at", now)))
        else:
            val = max(0.0, now - float(getattr(t, "last_output_at", now)))
        entries.append({"term": t.address, "state": t.state, "value": val})
    entries.sort(key=lambda e: e["value"], reverse=True)
    return web.json_response({"by": by, "entries": entries[:limit], "total": len(terms)})



async def handle_spaces_detail(request: web.Request) -> web.Response:
    state = _state(request)
    terminals = state.supervisor.list_terminals()
    spaces = []
    machines = sorted({t.machine for t in terminals})
    for machine in machines:
        members = [t.address for t in terminals if t.machine == machine or (getattr(t, "labels", {}) or {}).get("space") == machine]
        spaces.append({
            "id": machine,
            "terms": len(members),
            "live": sum(1 for a in members if not any(t.state in ("exited","archived") for t in terminals if t.address == a)),
            "labels": [k for t in terminals if t.machine == machine for k in (getattr(t, "labels", {}) or {}).keys()],
            "members": members,
        })
    # custom spaces merge
    try:
        custom = _load_custom_spaces(state)
        seen = {s.get("id") for s in spaces}
        for c in custom.get("spaces", []):
            if c.get("id") not in seen:
                spaces.append({"id": c.get("id"), "terms": 0, "live": 0, "labels": [], "members": []})
    except Exception:
        pass
    return web.json_response({"spaces": spaces, "count": len(spaces)})



async def handle_terminals_summary(request: web.Request) -> web.Response:
    state = _state(request)
    try:
        limit = int(request.query.get("limit", "50"))
    except ValueError:
        return _error("limit must be integer", status=400)
    if limit < 1 or limit > 500:
        return _error("limit out of range 1..500", status=400)
    terms = []
    for t in list(state.supervisor.list_terminals())[:limit]:
        lines = (t.recent_output or "").splitlines()
        last_line = lines[-1] if lines else ""
        terms.append({
            "name": t.name,
            "space": getattr(t, "space", None) or t.machine,
            "state": t.state,
            "last_line": last_line,
            "last_activity_ts": getattr(t, "last_output_at", None),
        })
    return web.json_response({"count": len(terms), "terminals": terms})


async def handle_interrupt(request: web.Request) -> web.Response:
    """POST /api/core/interrupt {term} — Esc-стоп программе."""
    state = _state(request)
    try:
        data = await _read_json(request)
        term = _term(request, data)
    except ValueError as exc:
        return _error(str(exc))
    denied = await _gate_check(state, "core.terminal_mutation",
                               {"action": "interrupt", "term": term}, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    if not state.supervisor.interrupt(term):
        return _error(f"terminal not found: {term}", status=404)
    return web.json_response({"term": term, "status": "interrupted"})


async def handle_state_export(request: web.Request) -> web.Response:
    state = _state(request)
    snapshot = {
        "terminals": [t.to_dict() for t in state.supervisor.list_terminals()],
        "spaces": [s.get("id") for s in _load_custom_spaces(state).get("spaces", [])],
        "version": "N3",
    }
    return web.json_response(snapshot)



async def handle_watch(request: web.Request) -> web.Response:
    state = _state(request)
    try:
        data = await _read_json(request)
        term_name = request.match_info.get("term") or _term(request, data)
    except ValueError as exc:
        return _error(str(exc))
    pattern = data.get("pattern")
    if not isinstance(pattern, str):
        return _error("pattern must be string")
    term = state.supervisor.get_terminal(term_name)
    if term is None:
        return _error(f"terminal not found: {term_name}", status=404)
    denied = await _gate_check(
        state, "core.terminal_mutation",
        {"action": "terminal-watch", "term": term.address,
         "pattern_sha": _payload_sha(pattern)},
        intent_hash=data.get("intent_hash"))
    if denied:
        return denied
    term.labels["_watch"] = pattern
    try:
        state.supervisor._save_registry()
    except Exception:
        pass
    return web.json_response({"term": term_name, "pattern": pattern})


async def handle_lock(request: web.Request) -> web.Response:
    state = _state(request)
    try:
        data = await _read_json(request)
        term_name = request.match_info.get("term") or _term(request, data)
    except ValueError as exc:
        return _error(str(exc))
    val = data.get("locked", None)
    if val is None:
        return _error("locked required", status=400)
    locked = bool(val)
    term = state.supervisor.get_terminal(term_name)
    if term is None:
        return _error(f"terminal not found: {term_name}", status=404)
    denied = await _gate_check(
        state, "core.terminal_mutation",
        {"action": "terminal-lock", "term": term.address,
         "locked": locked},
        intent_hash=data.get("intent_hash"))
    if denied:
        return denied
    term.locked = locked
    try:
        state.supervisor._save_registry()
    except Exception:
        pass
    return web.json_response({"term": term_name, "locked": term.locked})



async def handle_archive(request: web.Request) -> web.Response:
    state = _state(request)
    try:
        data = await _read_json(request)
        term_name = request.match_info.get("term") or _term(request, data)
    except ValueError as exc:
        return _error(str(exc))
    term = state.supervisor.get_terminal(term_name)
    if term is None:
        return _error(f"terminal not found: {term_name}", status=404)
    # best-effort freeze: drop recent/scrollback (+gz/pending, W96), archived, persist
    term.state = "archived"
    state.supervisor.scrollback_clear(term)
    try:
        state.supervisor._save_registry()
    except Exception:
        pass
    return web.json_response({"term": term_name, "archived": True})
    state = _state(request)
    try:
        data = await _read_json(request)
        term = _term(request, data)
    except ValueError as exc:
        return _error(str(exc))
    denied = await _gate_check(state, "core.terminal_mutation",
                               {"action": "interrupt", "term": term}, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    if not state.supervisor.interrupt(term):
        return _error(f"terminal not found: {term}", status=404)
    return web.json_response({"term": term, "status": "interrupted"})


async def handle_label(request: web.Request) -> web.Response:
    """POST /api/core/label {term, labels} — label K=V."""
    state = _state(request)
    try:
        data = await _read_json(request)
        term = _term(request, data)
        labels = data.get("labels")
        if not isinstance(labels, dict) or not labels:
            raise ValueError("labels object required")
    except ValueError as exc:
        return _error(str(exc))
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "label", "term": term,
        "labels": {str(k): str(v) for k, v in labels.items()},
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    try:
        state.supervisor.set_labels(term, {str(k): str(v) for k, v in labels.items()})
    except KeyError:
        return _error(f"terminal not found: {term}", status=404)
    return web.json_response({"term": term, "labels": labels})


async def handle_terminal_rename(request: web.Request) -> web.Response:
    """POST /api/core/terminal/{name}/rename {new_name} — #550.

    {name} — короткое имя или полный адрес machine/name (route .+).
    Переименование = смена ключа/адреса (display-name поля нет —
    `title` OSC-owned); registry перезаписывается → переживает рестарт.
    """
    state = _state(request)
    raw = request.match_info.get("name", "")
    try:
        data = await _read_json(request)
        new_name = data.get("new_name")
        if not isinstance(new_name, str) or not new_name.strip():
            raise ValueError("new_name required")
        new_name = new_name.strip()
    except ValueError as exc:
        return _error(str(exc))
    restoring = _terminal_restore_guard(state, raw)
    if restoring is not None:
        return restoring
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "rename", "term": raw, "new_name": new_name,
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    try:
        term = state.supervisor.rename_terminal(raw, new_name)
    except KeyError:
        return _error(f"terminal not found: {raw}", status=404)
    except ValueError as exc:
        return _error(str(exc), status=400)
    return web.json_response(term.to_dict())


async def handle_terminal_resize(request: web.Request) -> web.Response:
    """POST /api/core/terminal/{name}/resize {cols,rows}."""
    state = _state(request)
    raw = request.match_info.get("name", "")
    try:
        data = await _read_json(request)
        cols = _terminal_dim(data.get("cols"), "cols", 1, 65535)
        rows = _terminal_dim(data.get("rows"), "rows", 1, 65535)
    except ValueError as exc:
        return _error(str(exc), status=400)

    restoring = _terminal_restore_guard(state, raw)
    if restoring is not None:
        return restoring

    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "resize", "term": raw, "cols": cols, "rows": rows,
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied

    try:
        term = state.supervisor.resize_terminal(raw, cols, rows)
    except KeyError:
        return _error(f"terminal not found: {raw}", status=404)
    except ValueError as exc:
        return _error(str(exc), status=400)
    return web.json_response(term.to_dict())


async def handle_spawn_child(request: web.Request) -> web.Response:
    """POST /api/core/terminal/<name>/spawn-child — #566.

    Body: {"command": [argv], "name"?, "cwd"?, "die_with_parent"?}.
    Дочка создаётся обычным create_terminal path:
      parent = <parent.address> (полный адрес machine/name),
      die_with_parent = arg ?? true (false → переживает родителя,
        parent_lost-event),
      cwd = arg.cwd ?? parent.cwd — наследование по умолчанию
        (Herdr-семантика),
      name = arg.name ?? '<parent>-<N>' уникальное (_unique_term_name).
    Родитель обязан быть живым: exited/lost/restoring → 409 — дочка
    под мёртвым родителем была бы reaped на следующем тике step_once.
    """
    state = _state(request)
    raw = request.match_info.get("name", "")
    parent = state.supervisor.get_terminal(raw)
    if parent is None:
        return _error(f"terminal not found: {raw}", status=404)
    if parent.state == "restoring":
        return _error("parent terminal restoring", status=409)
    handle = parent.handle
    if (parent.state == "exited" or handle is None
            or not handle.alive()):
        return _error("parent terminal not running", status=409)
    try:
        data = await _read_json(request)
        command = data.get("command")
        if (not isinstance(command, list) or not command
                or not all(isinstance(c, str) and c for c in command)):
            raise ValueError("command must be a non-empty list of strings")
        name = data.get("name")
        if name is not None and not isinstance(name, str):
            raise ValueError("name must be a string")
        name = name.strip() if name else None
        cwd = data.get("cwd")
        if cwd is not None and not isinstance(cwd, str):
            raise ValueError("cwd must be a string")
        cwd = cwd.strip() if cwd else None
        die = data.get("die_with_parent")
        if die is not None and not isinstance(die, bool):
            raise ValueError("die_with_parent must be a boolean")
    except ValueError as exc:
        return _error(str(exc))
    if name is not None:
        if not VALID_NAME_RE.fullmatch(name):
            return _error(
                f"invalid terminal name {name!r} "
                "(1-32 of a-z 0-9 _ -)", status=400)
    else:
        try:
            name = _unique_term_name(state, parent.name)
        except ValueError as exc:
            return _error(str(exc), status=409)
    cwd_eff = cwd if cwd else parent.cwd
    die_eff = True if die is None else die
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "spawn-child", "parent": parent.address, "name": name,
        "command": [str(c) for c in command],
        "cwd": str(cwd_eff) if cwd_eff else None,
        "die_with_parent": die_eff,
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    try:
        term = state.supervisor.create_terminal(
            name=name,
            command=[str(c) for c in command],
            cwd=str(cwd_eff) if cwd_eff else None,
            parent=parent.address,
            die_with_parent=die_eff,
        )
    except Exception as exc:
        return _error(str(exc), status=409)
    return web.json_response(term.to_dict())


async def handle_terminal_send_file(request: web.Request) -> web.Response:
    """POST /api/core/terminal/<name>/send-file — file-drop + опц. send.

    Body: {"path": <src>} | {"content": <text>} |
    {"content_b64": <b64>}, "name"?, "send"?, "offset"?.
    Файл ложится в files/<machine>/<term>/<name> — тот же drop-каталог,
    что у putfile (#515):
      path    — источник ВНУТРИ FileOps-песочницы (абсолютные пути
                запрещены контрактом file_ops); имя по умолчанию —
                basename источника, бинарь копируется байт-в-байт.
      content — inline-текст (utf-8); имя по умолчанию "file.txt".
      content_b64 — base64-байты (бинарные чанки докачки).
      name    — обычное имя файла (без / \\ ..).
      send    — true → абсолютный путь вставляется в терминал
                (enter=false: путь остаётся на prompt, готов к
                использованию — семантика `put`).
      offset  — W55: байтовое смещение записи (только с
                content/content_b64; path → 400 при offset>0).
                Чанки с растущим offset = докачка; повторная
                отправка того же offset идемпотентна.
    """
    state = _state(request)
    term_addr = request.match_info.get("name", "")
    terminal = state.supervisor.get_terminal(term_addr)
    if terminal is None:
        return _error(f"terminal not found: {term_addr}", status=404)
    try:
        data = await _read_json(request)
    except ValueError as exc:
        return _error(str(exc))
    src = data.get("path")
    content = data.get("content")
    content_b64 = data.get("content_b64")
    payloads = [x is not None for x in (src, content, content_b64)]
    if sum(payloads) != 1:
        return _error(
            "exactly one of path, content or content_b64 required")
    send_flag = data.get("send", False)
    if not isinstance(send_flag, bool):
        return _error("send must be a boolean")
    offset = data.get("offset", 0)
    if (not isinstance(offset, int) or isinstance(offset, bool)
            or offset < 0):
        return _error("offset must be int >= 0")
    if offset and src is not None:
        return _error("offset only with content/content_b64")
    fname = data.get("name")
    if fname is not None:
        fname = str(fname).strip()
        if (not fname or fname in (".", "..")
                or "/" in fname or "\\" in fname):
            return _error("name must be a plain file name")
    machine = terminal.machine
    if _is_remote(machine):
        return _error(
            f"remote file drop not supported until N4: machine {machine!r}",
            status=501)
    if send_flag:
        restoring = _terminal_restore_guard(state, terminal.address)
        if restoring is not None:
            return restoring
    if src is not None:
        if not isinstance(src, str) or not src.strip():
            return _error("path must be a non-empty string")
        src = src.strip()
        try:
            raw = state.files.read_bytes(src)
        except FileOpsNotFound:
            return _error(f"source not found: {src}", status=404)
        except (FileOpsError, ValueError) as exc:
            return _error(str(exc))
        if not fname:
            fname = Path(src).name or "file"
    elif content is not None:
        if not isinstance(content, str):
            return _error("content must be a string")
        raw = content.encode("utf-8")
        if not fname:
            fname = "file.txt"
    else:
        # content_b64 — бинарный чанк докачки
        if not isinstance(content_b64, str):
            return _error("content_b64 must be a string")
        try:
            raw = base64.b64decode(content_b64, validate=True)
        except (binascii.Error, ValueError) as exc:
            return _error(f"content_b64 invalid: {exc}")
        if not fname:
            fname = "file.bin"
    if len(raw) > MAX_PUTFILE_BYTES:
        return _error(f"file exceeds {MAX_PUTFILE_BYTES} bytes",
                      status=413)
    rel = f"files/{machine}/{terminal.name}/{fname}"
    # file-мутация через gate; содержимое → sha256 (не в аудите),
    # send-флаг и имя — часть связываемого payload'а
    denied = await _gate_check(state, "core.file_mutation", {
        "action": "send-file", "path": rel, "machine": machine,
        "term": terminal.address, "name": fname, "bytes": len(raw),
        "send": send_flag, "offset": offset,
        "data_sha": hashlib.sha256(raw).hexdigest()[:16],
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    try:
        if offset or content_b64 is not None:
            # W55: chunk-запись по смещению (докачка)
            result = state.files.write_bytes_at(rel, offset, raw)
        else:
            result = state.files.write_bytes(rel, raw)
    except (FileOpsError, ValueError) as exc:
        return _error(str(exc))
    abs_path = str((state.files.root / rel).resolve())
    sent = False
    if send_flag:
        sent = state.supervisor.send(
            terminal.address, abs_path, enter=False)
    return web.json_response({
        "term": terminal.address,
        "machine": machine,
        "path": rel,
        "abs_path": abs_path,
        "bytes": result.get("bytes", result.get("written")),
        "offset": result.get("offset", 0),
        "size": result.get("size"),
        "sent": sent,
        "status": "delivered",
    })


async def handle_terminal_clone(request: web.Request) -> web.Response:
    """POST /api/core/terminal/<name>/clone — W4+W52.

    Body: {"name"?, "scrollback"?}. Новый терминал получает spec
    источника: command/cwd/env/labels/keep/machine/cols/rows.
    parent и die_with_parent НЕ копируются — клон siblings,
    не ребёнок. name = arg ?? '<src>-<N>' уникальное.
    W52: scrollback:true → копия scrollback источника в клон
    (deque до maxlen; recent_output тоже заполняется), markers
    не копируются.
    """
    state = _state(request)
    raw = request.match_info.get("name", "")
    src = state.supervisor.get_terminal(raw)
    if src is None:
        return _error(f"terminal not found: {raw}", status=404)
    try:
        data = await _read_json(request)
        name = data.get("name")
        if name is not None and not isinstance(name, str):
            raise ValueError("name must be a string")
        name = name.strip() if name else None
        with_scrollback = bool(data.get("scrollback", False))
    except ValueError as exc:
        return _error(str(exc))
    if name is not None:
        if not VALID_NAME_RE.fullmatch(name):
            return _error(
                f"invalid terminal name {name!r} "
                "(1-32 of a-z 0-9 _ -)", status=400)
    else:
        try:
            name = _unique_term_name(state, src.name)
        except ValueError as exc:
            return _error(str(exc), status=409)
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "clone", "source": src.address, "name": name,
        "machine": src.machine, "scrollback": with_scrollback,
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    try:
        term = state.supervisor.create_terminal(
            name=name,
            command=list(src.command) if src.command else None,
            cwd=src.cwd,
            env=dict(src.env) if src.env else None,
            labels=dict(src.labels),
            machine=src.machine,
            keep=src.keep,
            cols=src.cols,
            rows=src.rows,
        )
    except Exception as exc:
        return _error(str(exc), status=409)
    if with_scrollback:
        # W52: копия scrollback — deque сам режет по maxlen;
        # recent_output = хвост (как у живого терминала).
        src_lines = (scrollback_all(src)
                     or src.recent_output.splitlines())
        state.supervisor.scrollback_extend(term, src_lines)
        tail = "\n".join(src_lines[-50:])
        term.recent_output = tail[-RECENT_OUTPUT_CAP:]
    return web.json_response(term.to_dict())


# -- replay-input (W20) ------------------------------------------------------


async def _replay_inputs(state, address: str, entries: list,
                         delay_ms: float) -> None:
    """W20: фоновый прогон input_log на новом терминале.

    send() пишет в input_log нового терминала — replay цепочкой
    работает (replay-of-replay). Мёртвый терминал → send()=False,
    запись пропускается.
    """
    delay = max(0.0, delay_ms) / 1000.0
    for e in entries:
        if delay:
            await asyncio.sleep(delay)
        try:
            state.supervisor.send(
                address, e["text"], enter=bool(e.get("enter", True)))
        except Exception:
            break  # терминал исчез — дальше бессмысленно


async def handle_terminal_replay(request: web.Request) -> web.Response:
    """POST /api/core/terminal/<name>/replay — W20.

    Повторяет send-последовательность источника на НОВОМ терминале:
    спавнится терминал (command/cwd/env/labels по умолчанию = spec
    источника, как clone) и в фоне прогоняется его input_log
    (записи {ts,text,enter} из SupervisorV1.send — /send,
    send-broadcast; pipe/keys не пишутся).

    Body: {"name"?, "command"?, "cwd"?, "env"?, "labels"?,
           "delay_ms"?}. name = arg ?? '<src>-replay-<N>'.
    Ответ term.to_dict() + {replayed, source, replay:"scheduled"}.
    Gate core.terminal_mutation action="replay".
    """
    state = _state(request)
    raw = request.match_info.get("name", "")
    src = state.supervisor.get_terminal(raw)
    if src is None:
        return _error(f"terminal not found: {raw}", status=404)
    try:
        data = await _read_json(request)
        name = data.get("name")
        if name is not None and not isinstance(name, str):
            raise ValueError("name must be a string")
        name = name.strip() if name else None
        command = data.get("command")
        if command is not None and (
                not isinstance(command, list)
                or not all(isinstance(c, str) for c in command)):
            raise ValueError("command must be list[str]")
        delay_ms = data.get("delay_ms", 0)
        delay_ms = float(delay_ms)
        if delay_ms < 0:
            raise ValueError("delay_ms must be >= 0")
    except (ValueError, TypeError) as exc:
        return _error(str(exc))
    if name is not None:
        if not VALID_NAME_RE.fullmatch(name):
            return _error(
                f"invalid terminal name {name!r} "
                "(1-32 of a-z 0-9 _ -)", status=400)
    else:
        try:
            name = _unique_term_name(state, f"{src.name}-replay")
        except ValueError as exc:
            return _error(str(exc), status=409)
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "replay", "source": src.address, "name": name,
        "replayed": len(src.input_log),
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    try:
        term = state.supervisor.create_terminal(
            name=name,
            command=(list(command) if command
                     else (list(src.command) if src.command else None)),
            cwd=data.get("cwd") or src.cwd,
            env=(dict(data["env"]) if isinstance(data.get("env"), dict)
                 else (dict(src.env) if src.env else None)),
            labels=(dict(data["labels"])
                    if isinstance(data.get("labels"), dict)
                    else dict(src.labels)),
            machine=src.machine,
            keep=src.keep,
            cols=src.cols,
            rows=src.rows,
        )
    except Exception as exc:
        return _error(str(exc), status=409)
    entries = list(src.input_log)
    if entries:
        asyncio.create_task(_replay_inputs(
            state, term.address, entries, delay_ms))
    out = term.to_dict()
    out["replayed"] = len(entries)
    out["source"] = src.address
    out["replay"] = "scheduled" if entries else "empty"
    return web.json_response(out)


_REPLAY_FILE_MAX_LINES = 1000
_REPLAY_FILE_MAX_BYTES = 1024 * 1024


async def handle_replay_file(request: web.Request) -> web.Response:
    """POST /api/core/replay-file — W40 replay команд из файла.

    {"file": "<sandbox-rel>", "name"?, "command"?, "cwd"?,
     "env"?, "labels"?, "delay_ms"?, "machine"?}
    Файл читается через FileOps-песочницу (state-base, ≤1MB);
    команды = строки: пустые и '#'-комментарии пропускаются,
    \r срезается, cap 1000 строк. Каждая → send(text, enter=True)
    на новом терминале в фоне (как W20 replay). name = arg ??
    'replay-file-<N>'. Gate core.terminal_mutation
    action="replay-file".
    """
    state = _state(request)
    try:
        data = await _read_json(request)
        path = data.get("file")
        if not isinstance(path, str) or not path.strip():
            raise ValueError("file required (sandbox-relative path)")
        name = data.get("name")
        if name is not None and not isinstance(name, str):
            raise ValueError("name must be a string")
        name = name.strip() if name else None
        command = data.get("command")
        if command is not None and (
                not isinstance(command, list)
                or not all(isinstance(c, str) for c in command)):
            raise ValueError("command must be list[str]")
        delay_ms = float(data.get("delay_ms", 0))
        if delay_ms < 0:
            raise ValueError("delay_ms must be >= 0")
    except (ValueError, TypeError) as exc:
        return _error(str(exc))
    try:
        raw = state.files.read_bytes(
            path.strip(), max_bytes=_REPLAY_FILE_MAX_BYTES)
    except FileOpsNotFound as exc:
        return _error(str(exc), status=404)
    except (FileOpsError, ValueError) as exc:
        return _error(str(exc), status=400)
    text = raw.decode("utf-8", errors="replace")
    entries = [{"text": ln.strip(), "enter": True}
               for ln in text.splitlines()
               if ln.strip() and not ln.strip().startswith("#")
               ][:_REPLAY_FILE_MAX_LINES]
    if not entries:
        return _error("no commands in file", status=400)
    if name is not None:
        if not VALID_NAME_RE.fullmatch(name):
            return _error(
                f"invalid terminal name {name!r} "
                "(1-32 of a-z 0-9 _ -)", status=400)
    else:
        try:
            name = _unique_term_name(state, "replay-file")
        except ValueError as exc:
            return _error(str(exc), status=409)
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "replay-file", "file": path.strip(),
        "name": name, "commands": len(entries)},
        intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    try:
        term = state.supervisor.create_terminal(
            name=name,
            command=(list(command) if command else None),
            cwd=data.get("cwd"),
            env=(dict(data["env"]) if isinstance(data.get("env"), dict)
                 else None),
            labels=(dict(data["labels"])
                    if isinstance(data.get("labels"), dict)
                    else None),
            machine=data.get("machine"),
        )
    except Exception as exc:
        return _error(str(exc), status=409)
    asyncio.create_task(_replay_inputs(
        state, term.address, entries, delay_ms))
    out = term.to_dict()
    out["replayed"] = len(entries)
    out["file"] = path.strip()
    out["replay"] = "scheduled"
    return web.json_response(out)


# W6: секреты в env не покидают API — значения *_KEY|*_TOKEN|*_SECRET
# (и точные KEY/TOKEN/SECRET) маскируются; MONKEY и прочие ложные
# срабатывания не трогаем — паттерн требует '_' или начало строки.
_SECRET_ENV_RE = re.compile(r"(?:^|_)(?:KEY|TOKEN|SECRET)$", re.IGNORECASE)


def _masked_env(env: Optional[dict]) -> dict:
    if not env:
        return {}
    return {
        str(k): ("***" if _SECRET_ENV_RE.search(str(k)) else v)
        for k, v in env.items()
    }


async def handle_terminal_info(request: web.Request) -> web.Response:
    """GET /api/core/terminal/<name>/info — W6: полная спека терминала.

    to_dict + env с маскировкой секретов (*_KEY|*_TOKEN|*_SECRET →
    "***"). Read-only — gate не нужен (как screen/dump)."""
    state = _state(request)
    raw = request.match_info.get("name", "")
    term = state.supervisor.get_terminal(raw)
    if term is None:
        return _error(f"terminal not found: {raw}", status=404)
    data = term.to_dict()
    data["env"] = _masked_env(term.env)
    return web.json_response(data)


# -- export/import (W22/W23) -------------------------------------------------


async def handle_terminal_export(request: web.Request) -> web.Response:
    """GET /api/core/terminal/<n>/export — W22.

    {"v":1,"exported_at","spec","scrollback","recent_output",
    "env_masked"}. spec — SNAPSHOT_SPEC_KEYS + name; env МАСИИРОВАН
    (_masked_env — GET не должен отдавать секреты; W23-import
    получит "***"-плейсхолдеры, не оригиналы). scrollback — deque
    или recent_output-fallback (как dump). Read-only, без gate.
    """
    state = _state(request)
    raw = request.match_info.get("name", "")
    term = state.supervisor.get_terminal(raw)
    if term is None:
        return _error(f"terminal not found: {raw}", status=404)
    spec = {key: getattr(term, key) for key in SNAPSHOT_SPEC_KEYS}
    spec["name"] = term.name
    spec["env"] = _masked_env(term.env)
    scrollback = (scrollback_all(term)
                  or term.recent_output.splitlines())
    # W42: format=bundle → tar.gz (spec.json+scrollback.txt+meta.json)
    if request.query.get("format") == "bundle":
        import io
        import tarfile
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tf:
            def _add(arc: str, payload: bytes) -> None:
                info = tarfile.TarInfo(arc)
                info.size = len(payload)
                tf.addfile(info, io.BytesIO(payload))
            _add("spec.json", json.dumps(
                {"v": 1, "exported_at": time.time(), "spec": spec},
                ensure_ascii=False, indent=2).encode("utf-8"))
            _add("scrollback.txt",
                 ("\n".join(scrollback)).encode("utf-8"))
            _add("meta.json", json.dumps({
                "term": term.address, "state": term.state,
                "scrollback_lines": len(scrollback),
                "exported_at": time.time(),
                "env_masked": bool(term.env)},
                ensure_ascii=False, indent=2).encode("utf-8"))
        fname = f"{term.name}-export.tar.gz"
        return web.Response(
            body=buf.getvalue(), content_type="application/gzip",
            headers={"Content-Disposition":
                     f'attachment; filename="{fname}"'})
    return web.json_response({
        "v": 1,
        "exported_at": time.time(),
        "spec": spec,
        "scrollback": scrollback,
        "scrollback_lines": len(scrollback),
        "recent_output": term.recent_output,
        "env_masked": bool(term.env),
    })


# -- snapshot / restore (W7) -------------------------------------------------

SNAPSHOT_SPEC_KEYS = (
    "command", "cwd", "env", "labels", "keep", "machine",
    "cols", "rows", "parent", "die_with_parent", "outlive_parent",
)


async def handle_terminal_snapshot(request: web.Request) -> web.Response:
    """POST /api/core/terminal/<name>/snapshot — W7.

    Пишет snapshots/<name>-<ms>.json в state-base (FileOps-песочница):
    {"v":1, "snap_ts", "spec": {…SNAPSHOT_SPEC_KEYS…, "name"},
     "scrollback": [строки]}. scrollback — deque или recent_output
    fallback (как dump). env в снапшоте — сырой (как в registry.json —
    persistence-граница уже хранит env)."""
    state = _state(request)
    raw = request.match_info.get("name", "")
    term = state.supervisor.get_terminal(raw)
    if term is None:
        return _error(f"terminal not found: {raw}", status=404)
    rel = f"snapshots/{term.name}-{int(time.time() * 1000)}.json"
    data: dict = {}
    try:
        if request.can_read_body:
            data = await _read_json(request)
    except ValueError:
        data = {}  # тело опционально — snapshot работает и с пустым POST
    denied = await _gate_check(state, "core.file_mutation", {
        "action": "snapshot", "path": rel, "machine": term.machine,
        "term": term.address,
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    scrollback = (scrollback_all(term)
                  or term.recent_output.splitlines())
    spec = {key: getattr(term, key) for key in SNAPSHOT_SPEC_KEYS}
    spec["name"] = term.name
    payload = {
        "v": 1,
        "snap_ts": time.time(),
        "spec": spec,
        "scrollback": scrollback,
    }
    try:
        result = state.files.write(
            rel, json.dumps(payload, ensure_ascii=False))
    except (FileOpsError, ValueError) as exc:
        return _error(str(exc))
    abs_path = str((state.files.root / rel).resolve())
    return web.json_response({
        "term": term.address,
        "path": rel,
        "abs_path": abs_path,
        "bytes": result["bytes"],
        "scrollback_lines": len(scrollback),
        "status": "snapshotted",
    })


async def handle_terminal_restore_snapshot(request: web.Request) -> web.Response:
    """POST /api/core/terminal/<name>/restore-snapshot {"file"} — W7.

    <name> — имя НОВОГО терминала (VALID_NAME_RE, dup → 409).
    file — sandbox-relative путь к snapshot-JSON (snapshots/…).
    Терминал создаётся по spec снапшота; scrollback → recent_output
    (+ scrollback deque) — экран выглядит как на момент снапшота.
    Ответ to_dict + {"restored": true, "snapshot": file}."""
    state = _state(request)
    name = request.match_info.get("name", "")
    if not VALID_NAME_RE.fullmatch(name):
        return _error(
            f"invalid terminal name {name!r} "
            "(1-32 of a-z 0-9 _ -)", status=400)
    try:
        data = await _read_json(request)
        file_rel = data.get("file")
        if not isinstance(file_rel, str) or not file_rel.strip():
            raise ValueError("file required")
        file_rel = file_rel.strip()
    except ValueError as exc:
        return _error(str(exc))
    try:
        raw = state.files.read_bytes(file_rel)
    except FileOpsNotFound:
        return _error(f"snapshot not found: {file_rel}", status=404)
    except (FileOpsError, ValueError) as exc:
        return _error(str(exc))
    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return _error("snapshot: invalid JSON", status=400)
    spec = payload.get("spec") if isinstance(payload, dict) else None
    scrollback = payload.get("scrollback") if isinstance(payload, dict) else None
    if not isinstance(spec, dict) or not isinstance(scrollback, list):
        return _error("snapshot: spec/scrollback missing", status=400)
    machine = spec.get("machine") or state.supervisor.machine
    if machine != state.supervisor.machine:
        return _error(
            f"remote restore unsupported: machine {machine!r}", status=400)
    command = spec.get("command")
    if command is not None and not (
            isinstance(command, list)
            and all(isinstance(c, str) for c in command)):
        return _error("snapshot: invalid command", status=400)
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "restore-snapshot", "name": name, "file": file_rel,
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    try:
        term = state.supervisor.create_terminal(
            name=name,
            command=[str(c) for c in command] if command else None,
            cwd=spec.get("cwd"),
            env=spec.get("env") if isinstance(spec.get("env"), dict) else None,
            labels={str(k): str(v) for k, v in
                    (spec.get("labels") or {}).items()
                    if isinstance(k, str) and isinstance(v, str)},
            keep=spec.get("keep") if isinstance(spec.get("keep"), bool) else None,
            machine=state.supervisor.machine,
            parent=spec.get("parent") if isinstance(spec.get("parent"), str) else None,
            die_with_parent=spec.get("die_with_parent")
            if isinstance(spec.get("die_with_parent"), bool) else None,
            outlive_parent=bool(spec.get("outlive_parent")),
            cols=int(spec.get("cols") or 120),
            rows=int(spec.get("rows") or 30),
        )
    except Exception as exc:
        return _error(str(exc), status=409)
    lines = [str(x) for x in scrollback]
    state.supervisor.scrollback_extend(term, lines)
    term.recent_output = "\n".join(lines)[-RECENT_OUTPUT_CAP:]
    state.supervisor._save_registry()
    out = term.to_dict()
    out["restored"] = True
    out["snapshot"] = file_rel
    return web.json_response(out)


_IMPORT_MAX_SCROLLBACK = 5000


def _validate_import(data: dict) -> tuple[Optional[dict],
                                      Optional[list],
                                      Optional[str], list[str]]:
    """W43: schema-check import-payload → (spec, scrollback, name,
    errors). Строгая типизация; errors непустой → 400 details."""
    errors: list[str] = []
    spec = data.get("spec")
    scrollback = data.get("scrollback")
    if not isinstance(spec, dict):
        errors.append("spec must be an object")
        spec = None
    if not isinstance(scrollback, list):
        errors.append("scrollback must be a list")
        scrollback = None
    elif scrollback and not all(isinstance(x, str) for x in scrollback):
        bad = next(i for i, x in enumerate(scrollback)
                   if not isinstance(x, str))
        errors.append(f"scrollback[{bad}] must be a string")
    name = data.get("name") or (spec or {}).get("name")
    if name is not None and not isinstance(name, str):
        errors.append("name must be a string")
        name = None
    if spec is not None:
        def _chk(key, pred, desc):
            v = spec.get(key)
            if v is not None and not pred(v):
                errors.append(f"spec.{key} {desc}")
        _chk("command",
             lambda v: isinstance(v, list) and all(
                 isinstance(c, str) for c in v),
             "must be list[str]")
        _chk("cwd", lambda v: isinstance(v, str), "must be string")
        _chk("env", lambda v: isinstance(v, dict),
             "must be object")
        _chk("labels", lambda v: isinstance(v, dict) and all(
            isinstance(k, str) and isinstance(x, str)
            for k, x in v.items()),
            "must be object of string pairs")
        for bk in ("keep", "die_with_parent", "outlive_parent"):
            _chk(bk, lambda v: isinstance(v, bool), "must be bool")
        for ik in ("cols", "rows"):
            _chk(ik, lambda v: isinstance(v, int)
                 and not isinstance(v, bool) and 1 <= v <= 500,
                 "must be int 1..500")
        for sk in ("machine", "parent", "note", "title", "name"):
            _chk(sk, lambda v: isinstance(v, str), "must be string")
        # env values — скаляры (str/num/bool), не вложенные объекты
        env_v = spec.get("env")
        if isinstance(env_v, dict):
            for k, v in env_v.items():
                if not isinstance(k, str) or not isinstance(
                        v, (str, int, float, bool)):
                    errors.append(
                        f"spec.env[{k!r}] must be scalar")
                    break
    if errors:
        return None, None, None, errors
    if scrollback is not None and len(scrollback) > _IMPORT_MAX_SCROLLBACK:
        scrollback = scrollback[:_IMPORT_MAX_SCROLLBACK]
    return spec, scrollback, name, []


async def handle_terminal_import(request: web.Request) -> web.Response:
    """POST /api/core/terminal/import — W23+W43.

    Body = export-JSON (W22) ИЛИ snapshot-JSON (W7): оба имеют
    {spec, scrollback} — формат совместим. W43: строгий
    schema-check (_validate_import) — типы/границы всех полей,
    ошибки → 400 {error, details[]}. Опциональный top-level
    "name" переопределяет spec.name; без имени — spec.name, без
    него → 400. dup → 409 (create_terminal).

    env: значения "***" у секретных ключей (*_KEY|*_TOKEN|*_SECRET)
    отбрасываются — импорт не может восстановить замаскированные
    секреты (export маскирует их by design). parent/die_with_parent
    НЕ восстанавливаются — импорт = свежий spawn без связей.
    scrollback → deque + recent_output (как restore-snapshot).
    Gate core.terminal_mutation action="import-terminal".
    """
    state = _state(request)
    try:
        data = await _read_json(request)
    except ValueError as exc:
        return _error(str(exc))
    spec, scrollback, name, errors = _validate_import(data)
    if errors:
        return web.json_response(
            {"error": "import schema check failed",
             "details": errors}, status=400)
    if name is None or not name.strip():
        return _error("import: name required (top-level or spec.name)")
    name = name.strip()
    if not VALID_NAME_RE.fullmatch(name):
        return _error(
            f"invalid terminal name {name!r} "
            "(1-32 of a-z 0-9 _ -)", status=400)
    machine = spec.get("machine") or state.supervisor.machine
    if machine != state.supervisor.machine:
        return _error(
            f"remote import unsupported: machine {machine!r}",
            status=400)
    command = spec.get("command")
    if command is not None and not (
            isinstance(command, list)
            and all(isinstance(c, str) for c in command)):
        return _error("import: invalid command", status=400)
    env = spec.get("env")
    if isinstance(env, dict):
        env = {
            str(k): v for k, v in env.items()
            if not (_SECRET_ENV_RE.search(str(k)) and v == "***")
        }
    else:
        env = None
    denied = await _gate_check(state, "core.terminal_mutation", {
        "action": "import-terminal", "name": name,
        "scrollback_lines": len(scrollback),
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    try:
        term = state.supervisor.create_terminal(
            name=name,
            command=[str(c) for c in command] if command else None,
            cwd=spec.get("cwd"),
            env=env,
            labels={str(k): str(v) for k, v in
                    (spec.get("labels") or {}).items()
                    if isinstance(k, str) and isinstance(v, str)},
            keep=spec.get("keep")
            if isinstance(spec.get("keep"), bool) else None,
            machine=state.supervisor.machine,
            cols=int(spec.get("cols") or 120),
            rows=int(spec.get("rows") or 30),
        )
    except Exception as exc:
        return _error(str(exc), status=409)
    lines = [str(x) for x in scrollback]
    state.supervisor.scrollback_extend(term, lines)
    term.recent_output = "\n".join(lines)[-RECENT_OUTPUT_CAP:]
    state.supervisor._save_registry()
    out = term.to_dict()
    out["imported"] = True
    out["scrollback_lines"] = len(lines)
    out["env_dropped_masked"] = isinstance(spec.get("env"), dict) and any(
        _SECRET_ENV_RE.search(str(k)) and v == "***"
        for k, v in spec["env"].items())
    return web.json_response(out)


# -- события (SSE) ---------------------------------------------------------

async def handle_events(request: web.Request) -> web.Response:
    """GET /api/core/events[?types=a,b,c] — SSE-поток событий.

    #570: types — csv-фильтр по типам событий (пробелы/пустые
    отбрасываются); неизвестный тип → 400 со списком известных.
    Пустой/отсутствующий types — весь поток (совместимость).
    """
    state = _state(request)
    # HERETIC #414 E-4: subscriber cap — переполнение отклоняем до prepare,
    # чтобы клиент получил честный 503, а не оборванный поток.
    if state.events.channel.subscriber_count >= MAX_SUBSCRIBERS:
        return _error("SSE subscriber cap reached", status=503)
    last_event_id = request.headers.get("Last-Event-ID")
    wanted: Optional[set] = None
    types_raw = request.query.get("types")
    if types_raw is not None:
        wanted = set()
        unknown = []
        for part in types_raw.split(","):
            t = part.strip()
            if not t:
                continue
            if t not in KNOWN_EVENT_TYPES:
                unknown.append(t)
            else:
                wanted.add(t)
        if unknown:
            return web.json_response({
                "error": f"unknown event type(s): {', '.join(unknown)}",
                "known_types": sorted(KNOWN_EVENT_TYPES),
            }, status=400)
        if not wanted:
            wanted = None  # types= или только разделители → весь поток

    response = web.StreamResponse(
        status=200,
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )
    await response.prepare(request)
    try:
        async for data in state.events.stream(last_event_id, types=wanted):
            # EventChannel assigns a monotonic seq and includes it in the
            # JSON payload. Mirror it into the SSE id field so clients can
            # resume with Last-Event-ID.
            if data.startswith("event: "):
                data_line = next(
                    (line[6:] for line in data.splitlines()
                     if line.startswith("data: ")),
                    None,
                )
                if data_line is not None:
                    try:
                        event = json.loads(data_line)
                    except (TypeError, ValueError):
                        event = None
                    seq = event.get("seq") if isinstance(event, dict) else None
                    if type(seq) is int and seq > 0:
                        data = f"id: {seq}\n{data}"
            await response.write(data.encode("utf-8"))
    except asyncio.CancelledError:
        pass
    except Exception:
        pass
    finally:
        try:
            await response.write_eof()
        except (ConnectionError, RuntimeError):
            # SSE clients routinely close their stream before server cleanup.
            pass
    return response


# -- doc API ----------------------------------------------------------------

async def handle_doc_get(request: web.Request) -> web.Response:
    """GET /api/core/doc[?version=N] — версия документа (latest по умолчанию)."""
    state = _state(request)
    version = request.query.get("version")
    try:
        version = int(version) if version is not None else None
    except ValueError:
        return _error("version must be an integer")
    doc = state.doc.get(version)
    if doc is None:
        return _error("version not found", status=404)
    return web.json_response(doc)


async def handle_doc_latest(request: web.Request) -> web.Response:
    """GET /api/core/doc/latest — последняя версия документа."""
    state = _state(request)
    doc = state.doc.latest()
    if doc is None:
        return _error("no document yet", status=404)
    return web.json_response(doc)


async def handle_doc_put(request: web.Request) -> web.Response:
    """PUT/POST /api/core/doc {content, base_version?} — сохранить версию.

    CAS: если задан base_version и он ≠ текущей latest — конфликт (409),
    запись отклоняется (RFC-001 §16). При успехе эмитится событие `doc`.
    """
    state = _state(request)
    try:
        data = await _read_json(request)
        content = data.get("content")
        if not isinstance(content, str):
            raise ValueError("content (string) required")
        base_version = data.get("base_version")
        if base_version is not None:
            base_version = int(base_version)
    except ValueError as exc:
        return _error(str(exc))
    # #469b: doc-мутация через gate; content → sha (может быть большим)
    denied = await _gate_check(state, "core.doc_mutation", {
        "action": "doc_put", "content_sha": _payload_sha(content),
        "content_len": len(content), "base_version": base_version,
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    try:
        version = state.doc.put(content, base_version=base_version)
    except DocConflictError as exc:
        return _error(str(exc), status=409)
    state.events.channel.publish(
        {"type": "doc", "address": "local/doc", "version": version}
    )
    return web.json_response({"version": version, "status": "saved", "latest": version})


# -- templates --------------------------------------------------------------

async def handle_templates(request: web.Request) -> web.Response:
    """GET /api/core/templates — список .md-персон."""
    state = _state(request)
    templates = [t.to_dict() for t in state.templates.list_templates()]
    return web.json_response({
        "templates": templates,
        "count": len(templates),
        "directory": str(state.templates.directory),
    })


async def handle_template_run(request: web.Request) -> web.Response:
    """POST /api/core/templates/<name>/run {args} — запуск шаблона."""
    state = _state(request)
    name = request.match_info["name"]
    template = state.templates.get(name)
    if template is None:
        return _error(f"invalid_template: {name}", status=404)
    try:
        data = await _read_json(request)
        args = data.get("args") or []
        if not isinstance(args, list):
            raise ValueError("args must be a list")
        # W59: vars — {имя: скаляр} для {var}-плейсхолдеров
        # в command/body. Декларированные params обязательны.
        variables = data.get("vars") or {}
        if not isinstance(variables, dict):
            raise ValueError("vars must be an object")
        variables = {str(k): v for k, v in variables.items()
                     if isinstance(v, (str, int, float, bool))}
        missing = [p for p in template.params
                   if p not in variables]
        if missing:
            return _error(
                "missing template params: " + ", ".join(missing),
                status=400)
        term = data.get("term") or f"tpl-{name}-{int(time.time() * 1000) % 100000}"
    except ValueError as exc:
        return _error(str(exc))
    # #469b/#472: template-run создаёт терминал и шлёт body+args агенту —
    # отдельный op-класс core.template_mutation (исполнимый шаблон ≠
    # doc-мутация); args → sha.
    denied = await _gate_check(state, "core.template_mutation", {
        "action": "template_run", "name": name,
        "args_sha": _payload_sha(args), "args_count": len(args),
        "term": str(term),
    }, intent_hash=data.get("intent_hash"))
    if denied is not None:
        return denied
    # W59: {var}-подстановка в command и body
    command, rendered_body = template.render(variables)
    if not command:
        command = ["sh"]
    try:
        terminal = state.supervisor.create_terminal(
            name=str(term),
            command=command,
            labels={"template": name},
        )
    except Exception as exc:
        return _error(str(exc), status=409)
    # Ждём первый OSC-статус без блокировки aiohttp event loop. Если pump
    # включён — он один читает PTY; в тестовом app без pump шаг делаем в thread.
    await _wait_template_ready(request.app, state, terminal.address)
    message = rendered_body
    if args:
        message = message + "\n" + " ".join(str(a) for a in args)
    state.supervisor.send(terminal.address, message)
    # Оборота (handoff) завершён: тело шаблона + argv отправлены агенту.
    state.events.channel.publish(
        {"type": "turn", "address": terminal.address, "template": name}
    )
    return web.json_response(terminal.to_dict())


async def _wait_template_ready(app: web.Application, state: AppState,
                               address: str, timeout: float = 15.0) -> bool:
    deadline = time.monotonic() + timeout
    pump = app.get("pump")
    while time.monotonic() < deadline:
        terminal = state.supervisor.get_terminal(address)
        if terminal is None or terminal.handle is None:
            return False
        seen = getattr(state.supervisor, "_status_seen", set())
        if address in seen:
            return True
        if pump is None:
            await asyncio.to_thread(state.supervisor.step_once)
        elif pump.done():
            await asyncio.to_thread(state.supervisor.step_once)
        await asyncio.sleep(0.02)
    return False


# =============================================================================
# AEGIS policy-gate API
# =============================================================================

def _aegis_admin_enabled() -> bool:
    """B-C1: admin-роуты активны только при заданном AEGIS_ADMIN_TOKEN
    или AEGIS_ADMIN_KEYS (FIX-69 PC-1, ролевые идентичности).
    Пустой/отсутствующий env → роуты DISABLED (503), не fail-open."""
    return bool(os.environ.get("AEGIS_ADMIN_TOKEN")
                or os.environ.get("AEGIS_ADMIN_KEYS"))


def _aegis_admin_identity(request: web.Request) -> Optional[str]:
    """Имя admin-идентичности (обёртка над _and_roles)."""
    name, _roles = _aegis_admin_identity_and_roles(request)
    return name


def _aegis_admin_identity_and_roles(
    request: web.Request,
) -> tuple[Optional[str], List[str]]:
    """FIX-69 PC-1 (#472): admin-ключ → (имя, роли).

    AEGIS_ADMIN_KEYS = JSON {"<token>": {"name": str, "roles": [str]}} —
    несколько администраторов со своими ролями; shape зеркалит
    AEGIS_AGENT_KEYS. Эти роли сверяются с escalation_chain[pos] внутри
    AegisGuard.approve (two_person_required).

    Legacy AEGIS_ADMIN_TOKEN без изменений: один токен → имя из
    AEGIS_TOKEN_NAMES, roles=[] (двухчеловечность при одном секрете
    невыразима — и не включается)."""
    raw = os.environ.get("AEGIS_ADMIN_KEYS")
    if raw:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return None, []
        if not isinstance(data, dict):
            return None, []
        key = request.headers.get("X-AEGIS-Key", "")
        for token, ident in data.items():
            if not hmac.compare_digest(key, str(token)):
                continue
            if isinstance(ident, dict):
                return (str(ident.get("name") or "operator"),
                        [str(r) for r in (ident.get("roles") or [])])
            return str(ident or "operator"), []
        return None, []
    token = os.environ.get("AEGIS_ADMIN_TOKEN")
    if not token:
        return None, []
    key = request.headers.get("X-AEGIS-Key", "")
    if not hmac.compare_digest(key, token):
        return None, []
    try:
        names = json.loads(os.environ.get("AEGIS_TOKEN_NAMES") or "{}")
    except json.JSONDecodeError:
        names = {}
    return str(names.get(key, "operator")), []


def _aegis_agent_keys() -> tuple[Optional[Dict[str, str]], Optional[str]]:
    """AEGIS_AGENT_KEYS env (JSON {agent: key}) — per-agent attestation
    для POST /proposals. Fail-closed как B-C1:

    - env задан и валиден → ({agent: key}, None) — enforced
    - env задан, JSON битый → (None, "misconfigured") → 503
    - env пуст/не задан:
        - AEGIS_ALLOW_UNATTESTED=1 → ({}, None) — явный dev opt-out, open
        - иначе → (None, "required") → 503 (attestation required)
    """
    raw = os.environ.get("AEGIS_AGENT_KEYS")
    if raw:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return None, "AEGIS_AGENT_KEYS misconfigured"
        if not isinstance(data, dict):
            return None, "AEGIS_AGENT_KEYS misconfigured"
        return {str(k): str(v) for k, v in data.items()}, None
    if os.environ.get("AEGIS_ALLOW_UNATTESTED") == "1":
        return {}, None
    return None, (
        "agent attestation not configured "
        "(set AEGIS_AGENT_KEYS or AEGIS_ALLOW_UNATTESTED=1)"
    )


def _aegis_admin_guard(request: web.Request) -> Optional[web.Response]:
    """None — доступ разрешён; Response — ошибка для возврата handler'ом.
    B-C1: нет токена → 503 disabled; токен есть, ключ плохой → 401."""
    if not _aegis_admin_enabled():
        return _error("AEGIS admin disabled: AEGIS_ADMIN_TOKEN not set", status=503)
    if _aegis_admin_identity(request) is None:
        return _error("X-AEGIS-Key required", status=401)
    return None


def _policy_from_dict(data: dict) -> Policy:
    """JSON-политика → модель Policy (для hot-reload POST /api/core/policy)."""

    def cond_from(c):
        c = c or {}
        return PolicyCondition(
            type=str(c.get("type", COND_ALWAYS)),
            max_amount=c.get("max_amount"),
            payload_field=str(c.get("payload_field", "amount")),
            allowed=[str(x) for x in c.get("allowed", [])],
            budget_percent=float(c.get("budget_percent", 100.0)),
            operator=str(c.get("operator", "AND")).upper(),
            conditions=[cond_from(x) for x in c.get("conditions", [])],
            window_s=float(c.get("window_s", 60.0)),
            max_count=int(c.get("max_count", 1)),
            rate_scope=str(c.get("rate_scope", "global")),
        )

    rules = []
    for rd in data.get("rules", []):
        if not isinstance(rd, dict):
            raise ValueError("each rule must be an object")
        rule_id = str(rd.get("id", "")).strip()
        if not rule_id:
            raise ValueError("rule.id required")
        rules.append(PolicyRule(
            id=rule_id,
            description=str(rd.get("description", "")),
            operation=str(rd.get("operation", "*")),
            agent=str(rd.get("agent", "*")),
            condition=cond_from(rd.get("condition")),
            outcome=str(rd.get("outcome", "deny")),
            priority=int(rd.get("priority", 0)),
            active=bool(rd.get("active", True)),
            escalation_chain=[
                str(x) for x in (
                    rd.get("escalation_chain")
                    if isinstance(rd.get("escalation_chain"), list) else []
                )
            ],
        ))
    perms = {}
    for k, v in data.get("operation_permissions", {}).items():
        perms[str(k)] = [str(x) for x in (v if isinstance(v, list) else [])]
    op_class = {}
    for k, v in data.get("operation_class", {}).items():
        op_class[str(k)] = str(v)
    return Policy(
        version=str(data.get("version", "1.0.0")),
        rules=rules,
        default_outcome=str(data.get("default_outcome", "deny")),
        operation_permissions=perms,
        operation_class=op_class,
    )


async def handle_proposals(request: web.Request) -> web.Response:
    """POST /api/core/proposals {operation_type, agent, payload?, ctx?}

    Решение: 200 permit | 403 deny | 202 escalate{approval_id}. Детерминистический
    policy-gate перед исполнением (deny-by-default). Каждое решение → аудит
    (event-канал + JSONL). Чувствительность операции определяется сервером
    (policy.operation_class) — клиентское поле `sensitive` игнорируется.
    """
    state = _state(request)
    try:
        data = await _read_json(request)
        op = data.get("operation_type")
        agent = data.get("agent")
        payload = data.get("payload")
        ctx = data.get("ctx")
        if not isinstance(op, str) or not op.strip():
            raise ValueError("operation_type required")
        if not isinstance(agent, str) or not agent.strip():
            raise ValueError("agent required")
        if payload is None:
            payload = {}
        elif not isinstance(payload, dict):
            raise ValueError("payload must be an object")
        if ctx is None:
            ctx = {}
        elif not isinstance(ctx, dict):
            raise ValueError("ctx must be an object")
        simulate = data.get("simulate", False)
        if not isinstance(simulate, bool):
            raise ValueError("simulate must be boolean")
        approval_ttl = data.get("approval_ttl")
        if approval_ttl is not None and (
            not isinstance(approval_ttl, (int, float))
            or isinstance(approval_ttl, bool)
        ):
            raise ValueError("approval_ttl must be a number")
    except ValueError as exc:
        return _error(str(exc))

    # agent-attestation (A-2 fail-closed): без AEGIS_AGENT_KEYS proposals
    # закрыты, пока явно не задан AEGIS_ALLOW_UNATTESTED=1
    agent_keys, att_err = _aegis_agent_keys()
    if att_err is not None:
        return _error(att_err, status=503)
    if agent_keys:
        key = request.headers.get("X-Agent-Key", "")
        expected = agent_keys.get(agent, "")
        # compare_digest — timing-safe сравнение ключей
        if not expected or not hmac.compare_digest(key, expected):
            return web.json_response({"error": "agent key required"},
                                     status=401)

    proposal = OperationProposal(op, agent, payload)
    try:
        decision = state.gate.evaluate(
            proposal, ctx, simulate=simulate, approval_ttl=approval_ttl)
    except ValueError as exc:
        return _error(str(exc))

    # simulate → всегда 200: dry-run ничего не эскалирует по-настоящему
    if simulate:
        return web.json_response({
            "outcome": decision.outcome,
            "rule_id": decision.rule_id,
            "reason": decision.reason,
            "policy_hash": decision.policy_hash,
            "simulate": True,
            "approval_id": decision.approval_id,
        })

    if decision.outcome == "permit":
        return web.json_response({
            "outcome": "permit",
            "rule_id": decision.rule_id,
            "reason": decision.reason,
            "policy_hash": decision.policy_hash,
        })
    if decision.outcome == "deny":
        return web.json_response({
            "outcome": "deny",
            "rule_id": decision.rule_id,
            "reason": decision.reason,
            "policy_hash": decision.policy_hash,
        }, status=403)
    return web.json_response({
        "outcome": "escalate",
        "approval_id": decision.approval_id,
        "reason": decision.reason,
        "policy_hash": decision.policy_hash,
    }, status=202)


async def handle_approvals_list(request: web.Request) -> web.Response:
    """GET /api/core/approvals — pending escalate-запросы."""
    state = _state(request)
    expired = _expire_mutation_approvals(state)
    if expired is not None:
        return expired
    mutations = []
    if request.query.get("status", "pending") == "pending":
        mutations = [
            {"approval_id": approval_id, "status": "pending",
             "action": record["action"], "subject": record["subject"],
             "expires_at": record["expires_at"],
             "dual_control": bool(record.get("dual_control")),
             "decided_by": list(record.get("decided_by") or []),
             "required_approvals": int(
                 record.get("required_approvals") or 1)}
            for approval_id, record in state.mutation_approvals.items()
            if record["status"] == "pending"
        ]
    return web.json_response({
        "approvals": state.gate.pending_approvals(),
        "mutations": mutations,
    })


async def _decide_mutation_approval(
    state: "AppState", approval_id: str, approved: bool,
    by: str = "operator",
) -> Optional[web.Response]:
    """Resolve a queued core request; ``None`` means legacy AEGIS ID.

    W6 dual-control: запись с ``dual_control:true`` требует
    ``required_approvals`` (2) РАЗНЫХ approver'ов — каждый approve
    добавляет ``by`` в ``decided_by``; повторный approve от того же
    principal → 409; после второго distinct-голоса запрос реплеится.
    Deny резолвит сразу (fail-safe, как в AEGIS escalation chain).
    """
    expired = _expire_mutation_approvals(state)
    if expired is not None:
        return expired
    record = state.mutation_approvals.get(approval_id)
    if record is None:
        return None
    if record["status"] == "expired":
        return _error("approval expired", status=410)
    if record["status"] != "pending":
        return _error("approval already resolved", status=409)
    is_dual = bool(record.get("dual_control"))
    required = int(record.get("required_approvals") or 1)
    decided_by = record.setdefault("decided_by", [])
    approver = str(by or "").strip() or "operator"

    if not approved:
        if approver not in decided_by:
            decided_by.append(approver)
        error = _record_mutation_approval_event(
            state, "approval_denied", record["subject"], "denied",
            approval_id, record["rule_id"], by=approver)
        if error is not None:
            return error
        record.update(status="denied", request=None, handler=None)
        _save_mutation_approvals(state)
        return web.json_response({"status": "denied"})

    if is_dual:
        if approver in decided_by:
            return web.json_response({
                "error": "approver already decided",
                "approval_id": approval_id,
                "decided_by": list(decided_by),
                "required_approvals": required,
            }, status=409)
        decided_by.append(approver)
        votes = len(decided_by)
        if votes < required:
            error = _record_mutation_approval_event(
                state, "approval_vote", record["subject"],
                f"vote-{votes}/{required}", approval_id,
                record["rule_id"], by=approver)
            if error is not None:
                return error
            _save_mutation_approvals(state)
            return web.json_response({
                "status": "pending",
                "approval_id": approval_id,
                "decided_by": list(decided_by),
                "required_approvals": required,
                "remaining": required - votes,
            }, status=202)

    decision = "approved"
    event = "approval_approved"
    error = _record_mutation_approval_event(
        state, event, record["subject"], decision, approval_id,
        record["rule_id"], by=approver)
    if error is not None:
        return error

    original_request = record.get("request")
    handler = record.get("handler")
    if original_request is None or handler is None:
        # W73: очередь пережила рестарт — request/handler не
        # сериализуются; replay-spec восстанавливает их через
        # router.resolve (см. _request_from_replay_spec).
        original_request, handler = await _request_from_replay_spec(
            state, record.get("replay") or {})
        if original_request is None:
            record["status"] = "failed"
            record.update(request=None, handler=None)
            _save_mutation_approvals(state)
            return web.json_response({
                "status": "failed",
                "error": "replay spec missing or route not found",
            }, status=409)
    record["status"] = "executing"
    replay = {
        "state": state, "approval_id": approval_id,
        "operation_type": record["operation_type"],
        "payload_hash": record["payload_hash"],
        "rule_id": record["rule_id"], "policy_hash": record["policy_hash"],
        "subject": record["subject"], "used": False,
    }
    request_token = _CURRENT_GATE_REQUEST.set(original_request)
    replay_token = _APPROVED_POLICY_REPLAY.set(replay)
    try:
        result_response = await handler(original_request)
        status = result_response.status
        try:
            result = json.loads(result_response.body.decode("utf-8"))
        except (AttributeError, UnicodeError, json.JSONDecodeError):
            result = {"http_status": status}
        executed = replay["used"] and 200 <= status < 300 and status != 202
    except Exception:
        status, result, executed = 500, {"error": "mutation execution failed"}, False
    finally:
        _APPROVED_POLICY_REPLAY.reset(replay_token)
        _CURRENT_GATE_REQUEST.reset(request_token)
        record.update(request=None, handler=None)
    record["status"] = "executed" if executed else "failed"
    _save_mutation_approvals(state)
    if executed:
        return web.json_response({"status": "executed", "result": result})
    return web.json_response({
        "status": "failed", "http_status": status, "result": result,
    }, status=409)


async def handle_approval_decide(request: web.Request) -> web.Response:
    """POST /api/core/approvals/{id} {approved, by?} — финальное решение.

    AuthZ: если задан env AEGIS_ADMIN_TOKEN — заголовок X-AEGIS-Key обязателен;
    `by` тогда берётся из идентичности токена, а не из тела запроса."""
    state = _state(request)
    denied = _aegis_admin_guard(request)
    if denied is not None:
        return denied
    identity, roles = _aegis_admin_identity_and_roles(request)
    approval_id = request.match_info["id"]
    try:
        data = await _read_json(request)
        approved = data.get("approved")
        # B-C1: роут жив только при заданном токене — `by` всегда из
        # идентичности ключа, клиентское поле игнорируется
        by = identity
        if not isinstance(approved, bool):
            raise ValueError("approved must be boolean")
        if not isinstance(by, str):
            by = str(by)
    except ValueError as exc:
        return _error(str(exc))
    mutation_decision = await _decide_mutation_approval(
        state, approval_id, approved, by=by)
    if mutation_decision is not None:
        return mutation_decision
    decision = state.gate.approve(approval_id, approved, by=by,
                                  roles=roles)
    if decision is None:
        return _error("approval not found", status=404)
    # FIX-69 PC-1 (#472): оператор видит требование следующего шага —
    # роль уже несёт escalate_to в Decision.
    return web.json_response({
        "outcome": decision.outcome,
        "reason": decision.reason,
        "approval_id": decision.approval_id,
        "required_role": decision.escalate_to,
    })


async def handle_policy_get(request: web.Request) -> web.Response:
    """GET /api/core/policy — текущая политика + статистика."""
    state = _state(request)
    gate = state.gate
    p = gate.policy
    return web.json_response({
        "version": p.version,
        "policy_hash": gate.policy_hash,
        "default_outcome": p.default_outcome,
        "rules": [
            {
                "id": r.id,
                "description": r.description,
                "operation": r.operation,
                "agent": r.agent,
                "outcome": r.outcome,
                "priority": r.priority,
                "active": r.active,
                "escalation_chain": list(r.escalation_chain),
            }
            for r in p.rules
        ],
        "evaluations": gate.evaluation_count,
        "pending": len(gate.pending_approvals()),
        "operation_class": p.operation_class,
    })


async def handle_policy_update(request: web.Request) -> web.Response:
    """POST /api/core/policy {policy} — hot-reload (новый hash + аудит).

    AuthZ: X-AEGIS-Key обязателен при заданном env AEGIS_ADMIN_TOKEN;
    без токена роут disabled → 503 (B-C1)."""
    state = _state(request)
    denied = _aegis_admin_guard(request)
    if denied is not None:
        return denied
    try:
        data = await _read_json(request)
        pd = data.get("policy")
        if not isinstance(pd, dict):
            raise ValueError("policy object required")
        policy = _policy_from_dict(pd)
    except ValueError as exc:
        return _error(str(exc))
    # #468: policy-update через gate — panic может заморозить саму
    # ротацию политики (operator escape — только panic_off).
    denied = await _gate_check(
        state, "aegis.policy_update",
        {"action": "policy_update", "version": policy.version,
         "rule_ids": sorted(r.id for r in policy.rules)},
        agent=_aegis_admin_identity(request) or "aegis-admin")
    if denied is not None:
        return denied
    try:
        new_hash = state.gate.reload_policy(policy)
    except ValueError as exc:
        return _error(str(exc), status=409)
    return web.json_response({
        "status": "reloaded",
        "version": policy.version,
        "policy_hash": new_hash,
    })


async def handle_audit(request: web.Request) -> web.Response:
    """GET /api/core/audit — AEGIS chain plus bounded core gate decisions.

    ``entries`` is the newest-first v1 gate trail (``limit`` defaults to 100,
    ``action`` filters it); legacy AEGIS hash-chain rows remain in ``records``.
    """
    state = _state(request)
    try:
        limit_raw = request.query.get("limit")
        limit = int(limit_raw) if limit_raw is not None else 50
    except ValueError:
        return _error("limit must be an integer")
    records = state.gate.audit_records(
        outcome=request.query.get("outcome") or None,
        agent=request.query.get("agent") or None,
        limit=limit,
    )
    trail_limit = int(limit_raw) if limit_raw is not None else 100
    trail_limit = max(1, min(trail_limit, state.audit_trail.maxlen))
    entries, total = state.audit_trail.query(
        limit=trail_limit, action=request.query.get("action") or None)
    return web.json_response({
        "entries": entries,
        "total": total,
        "records": records,
    })


async def handle_audit_verify(request: web.Request) -> web.Response:
    """Verify both AEGIS policy records and the persisted core gate trail."""
    state = _state(request)
    aegis = state.gate.audit_chain_verify()
    trail = state.audit_trail.verify()
    detail = trail["detail"]
    if detail is None and not aegis.get("ok", True):
        detail = str(aegis.get("error", "AEGIS audit chain invalid"))
    return web.json_response({
        **aegis,
        "ok": bool(aegis.get("ok", True) and trail["ok"]),
        "verified": trail["verified"],
        "broken_at": trail["broken_at"],
        "detail": detail,
        "aegis": aegis,
        "gate_trail": trail,
    })


async def handle_audit_export(request: web.Request) -> web.Response:
    """Export the gate trail as canonical NDJSON when ``limit`` is supplied;
    otherwise preserve the legacy AEGIS JSON/JSONL/CSV export contract."""
    state = _state(request)

    limit_raw = request.query.get("limit")
    if limit_raw is not None:
        try:
            limit = int(limit_raw)
        except ValueError:
            return _error("limit must be an integer")
        bounded = max(1, min(limit, state.audit_trail.maxlen))
        entries, _ = state.audit_trail.query(limit=bounded)
        text = "".join(
            state.audit_trail._canonical(entry).decode("utf-8") + "\n"
            for entry in reversed(entries)
        )
        return web.Response(
            text=text,
            content_type="application/x-ndjson",
            headers={"Content-Disposition": "attachment; filename=audit.jsonl"},
        )

    def _ts(name):
        raw = request.query.get(name)
        if raw is None:
            return None
        try:
            return float(raw)
        except ValueError:
            raise ValueError(f"{name} must be a number")

    try:
        from_ts, to_ts = _ts("from_ts"), _ts("to_ts")
    except ValueError as exc:
        return _error(str(exc))
    bundle = state.gate.audit_export(from_ts=from_ts, to_ts=to_ts)
    fmt = request.query.get("format", "json")
    if fmt == "jsonl":
        text = "".join(
            json.dumps(e, ensure_ascii=False) + "\n" for e in bundle["entries"]
        )
        return web.Response(
            text=text, content_type="application/x-ndjson",
            headers={"Content-Disposition": "attachment; filename=aegis-audit.jsonl"},
        )
    if fmt == "csv":
        import csv
        import io
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["ts", "audit_id", "type", "operation_type", "agent",
                    "outcome", "rule_id", "reason", "approval_id",
                    "policy_hash", "prev_audit_hash", "content_hash"])
        for e in bundle["entries"]:
            w.writerow([e.get(k, "") for k in (
                "ts", "audit_id", "type", "operation_type", "agent",
                "outcome", "rule_id", "reason", "approval_id",
                "policy_hash", "prev_audit_hash", "content_hash")])
        return web.Response(
            text=buf.getvalue(), content_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=aegis-audit.csv"},
        )
    return web.json_response(bundle)


# =============================================================================
# #468 W3 panic circuit-breaker + W1 verdict-attestation
# =============================================================================

async def handle_panic_on(request: web.Request) -> web.Response:
    """POST /api/core/panic/on — emergency freeze: все evaluate → deny.
    AuthZ: AEGIS_ADMIN_TOKEN; активировать может любой admin (fail-safe)."""
    state = _state(request)
    denied = _aegis_admin_guard(request)
    if denied is not None:
        return denied
    identity = _aegis_admin_identity(request) or "aegis-admin"
    return web.json_response({"panic": state.gate.panic_on(by=identity)})


async def handle_panic_off(request: web.Request) -> web.Response:
    """POST /api/core/panic/off — снять заморозку: только panic_owner
    (AEGIS_PANIC_OWNER) и только после cooldown. Отказ → 403 + аудит."""
    state = _state(request)
    denied = _aegis_admin_guard(request)
    if denied is not None:
        return denied
    identity = _aegis_admin_identity(request) or "aegis-admin"
    result = state.gate.panic_off(by=identity)
    return web.json_response(result, status=200 if result["released"] else 403)


async def handle_panic_status(request: web.Request) -> web.Response:
    """GET /api/core/panic — состояние circuit-breaker'а."""
    return web.json_response({"panic": _state(request).gate.panic_status()})


async def handle_verdicts_post(request: web.Request) -> web.Response:
    """POST /api/core/verdicts {payload_hash, verdict, risk?, note?} —
    reviewer verdict по payload_hash (#468 W1). `by` = admin identity;
    gate принимает verdict только от AEGIS_REVIEWERS."""
    state = _state(request)
    denied = _aegis_admin_guard(request)
    if denied is not None:
        return denied
    identity = _aegis_admin_identity(request) or "aegis-admin"
    try:
        data = await _read_json(request)
    except ValueError as exc:
        return _error(str(exc))
    rec = state.gate.submit_verdict(
        str(data.get("payload_hash", "")),
        str(data.get("verdict", "")),
        by=identity,
        risk=data.get("risk"),
        note=str(data.get("note", "")),
    )
    if rec is None:
        return _error(
            "verdict rejected: reviewer role required "
            "(AEGIS_REVIEWERS) or store full/invalid input", status=403)
    return web.json_response({"verdict": rec})


async def handle_verdicts_get(request: web.Request) -> web.Response:
    """GET /api/core/verdicts?limit — список verdict-записей."""
    state = _state(request)
    try:
        limit_raw = request.query.get("limit")
        limit = int(limit_raw) if limit_raw is not None else 100
    except ValueError:
        return _error("limit must be an integer")
    return web.json_response(
        {"verdicts": state.gate.list_verdicts(limit=limit)})


# =============================================================================
# #469b W2 guardian M-of-N — параллельные голоса по escalate-заявкам
# =============================================================================

_GUARDIAN_VOTE_STATUS = {
    "not a configured guardian": 403,
    "guardian votes not configured": 503,
    "unknown or already resolved": 404,
    "approval expired": 410,
    "already voted": 409,
}


async def handle_approval_vote(request: web.Request) -> web.Response:
    """POST /api/core/approvals/{id}/vote {decision, note?} — голос
    guardian'а (AEGIS_GUARDIANS). threshold approve → release через
    approve(); один deny → reject. by = admin identity."""
    state = _state(request)
    denied = _aegis_admin_guard(request)
    if denied is not None:
        return denied
    identity = _aegis_admin_identity(request) or "aegis-admin"
    try:
        data = await _read_json(request)
    except ValueError as exc:
        return _error(str(exc))
    result = state.gate.guardian_vote(
        request.match_info["id"],
        by=identity,
        decision=str(data.get("decision", "approve")),
        note=str(data.get("note", "")),
    )
    if not result.get("ok"):
        reason = str(result.get("reason", "vote rejected"))
        status = next(
            (s for k, s in _GUARDIAN_VOTE_STATUS.items() if k in reason),
            400)
        return _error(reason, status=status)
    return web.json_response(result)


async def handle_approval_votes_get(request: web.Request) -> web.Response:
    """GET /api/core/approvals/{id}/votes — статус guardian-голосования."""
    return web.json_response({
        "guardian": _state(request).gate.guardian_status(
            request.match_info["id"])
    })


# =============================================================================
# Ratings (NEWF_SPEC §6) — orchestrator-scored agent ratings
# =============================================================================

async def handle_ratings_all(request: web.Request) -> web.Response:
    """GET /api/core/ratings — все рейтинги агентов."""
    return web.json_response({"ratings": _state(request).ratings.all()})


async def handle_ratings_get(request: web.Request) -> web.Response:
    """GET /api/core/ratings/{agent_id} — рейтинг одного агента."""
    agent_id = request.match_info["agent_id"]
    rec = _state(request).ratings.get(agent_id)
    if rec is None:
        return _error("rating not found", 404)
    return web.json_response({"agent_id": agent_id, "rating": rec})


async def handle_ratings_score(request: web.Request) -> web.Response:
    """POST /api/core/ratings/{agent_id}/score {score,task,note} —
    append оценка + sliding-average. AuthZ: operator-класс (AEGIS token);
    без AEGIS_ADMIN_TOKEN роут disabled → 503 (B-C1)."""
    state = _state(request)
    denied = _aegis_admin_guard(request)
    if denied is not None:
        return denied
    agent_id = request.match_info["agent_id"]
    try:
        body = await request.json()
    except Exception:
        return _error("Invalid JSON body")
    if not isinstance(body, dict):
        return _error("Invalid JSON body")
    # #468: ratings-score через gate (audit + panic coverage).
    denied = await _gate_check(
        state, "aegis.ratings_score",
        {"action": "ratings_score", "agent_id": agent_id,
         "score": body.get("score"), "task": body.get("task", "")},
        agent=_aegis_admin_identity(request) or "aegis-admin")
    if denied is not None:
        return denied
    idem_key = body.get("idempotency_key")
    if idem_key is not None and not isinstance(idem_key, str):
        return _error("idempotency_key must be a string")
    try:
        rec = state.ratings.score(
            agent_id,
            body.get("score"),
            task=body.get("task", ""),
            note=body.get("note", ""),
            idempotency_key=idem_key,
        )
    except IdempotencyConflict as exc:
        return _error(str(exc), 409)
    except ValueError as exc:
        return _error(str(exc))
    return web.json_response({"agent_id": agent_id, "rating": rec})


# =============================================================================
# App Factory
# =============================================================================

PUMP_INTERVAL_S = 0.05


async def _pump_supervisor(app: web.Application) -> None:
    """Фоновый цикл надзора: step_once читает PTY, применяет OSC-статусы,
    респаунит lost и наполняет recent_output. Без него живые терминалы
    не продвигаются (до этого шагали только wait_ready/wait_for_exit)."""
    state: AppState = app["state"]
    import faulthandler as _fh
    _pump_errors = 0
    while True:
        try:
            _fh.dump_traceback_later(15.0, file=sys.stderr)
            try:
                await asyncio.to_thread(state.supervisor.step_once)
            finally:
                _fh.cancel_dump_traceback_later()
            _pump_errors = 0
        except Exception:
            _pump_errors += 1
            import traceback as _tb
            _tb.print_exc()
            print(f"nexus-core: pump step_once crashed ({_pump_errors}x) — continuing",
                  file=sys.stderr, flush=True)
            await asyncio.sleep(max(PUMP_INTERVAL_S, min(5.0, _pump_errors * 0.5)))
            continue
        await asyncio.sleep(PUMP_INTERVAL_S)


_RATE_LIMIT_WINDOW = 60.0
_RATE_LIMIT_MAX = 120


def _rate_buckets(request: web.Request) -> dict:
    """Per-app token→timestamps buckets.

    Хранится на Application instance: каждый create_app() (тесты,
    параллельные стенды) получает свои счётчики — module-global dict
    протекал бы между инстансами и душил чужие POST'ы (429)."""
    app = request.app
    buckets = app.get("rate_limit_buckets")
    if buckets is None:
        buckets = {}
        app["rate_limit_buckets"] = buckets
    return buckets


@web.middleware
async def _rate_limit(request: web.Request, handler):
    if request.method != "POST" or not request.path.startswith("/api/core"):
        return await handler(request)
    buckets = _rate_buckets(request)
    token = request.headers.get("X-Nexus-Token") or "anon"
    now = time.time()
    bucket = buckets.setdefault(token, [])
    bucket[:] = [t for t in bucket if now - t < _RATE_LIMIT_WINDOW]
    if len(bucket) >= _RATE_LIMIT_MAX:
        return _error("rate limit exceeded", status=429)
    bucket.append(now)
    return await handler(request)


def create_app(base: Optional[Path] = None, supervisor: Optional[SupervisorV1] = None,
               host: str = DEFAULT_HOST, port: int = DEFAULT_PORT,
               templates_dir: Optional[Path] = None,
               pump: bool = False) -> web.Application:
    base = Path(base) if base is not None else DEFAULT_BASE
    if supervisor is None:
        # #515 P0.2: daemon-персистентность — registry.json в base.
        # _load_registry в __init__ делает adoption: keep-терминалы
        # получают shell-замену (не повтор команды), экраны восстанавливаются
        # из recent_output. Без registry_path каждый рестарт = потеря.
        supervisor = SupervisorV1(registry_path=base / "registry.json", restore=False)
    state = AppState(base, supervisor, templates_dir)
    state.bind_host = host
    # W37: per-space idle TTL из spaces.json → supervisor
    supervisor.space_idle_ttl.update(_space_idle_ttls(state))

    app = web.Application(middlewares=[
        _rate_limit, _cors, _core_authz, _gate_request_context,
    ])
    app.on_response_prepare.append(_cors_prepare)
    app["state"] = state
    app["rate_limit_buckets"] = {}
    state.app = app  # W73: replay-spec → router.resolve после рестарта

    if pump:
        async def _start_pump(app: web.Application) -> None:
            app["pump"] = asyncio.create_task(_pump_supervisor(app))

            def _pump_done(task: "asyncio.Task") -> None:
                if task.cancelled():
                    return
                exc = task.exception()
                if exc is not None:
                    print(f"nexus-core: supervisor pump died: {exc!r}",
                          file=sys.stderr)

            app["pump"].add_done_callback(_pump_done)
            # non-blocking adoption/restore — чтобы /server отвечал мгновенно
            app["restore_task"] = asyncio.create_task(
                supervisor.restore_registry_async())
            # W15: exit-webhook drain (~0.25с тик)
            app["webhook_task"] = asyncio.create_task(
                _webhook_drain_loop(app))

            def _wh_done(task: "asyncio.Task") -> None:
                if task.cancelled():
                    return
                exc = task.exception()
                if exc is not None:
                    print(f"nexus-core: webhook drain died: {exc!r}",
                          file=sys.stderr)
            app["webhook_task"].add_done_callback(_wh_done)

        async def _stop_pump(app: web.Application) -> None:
            app["pump"].cancel()
            try:
                await app["pump"]
            except asyncio.CancelledError:
                pass
            restore_task = app.get("restore_task")
            if restore_task is not None:
                await restore_task
            webhook_task = app.get("webhook_task")
            if webhook_task is not None:
                webhook_task.cancel()
                try:
                    await webhook_task
                except asyncio.CancelledError:
                    pass

        app.on_startup.append(_start_pump)
        app.on_cleanup.append(_stop_pump)
    else:
        async def _restore_only(app: web.Application) -> None:
            await supervisor.restore_registry_async()

        app.on_startup.append(_restore_only)

    app.router.add_get("/api/core/terminals", handle_terminals)
    app.router.add_get("/api/core/machines", handle_machines)
    # Register the literal path before the {name} route.
    app.router.add_get("/api/core/machines/schema", handle_machines_schema)
    app.router.add_get("/api/core/machines/{name}", handle_machine_get)
    app.router.add_put("/api/core/machines/{name}", handle_machine_put)
    app.router.add_delete("/api/core/machines/{name}", handle_machine_delete)
    app.router.add_post("/api/core/machines/{name}/connect", handle_machine_connect)
    app.router.add_post("/api/core/machines/{name}/rename", handle_machine_rename)
    app.router.add_post("/api/core/exec", handle_exec)
    app.router.add_get("/api/core/file/read", handle_file_read)
    # N8 (#478) NEWF read-only мост: /files — алиас того же хендлера, что и
    # /file/list (директива и design-док называют путь по-разному).
    app.router.add_get("/api/core/file/list", handle_files_list)
    app.router.add_get("/api/core/files", handle_files_list)
    app.router.add_get("/api/core/changes", handle_changes)
    app.router.add_post("/api/core/worktree", handle_worktree_create)
    app.router.add_get("/api/core/worktrees", handle_worktrees)
    app.router.add_delete("/api/core/worktree", handle_worktree_delete)
    app.router.add_post("/api/core/file/write", handle_file_write)
    app.router.add_post("/api/core/file/edit", handle_file_edit)
    app.router.add_get("/api/core/programs", handle_programs)
    app.router.add_get("/api/core/presets", handle_presets)
    app.router.add_post("/api/core/spawn-preset", handle_spawn_preset)
    app.router.add_post("/api/core/record/start", handle_record_start)
    app.router.add_post("/api/core/record/stop/{id:.+}", handle_record_stop)
    app.router.add_get("/api/core/recordings", handle_record_list)
    app.router.add_get("/api/core/recording/{id:.+}", handle_record_read)
    app.router.add_get("/api/core/server", handle_server_status)
    app.router.add_get("/api/core/capabilities", handle_capabilities)
    app.router.add_get("/api/core/terminals/summary", handle_terminals_summary)
    app.router.add_get("/api/core/terminals/top", handle_terminals_top)
    app.router.add_get("/api/core/space/{id:.+}/stats", handle_space_stats)
    app.router.add_get("/api/core/terminal/{term:.+}/children", handle_children)
    app.router.add_get("/api/core/ratelimit", handle_ratelimit_view)
    app.router.add_get("/api/core/events/since", handle_events_cursor)
    app.router.add_get("/api/core/terminal/{term:.+}/input-log", handle_input_log)
    app.router.add_get("/api/core/diag", handle_diag)
    app.router.add_get("/api/core/alerts", handle_alerts)
    app.router.add_get("/api/core/alert-rules", handle_alert_rules)
    app.router.add_post("/api/core/alert-rules", handle_alert_rule_add)
    app.router.add_post("/api/core/alert-rules/{idx:.+}/toggle", handle_alert_toggle)
    app.router.add_get("/api/core/health", handle_health)
    app.router.add_get("/api/core/config", handle_config)
    app.router.add_post("/api/core/terminal/{term:.+}/on-event/test", handle_webhook_test)
    app.router.add_get("/api/core/events/types", handle_event_types)
    app.router.add_get("/api/core/webhooks/pending", handle_webhooks_pending)
    app.router.add_get("/api/core/webhooks/stats", handle_webhook_stats)
    app.router.add_get("/api/core/webhooks/dead", handle_dead_webhooks)
    app.router.add_post("/api/core/webhooks/requeue", handle_webhook_requeue)
    app.router.add_get("/api/core/state/export", handle_state_export)
    app.router.add_get("/api/core/system", handle_system)
    app.router.add_get("/api/core/agents", handle_agents)
    app.router.add_get("/api/core/spaces", handle_spaces)
    app.router.add_get("/api/core/spaces/detail", handle_spaces_detail)
    app.router.add_post("/api/core/space/{id:.+}/batch",
                        handle_space_batch)
    app.router.add_get("/api/core/workspace/templates", handle_workspace_templates)
    app.router.add_post("/api/core/workspace/template", handle_workspace_templates)
    app.router.add_post("/api/core/workspace/spawn", handle_workspace_spawn)
    app.router.add_post("/api/core/workspace/snapshot",
                        handle_workspace_snapshot)
    app.router.add_get("/api/core/workspace/snapshots",
                       handle_workspace_snapshots)
    app.router.add_get("/api/core/workspace/snapshot/{name:.+}",
                       handle_workspace_snapshot_get)
    app.router.add_post("/api/core/workspace/import",
                        handle_workspace_import)
    app.router.add_get("/api/core/workspace/restore/preview",
                       handle_workspace_restore_preview)
    app.router.add_post("/api/core/workspace/restore",
                        handle_workspace_restore)
    app.router.add_post("/api/core/spawn-remote", handle_spawn_remote)
    app.router.add_get("/api/core/relay-status", handle_relay_status)
    app.router.add_post("/api/core/space", handle_space_create)
    app.router.add_post("/api/core/space/{id:.+}/rename", handle_space_rename)
    app.router.add_put("/api/core/space/{id:.+}/idle-policy",
                       handle_space_idle_policy)
    app.router.add_put("/api/core/space/{id:.+}/labels",
                       handle_space_labels)
    app.router.add_delete("/api/core/space/{id:.+}", handle_space_delete)
    app.router.add_post("/api/core/terminal/{name:.+}/migrate",
                        handle_terminal_migrate)
    app.router.add_get("/v1/roster.json", handle_roster)
    app.router.add_get("/api/core/screen/{term:.+}", handle_screen)
    app.router.add_get("/api/core/terminal/{term:.+}/stream", handle_screen_stream)
    app.router.add_get("/api/core/terminal/{term:.+}/dump", handle_terminal_dump)
    app.router.add_post("/api/core/terminal/{name:.+}/compress-scrollback",
                        handle_terminal_compress_scrollback)
    app.router.add_get("/api/core/terminal/{name:.+}/scrollback-info",
                       handle_terminal_scrollback_info)
    app.router.add_post("/api/core/share", handle_share_create)
    app.router.add_get("/api/core/shares", handle_shares)
    app.router.add_delete("/api/core/share/{token:.+}",
                          handle_share_revoke)
    app.router.add_get("/view/{token}/{scope}", handle_view)
    app.router.add_post("/api/core/state/migrate",
                        handle_state_migrate)
    app.router.add_post("/api/core/run", handle_run)
    app.router.add_post("/api/core/run-program", handle_run_program)
    app.router.add_post("/api/core/send", handle_send)
    app.router.add_get("/api/core/send-queues", handle_send_queues)
    app.router.add_delete("/api/core/send-queue/{name:.+}",
                          handle_send_queue_clear)
    app.router.add_post("/api/core/send-broadcast", handle_send_broadcast)
    app.router.add_post("/api/core/script", handle_script)
    app.router.add_get("/api/core/scripts", handle_scripts)
    app.router.add_post("/api/core/script/run", handle_script_run)
    app.router.add_post("/api/core/keys", handle_keys)
    app.router.add_post("/api/core/put", handle_put)
    app.router.add_post("/api/core/putfile", handle_putfile)
    app.router.add_post("/api/core/park", handle_park)
    app.router.add_post("/api/core/keep", handle_keep)
    app.router.add_post("/api/core/wait", handle_wait)
    app.router.add_post("/api/core/kill", handle_kill)
    app.router.add_post("/api/core/batch", handle_batch)
    app.router.add_post("/api/core/terminal/{term:.+}/restart", handle_restart)
    app.router.add_get("/api/core/terminal/{term:.+}/wait", handle_wait_longpoll)
    app.router.add_post("/api/core/terminal/{term:.+}/lock", handle_lock)
    app.router.add_post("/api/core/terminal/{term:.+}/archive", handle_archive)
    app.router.add_post("/api/core/terminal/{term:.+}/note", handle_note)
    app.router.add_post("/api/core/terminal/{term:.+}/env", handle_env_update)
    app.router.add_post("/api/core/terminal/{term:.+}/labels", handle_labels)
    app.router.add_post("/api/core/terminal/{term:.+}/watch", handle_watch)
    app.router.add_post("/api/core/interrupt", handle_interrupt)
    app.router.add_post("/api/core/label", handle_label)
    app.router.add_post("/api/core/terminal/{name:.+}/rename",
                        handle_terminal_rename)
    app.router.add_post("/api/core/terminal/{name:.+}/resize",
                        handle_terminal_resize)
    app.router.add_post("/api/core/terminal/{name:.+}/spawn-child",
                        handle_spawn_child)
    app.router.add_post("/api/core/terminal/{name:.+}/send-file",
                        handle_terminal_send_file)
    app.router.add_post("/api/core/terminal/{name:.+}/clone",
                        handle_terminal_clone)
    app.router.add_get("/api/core/terminal/{name:.+}/info",
                       handle_terminal_info)
    app.router.add_post("/api/core/terminal/{name:.+}/snapshot",
                        handle_terminal_snapshot)
    app.router.add_post("/api/core/terminal/{name:.+}/restore-snapshot",
                        handle_terminal_restore_snapshot)
    app.router.add_post("/api/core/group", handle_group)
    app.router.add_get("/api/core/groups", handle_groups_list)
    app.router.add_put("/api/core/group/{name}", handle_group_upsert)
    app.router.add_get("/api/core/group/{name}", handle_group_get)
    app.router.add_delete("/api/core/group/{name}", handle_group_delete)
    app.router.add_post("/api/core/group/{name}/send",
                        handle_group_send)
    app.router.add_post("/api/core/group/{name}/kill",
                        handle_group_kill)
    app.router.add_post("/api/core/terminal/{name:.+}/pipe",
                        handle_terminal_pipe)
    app.router.add_post("/api/core/terminal/{name:.+}/marker",
                        handle_terminal_marker)
    app.router.add_post("/api/core/terminal/{name:.+}/replay",
                        handle_terminal_replay)
    app.router.add_get("/api/core/diff/{a}/{b}", handle_terminal_diff)
    app.router.add_get("/api/core/terminal/{name:.+}/metrics",
                       handle_terminal_metrics)
    app.router.add_post("/api/core/terminal/{name:.+}/on-exit",
                        handle_terminal_on_exit)
    app.router.add_route("*", "/api/core/terminal/{name:.+}/on-event",
                         handle_terminal_on_event)
    app.router.add_post("/api/core/terminal/{name:.+}/freeze",
                        handle_terminal_freeze)
    app.router.add_post("/api/core/terminal/{name:.+}/resume",
                        handle_terminal_resume)
    app.router.add_get("/api/core/terminal/{name:.+}/export",
                       handle_terminal_export)
    app.router.add_post("/api/core/terminal/import",
                        handle_terminal_import)
    app.router.add_get("/api/core/terminal/{name:.+}/cost",
                       handle_terminal_cost)
    app.router.add_get("/api/core/cost-report",
                       handle_cost_report)
    app.router.add_get("/api/core/screens", handle_screens)
    app.router.add_post("/api/core/purge-exited", handle_purge_exited)
    app.router.add_get("/api/core/search-all", handle_search_all)
    app.router.add_get("/api/core/merge", handle_session_merge)
    app.router.add_get("/api/core/stats", handle_stats_aggregation)
    app.router.add_post("/api/core/terminal/{name:.+}/pipe-file",
                        handle_terminal_pipe_file)
    app.router.add_get("/api/core/pipe-files", handle_pipe_files)
    app.router.add_get("/api/core/alert-rules", handle_alert_rules)
    app.router.add_post("/api/core/alert-rules/test",
                        handle_alert_rule_test)
    app.router.add_get("/api/core/capacity", handle_capacity)
    app.router.add_get("/api/core/capacity/forecast",
                       handle_capacity_forecast)
    app.router.add_get("/api/core/metrics", handle_core_metrics)
    app.router.add_post("/api/core/backup", handle_backup_create)
    app.router.add_get("/api/core/backups", handle_backups_list)
    app.router.add_get("/api/core/backups/{name}",
                       handle_backup_download)
    app.router.add_post("/api/core/replay-file", handle_replay_file)
    app.router.add_post("/api/core/send-schedule",
                        handle_send_schedule)
    app.router.add_get("/api/core/send-schedule",
                       handle_send_schedule_list)
    app.router.add_delete("/api/core/send-schedule/{id}",
                          handle_send_schedule_cancel)
    app.router.add_get("/api/core/pipes", handle_pipes)
    app.router.add_get("/api/core/events", handle_events)
    app.router.add_get("/api/core/doc", handle_doc_get)
    app.router.add_get("/api/core/doc/latest", handle_doc_latest)
    app.router.add_put("/api/core/doc", handle_doc_put)
    app.router.add_post("/api/core/doc", handle_doc_put)
    app.router.add_get("/api/core/templates", handle_templates)
    app.router.add_post("/api/core/templates/{name}/run", handle_template_run)

    # AEGIS policy-gate (N6/CERBERUS-фича)
    app.router.add_post("/api/core/proposals", handle_proposals)
    app.router.add_get("/api/core/approvals", handle_approvals_list)
    app.router.add_post("/api/core/approvals/{id}", handle_approval_decide)
    app.router.add_post("/api/core/approvals/{id}/vote", handle_approval_vote)
    app.router.add_get("/api/core/approvals/{id}/votes", handle_approval_votes_get)
    app.router.add_get("/api/core/policy", handle_policy_get)
    app.router.add_post("/api/core/policy", handle_policy_update)
    app.router.add_get("/api/core/audit", handle_audit)
    app.router.add_get("/api/core/audit/verify", handle_audit_verify)
    app.router.add_get("/api/core/audit/export", handle_audit_export)
    app.router.add_post("/api/core/panic/on", handle_panic_on)
    app.router.add_post("/api/core/panic/off", handle_panic_off)
    app.router.add_get("/api/core/panic", handle_panic_status)
    app.router.add_post("/api/core/verdicts", handle_verdicts_post)
    app.router.add_get("/api/core/verdicts", handle_verdicts_get)
    app.router.add_get("/api/core/ratings", handle_ratings_all)
    app.router.add_get("/api/core/ratings/{agent_id}", handle_ratings_get)
    app.router.add_post("/api/core/ratings/{agent_id}/score", handle_ratings_score)

    return app


def run_server(base: Optional[Path] = None, supervisor: Optional[SupervisorV1] = None,
               host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> None:
    """Запуск API-сервера (CORE_MOCK=1 → mock-супервизор)."""
    # HERETIC #406: non-loopback bind без NEXUS_CORE_TOKEN = открытый RCE —
    # отказываем стартовать, а не работаем в insecure-режиме.
    if not _is_loopback_host(host) and not os.environ.get("NEXUS_CORE_TOKEN"):
        raise SystemExit(
            f"refusing to bind {host}: mutating endpoints would be exposed "
            "without auth — set NEXUS_CORE_TOKEN (HERETIC #406)")
    if not os.environ.get("NEXUS_CORE_TOKEN"):
        print("nexus-core: NEXUS_CORE_TOKEN not set — dev mode, "
              "mutating endpoints unauthenticated (loopback only)",
              file=sys.stderr)
    app = create_app(base, supervisor, host, port, pump=True)
    web.run_app(app, host=host, port=port, print=None)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="nexus-core API server")
    parser.add_argument("--host", default=DEFAULT_HOST, help="Bind host")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Bind port")
    parser.add_argument("--base", type=Path, default=DEFAULT_BASE, help="Base dir")
    args = parser.parse_args()
    run_server(base=args.base, host=args.host, port=args.port)
