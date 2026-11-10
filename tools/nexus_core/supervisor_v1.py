#!/usr/bin/env python3
"""
tools/nexus_core/supervisor_v1.py — супервизор v1 (N1).

Функции:
1. Локальный спавн PTY: Windows — ConPTY, Linux — forkpty, либо mock при
   CORE_MOCK=1.
2. Keep-alive: если терминал lost (умер/закрыт) — пере-спавн shell
   (как hc keep), пока keep=True.
3. OSC 7501-статусы: parsing потока вывода → working/blocked/idle/done,
   attention из blocked.
4. Адресация machine/term (по умолчанию machine="local").
5. Labels: словарь key=value у терминала.
"""

from __future__ import annotations

import asyncio
import gzip
import hmac
import json
import os
import re
import secrets
import sys
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

from tools.nexus_core.alert_rules import load_rules
from tools.nexus_core.machine_registry import VALID_NAME_RE
from tools.nexus_core.signed_json import (
    REGISTRY_KEY_ENV,
    REQUIRE_SIG_ENV,
    canonical_rows,
    sign_rows,
)
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.osc7501 import Osc7501Parser
from tools.nexus_core.pty_backend import PTYBackend, PTYHandle, SpawnSpec, default_shell, get_default_backend

# Сколько последних символов экрана держать в recent_output
# (GET /api/core/screen/<term> — хвост для NEWF, как `hc read --tail`).
RECENT_OUTPUT_CAP = 65536

# --- Registry trust (P-1 #398) ---------------------------------------------
# registry.json — единственная persistent-граница: всё, что из неё
# восстанавливается в spawn (cwd/env/command), потенциально враждебно.
# Три линии защиты: allowlist программ, санитизация cwd/env,
# опциональная HMAC-подпись файла (env NEXUS_REGISTRY_KEY).

# Программы, которым разрешено восстанавливаться из registry.
# env NEXUS_RESPAWN_ALLOWLIST — comma-separated имена/basename'ы;
# "*" — разрешить всё (явный opt-out).
DEFAULT_RESPAWN_ALLOWLIST = frozenset({
    "sh", "bash", "zsh", "fish", "nu",
    "cmd", "cmd.exe", "powershell", "powershell.exe",
    "pwsh", "pwsh.exe",
    "hc", "devin", "qoder", "codex", "claude", "gemini", "aider",
    "python", "python3", "python.exe", "node", "node.exe",
})
RESPAWN_ALLOWLIST_ENV = "NEXUS_RESPAWN_ALLOWLIST"
# REGISTRY_KEY_ENV / REQUIRE_SIG_ENV — общие с machine_registry (#419)
# из signed_json; имена остаются экспортируемыми отсюда.
# дополнительные trusted exec roots для path-команд (os.pathsep-список).
SAFE_ROOTS_ENV = "NEXUS_RESPAWN_SAFE_ROOTS"

# W67: schema versioning registry.json.
# v0 = legacy bare-list; v1 = {"v":1,"rows","sig"?}; v2 = текущая.
REGISTRY_SCHEMA_VERSION = 2


def _migrate_registry_v1_to_v2(rows: list) -> list:
    """W67: v1→v2 — нормализация row-полей под текущую схему.

    space: только str иначе None; labels: только str→str;
    frozen: bool; state_time: float-значения.
    """
    for row in rows:
        if not isinstance(row, dict):
            continue
        if not isinstance(row.get("space"), str) or not row["space"]:
            row["space"] = None
        labels = row.get("labels")
        row["labels"] = ({str(k): str(v) for k, v in labels.items()
                          if isinstance(k, str)}
                         if isinstance(labels, dict) else {})
        row["frozen"] = bool(row.get("frozen", False))
        st = row.get("state_time")
        row["state_time"] = ({str(k): float(v) for k, v in st.items()
                              if isinstance(v, (int, float))}
                             if isinstance(st, dict) else {})
    return rows


# target_version → fn(rows). Цепочка применяется по порядку.
REGISTRY_MIGRATIONS = {2: _migrate_registry_v1_to_v2}

# env-ключи, опасные при восстановлении: spec.env мёржится ПОВЕРХ
# os.environ в pty_backend — LD_PRELOAD/PATH/COMSPEC/BASH_ENV = code exec.
_DANGEROUS_ENV_EXACT = frozenset({
    "path", "pathext", "comspec", "shell",
    "ld_preload", "ld_library_path", "ld_audit", "ld_debug",
    "dyld_insert_libraries", "dyld_library_path",
    "dyld_fallback_library_path", "dyld_print_libraries",
    "pythonpath", "pythonstartup", "pythonhome", "pythoninspect",
    "bash_env", "env", "cdpath",
    # #404 addendum: shell rc / locator / agent-socket обходы
    "zdotdir", "home",
    "xdg_config_home", "xdg_config_dirs",
    "xdg_data_home", "xdg_data_dirs",
    "xdg_cache_home", "xdg_state_home", "xdg_runtime_dir",
    "ssh_auth_sock",
})
_DANGEROUS_ENV_PREFIXES = ("ld_", "dyld_")


def _respawn_allowlist() -> Optional[frozenset]:
    """None → allow all ('*'); иначе множество разрешённых имён."""
    raw = os.environ.get(RESPAWN_ALLOWLIST_ENV)
    if raw is None:
        return DEFAULT_RESPAWN_ALLOWLIST
    items = {x.strip().lower() for x in raw.split(",") if x.strip()}
    if "*" in items:
        return None
    return frozenset(items)


def _safe_exec_roots() -> tuple:
    """Trusted roots для command[0], заданного путём (#404 basename-
    evasion). Bare-имена идут через PATH и сюда не попадают.

    Дефолты: системные каталоги ОС + каталог sys.executable; env
    NEXUS_RESPAWN_SAFE_ROOTS (os.pathsep) добавляет корни. Намеренно
    БЕЗ home/temp — иначе /tmp/evil/bash и ~/evil пройдут."""
    roots = []
    try:
        roots.append(os.path.dirname(
            os.path.realpath(sys.executable)))
    except Exception:
        pass
    if os.name == "nt":
        env = os.environ
        for var in ("SystemRoot", "ProgramFiles", "ProgramFiles(x86)",
                    "ProgramData"):
            if env.get(var):
                roots.append(env[var])
        if env.get("LOCALAPPDATA"):
            roots.append(os.path.join(env["LOCALAPPDATA"], "Programs"))
        if env.get("APPDATA"):
            roots.append(os.path.join(env["APPDATA"], "npm"))
    else:
        roots += ["/usr", "/bin", "/sbin", "/opt", "/snap"]
    extra = os.environ.get(SAFE_ROOTS_ENV)
    if extra:
        roots += [p for p in extra.split(os.pathsep) if p.strip()]
    out = []
    for r in roots:
        try:
            out.append(os.path.normcase(
                os.path.realpath(os.path.abspath(r))))
        except (OSError, ValueError):
            continue
    return tuple(dict.fromkeys(out))


def _under_any_root(resolved: str, roots) -> bool:
    for root in roots:
        try:
            if os.path.commonpath([resolved, root]) == root:
                return True
        except ValueError:  # разные диски (Windows)
            continue
    return False


def _command_allowed(command, allowlist: Optional[frozenset],
                     safe_roots=None) -> bool:
    """basename/schedule-match command[0] против allowlist + path-trust.

    #404: basename-эвизия — '/evil/bash' проходил по имени 'bash'.
    Если command[0] содержит путь → resolved realpath обязан лежать под
    trusted exec root, либо точно совпадать с absolute-записью
    allowlist'а (NEXUS_RESPAWN_ALLOWLIST принимает и полные пути).
    Пустая команда → shell-путь → разрешено."""
    if allowlist is None or not command:
        return True
    prog_raw = str(command[0])
    has_path = bool(os.path.dirname(prog_raw))
    resolved = None
    if has_path:
        try:
            resolved = os.path.normcase(
                os.path.realpath(os.path.abspath(prog_raw)))
        except (OSError, ValueError):
            return False
        if safe_roots is None:
            safe_roots = _safe_exec_roots()
        for e in allowlist:
            if isinstance(e, str) and os.path.isabs(e):
                try:
                    if resolved == os.path.normcase(
                            os.path.realpath(os.path.abspath(e))):
                        return True  # exact absolute allowlist entry
                except (OSError, ValueError):
                    continue
    prog = os.path.basename(prog_raw).lower()
    stem = os.path.splitext(prog)[0]
    if prog not in allowlist and stem not in allowlist:
        return False
    if not has_path:
        return True  # bare-имя → PATH-lookup в pty_backend
    return _under_any_root(resolved, safe_roots)


def _sanitize_env(env) -> tuple[Optional[dict], int]:
    """registry env → (clean|None, stripped_count). Не-dict → (None, 0)."""
    if env is None:
        return None, 0
    if not isinstance(env, dict):
        return None, 0
    clean: dict = {}
    stripped = 0
    for k, v in env.items():
        if (not isinstance(k, str) or not k or "=" in k or "\x00" in k
                or v is None):
            stripped += 1
            continue
        kl = k.lower()
        if (kl in _DANGEROUS_ENV_EXACT
                or kl.startswith(_DANGEROUS_ENV_PREFIXES)):
            stripped += 1
            continue
        clean[k] = v if isinstance(v, str) else str(v)
    return (clean or None), stripped


def _sanitize_cwd(cwd) -> Optional[str]:
    """cwd должен существовать и быть каталогом — иначе None (default)."""
    if not isinstance(cwd, str) or not cwd:
        return None
    try:
        if os.path.isdir(cwd):
            return cwd
    except OSError:
        pass
    return None


def _term_env(env: Optional[dict], address: str) -> dict:
    """NX_TERMINAL_ID — hc $HC_TERMINAL_ID parity (#515): процесс внутри
    терминала знает свой канонический адрес без внешнего окружения.
    Инжектится ПОСЛЕ sanitize — значение генерит ядро, не клиент."""
    merged = dict(env or {})
    merged["NX_TERMINAL_ID"] = address
    return merged


def _registry_canonical(rows) -> bytes:
    return canonical_rows(rows)


def _registry_sig(rows, key: str) -> str:
    return sign_rows(rows, key)


