#!/usr/bin/env python3
"""
tools/nexus_core/machine_registry.py — реестр машин + machine.exec (N3).

Контракт (NEXUS_CORE_SPEC.md §0a.5, К6, §2):
    add {name, host, transport} — transport ∈ local|ssh; ssh — только
        реестр, probe позже (connect);
    rm — забыть машину, НЕ трогая живые терминалы;
    rename — ломающая смена адреса: адреса со старым именем перестают
        работать, терминалы local/<old> → local/<new> ремапятся;
    connect — регистрация ssh-машины + probe `ssh -o BatchMode true`;
    machine.exec — запуск программы БЕЗ терминала (local — subprocess;
        remote — честная ошибка «remote not supported in N3», транспорт
        появится в N4).

Состояние: <base>/machines.json (атомарно tmp → replace). Машина
«local» присутствует всегда (seed при первом создании).
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

from tools.nexus_core.signed_json import (
    REGISTRY_KEY_ENV,
    REQUIRE_SIG_ENV,
    registry_key,
    require_sig,
    sign_rows,
    signature_valid,
)

log = logging.getLogger(__name__)

MACHINES_FILE_NAME = "machines.json"
LOCAL_MACHINE = "local"
VALID_NAME_RE = re.compile(r"^[a-z0-9_-]{1,32}$")
# ssh-назначение: [user@]host[:port] / IPv6 [...]. Первый символ —
# НЕ '-': host="-oProxyCommand=…" иначе стал бы опцией ssh (injection).
HOST_RE = re.compile(
    r"^(?:[A-Za-z0-9]|\[)[A-Za-z0-9._@:\[\]_-]{0,253}$")

DEFAULT_EXEC_TIMEOUT_S = 60.0
MAX_EXEC_TIMEOUT_S = 600.0

TRANSPORTS = ("local", "ssh")
MACHINE_STATES = ("connecting", "connected", "needs_login", "unreachable")


class MachineError(Exception):
    """Ошибка реестра машин."""


class RemoteNotSupportedError(Exception):
    """Честная ошибка: remote-операция недоступна в N3."""


@dataclass
class Machine:
    """Машина реестра (подмножество схемы К6)."""

    name: str
    host: str
    transport: str = "ssh"
    state: str = "connecting"
    since_ms: float = field(default_factory=lambda: time.time() * 1000)
    why: Optional[str] = None
    labels: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "host": self.host,
            "transport": self.transport,
            "state": self.state,
            "since_ms": self.since_ms,
            "why": self.why,
            "labels": dict(self.labels),
        }


def validate_machine_name(name: str) -> None:
    if not isinstance(name, str) or not VALID_NAME_RE.fullmatch(name):
        raise MachineError(f"invalid machine name {name!r} (1-32 of a-z 0-9 - _)")


def validate_host(host) -> str:
    """Нормализует и валидирует ssh-host (#419): trim + формат.

    Отклоняет пустое, пробелы/метасимволы и ведущий '-' (ssh option
    injection). Возвращает stripped-значение."""
    if not isinstance(host, str):
        raise MachineError("host must be a string")
    h = host.strip()
    if not h or not HOST_RE.fullmatch(h):
        raise MachineError(f"invalid host {host!r}")
    return h


def default_probe(host: str, timeout: float = 10.0) -> tuple[str, Optional[str]]:
    """Probe `ssh -o BatchMode true <host>`: состояние и причина.

    Возвращает (state, why): connected | needs_login | unreachable.
    """
    try:
        result = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", host, "true"],
            capture_output=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return "unreachable", "timeout"
    if result.returncode == 0:
        return "connected", None
    err = result.stderr.decode("utf-8", errors="replace").lower()
    if "permission denied" in err or "denied" in err:
        return "needs_login", "permission denied"
    return "unreachable", f"exit code {result.returncode}"


class MachineRegistry:
    """Персистентный реестр машин в <base>/machines.json."""

    def __init__(
        self,
        base: Path,
        supervisor=None,
        probe_fn: Optional[Callable[[str], tuple[str, Optional[str]]]] = None,
    ) -> None:
        self.base = Path(base)
        self.supervisor = supervisor
        self.probe_fn = probe_fn or default_probe
        self.machines: dict[str, Machine] = {}
        # HERETIC #419: None | "signature_mismatch" | "require_sig_without_key"
        # | "unreadable" — API/ops могут показать integrity-статус.
        self.integrity_error: Optional[str] = None
        self._load()
        if LOCAL_MACHINE not in self.machines:
            self._seed_local()

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    def add(
        self,
        name: str,
        host: str,
        transport: str = "ssh",
        state: Optional[str] = None,
        labels: Optional[dict] = None,
    ) -> Machine:
        """Регистрирует машину. ssh — только реестр (probe отдельно)."""
        validate_machine_name(name)
        if transport not in TRANSPORTS:
            raise MachineError(f"unknown transport: {transport!r}")
        host = validate_host(host)
        if name in self.machines:
            raise MachineError(f"machine already exists: {name}")
        machine = Machine(
            name=name,
            host=host,
            transport=transport,
            state=state or ("connected" if transport == "local" else "connecting"),
            labels={str(k): str(v) for k, v in (labels or {}).items()},
        )
        self.machines[name] = machine
        self._save()
        return machine

    def get(self, name: str) -> Optional[Machine]:
        return self.machines.get(name)

    def list_all(self) -> list[Machine]:
        return sorted(self.machines.values(), key=lambda m: m.name)

    def update(self, name: str, host: Optional[str] = None,
               transport: Optional[str] = None,
               labels: Optional[dict[str, str]] = None) -> Machine:
        """Обновляет host/transport/labels существующей машины."""
        machine = self.get(name)
        if machine is None:
            raise MachineError(f"machine not found: {name}")
        if host is not None:
            machine.host = validate_host(host)
        if transport is not None:
            if transport not in TRANSPORTS:
                raise MachineError(f"unknown transport: {transport!r}")
            machine.transport = transport
        if labels is not None:
            machine.labels = dict(labels)
        self._save()
        return machine

    def rm(self, name: str) -> Machine:
        """Забывает машину. Терминалы НЕ трогает (контракт К6)."""
        machine = self.machines.pop(name, None)
        if machine is None:
            raise MachineError(f"machine not found: {name}")
        self._save()
        return machine

    def rename(self, old: str, new: str) -> Machine:
        """Ломающая смена адреса + remap терминалов local/<old> → local/<new>."""
        validate_machine_name(new)
        machine = self.get(old)
        if machine is None:
            raise MachineError(f"machine not found: {old}")
        if new in self.machines:
            raise MachineError(f"machine already exists: {new}")
        machine.name = new
        self.machines[new] = machine
        del self.machines[old]
        self._remap_terminals(old, new)
        self._save()
        return machine

    def _remap_terminals(self, old: str, new: str) -> None:
        sup = self.supervisor
        if sup is None:
            return
        for address, term in list(sup.terminals.items()):
            if term.machine == old:
                del sup.terminals[address]
                term.machine = new
                sup.terminals[term.address] = term
        save = getattr(sup, "_save_registry", None)
        if callable(save):
            save()

    # ------------------------------------------------------------------
    # Probe
    # ------------------------------------------------------------------

    def probe(self, name: str) -> Machine:
        """Проверяет доступность ssh-машины (ssh -o BatchMode true)."""
        machine = self.get(name)
        if machine is None:
            raise MachineError(f"machine not found: {name}")
        if machine.transport != "ssh":
            machine.state = "connected"
            machine.why = None
            self._save()
            return machine
        machine.state = "connecting"
        machine.why = None
        state, why = self.probe_fn(machine.host)
        machine.state = state
        machine.why = why
        self._save()
        return machine

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def _seed_local(self) -> None:
        self.machines[LOCAL_MACHINE] = Machine(
            name=LOCAL_MACHINE,
            host="localhost",
            transport="local",
            state="connected",
        )
        self._save()

    def _preserve_corrupt(self, path: Path) -> None:
        """Битый файл → <name>.corrupt (forensic copy, оригинал цел)."""
        try:
            dst = path.with_name(path.name + ".corrupt")
            if not dst.exists():
                dst.write_bytes(path.read_bytes())
        except OSError:
            pass

    def _quarantine(self, path: Path) -> None:
        """signature-mismatch → <name>.poisoned (не ретраим каждый рестарт)."""
        try:
            os.replace(path, path.with_name(path.name + ".poisoned"))
        except OSError:
            pass

    def _load(self) -> None:
        """Загружает machines.json.

        HERETIC #419: файл — untrusted persistence boundary (ssh host
        уходит в subprocess). Формат:
        - signed {"v":1,"machines":[...],"sig":hmac} — при заданном
          NEXUS_REGISTRY_KEY подпись проверяется (fail-closed на
          mismatch → quarantine); без ключа — dev-режим warn.
        - legacy {"machines":[...]} без sig — принимается, save
          перепишет signed (миграция).
        - NEXUS_REGISTRY_REQUIRE_SIG=1 без ключа → ничего не грузим.
        - host-строки валидируются (validate_host); битые rows skip.
        """
        path = self.base / MACHINES_FILE_NAME
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return
        except Exception as exc:
            log.warning("machines.json unreadable: %s", exc)
            self.integrity_error = "unreadable"
            self._preserve_corrupt(path)
            return
        if not isinstance(data, dict):
            log.warning("machines.json: top-level is not an object")
            return
        rows = data.get("machines")
        sig = data.get("sig")
        if not isinstance(rows, list):
            return
        key = registry_key()
        if key is None and require_sig():
            log.warning("machines.json present but %s set without %s — "
                        "refusing load (integrity required)",
                        REQUIRE_SIG_ENV, REGISTRY_KEY_ENV)
            self.integrity_error = "require_sig_without_key"
            return
        if sig is not None:
            if key is None:
                log.warning("signed machines.json but %s unset — loading "
                            "(integrity off, dev-mode)", REGISTRY_KEY_ENV)
            elif not signature_valid(rows, sig, key):
                log.warning("machines.json signature mismatch — "
                            "refusing load")
                self.integrity_error = "signature_mismatch"
                self._quarantine(path)
                return
        elif key is not None:
            log.warning("unsigned legacy machines.json — migrating to "
                        "signed format")
        skipped = 0
        for row in rows:
            if not isinstance(row, dict):
                continue
            name = row.get("name")
            if not isinstance(name, str) or not name:
                continue
            try:
                host = validate_host(row.get("host", name))
            except MachineError:
                skipped += 1
                continue
            self.machines[name] = Machine(
                name=name,
                host=host,
                transport=str(row.get("transport", "ssh")),
                state=str(row.get("state", "connecting")),
                since_ms=float(row.get("since_ms", time.time() * 1000)),
                why=row.get("why"),
                labels={
                    str(k): str(v) for k, v in (row.get("labels") or {}).items()
                    if isinstance(v, str)
                },
            )
        if skipped:
            log.warning("machines.json: skipped %d rows with invalid host",
                        skipped)

    def _save(self) -> None:
        self.base.mkdir(parents=True, exist_ok=True)
        rows = [m.to_dict() for m in self.list_all()]
        payload = {"machines": rows}
        key = registry_key()
        if key is not None:
            payload = {"v": 1, "machines": rows,
                       "sig": sign_rows(rows, key)}
        path = self.base / MACHINES_FILE_NAME
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        os.replace(tmp, path)


# ----------------------------------------------------------------------------
# machine.exec
# ----------------------------------------------------------------------------

def machine_exec(
    machine: str,
    argv: list[str],
    timeout: Optional[float] = None,
) -> dict:
    """Запускает программу БЕЗ терминала на машине.

    local — прямой spawn (subprocess), захват stdout/stderr/exit_code.
    remote — честная ошибка RemoteNotSupportedError («remote not supported
    in N3»; зарегистрированный транспорт появится в N4).

    nonzero exit и timeout — результат, а не ошибка (контракт К2/К6).
    """
    m = (machine or LOCAL_MACHINE).strip()
    if m != LOCAL_MACHINE:
        raise RemoteNotSupportedError("remote not supported in N3")
    if not isinstance(argv, list) or not argv or not all(
        isinstance(a, str) for a in argv
    ):
        raise ValueError("argv must be a non-empty list of strings")
    if timeout is None:
        limit = DEFAULT_EXEC_TIMEOUT_S
    else:
        limit = float(timeout)
        if limit <= 0:
            raise ValueError("timeout must be > 0")
        limit = min(limit, MAX_EXEC_TIMEOUT_S)
    start = time.monotonic()
    try:
        result = subprocess.run(
            [str(a) for a in argv],
            capture_output=True,
            timeout=limit,
        )
        timed_out = False
        exit_code = result.returncode
        stdout, stderr = result.stdout, result.stderr
    except subprocess.TimeoutExpired as exc:
        timed_out = True
        exit_code = None
        stdout = exc.stdout or b""
        stderr = exc.stderr or b""
    duration_ms = int((time.monotonic() - start) * 1000)
    return {
        "machine": m,
        "argv": [str(a) for a in argv],
        "stdout": stdout.decode("utf-8", errors="replace"),
        "stderr": stderr.decode("utf-8", errors="replace"),
        "exit_code": exit_code,
        "timed_out": timed_out,
        "duration_ms": duration_ms,
    }