@dataclass
class Terminal:
    """Терминал супервизора (адрес machine/term + состояние)."""

    name: str
    machine: str = "local"
    # W48: space-назначение (id спейса из spaces.json или machine).
    # None → терминал в space своей machine. Миграция через
    # POST /terminal/<n>/migrate — меняет только членство, PTY
    # и адрес (machine/name) не трогаются.
    space: Optional[str] = None
    command: list[str] = field(default_factory=list)
    cwd: Optional[str] = None
    env: Optional[dict] = None
    labels: dict[str, str] = field(default_factory=dict)
    note: Optional[str] = None
    locked: bool = False
    state: str = "idle"
    attention: bool = False
    keep: bool = True
    parent: Optional[str] = None
    die_with_parent: bool = False
    outlive_parent: bool = False
    last_output_at: float = field(default_factory=time.time)
    created_at: float = field(default_factory=time.time)
    exited_at: Optional[float] = None
    respawn_count: int = 0
    exit_code: Optional[int] = None
    recent_output: str = ""
    scrollback: deque = field(default_factory=lambda: deque(maxlen=2000))
    # W93: недописанный хвост последней строки — read()-чанки режут
    # вывод как попало; без буфера маркер, разрезанный границей чанка,
    # склеивался "\n" при чтении и grep по экрану его не находил.
    scrollback_pending: str = ""
    # W62: gzip-архив scrollback при idle — старые строки уходят
    # из deque в scrollback_gz (in-memory, не персистится).
    # Читается через scrollback_all() = archive + deque.
    scrollback_gz: Optional[bytes] = None
    scrollback_gz_count: int = 0
    # W12: маркеры-закладки {ts,label} — in-memory (scrollback-строка
    # персистится через recent_output, сам список — нет).
    markers: list = field(default_factory=list)
    # W14: метрики — сэмпл ~1с {ts,state,out_bps} + журнал переходов
    # state {ts,from,to}. In-memory only.
    metrics: deque = field(default_factory=lambda: deque(maxlen=1440))
    state_changes: deque = field(default_factory=lambda: deque(maxlen=500))
    _m_ts: float = field(default=0.0, init=False)
    _m_state: str = field(default="", init=False)
    _m_out: int = field(default=0, init=False)
    parent_reaped: bool = False
    missed_ticks: int = 0
    lost_reported: bool = False
    handle: Optional[PTYHandle] = None
    cols: int = 120
    rows: int = 30
    title: Optional[str] = None
    # W15: on-exit webhook URL — in-memory (endpoint /on-exit).
    exit_webhook: Optional[str] = None
    # W61: lifecycle webhooks [{events:[...], url}] — in-memory
    # (endpoint /on-event). Срабатывают на события из events-списка.
    lifecycle_webhooks: list = field(default_factory=list)
    # W20: история send-ввода {ts,text,enter} — для replay на
    # новый терминал. In-memory, кап 500.
    input_log: deque = field(
        default_factory=lambda: deque(maxlen=500))
    # W21: freeze — step_once пропускает терминал целиком
    # (PTY-вывод копится в OS-буфере до resume).
    frozen: bool = False
    # W24: cost-tracker — кумулятивные output-байты и время по
    # состояниям {state: seconds}. Персистится через to_dict/registry.
    out_bytes: int = 0
    state_time: dict = field(default_factory=dict)
    _st_ts: float = field(default_factory=time.time)
    # W49: ленивый search-индекс scrollback — fingerprint
    # (len,first,last) + blob/offsets для C-speed find.
    # Мутации scrollback только append-right + evict-left
    # (maxlen) → fingerprint достаточен.
    _sidx_key: tuple = field(default=None, init=False)
    _sidx_lines: list = field(default=None, init=False)
    _sidx_blob: str = field(default="", init=False)
    _sidx_offsets: list = field(default=None, init=False)
    # W51: output rate-limit — sliding 1с-окно {ts,bytes,dropped}.
    _rl_ts: float = field(default=0.0, init=False)
    _rl_bytes: int = field(default=0, init=False)
    _rl_dropped: int = field(default=0, init=False)

    @property
    def address(self) -> str:
        return f"{self.machine}/{self.name}"

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "machine": self.machine,
            "space": self.space,
            "address": self.address,
            "command": list(self.command),
            "cwd": self.cwd,
            "labels": dict(self.labels),
            "note": self.note,
            "locked": self.locked,
            "state": self.state,
            "frozen": self.frozen,
            "out_bytes": self.out_bytes,
            "state_time": dict(self.state_time),
            "attention": self.attention,
            "keep": self.keep,
            "parent": self.parent,
            "die_with_parent": self.die_with_parent,
            "outlive_parent": self.outlive_parent,
            "exit_code": self.exit_code,
            "created_at": self.created_at,
            "exited_at": self.exited_at,
            "respawn_count": self.respawn_count,
            "cols": self.cols,
            "rows": self.rows,
            "title": self.title,
            "last_output_at": self.last_output_at,
            # recent_output в registry → adoption восстанавливает экран (RFC §10)
            "recent_output": self.recent_output,
        }


def parse_address(address: str) -> tuple[str, str]:
    """Разбирает "<machine>/<term>" → (machine, term)."""
    if not isinstance(address, str) or "/" not in address:
        raise ValueError(f"invalid terminal address: {address!r}")
    machine, term = address.split("/", 1)
    machine, term = machine.strip(), term.strip()
    if not machine or not term:
        raise ValueError(f"invalid terminal address: {address!r}")
    return machine, term


_FILE_PIPE_MAX = 256 * 1024 * 1024  # W25: 256MB на pipe-file


class SupervisorV1:
    """Супервизор v1: спавн, keep-alive, OSC-статусы, labels."""

    def __init__(
        self,
        backend: Optional[PTYBackend] = None,
        machine: str = "local",
        keep_alive: bool = True,
        event_sink: Optional[Callable[[dict], None]] = None,
        registry_path: Optional[os.PathLike] = None,
        missed_tick_threshold: int = 2,
        restore: bool = True,
    ):
        self.backend = backend if backend is not None else _default_backend()
        self.machine = machine
        self.keep_alive = keep_alive
        self.event_sink = event_sink
        self.missed_tick_threshold = max(1, int(missed_tick_threshold))
        self.last_step_ts = 0.0
        self.terminals: dict[str, Terminal] = {}
        self.events: list[dict] = []
        # W9: output-pipes src_address → [dst_address]; вывод src
        # пишется в stdin dst на каждом step_once (сырые байты).
        self.pipes: dict[str, list[str]] = {}
        # W15: очередь exit-webhooks {url,payload,ts}; заполняется в
        # _emit("exited"), разбирается api-drain-таском (async HTTP).
        self.pending_webhooks: deque = deque(maxlen=1000)
        self.alert_history: deque = deque(maxlen=500)
        self.dead_webhooks: list = []
        # W25: file-pipes address → sandbox-rel path; сырой вывод
        # терминала дозаписывается в файл через file_sink (api
        # подключает FileOps.append_bytes).
        self.file_pipes: dict[str, str] = {}
        self.file_sink: Optional[Callable[[str, bytes], None]] = None
        # W45: ротация при превышении file_pipe_max — file_rotator
        # (api подключает FileOps.rotate → path.1). None → старое
        # поведение: file_pipe_full + стоп записи.
        self.file_rotator: Optional[Callable[[str], bool]] = None
        self.file_pipe_max: int = _FILE_PIPE_MAX
        self._file_pipe_bytes: dict[str, int] = {}
        self._file_pipe_full: set[str] = set()
        # W26: alert rules — сработавшие (addr,rule_id) для once:true;
        # alert_rules_path=None → tools/nexus_core/alert_rules.json
        self._alert_fired: set = set()
        self.alert_rules_path: Optional[os.PathLike] = None
        # W96: pump крутит step_once через asyncio.to_thread (worker-поток),
        # а HTTP-хендлеры мутируют терминалы в loop-потоке — scrollback-
        # поверхность (deque/pending/gz/recent_output) защищена локом.
        self._sb_lock = threading.RLock()
        self.alert_rule_disabled: set = set()
        self.alert_rules_extra: list = []
        # W27: именованные группы терминалов (in-memory, api-слой):
        # {name: {"name","members":[addr],"created_at","updated_at"}}
        self.groups: dict[str, dict] = {}
        # W30: отложенные рассылки {id,terms,text,enter,at_ts,...}
        self.scheduled_sends: list[dict] = []
        self._sched_seq = 0
        # W47: capacity forecast — ~5с сэмплы {ts,live,mem_free_mb},
        # кольцевой буфер ~4ч. Читается /capacity/forecast.
        self.capacity_history: deque = deque(maxlen=2880)
        self._cap_ts = 0.0
        # W51: output rate-limit bytes/sec на терминал.
        # env NEXUS_OUT_RATE (default 4MiB; ≤0 → unlimited).
        # Per-term override — label `_out_rate` ("0" → unlimited).
        try:
            self.out_rate_limit = int(os.environ.get(
                "NEXUS_OUT_RATE", str(4 * 1024 * 1024)))
        except ValueError:
            self.out_rate_limit = 4 * 1024 * 1024
        # W56: send-queue — буфер ввода по адресу; drain в
        # step_once когда терминал жив и не frozen. In-memory.
        self.send_queues: dict[str, list] = {}
        self._sendq_seq = 0
        self.send_queue_max = 100
        # W62: gzip-сжатие scrollback при idle.
        # NEXUS_SBC_IDLE — секунд без вывода (default 120),
        # NEXUS_SBC_MIN — мин. строк в deque (default 500).
        # ≤0 по любому → авто-режим выключен.
        try:
            self.sbc_idle_s = float(os.environ.get(
                "NEXUS_SBC_IDLE", "120"))
            self.sbc_min_lines = int(os.environ.get(
                "NEXUS_SBC_MIN", "500"))
        except ValueError:
            self.sbc_idle_s, self.sbc_min_lines = 120.0, 500
        self._last_sbc_scan = 0.0
        # W63: sharing tokens — read-only view-доступ к терминалу.
        # In-memory {token: {term,scopes,expires,created,hits}}.
        self.share_tokens: dict[str, dict] = {}
        self.share_ttl_default = 3600.0
        self.share_ttl_max = 86400.0
        # W34: кумулятивные счётчики для /api/core/metrics
        self._counters = {"created": 0, "exited": 0, "events": 0}
        self.started_at = time.time()
        # W36: prev-scrollback для screens?format=diff
        # {addr: [lines]} — in-memory, обновляется на diff-запросах
        self.screen_prev: dict[str, list] = {}
        # W37: per-space (machine) idle-kick TTL {machine: seconds};
        # ≤0 выключает kick для space. Синхронизируется из api
        # spaces.json idle_ttl (create_app) + PUT idle-policy.
        self.space_idle_ttl: dict[str, float] = {}
        # W17: idle-kick TTL (сек); ≤0 — выключено. Label `_idle_ttl`
        # на терминале перекрывает глобальное значение (0 = opt-out).
        try:
            self.idle_ttl = float(os.environ.get("NEXUS_IDLE_TTL", "0"))
        except ValueError:
            self.idle_ttl = 0.0
        self._last_idle_scan = 0.0
        # W18: auto-purge exited старше N сек (env NEXUS_EXIT_TTL,
        # default 60; endpoint может задать свой ttl разово).
        try:
            self.exit_ttl = max(0.0, float(
                os.environ.get("NEXUS_EXIT_TTL", "60")))
        except ValueError:
            self.exit_ttl = 60.0
        self._parsers: dict[str, Osc7501Parser] = {}
        self._status_seen: set[str] = set()
        self._registry_path = os.fspath(registry_path) if registry_path is not None else None
        self._registry_restored = self._registry_path is None
        self._restore_started = False
        self._restore_done = 0
        self._restore_failed = 0
        # W29: pipes-топология рядом с registry (pipes.json) —
        # переживает restart; нет registry_path → in-memory only.
        self._pipes_path = (Path(self._registry_path).with_name(
            "pipes.json") if self._registry_path else None)
        self._load_pipes()
        if restore and self._registry_path is not None:
            self._restore_started = True
            self._load_registry()
            self._registry_restored = True

    @property
    def restore_status(self) -> dict[str, int]:
        """Live counters; pending is derived from the actual restoring states."""
        return {
            "pending": sum(t.state == "restoring" for t in self.terminals.values()),
            "done": self._restore_done,
            "failed": self._restore_failed,
        }

    def restore_registry(self) -> None:
        if self._registry_restored:
            return
        if self._registry_path is None:
            self._registry_restored = True
            return
        if self._restore_started:
            return
        self._restore_started = True
        self._load_registry()
        self._registry_restored = True

    async def restore_registry_async(self) -> None:
        """Queue restored terminals, then spawn at most two per level.

        Parent levels finish before children start. This keeps dependencies
        intact while allowing independent terminals to restore concurrently.
        """
        if self._registry_restored:
            return
        if self._registry_path is None:
            self._registry_restored = True
            return
        if self._restore_started:
            return
        self._restore_started = True
        queue = self._load_registry(defer_spawn=True) or []
        semaphore = asyncio.Semaphore(2)

        async def spawn_one(term: Terminal) -> None:
            shell = default_shell()
            spec = SpawnSpec(
                command=shell, cwd=term.cwd, env=term.env,
                cols=term.cols, rows=term.rows,
            )
            async with semaphore:
                try:
                    handle = await asyncio.to_thread(self.backend.spawn, spec)
                except Exception as exc:
                    self._restore_spawn_failed(term, exc)
                else:
                    self._restore_spawn_succeeded(term, shell, handle)

        try:
            for level in self._restore_levels(queue):
                # gather schedules the level in registry order; the semaphore
                # bounds in-flight spawns while preserving FIFO acquisition.
                await asyncio.gather(*(spawn_one(term) for term in level))
        finally:
            self._registry_restored = True
            self._save_registry()

    def _restore_levels(self, queue: list[Terminal]) -> list[list[Terminal]]:
        """Stable topological levels: a queued parent always precedes its child."""
        by_address = {term.address: term for term in queue}
        depths: dict[str, int] = {}

        def depth(term: Terminal, visiting: frozenset[str] = frozenset()) -> int:
            if term.address in depths:
                return depths[term.address]
            if term.address in visiting:
                return 0  # malformed cycle: preserve stable order, do not recurse
            parent = term.parent
            parent_term = None
            if parent:
                parent_term = by_address.get(parent)
                if parent_term is None and "/" not in parent:
                    parent_term = by_address.get(f"{term.machine}/{parent}")
            result = 0 if parent_term is None else 1 + depth(
                parent_term, visiting | {term.address})
            depths[term.address] = result
            return result

        levels: list[list[Terminal]] = []
        for term in queue:
            level = depth(term)
            while len(levels) <= level:
                levels.append([])
            levels[level].append(term)
        return levels

    def _restore_spawn_succeeded(self, term: Terminal, shell: list[str], handle) -> None:
        term.handle = handle
        term.command = shell
        term.respawn_count += 1
        term.state = "idle"
        term.attention = False
        self._restore_done += 1
        self._emit("respawn", {"address": term.address,
                                "count": term.respawn_count,
                                "recovery": "shell"})
        self._save_registry()

    def _restore_spawn_failed(self, term: Terminal, exc: Exception) -> None:
        term.handle = None
        term.state = "lost"
        self._restore_failed += 1
        self._emit("respawn_failed", {"address": term.address,
                                      "error": str(exc)})
        self._save_registry()
    # -------------------------------------------------------------------------
    # Управление терминалами
    # -------------------------------------------------------------------------

    def create_terminal(
        self,
        name: str,
        command: Optional[list[str]] = None,
        labels: Optional[dict[str, str]] = None,
        cwd: Optional[str] = None,
        machine: Optional[str] = None,
        keep: Optional[bool] = None,
        env: Optional[dict] = None,
        parent: Optional[str] = None,
        die_with_parent: Optional[bool] = None,
        outlive_parent: bool = False,
        cols: int = 120,
        rows: int = 30,
    ) -> Terminal:
        """Создаёт терминал и спавнит PTY.

        die-with-parent по умолчанию ВКЛЮЧЁН (RFC §12 MUST); outlive_parent —
        явный opt-out. Явный die_with_parent=False отключает.
        """
        if not isinstance(name, str) or not VALID_NAME_RE.fullmatch(name):
            raise ValueError(
                f"invalid terminal name {name!r} (1-32 of a-z 0-9 _ -)"
            )
        m = machine or self.machine
        address = f"{m}/{name}"
        if address in self.terminals:
            raise ValueError(f"terminal already exists: {address}")
        if outlive_parent:
            eff_die = False
        elif die_with_parent is None:
            eff_die = True
        else:
            eff_die = die_with_parent
        # HERETIC #424: env/cwd из API-клиента — тот же недоверенный канал,
        # что и registry при respawn/load → sanitize до SpawnSpec, иначе
        # LD_PRELOAD/PYTHONPATH обходят фильтр на первом спавне.
        cwd_orig = cwd
        cwd = _sanitize_cwd(cwd)
        env, env_stripped = _sanitize_env(env)
        env = _term_env(env, address)
        cwd_fixed = cwd != cwd_orig
        spec = SpawnSpec(
            command=command if command is not None else default_shell(),
            cwd=cwd,
            env=env,
            cols=cols,
            rows=rows,
        )
        handle = self.backend.spawn(spec)
        term = Terminal(
            name=name,
            machine=m,
            command=spec.command,
            cwd=cwd,
            env=env,
            labels=dict(labels or {}),
            keep=self.keep_alive if keep is None else keep,
            parent=parent,
            die_with_parent=eff_die,
            outlive_parent=outlive_parent,
            handle=handle,
            cols=cols,
            rows=rows,
        )
        self.terminals[address] = term
        self._counters["created"] += 1  # W34
        self._emit("spawn", {"address": address, "term": name, "machine": m})
        self._emit("created", {"address": address, "term": name, "machine": m})
        if env_stripped or cwd_fixed:
            self._emit("spawn_sanitized", {
                "address": address,
                "cwd_fixed": cwd_fixed,
                "env_stripped": env_stripped,
            })
        self._emit("size", {"address": address, "cols": cols, "rows": rows})
        if parent:
            self._emit("turn", {"address": address, "parent": parent})
        self._save_registry()
        return term

    def get_terminal(self, address: str) -> Optional[Terminal]:
        """По адресу "machine/term" или короткому "term" (в self.machine)."""
        if address in self.terminals:
            return self.terminals[address]
        return self.terminals.get(f"{self.machine}/{address}")

    def resize_terminal(self, address: str, cols: int, rows: int) -> Terminal:
        """Меняет размер PTY и сохраняет его для последующего respawn."""
        for value, name in ((cols, "cols"), (rows, "rows")):
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError(f"{name} must be an integer")
            if not 1 <= value <= 65535:
                raise ValueError(f"{name} out of range 1..65535")

        term = self.get_terminal(address)
        handle = term.handle if term is not None else None
        if (
            term is None
            or term.state == "exited"
            or handle is None
            or not handle.alive()
        ):
            raise KeyError(address)

        # Сначала PTY: если resize завершится ошибкой, сохранённый размер
        # остаётся согласован с фактическим. У базового backend resize no-op.
        handle.resize(cols, rows)
        term.cols = cols
        term.rows = rows
        self._emit("size", {"address": term.address, "cols": cols, "rows": rows})
        self._save_registry()
        return term

    def list_terminals(self) -> list[Terminal]:
        # lazy-clean: при чтении реестра подчищаем завершившиеся (registry-leak fix #371)
        self.purge_exited(self.exit_ttl)
        return sorted(self.terminals.values(), key=lambda t: t.address)

    def purge_exited(self, exited_ttl: float = 60.0,
                     dry_run: bool = False) -> int:
        """Удаляет exited-терминалы старше exited_ttl секунд и эмитит removed.

        Репорт-фикс #371: exited-терминалы раньше никогда не чистились —
        реестр рос без ограничений. Теперь:
          - вызвается из list_terminals (lazy, при чтении);
          - дополнительно периодически из step_once / _purge_tick.
        W18: dry_run=True — только посчитать, ничего не удаляя.
        Возвращает число удалённых (или кандидатов при dry_run).
        """
        now = time.time()
        removed = 0
        stale = []
        for address, term in self.terminals.items():
            if term.state != "exited":
                continue
            exited_at = term.exited_at if term.exited_at is not None else term.created_at
            if exited_at is not None and (now - exited_at) >= exited_ttl:
                stale.append(address)
        if dry_run:
            return len(stale)
        for address in stale:
            term = self.terminals.pop(address, None)
            if term is None:
                continue
            self._parsers.pop(address, None)
            removed += 1
            self._emit("removed", {"address": address, "reason": "exited_ttl", "exit_code": term.exit_code})
        if removed and self._registry_path is not None:
            self._save_registry()
        return removed

    def restart_terminal(self, address: str) -> Terminal:
        term = self.get_terminal(address)
        if term is None:
            raise KeyError(f"terminal not found: {address}")
        if term.state not in ("exited", "failed"):
            raise ValueError("terminal still running")
        spec = SpawnSpec(
            command=list(term.command) if term.command else default_shell(),
            cwd=term.cwd,
            env=dict(term.env) if term.env else None,
            cols=term.cols,
            rows=term.rows,
        )
        handle = self.backend.spawn(spec)
        term.handle = handle
        term.command = spec.command
        term.cwd = spec.cwd
        term.env = spec.env
        term.state = "idle"
        term.exit_code = None
        term.exited_at = None
        self.scrollback_clear(term)
        term.respawn_count += 1
        self._parsers.pop(address, None)
        self._emit("restarted", {"address": address, "count": term.respawn_count})
        return term

    # -- scrollback surface (W96: _sb_lock — pump thread ↔ loop thread) ---

    def scrollback_clear(self, term: Terminal) -> None:
        """Полная очистка scrollback-поверхности: deque + pending-хвост +
        gzip-архив + recent_output. Иначе после reset scrollback_all()
        воскрешал stale-строки из scrollback_gz (W96-4)."""
        with self._sb_lock:
            term.scrollback_pending = ""
            term.scrollback_gz = None
            term.scrollback_gz_count = 0
            term.recent_output = ""
            try:
                term.scrollback.clear()
            except Exception:
                pass

    def scrollback_extend(self, term: Terminal, lines) -> None:
        """Locked-append готовых строк (restore/import/marker из api-слоя)."""
        with self._sb_lock:
            term.scrollback.extend(lines)

    def mark_observed(self, address: str) -> bool:
        """Наблюдение терминала клиентом (screen-read/агенты-листинг).

        RFC §11.1 K2-1: done (закончил без наблюдателя) → idle при наблюдении
        [MUST]. Сбрасывает attention и эмитит статус c prev=done.

        Возвращает True, если произошёл переход done→idle.
        """
        term = self.get_terminal(address)
        if term is None or term.state != "done":
            return False
        prev = term.state
        term.state = "idle"
        term.attention = False
        self._emit("status", {"address": term.address, "state": "idle", "prev": prev})
        return True

    def set_labels(self, address: str, labels: dict[str, str]) -> None:
        term = self.get_terminal(address)
        if term is None:
            raise KeyError(f"terminal not found: {address}")
        term.labels.update(labels)
        self._emit("labels", {"address": term.address, "labels": dict(term.labels)})
        self._save_registry()

    def rename_terminal(self, address: str, new_name: str) -> Terminal:
        """Переименовывает терминал: меняется КЛЮЧ (name → address).

        Выбор #550: отдельного display-name поля нет (`title` —
        OSC-owned, перезаписывается шеллом), поэтому herdr-семантика
        «session-id стабилен, имя меняется» у нас = смена адреса.
        Сохраняется всё: spec/labels/created_at/respawn_count/recent_output
        (тот же Terminal-объект), registry-запись переписывается под
        новым именем → rename переживает рестарт.

        Дочерние терминалы: parent-ссылки на старый адрес переписываются
        на новый (die-with-parent/turn-связи не рвутся).
        new_name==текущее — идемпотентный no-op. Занятое/невалидное имя
        → ValueError; неизвестный адрес → KeyError.
        """
        term = self.get_terminal(address)
        if term is None:
            raise KeyError(f"terminal not found: {address}")
        if not isinstance(new_name, str) or not VALID_NAME_RE.fullmatch(new_name):
            raise ValueError(
                f"invalid terminal name {new_name!r} (1-32 of a-z 0-9 _ -)"
            )
        new_address = f"{term.machine}/{new_name}"
        if new_address == term.address:
            return term
        if new_address in self.terminals:
            raise ValueError(f"terminal already exists: {new_address}")
        old_address = term.address
        for other in self.terminals.values():
            if other.parent in (old_address, term.name):
                other.parent = new_address
        del self.terminals[old_address]
        term.name = new_name
        self.terminals[new_address] = term
        self._parsers.pop(old_address, None)
        # #570: address = актуальный адрес терминала после rename —
        # data.term заполняется каналом как у прочих терминальных событий.
        self._emit("renamed", {"old": old_address, "new": new_address,
                               "address": new_address})
        self._save_registry()
        return term

    # -- output pipes (W9) ---------------------------------------------------

    def _load_pipes(self) -> None:
        """W29: pipes.json → self.pipes (best-effort, битый файл → {})."""
        if self._pipes_path is None:
            return
        try:
            data = json.loads(
                Path(self._pipes_path).read_text(encoding="utf-8"))
            raw = data.get("pipes", data) if isinstance(data, dict) else {}
            for src, dsts in raw.items():
                if (isinstance(src, str) and isinstance(dsts, list)
                        and all(isinstance(d, str) for d in dsts)):
                    self.pipes[src] = list(dict.fromkeys(dsts))
            # W25 file-pipes — та же персистентность
            fraw = data.get("file_pipes", {}) if isinstance(
                data, dict) else {}
            if isinstance(fraw, dict):
                for addr, path in fraw.items():
                    if isinstance(addr, str) and isinstance(path, str):
                        self.file_pipes[addr] = path
                        self._file_pipe_bytes[addr] = 0
        except Exception:
            pass

    def _save_pipes(self) -> None:
        """W29: self.pipes → pipes.json (atomic tmp+replace)."""
        if self._pipes_path is None:
            return
        try:
            path = Path(self._pipes_path)
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(
                {"pipes": {s: list(ds) for s, ds in self.pipes.items()},
                 "file_pipes": dict(self.file_pipes)},
                ensure_ascii=False, indent=2), encoding="utf-8")
            os.replace(tmp, path)
        except Exception:
            pass

    def add_pipe(self, src: str, dst: str) -> dict:
        """Регистрирует pipe src→dst: каждый чанк вывода src пишется
        в stdin dst (как `a | b` в tmux pipe-pane). Идемпотентно."""
        targets = self.pipes.setdefault(src, [])
        if dst not in targets:
            targets.append(dst)
            self._save_pipes()  # W29 persist
        self._emit("pipe", {"src": src, "dst": dst, "op": "add"})
        return {"src": src, "dst": dst}

    def remove_pipe(self, src: str, dst: Optional[str] = None) -> int:
        """Снимает pipe(s). dst=None → все от src. Возвращает число."""
        removed = 0
        targets = self.pipes.get(src)
        if targets is not None:
            if dst is None:
                removed = len(targets)
                for d in targets:
                    self._emit("pipe",
                               {"src": src, "dst": d, "op": "remove"})
                del self.pipes[src]
                if removed:
                    self._save_pipes()  # W29 persist
            else:
                kept = [d for d in targets if d != dst]
                removed = len(targets) - len(kept)
                if kept:
                    self.pipes[src] = kept
                else:
                    del self.pipes[src]
                if removed:
                    self._emit("pipe",
                               {"src": src, "dst": dst, "op": "remove"})
                    self._save_pipes()  # W29 persist
        return removed

    def list_pipes(self) -> list[dict]:
        return [{"src": s, "dst": d}
                for s, ds in self.pipes.items() for d in ds]

    # -- file pipes (W25) ----------------------------------------------------

    def add_file_pipe(self, src: str, path: str) -> dict:
        """Регистрирует pipe src→file: сырой вывод src дозаписывается
        в sandbox-файл (через file_sink). Один файл на src —
        повторный add перенацеливает. Идемпотентно."""
        self.file_pipes[src] = path
        self._file_pipe_bytes[src] = 0
        self._file_pipe_full.discard(src)
        self._save_pipes()  # W29 persist
        self._emit("file_pipe", {"src": src, "path": path,
                                 "op": "add"})
        return {"src": src, "path": path}

    def remove_file_pipe(self, src: str) -> bool:
        """Снимает file-pipe src. True если был."""
        existed = self.file_pipes.pop(src, None) is not None
        if existed:
            self._save_pipes()  # W29 persist
            self._emit("file_pipe", {"src": src, "op": "remove"})
        return existed

    def list_file_pipes(self) -> list[dict]:
        return [{"src": s, "path": p,
                 "bytes": self._file_pipe_bytes.get(s, 0),
                 "full": s in self._file_pipe_full}
                for s, p in self.file_pipes.items()]

    def set_keep(self, address: str, keep: bool) -> bool:
        """Включает/выключает keep-alive + эмитит событие keep."""
        term = self.get_terminal(address)
        if term is None:
            return False
        term.keep = bool(keep)
        self._emit("keep", {"address": term.address, "keep": term.keep})
        self._save_registry()
        return True

    # -------------------------------------------------------------------------
    # I/O
    # -------------------------------------------------------------------------

    @staticmethod
    def _write(term: Terminal, data: bytes) -> bool:
        """Пишет в PTY-хендл; мёртвый/закрытый хендл → False (не 500)."""
        if term.handle.closed:
            return False
        try:
            term.handle.write(data)
            return True
        except (RuntimeError, OSError):
            return False

    def send(self, address: str, text: str, enter: bool = True) -> bool:
        """Пишет текст в терминал (paste+enter по умолчанию)."""
        term = self.get_terminal(address)
        if term is None or term.handle is None:
            return False
        data = text if not enter else text + "\r"
        ok = self._write(term, data.encode("utf-8"))
        if ok:
            # W20: send-последовательность для replay
            term.input_log.append({
                "ts": time.time(), "text": text,
                "enter": bool(enter)})
        return ok

    def keys(self, address: str, keys: list[str]) -> bool:
        """Отправляет спец-клавиши (ctrl+c, enter, esc, ...)."""
        term = self.get_terminal(address)
        if term is None or term.handle is None:
            return False
        keymap = {
            "ctrl+c": b"\x03",
            "ctrl+d": b"\x04",
            "enter": b"\r",
            "esc": b"\x1b",
            "up": b"\x1b[A",
            "down": b"\x1b[B",
            "left": b"\x1b[D",
            "right": b"\x1b[C",
            "tab": b"\t",
            "shift+tab": b"\x1b[Z",
            "backspace": b"\x7f",
            "delete": b"\x1b[3~",
            "insert": b"\x1b[2~",
            "home": b"\x1b[H",
            "end": b"\x1b[F",
            "pgup": b"\x1b[5~",
            "pagedown": b"\x1b[6~",
            "pgdn": b"\x1b[6~",
            "f1": b"\x1bOP",
            "f2": b"\x1bOQ",
            "f3": b"\x1bOR",
            "f4": b"\x1bOS",
            "f5": b"\x1b[15~",
            "f6": b"\x1b[17~",
            "f7": b"\x1b[18~",
            "f8": b"\x1b[19~",
            "f9": b"\x1b[20~",
            "f10": b"\x1b[21~",
            "f11": b"\x1b[23~",
            "f12": b"\x1b[24~",
            "ctrl+\\": b"\x1c",
            "ctrl+z": b"\x1a",
        }
        data = b""
        for k in keys:
            key = str(k).lower()
            data += keymap.get(key, key.encode("utf-8"))
        return self._write(term, data)

    def interrupt(self, address: str) -> bool:
        """'press the stop key' (Esc-стоп программе) + событие."""
        term = self.get_terminal(address)
        if term is None or term.handle is None:
            return False
        if not self._write(term, b"\x1b"):
            return False
        self._emit("interrupt", {"address": term.address})
        return True

    def park(self, address: str) -> bool:
        """Паркует терминал: отключает keep-alive."""
        term = self.get_terminal(address)
        if term is None:
            return False
        term.keep = False
        self._emit("park", {"address": term.address})
        return True

    # -------------------------------------------------------------------------
    # Wait-семантика
    # -------------------------------------------------------------------------

    def wait_for_exit(
        self,
        address: str,
        timeout: Optional[float] = None,
        children: Optional[str] = None,
        output: Optional[str] = None,
    ) -> Optional[dict]:
        """Ждёт exit терминала (или матч нового вывода).

        Возвращает None по таймауту, иначе dict с exit-состоянием:
            {"state": "exited", "exit_code": ...}
            {"state": "exited", "children": [...]}     (children-режим)
            {"state": "output_match", "matched": <str>}
        `children="any"` ждёт завершения ЛЮБОГО дочернего терминала,
        `children="all"` — всех.
        """
        deadline = None if timeout is None else time.monotonic() + timeout
        wait_set = self.children(address) if children else [address]
        pending = set(wait_set)
        while True:
            if deadline is not None and time.monotonic() >= deadline:
                return None
            if output is not None:
                term = self.get_terminal(address) if not children else self._child_in_pending(pending)
                if term is not None and term.handle is not None:
                    chunk = term.handle.read(timeout=0)
                    if chunk:
                        try:
                            text = chunk.decode("utf-8", errors="replace")
                        except Exception:
                            text = ""
                        if output in text:
                            return {"state": "output_match", "matched": output}
            finished: list[str] = []
            for addr in list(pending):
                term = self.get_terminal(addr)
                if term is None or term.handle is None:
                    finished.append(addr)
                    pending.discard(addr)
                    continue
                if not term.handle.alive():
                    finished.append(addr)
                    pending.discard(addr)
                    continue
                if term.handle.closed:
                    finished.append(addr)
                    pending.discard(addr)
            if children:
                if pending and children == "any" and finished:
                    return {"state": "exited", "children": sorted(finished)}
                if not pending:
                    return {"state": "exited", "children": sorted(wait_set)}
            elif finished:
                term = self.get_terminal(address)
                return {
                    "state": "exited",
                    "exit_code": term.exit_code if term is not None else None,
                }
            time.sleep(0.02)

    def children(self, address: str) -> list[str]:
        """Адреса дочерних терминалов (parent-поле = address)."""
        return sorted(
            t.address for t in self.terminals.values() if t.parent == address
        )

    def wait_ready(self, address: str, timeout: float = 15.0) -> bool:
        """Крутит step_once, пока терминал не пришлёт первый OSC-статус."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if address not in self.terminals:
                return False
            term = self.terminals[address]
            if term.handle is None:
                return False
            self.step_once()
            if address in self._status_seen:
                return True
            time.sleep(0.02)
        return False

    def _child_in_pending(self, pending: set) -> Optional[Terminal]:
        for addr in pending:
            term = self.get_terminal(addr)
            if term is not None:
                return term
        return None

    def _parent_of(self, address: str) -> Optional[str]:
        term = self.get_terminal(address)
        return term.parent if term is not None else None

    # -------------------------------------------------------------------------
    # Управление терминалами (пары)
    # -------------------------------------------------------------------------

    def destroy_terminal(self, address: str, keep: bool = False) -> None:
        """Закрывает терминал; при keep=False — с удалением из реестра."""
        term = self.terminals.pop(address, None)
        if term is None:
            term = self.terminals.pop(f"{self.machine}/{address}", None)
        if term is None:
            return
        if term.handle is not None:
            try:
                term.handle.close()
            except Exception:
                pass
            term.handle = None
        if not keep:
            self._emit("removed", {"address": address})

    # -------------------------------------------------------------------------
    # Цикл надзора
    # -------------------------------------------------------------------------

    def step_once(self) -> int:
        """Один цикл: читает вывод, применяет OSC-статусы, респаунит lost.

        Возвращает число произошедших переходов статуса (для событий).
        """
        transitions = 0
        for address, term in list(self.terminals.items()):
            if term.frozen:  # W21: pump приостановлен для терминала
                continue
            # W24: учёт времени в текущем state (тик-гранулярность)
            tnow = time.time()
            if term._st_ts:
                dt = tnow - term._st_ts
                if dt > 0:
                    term.state_time[term.state] = (
                        term.state_time.get(term.state, 0.0) + dt)
                term._st_ts = tnow
            parser = self._parser_for(address)
            produced = False
            if term.handle is not None:
                try:
                    data = term.handle.read(timeout=0)
                except Exception:
                    data = b""
                if data:
                    # W51: output rate-limit — sliding 1с-окно.
                    # Превышение → чанк дропается целиком (не
                    # портит UTF-8/ANSI посередине), dropped копится
                    # до output_limited на границе окна. Drop не
                    # трогает alive-check/respawn ниже.
                    limit = self._term_out_rate(term)
                    if limit:
                        rnow = time.time()
                        if rnow - term._rl_ts >= 1.0:
                            if term._rl_dropped:
                                self._emit("output_limited", {
                                    "address": term.address,
                                    "dropped_bytes":
                                        term._rl_dropped})
                                term._rl_dropped = 0
                            term._rl_ts = rnow
                            term._rl_bytes = 0
                        if term._rl_bytes + len(data) > limit:
                            term._rl_dropped += len(data)
                            data = b""
                            # W96-3: дроп разрывает строку — pending-
                            # фрагмент коммитим отдельной строкой, иначе
                            # следующий принятый чанк молча склеится с
                            # чужим хвостом (потерянная середина).
                            with self._sb_lock:
                                if term.scrollback_pending:
                                    term.scrollback.append(
                                        term.scrollback_pending.rstrip("\r"))
                                    term.scrollback_pending = ""
                        else:
                            term._rl_bytes += len(data)
                if data:
                        produced = True
                        term._m_out += len(data)  # W14 output-rate
                        term.out_bytes += len(data)  # W24 cumulative
                        term.recent_output = (
                            term.recent_output + data.decode("utf-8", errors="replace")
                        )[-RECENT_OUTPUT_CAP:]
                        # W93: склейка недописанной строки между чанками.
                        # read() возвращает куски ReadFile как есть — граница
                        # может попасть посреди токена; splitlines() на каждом
                        # чанке порознь превращал её в фантомный "\n" и ломал
                        # grep по экрану (флейк e2e 'screen' 44/45).
                        # W96: весь блок под _sb_lock — step_once живёт в
                        # worker-потоке (to_thread), reset'ы — в loop-потоке.
                        with self._sb_lock:
                            _txt = term.scrollback_pending + data.decode(
                                "utf-8", errors="replace")
                            term.scrollback_pending = ""
                            if _txt.endswith("\r"):
                                # \r на краю может оказаться первой половиной
                                # \r\n следующего чанка — ждём его, иначе
                                # получили бы фантомную пустую строку.
                                _txt, _tail = _txt[:-1], "\r"
                            else:
                                _tail = ""
                            _idx = max(_txt.rfind("\n"), _txt.rfind("\r"))
                            if _idx >= 0:
                                term.scrollback.extend(
                                    _txt[: _idx + 1].splitlines())
                                term.scrollback_pending = (
                                    _txt[_idx + 1 :] + _tail)[-RECENT_OUTPUT_CAP:]
                            else:
                                term.scrollback_pending = (
                                    _txt + _tail)[-RECENT_OUTPUT_CAP:]
                        # attention: вывод пошёл, пока читатель не смотрит.
                        if not term.attention and term.state != "exited":
                            term.attention = True
                            self._emit("attention", {"address": term.address, "state": term.state, "attention": True})
                        term.last_output_at = time.time()
                        # W13 watch rules: regex over new output chunk.
                        _pat = term.labels.get("_watch")
                        if _pat and term.state != "exited":
                            try:
                                import re as _re
                                _m = _re.search(_pat, data.decode("utf-8", errors="replace"))
                                if _m:
                                    self._emit("watch_hit", {"address": term.address, "pattern": _pat, "match": _m.group(0)[:80]})
                            except Exception:
                                pass
                        # W26 alert rules: pattern→action по выводу.
                        self._apply_alert_rules(
                            term, data.decode("utf-8", errors="replace"))
                        # W9 pipe: сырой вывод src → stdin dst-терминалов.
                        # Мёртвый/exited dst пропускается (pipe живёт,
                        # запись возобновится при respawn).
                        for dst in self.pipes.get(address, ()):
                            dterm = self.terminals.get(dst)
                            if (dterm is not None
                                    and dterm.state != "exited"
                                    and dterm.handle is not None):
                                self._write(dterm, data)
                        # W25 pipe-file: сырой вывод → файл (sandbox
                        # через file_sink; кап 256MB — дальше skip+
                        # однократный file_pipe_full event).
                        fpath = self.file_pipes.get(address)
                        if fpath and self.file_sink is not None:
                            written = self._file_pipe_bytes.get(
                                address, 0)
                            # W45: ротация вместо стопа — path →
                            # path.1, счётчик обнуляется, запись
                            # продолжается. Без rotator — старый
                            # full+skip.
                            if (address not in self._file_pipe_full
                                    and written >= self.file_pipe_max
                                    and self.file_rotator is not None
                                    and self.file_rotator(fpath)):
                                self._file_pipe_bytes[address] = 0
                                written = 0
                                self._emit("file_pipe_rotate", {
                                    "address": address,
                                    "path": fpath,
                                    "bytes": self.file_pipe_max})
                            if (address not in self._file_pipe_full
                                    and written < self.file_pipe_max):
                                try:
                                    self.file_sink(fpath, data)
                                    self._file_pipe_bytes[address] = (
                                        written + len(data))
                                except Exception:
                                    pass
                            elif written >= self.file_pipe_max:
                                self._file_pipe_full.add(address)
                                self._emit("file_pipe_full", {
                                    "address": address,
                                    "path": fpath,
                                    "bytes": written})
                        for status in parser.feed(data):
                            t = self._apply_status(term, status)
                            transitions += t
                            if t:
                                produced = True
            alive = term.handle is not None and term.handle.alive()
            # keep-alive: lost → пере-спавн; exited (close) → не рестарт
            if term.handle is not None and not alive:
                # хендл умер — отличаем намеренное закрытие от потери
                if term.handle.closed or self._session_ended(term.handle):
                    term.handle = None
                    term.state = "exited"
                    term.exit_code = 0
                    term.exited_at = term.exited_at or time.time()
                    self._emit("exited", {"address": term.address, "exit_code": 0})
                    self._emit("finished", {"address": term.address, "exit_code": 0})
                else:
                    # тик-модель: отсутствие признаков жизни N тиков → lost (RFC §18)
                    term.missed_ticks += 1
                    if term.missed_ticks >= self.missed_tick_threshold:
                        if term.keep:
                            self._respawn(term)  # эмитит lost + restarted
                        elif not term.lost_reported:
                            self._emit("lost", {"address": term.address})
                            term.lost_reported = True
            else:
                # liveness (alive или output/status) сбрасывает счётчик
                if alive or produced:
                    term.missed_ticks = 0
                    term.lost_reported = False
            # родитель умер → die-with-parent: убить потомков;
            # outlive-parent: оставить (не трогаем)
            if (
                term.parent is not None
                and not term.parent_reaped
                and not self._parent_alive(term.parent)
            ):
                term.parent_reaped = True
                self._reap_lost_parent(term)
            self._sample_metrics(term)  # W14
        # периодическая подчистка exited (registry-leak fix #371); дебаунс ~30s
        now = time.time()
        if now - getattr(self, "_last_purge", 0.0) >= 30.0:
            self._last_purge = now
            self.purge_exited(self.exit_ttl)
        # W17: idle-kick скан ~5с (debounce — не каждый тик)
        if now - self._last_idle_scan >= 5.0:
            self._last_idle_scan = now
            self._idle_kick_scan(now)
        self._run_scheduled(now)  # W30
        self._sample_capacity(now)  # W47
        self._drain_send_queues()  # W56
        self._maybe_compress_scrollback(now)  # W62
        self.last_step_ts = time.time()
        return transitions

    # -- send queue (W56) ----------------------------------------------------

    def queue_send(self, address: str, text: str,
                   enter: bool = True,
                   priority: int = 5) -> Optional[dict]:
        """W56/W57: ставит ввод в очередь терминала. None если
        терминал неизвестен/exited/без handle — иначе
        {id, depth, priority}. priority 0–9 (выше = раньше)."""
        term = self.get_terminal(address)
        if (term is None or term.handle is None
                or term.state == "exited"):
            return None
        try:
            prio = max(0, min(9, int(priority)))
        except (TypeError, ValueError):
            prio = 5
        self._sendq_seq += 1
        q = self.send_queues.setdefault(term.address, [])
        item = {"id": f"sq-{self._sendq_seq}", "text": text,
                "enter": bool(enter), "priority": prio,
                "ts": time.time()}
        q.append(item)
        if len(q) > self.send_queue_max:
            q.pop(0)  # переполнение → снять старейший
        self._emit("send_queue", {
            "address": term.address, "action": "enqueue",
            "id": item["id"], "depth": len(q), "priority": prio})
        return {"id": item["id"], "depth": len(q),
                "priority": prio}

    def send_queue_depths(self) -> dict[str, int]:
        """W56: {address: depth} для непустых очередей."""
        return {a: len(q) for a, q in self.send_queues.items()
                if q}

    def clear_send_queue(self, address: str) -> int:
        """W56: сбрасывает очередь адреса → сколько снято."""
        q = self.send_queues.get(address)
        if not q:
            return 0
        n = len(q)
        q.clear()
        self._emit("send_queue", {
            "address": address, "action": "cleared", "depth": 0})
        return n

    def _drain_send_queues(self) -> None:
        """W56: step_once — до 4 сообщений на терминал за тик.

        Пропускает frozen/exited/lost/restoring; мёртвый терминал
        → очередь сбрасывается с send_queue dropped-событием.
        """
        for address, q in list(self.send_queues.items()):
            if not q:
                continue
            term = self.terminals.get(address)
            if (term is None or term.state in
                    ("exited", "lost", "restoring")
                    or term.handle is None):
                dropped = len(q)
                q.clear()
                self._emit("send_queue", {
                    "address": address, "action": "dropped",
                    "depth": 0, "dropped": dropped})
                continue
            if term.frozen:
                continue
            sent = 0
            while q and sent < 4:
                # W57: priority-desc, затем ts-asc (старейший первым
                # при равном приоритете). Скан ≤maxlen — дёшево.
                best = max(range(len(q)),
                           key=lambda i: (q[i]["priority"],
                                          -q[i]["ts"]))
                item = q[best]
                del q[best]
                if self.send(address, item["text"],
                            enter=item["enter"]):
                    sent += 1
                else:
                    q.append(item)  # вернуть в хвост
                    break
            if not q:
                self._emit("send_queue", {
                    "address": address, "action": "empty",
                    "depth": 0})

    # -- scrollback compression (W62) ---------------------------------------

    _SBC_GZ_CAP = 64 * 1024 * 1024  # safety: не распаковывать >64MiB

    def compress_scrollback(self, term, min_lines: int = 0,
                            force: bool = False) -> dict:
        """W62: gzip deque-строк → scrollback_gz, deque чистится.

        Порядок сохраняется: archive = СТАРЫЕ строки, новые append'ы
        идут в deque поверх. Читатели — scrollback_all().
        Возвращает {compressed, lines, gz_bytes, already}.
        """
        need = max(min_lines, 1 if force else self.sbc_min_lines)
        if term.scrollback_gz is not None:
            return {"compressed": True, "already": True,
                    "lines": term.scrollback_gz_count,
                    "gz_bytes": len(term.scrollback_gz)}
        # W96: snapshot+мутация под локом — api.py жмёт compress
        # endpoint'ом из loop-потока параллельно worker-feed'у.
        with self._sb_lock:
            lines = list(term.scrollback)
            if len(lines) < need:
                return {"compressed": False,
                        "lines": len(lines), "need": need}
            payload = "\n".join(lines).encode("utf-8")
            gz = gzip.compress(payload, compresslevel=6)
            if len(gz) > self._SBC_GZ_CAP:
                return {"compressed": False, "lines": len(lines),
                        "error": "gz too large"}
            term.scrollback.clear()
            term.scrollback_gz = gz
            term.scrollback_gz_count = len(lines)
        self._emit("scrollback_compressed", {
            "address": term.address, "lines": len(lines),
            "gz_bytes": len(gz)})
        return {"compressed": True, "already": False,
                "lines": len(lines), "gz_bytes": len(gz)}

    def _maybe_compress_scrollback(self, now: float) -> None:
        """W62: ~30с скан — idle-терминалы с большим deque → gzip."""
        if self.sbc_idle_s <= 0 or self.sbc_min_lines <= 0:
            return
        if now - self._last_sbc_scan < 30.0:
            return
        self._last_sbc_scan = now
        for term in self.terminals.values():
            if (term.state == "exited" or term.frozen
                    or term.handle is None
                    or term.scrollback_gz is not None
                    or len(term.scrollback) < self.sbc_min_lines):
                continue
            if now - term.last_output_at < self.sbc_idle_s:
                continue
            self.compress_scrollback(term)

    # -- sharing tokens (W63) -----------------------------------------------

    SHARE_SCOPES = frozenset({"screen", "dump", "info"})

    def create_share(self, address: str, scopes: list,
                     ttl_s: float) -> Optional[dict]:
        """W63: токен read-only view. None если терминал unknown."""
        term = self.get_terminal(address)
        if term is None:
            return None
        ttl = min(max(float(ttl_s), 60.0), self.share_ttl_max)
        token = secrets.token_urlsafe(18)
        self.share_tokens[token] = {
            "term": term.address,
            "scopes": sorted(set(scopes) & self.SHARE_SCOPES),
            "expires": time.time() + ttl,
            "created": time.time(), "hits": 0}
        return {"token": token, "term": term.address,
                "scopes": self.share_tokens[token]["scopes"],
                "expires_at": self.share_tokens[token]["expires"]}

    def resolve_share(self, token: str) -> Optional[dict]:
        """W63: валидный неистёкший токен → запись (+hits);
        неизвестный/истёкший → None."""
        rec = self.share_tokens.get(token or "")
        if rec is None:
            return None
        if time.time() > rec["expires"]:
            self.share_tokens.pop(token, None)
            return None
        rec["hits"] += 1
        return rec

    def revoke_share(self, token: str) -> bool:
        return self.share_tokens.pop(token or "", None) is not None

    def list_shares(self) -> list:
        now = time.time()
        out = []
        for tok, rec in self.share_tokens.items():
            out.append({
                "token": tok[:8] + "…", "term": rec["term"],
                "scopes": rec["scopes"],
                "expires_at": rec["expires"],
                "expired": now > rec["expires"],
                "hits": rec["hits"]})
        return out

    def _sample_capacity(self, now: float) -> None:
        """W47: ~5с-сэмпл {ts,live,mem_free_mb} для прогноза.

        mem_free — через system_metrics (без psutil); при недоступности
        метрик mem_free_mb=0 — forecast честно помечает estimate.
        """
        if now - self._cap_ts < 5.0:
            return
        self._cap_ts = now
        live = sum(1 for t in self.terminals.values()
                   if t.state != "exited")
        mem_free_mb = 0
        try:
            from tools.nexus_core.system_metrics import (
                get_system_metrics)
            m = get_system_metrics().collect()
            total = int(m.get("mem_total") or 0)
            used = int(m.get("mem_used") or 0)
            mem_free_mb = max(0, total - used) // (1024 * 1024)
        except Exception:
            pass
        self.capacity_history.append({
            "ts": round(now, 1), "live": live,
            "mem_free_mb": mem_free_mb})

    # -- scheduled broadcast (W30) -------------------------------------------

    def schedule_send(self, terms: list[str], text: str,
                      enter: bool, at_ts: float) -> dict:
        """Откладывает рассылку до at_ts (unix). terms — адреса."""
        self._sched_seq += 1
        item = {"id": f"sched-{self._sched_seq}",
                "terms": list(terms), "text": text,
                "enter": bool(enter), "at_ts": float(at_ts),
                "created_at": time.time()}
        self.scheduled_sends.append(item)
        self.scheduled_sends.sort(key=lambda x: x["at_ts"])
        self._emit("scheduled", {"id": item["id"], "op": "add",
                                 "at_ts": item["at_ts"],
                                 "count": len(terms)})
        return item

    def list_scheduled(self) -> list[dict]:
        return [dict(s) for s in self.scheduled_sends]

    def cancel_scheduled(self, sid: str) -> bool:
        for i, s in enumerate(self.scheduled_sends):
            if s["id"] == sid:
                del self.scheduled_sends[i]
                self._emit("scheduled", {"id": sid, "op": "cancel"})
                return True
        return False

    def _run_scheduled(self, now: float) -> None:
        """W30: due-рассылки → send живым членам; событие scheduled."""
        due = [s for s in self.scheduled_sends if s["at_ts"] <= now]
        if not due:
            return
        self.scheduled_sends = [
            s for s in self.scheduled_sends if s["at_ts"] > now]
        for s in due:
            sent = skipped = 0
            results: dict[str, dict] = {}
            for addr in s["terms"]:
                t = self.get_terminal(addr)
                if (t is None or t.state == "exited"
                        or t.handle is None or not t.handle.alive()):
                    results[addr] = {"ok": False, "skipped": True,
                                     "error": "not live"}
                    skipped += 1
                    continue
                ok = self.send(t.address, s["text"], s["enter"])
                if ok:
                    results[addr] = {"ok": True}
                    sent += 1
                else:
                    results[addr] = {"ok": False, "error": "send failed"}
                    skipped += 1
            self._emit("scheduled", {
                "id": s["id"], "op": "fired", "at_ts": s["at_ts"],
                "sent": sent, "skipped": skipped,
                "results": results})

    def _idle_ttl_for(self, term: Terminal) -> float:
        """TTL: label `_idle_ttl` > per-space (machine) TTL > global.
        ≤0 → kick выключен для этого терминала/space."""
        raw = term.labels.get("_idle_ttl")
        if raw is not None:
            try:
                return float(raw)
            except (TypeError, ValueError):
                pass
        sttl = self.space_idle_ttl.get(term.machine)
        if sttl is not None:
            try:
                return float(sttl)
            except (TypeError, ValueError):
                pass
        return self.idle_ttl

    def _idle_kick_scan(self, now: float) -> list:
        """W17: закрывает handle терминалов state=="idle" без вывода
        дольше TTL. Закрытие непрямое — следующий тик пометит exited
        штатным путём (exited-event + W15 webhook)."""
        kicked = []
        for term in self.terminals.values():
            if (term.state != "idle" or term.handle is None
                    or getattr(term, "locked", False)):
                continue
            ttl = self._idle_ttl_for(term)
            if ttl <= 0 or now - term.last_output_at < ttl:
                continue
            try:
                term.handle.close()
            except Exception:
                continue
            kicked.append(term.address)
            self._emit("idle_kick", {
                "address": term.address, "ttl": ttl,
                "idle_seconds": round(now - term.last_output_at, 1)})
        return kicked

    def _apply_alert_rules(self, term: Terminal, chunk: str) -> None:
        """W26: прогон alert-rules по свежему выводу терминала.

        actions: notify → alert-event (+url→pending_webhooks),
        label → term.labels[key]=value + save_registry,
        kill → handle.close() (exited следующим тиком).
        once:true → один раз на (addr,rule_id)."""
        if not chunk:
            return
        rules = list(load_rules(self.alert_rules_path)) + list(getattr(self, "alert_rules_extra", []))
        for idx, rule in enumerate(rules):
            if not rule.get("enabled", True):
                continue
            if idx in getattr(self, "alert_rule_disabled", set()):
                continue
            try:
                m = re.search(rule["pattern"], chunk)
            except re.error:
                continue
            if not m:
                continue
            rid = rule["id"]
            fired_key = (term.address, rid)
            if rule.get("once") and fired_key in self._alert_fired:
                continue
            self._alert_fired.add(fired_key)
            if len(self._alert_fired) > 10000:
                self._alert_fired.clear()
            match_txt = m.group(0)[:120]
            action = rule["action"]
            try:
                self.alert_history.append({"ts": time.time(), "term": term.address, "rule_idx": idx, "pattern": rule.get("pattern"), "action": action, "line": match_txt})
            except Exception:
                pass
            if action == "notify":
                self._emit("alert", {
                    "address": term.address, "rule": rid,
                    "action": "notify", "match": match_txt})
                url = rule.get("url")
                if url:
                    self.pending_webhooks.append({
                        "url": url, "ts": time.time(),
                        "payload": {
                            "event": "alert", "term": term.address,
                            "rule": rid, "match": match_txt,
                            "ts": time.time()}})
            elif action == "label":
                term.labels[rule["label_key"]] = rule["label_value"]
                self._emit("alert", {
                    "address": term.address, "rule": rid,
                    "action": "label", "match": match_txt,
                    "label": {rule["label_key"]:
                              rule["label_value"]}})
                self._save_registry()
            elif action == "kill":
                try:
                    if term.handle is not None:
                        term.handle.close()
                except Exception:
                    pass
                self._emit("alert", {
                    "address": term.address, "rule": rid,
                    "action": "kill", "match": match_txt})

    def _term_out_rate(self, term: Terminal) -> int:
        """W51: bytes/sec cap для терминала.

        label `_out_rate` (int) > env NEXUS_OUT_RATE; ≤0 →
        unlimited (0). Невалидный label → env default.
        """
        raw = term.labels.get("_out_rate")
        if raw is not None:
            try:
                v = int(str(raw).strip())
                return v if v > 0 else 0
            except (TypeError, ValueError):
                pass
        return self.out_rate_limit if self.out_rate_limit > 0 else 0

    def _sample_metrics(self, term: Terminal) -> None:
        """W14: ~1с-сэмпл {ts,state,out_bps} + state_changes журнал."""
        now = time.time()
        if term._m_ts and now - term._m_ts < 1.0:
            return
        elapsed = max(now - term._m_ts, 0.001) if term._m_ts else 1.0
        bps = term._m_out / elapsed
        term.metrics.append({
            "ts": round(now, 3), "state": term.state,
            "out_bps": round(bps, 1),
        })
        if term._m_state and term.state != term._m_state:
            term.state_changes.append({
                "ts": round(now, 3),
                "from": term._m_state, "to": term.state,
            })
        term._m_state = term.state
        term._m_ts = now
        term._m_out = 0

    def _apply_status(self, term: Terminal, status) -> int:
        self._status_seen.add(term.address)
        if getattr(status, "title", None) is not None and status.title != term.title:
            term.title = status.title
            self._emit("title", {"address": term.address, "title": status.title})
        if status.state == term.state:
            # только attention-флаг мог поменяться
            if status.attention != term.attention:
                term.attention = status.attention
                self._emit("attention", {"address": term.address, "state": term.state})
                return 1
            return 0

        prev = term.state
        term.state = status.state
        term.attention = status.attention
        self._emit("status", {"address": term.address, "state": status.state, "prev": prev})
        if status.state == "done":
            self._emit("done", {"address": term.address})
        elif status.attention:
            self._emit("attention", {"address": term.address, "state": status.state})
        return 1

    def _respawn(self, term: Terminal) -> None:
        """Пере-спавн SHELL (keep-alive) после loss — не команду (RFC §10/K5)."""
        old = term.handle
        term.handle = None
        self._emit("lost", {"address": term.address, "respawn_count": term.respawn_count})
        if old is not None:
            try:
                old.close()
            except Exception:
                pass
        # новый процесс = новый поток вывода: парсер начинаем с чистого листа
        self._parsers.pop(term.address, None)
        # W96-1: auto-respawn — pending-хвост принадлежал мёртвому
        # процессу; deque/gz истории сохраняем (keep-alive семантика),
        # а недописанную строку сбрасываем, иначе первый вывод нового
        # shell склеится с обрывком старого.
        with self._sb_lock:
            term.scrollback_pending = ""
        # keep рестартует SHELL в последнем cwd, а не исходную команду
        shell = default_shell()
        # registry-trust: cwd/env могли попасть в term из registry.json —
        # санитизируем и при runtime-respawn тоже (defensive, P-1 #398)
        cwd = _sanitize_cwd(term.cwd)
        env, stripped = _sanitize_env(term.env)
        # NX_TERMINAL_ID-инжекция сама по себе — не sanitize-ивент:
        # сравнение emit-условия идёт по sanitized-значению до инжекта.
        sanitized_env = env
        env = _term_env(env, term.address)
        if cwd != term.cwd or sanitized_env != term.env:
            self._emit("respawn_sanitized", {
                "address": term.address,
                "cwd_fixed": cwd != term.cwd,
                "env_stripped": stripped,
            })
        term.cwd, term.env = cwd, env
        spec = SpawnSpec(
            command=shell, cwd=cwd, env=env,
            cols=term.cols, rows=term.rows,
        )
        try:
            new = self.backend.spawn(spec)
        except Exception as exc:
            self._emit("respawn_failed", {"address": term.address, "error": str(exc)})
            return
        term.respawn_count += 1
        term.command = shell
        term.handle = new
        term.state = "idle"
        term.attention = False
        self._emit("keep", {"address": term.address, "count": term.respawn_count})
        self._emit("restarted", {"address": term.address, "count": term.respawn_count})
        self._emit("respawn", {"address": term.address, "count": term.respawn_count})

    # -------------------------------------------------------------------------
    # Kill-эскалация (hangup → terminate → kill, RFC §12: 10s/5s)
    # -------------------------------------------------------------------------

    # Окна ожидания между ступенями (RFC: ≤10s после hangup, ≤5s после terminate).
    KILL_GRACE_S = {"hangup": 10.0, "terminate": 5.0}

    def escalate_kill(self, address: str, stage: Optional[str] = None) -> dict:
        """Убивает терминал по ступеням: hangup → terminate → kill.

        Возвращает наблюдаемый результат после каждой ступени:
            {"term": ..., "steps": [...], "final": ...}
        `stage` — первая ступень (по умолчанию hangup). Останавливается,
        когда терминал мёртв, либо после всех трёх ступеней.

        N3.5: если у PTYHandle есть `escalate_kill(stage)` (getattr-проверка;
        mock и POSIX-половина), ступени зовут его с RFC-ожиданиями между ними
        (≤10s после hangup, ≤5s после terminate). Иначе — старый путь:
        один `close()` хендла (ConPTY: закрытие консоли; forkpty: SIGHUP).
        """
        term = self.get_terminal(address)
        if term is None:
            raise KeyError(f"terminal not found: {address}")
        if stage is not None and not isinstance(stage, str):
            raise ValueError("stage must be one of hangup/terminate/kill")
        handle = term.handle
        if handle is None or not handle.alive():
            if handle is not None:
                term.handle = None
                term.state = "exited"
                term.exit_code = None
                term.exited_at = term.exited_at or time.time()
                self._emit("exited", {"address": term.address, "exit_code": None})
            return {"term": address, "steps": [], "final": "not_running"}

        order = ("hangup", "terminate", "kill")
        if stage is not None and stage not in order:
            return {"term": address, "steps": [], "final": "error: unknown_stage"}
        start = order.index(stage) if stage in order else 0

        if not (hasattr(handle, "escalate_kill") and callable(handle.escalate_kill)):
            try:
                handle.close()
            except Exception:
                pass
            if handle.alive():
                return {"term": address, "steps": [], "final": "close_failed"}
            term.handle = None
            term.state = "exited"
            term.exit_code = None
            term.exited_at = term.exited_at or time.time()
            self._emit("exited", {"address": term.address, "exit_code": None})
            return {"term": address, "steps": [], "final": "closed"}

        steps: list[dict] = []
        alive = True
        for name in order[start:]:
            result = self._kill_stage(handle, name)
            alive = handle.alive()
            # RFC §12: после ПРИНЯТОГО hangup ждём ≤10s, после terminate ≤5s;
            # процесс, игнорировавший сигнал (*_ignored), эскалируется сразу.
            if alive and result == name:
                deadline = time.monotonic() + self.KILL_GRACE_S.get(name, 0)
                while time.monotonic() < deadline and handle.alive():
                    time.sleep(0.05)
                alive = handle.alive()
                if not alive:
                    result = name  # умер в окне — ступень сработала
            steps.append({
                "stage": name,
                "result": result,
                "state": "alive" if alive else "dead",
            })
            if not alive:
                break
        if not alive:
            term.handle = None
            term.state = "exited"
            term.exit_code = None
            term.exited_at = term.exited_at or time.time()
            self._emit("exited", {"address": term.address, "exit_code": None})
            return {"term": address, "steps": steps, "final": result}
        return {"term": address, "steps": steps, "final": "kill_failed"}

    @staticmethod
    def _kill_stage(handle, stage: str) -> str:
        """Одна ступень эскалации на хендле.

        PTYHandle может реализовывать `escalate_kill` (возвращает результат
        ступени: mock, POSIX — SIGHUP/SIGTERM/SIGKILL). Ступени с результатом
        `*_ignored` не тратят RFC-окно: процесс осознанно не ответил на
        сигнал, эскалация идёт дальше сразу.
        """
        if hasattr(handle, "escalate_kill") and callable(handle.escalate_kill):
            try:
                return handle.escalate_kill(stage)
            except Exception as exc:
                return f"error: {exc}"
        return f"{stage}_ignored"

    # -------------------------------------------------------------------------
    # Утилиты
    # -------------------------------------------------------------------------

    @staticmethod
    def _session_ended(handle) -> bool:
        """True, если хендл сам сообщает о завершении сессии."""
        return bool(getattr(handle, "session_ended", False))

    def _parent_alive(self, parent: str) -> bool:
        """Жив ли родительский терминал (существует и процесс не завершён)."""
        term = self.get_terminal(parent)
        if term is None:
            return False
        if term.handle is None:
            # Живого родителя без хендла не бывает: handle=None ставится только
            # при exited/lost/close/remove (или транзиент внутри _respawn).
            return False
        return term.handle.alive()

    def _reap_lost_parent(self, term: Terminal) -> None:
        """Родитель умер: die-with-parent → убить потомка; иначе оставить."""
        if term.die_with_parent:
            if term.handle is not None:
                try:
                    term.handle.close()
                except Exception:
                    pass
                term.handle = None
            term.state = "exited"
            term.exit_code = None
            term.exited_at = term.exited_at or time.time()
            self._emit("exited", {"address": term.address, "exit_code": None, "why": "die_with_parent"})
            self._emit("finished", {"address": term.address, "exit_code": None, "why": "die_with_parent"})
        else:
            self._emit("parent_lost", {"address": term.address, "parent": term.parent})

    def close(self) -> None:
        """Закрывает все терминалы (завершает процессы)."""
        for term in self.terminals.values():
            if term.handle is not None:
                try:
                    term.handle.close()
                except Exception:
                    pass
                term.handle = None

    # -------------------------------------------------------------------------
    # Persistентность (registry.json)
    # -------------------------------------------------------------------------

    def _quarantine_registry(self) -> None:
        """signature-mismatch → rename в <name>.poisoned (#404):
        poisoned файл не должен ретраиться каждый рестарт. Ошибка
        rename не фатальна — restore уже отказан выше."""
        try:
            src = Path(self._registry_path)
            dst = src.with_name(src.name + ".poisoned")
            os.replace(src, dst)
            self._emit("registry_quarantined", {"path": str(dst)})
        except OSError:
            pass

    def _load_registry(self, defer_spawn: bool = False) -> list[Terminal]:
        """Восстанавливает терминалы из registry.json (state, labels, meta).

        Сначала регистрирует все допустимые строки как restoring. Синхронный
        путь спавнит их последовательно; API restore task может отложить spawn
        и выполнить его с ограничением параллелизма.

        Registry-trust (P-1 #398 + #404 addendum): файл — untrusted
        persistence boundary.
        - HMAC: при заданном NEXUS_REGISTRY_KEY подписанный файл с битой
          подписью отклоняется целиком и КАРАНТИНИТСЯ (.poisoned — не
          ретраим poisoned restore каждый рестарт); legacy-список
          принимается и переподписывается при ближайшем _save_registry.
          Без ключа подпись НЕ проверяется = integrity off (dev-режим);
          NEXUS_REGISTRY_REQUIRE_SIG=1 делает отсутствие ключа
          fail-closed: registry не restore'ится вообще.
        - command: basename обязан быть в respawn-allowlist; command,
          заданный ПУТЁМ, дополнительно требует resolved realpath под
          trusted exec root (_safe_exec_roots / NEXUS_RESPAWN_SAFE_ROOTS)
          или точного absolute-совпадения с записью allowlist'а —
          '/evil/bash' больше не проходит по имени 'bash'. Иначе
          терминал помечается exited без spawn + warn-аудит.
        - cwd: только существующий каталог; env: опасные ключи срезаются
          (включая ZDOTDIR/HOME/XDG_*/SSH_AUTH_SOCK — #404).
        """
        self._restore_done = 0
        self._restore_failed = 0
        try:
            data = json.loads(Path(self._registry_path).read_text(encoding="utf-8"))
        except Exception:
            return []
        rows = None
        sig = None
        schema_v = 0
        if isinstance(data, dict):
            rows = data.get("rows")
            sig = data.get("sig")
            schema_v = data.get("v")
            if not isinstance(rows, list):
                return []
            if not isinstance(schema_v, int):
                schema_v = 1  # dict без v = v1-формат
        elif isinstance(data, list):
            rows = data  # v0 legacy bare-list
        if rows is None:
            return []
        # W67: чужая более новая схема → отказ, не гадаем
        if schema_v > REGISTRY_SCHEMA_VERSION:
            self._emit("registry_untrusted", {
                "reason": f"registry schema v{schema_v} > supported "
                          f"v{REGISTRY_SCHEMA_VERSION} — refusing "
                          "restore"})
            return []
        key = os.environ.get(REGISTRY_KEY_ENV) or None
        if key is None and os.environ.get(
                REQUIRE_SIG_ENV, "").strip().lower() in (
                "1", "true", "yes", "on"):
            # #404: integrity требуется, но ключа нет → fail-closed
            self._emit("registry_untrusted", {
                "reason": f"{REQUIRE_SIG_ENV} set but {REGISTRY_KEY_ENV} "
                          "unset — refusing restore (integrity required)"})
            return []
        if sig is not None:
            if key is None:
                self._emit("registry_untrusted", {
                    "reason": "signed registry but NEXUS_REGISTRY_KEY unset "
                              "— restoring sanitized (integrity off, "
                              "dev-mode; set "
                              f"{REQUIRE_SIG_ENV}=1 to fail closed)"})
            else:
                expect = _registry_sig(rows, key)
                if not hmac.compare_digest(str(sig), expect):
                    self._emit("registry_untrusted", {
                        "reason": "registry signature mismatch — "
                                  "refusing restore"})
                    self._quarantine_registry()
                    return []
        elif key is not None:
            # legacy unsigned + key задан → миграция: принимаем, save
            # в конце запишет уже подписанный формат
            self._emit("registry_untrusted", {
                "reason": "unsigned legacy registry — migrating to "
                          "signed format"})
        # W67: миграции schema v→current — ПОСЛЕ проверки подписи
        # (sig покрывает сырые rows; миграция меняет rows).
        for target in sorted(REGISTRY_MIGRATIONS):
            if schema_v < target <= REGISTRY_SCHEMA_VERSION:
                rows = REGISTRY_MIGRATIONS[target](rows)
        if schema_v < REGISTRY_SCHEMA_VERSION:
            self._emit("registry_migrated", {
                "from": schema_v, "to": REGISTRY_SCHEMA_VERSION})
        allowlist = _respawn_allowlist()
        safe_roots = _safe_exec_roots()
        restore_queue: list[Terminal] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            name = row.get("name")
            machine = row.get("machine", self.machine)
            if not isinstance(name, str) or not name:
                continue
            address = f"{machine}/{name}"
            if address in self.terminals:
                continue
            saved_state = str(row.get("state", "lost"))
            command = ([str(c) for c in row["command"]]
                       if isinstance(row.get("command"), list) else [])
            cwd = _sanitize_cwd(row.get("cwd"))
            env, env_stripped = _sanitize_env(row.get("env"))
            warnings = []
            if row.get("cwd") is not None and cwd is None:
                warnings.append("cwd rejected (missing/not a dir)")
            if env_stripped:
                warnings.append(f"env stripped {env_stripped} keys")
            term = Terminal(
                name=name,
                machine=machine,
                space=(str(row["space"])
                       if isinstance(row.get("space"), str)
                       and row["space"] else None),  # W48
                command=command,
                cwd=cwd,
                env=env,
                labels=dict(row.get("labels") or {}),
                state=saved_state,
                frozen=bool(row.get("frozen", False)),  # W41
                attention=bool(row.get("attention", False)),
                title=row.get("title"),
                keep=bool(row.get("keep", self.keep_alive)),
                parent=row.get("parent"),
                die_with_parent=bool(row.get("die_with_parent", False)),
                outlive_parent=bool(row.get("outlive_parent", False)),
                respawn_count=int(row.get("respawn_count", 0) or 0),
                cols=int(row.get("cols", 120) or 120),
                rows=int(row.get("rows", 30) or 30),
                # adoption: экран восстанавливается из registry (RFC §10)
                recent_output=str(row.get("recent_output", "") or "")[-RECENT_OUTPUT_CAP:],
                out_bytes=int(row.get("out_bytes", 0) or 0),
                state_time={str(k): float(v) for k, v in
                            (row.get("state_time") or {}).items()
                            if isinstance(v, (int, float))},
                handle=None,
            )
            self.terminals[address] = term
            if saved_state == "exited" or not term.keep:
                term.state = "exited"
                term.exited_at = term.exited_at or term.created_at or time.time()
                continue
            # allowlist: не-allowlist команда в registry → НЕ respawn,
            # терминал остаётся exited + warn-аудит (P-1 #398)
            if not _command_allowed(command, allowlist, safe_roots):
                term.state = "exited"
                term.exited_at = term.exited_at or time.time()
                self._emit("registry_untrusted", {
                    "address": address,
                    "reason": "command not in respawn allowlist",
                    "command0": os.path.basename(str(command[0])),
                })
                continue
            if warnings:
                self._emit("registry_untrusted", {
                    "address": address, "warnings": warnings})

            # lifecycle contract: keep+lost → shell-замена, не повтор команды
            term.state = "restoring"
            self._emit("lost", {"address": address, "reason": "supervisor_restore"})
            # NX_TERMINAL_ID и для adopted-строк: legacy-registry env его
            # не несёт — инжектим при восстановлении (#515).
            term.env = _term_env(term.env, address)
            restore_queue.append(term)

        if defer_spawn:
            self._save_registry()
            return restore_queue

        for term in restore_queue:
            shell = default_shell()
            spec = SpawnSpec(command=shell, cwd=term.cwd, env=term.env,
                             cols=term.cols, rows=term.rows)
            try:
                handle = self.backend.spawn(spec)
            except Exception as exc:
                self._restore_spawn_failed(term, exc)
            else:
                self._restore_spawn_succeeded(term, shell, handle)
        self._registry_restored = True
        self._save_registry()
        return restore_queue

    def _save_registry(self) -> None:
        if self._registry_path is None:
            return
        path = Path(self._registry_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        rows = [t.to_dict() for t in self.terminals.values()]
        key = os.environ.get(REGISTRY_KEY_ENV) or None
        # W67: всегда versioned dict — даже без ключа (v+rows);
        # sig добавляется только при ключе.
        payload = {"v": REGISTRY_SCHEMA_VERSION, "rows": rows}
        if key is not None:
            # signed-формат — целостность persistence-границы
            # (P-1 #398); без ключа — dev unsigned v2.
            payload["sig"] = _registry_sig(rows, key)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, path)

    def _emit(self, type_: str, data: dict) -> None:
        event = {"type": type_, **data, "ts": time.time()}
        self.events.append(event)
        self._counters["events"] += 1  # W34
        if type_ == "exited":
            self._counters["exited"] += 1  # W34
        if self.event_sink is not None:
            try:
                self.event_sink(event)
            except Exception:
                pass
        # W15: exited → exit_webhook в pending-очередь (все пути
        # выхода покрыты — kill/естественный выход/die_with_parent).
        if type_ == "exited":
            t = self.terminals.get(str(data.get("address", "")))
            if t is not None and t.exit_webhook:
                self.pending_webhooks.append({
                    "url": t.exit_webhook,
                    "ts": event["ts"],
                    "payload": {
                        "event": "exited",
                        "term": t.address,
                        "exit_code": data.get("exit_code"),
                        "why": data.get("why"),
                        "ts": event["ts"],
                    },
                })
        # W61: lifecycle webhooks — событие адреса терминала из
        # его hooks.events → pending_webhooks с полным event-payload.
        _addr = data.get("address")
        if _addr:
            _t = self.terminals.get(str(_addr))
            if _t is not None and _t.lifecycle_webhooks:
                for _hook in _t.lifecycle_webhooks:
                    if type_ in _hook.get("events", ()):
                        _wh = {"url": _hook["url"],
                               "ts": event["ts"],
                               "payload": dict(event)}
                        if _hook.get("secret"):
                            _wh["secret"] = _hook["secret"]
                        self.pending_webhooks.append(_wh)

    def _parser_for(self, address: str) -> Osc7501Parser:
        if address not in self._parsers:
            self._parsers[address] = Osc7501Parser()
        return self._parsers[address]


def scrollback_all(term) -> list:
    """W62: все строки scrollback — gzip-архив (старые) + deque.

    Пустой результат = нет ни архива, ни deque (fallback на
    recent_output остаётся на вызывающей стороне, как раньше).
    """
    out: list = []
    if term.scrollback_gz is not None:
        try:
            raw = gzip.decompress(term.scrollback_gz)
            if len(raw) <= SupervisorV1._SBC_GZ_CAP:
                out.extend(
                    raw.decode("utf-8", errors="replace")
                    .split("\n"))
        except (OSError, EOFError):
            pass  # битый архив → только deque
    out.extend(term.scrollback)
    # W93: недописанный хвост — тоже «экран»: /screen и dump должны
    # видеть текущую строку (prompt, вводимая команда) до \n.
    pending = getattr(term, "scrollback_pending", "")
    if pending:
        out.append(pending)
    return out


def _default_backend() -> PTYBackend:
    """CORE_MOCK=1 → mock; иначе реальный бэкенд платформы."""
    if os.environ.get("CORE_MOCK") == "1":
        return MockPTYBackend()
    return get_default_backend()
