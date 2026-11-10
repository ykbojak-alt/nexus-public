#!/usr/bin/env python3
"""
tools/nexus_core/daemon.py — detached-запуск API-сервера nexus-core (`nx serve`).

Зачем detached: ServerPTY (CreatePseudoConsole) не вложится в ConPTY —
атрибут PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE игнорируется для процессов,
запущенных внутри ConPTY-сессии (любой терминал Windows/hc). Поэтому
api-сервер на Windows надо поднимать ОТОРВАННЫМ от консоли:

  - Windows: pythonw.exe + subprocess.Popen(creationflags=
    CREATE_NO_WINDOW | DETACHED_PROCESS);
  - POSIX: start_new_session=True (setsid).

Состояние демона — base/daemon.json: {pid, port, host, base, started}.

Команды:
  nx serve [--port] [--host] [--base]   — запустить detached и дождаться HTTP
  nx serve --status                      — pid жив + HTTP probe /api/core/server
  nx serve --stop                        — SIGTERM/Stop-Process по pid с verify
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Optional

from tools.nexus_core.api import DEFAULT_HOST, DEFAULT_PORT

DAEMON_FILE_NAME = "daemon.json"
SERVER_START_TIMEOUT_S = 5.0
STOP_VERIFY_TIMEOUT_S = 5.0
PROBE_TIMEOUT_S = 2.0


def _package_root() -> Path:
    """Корень репозитория (tools/..): чтобы `python -m tools.nexus_core.api`
    работал из любой cwd."""
    return Path(__file__).resolve().parents[2]


def _state_file(base: Path) -> Path:
    return Path(base) / DAEMON_FILE_NAME


# ----------------------------------------------------------------------------
# daemon.json
# ----------------------------------------------------------------------------

def read_daemon_state(base: Path) -> Optional[dict]:
    """Читает base/daemon.json; None если нет/битый."""
    try:
        data = json.loads(_state_file(base).read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    return data


def write_daemon_state(base: Path, state: dict) -> None:
    """Атомарно пишет base/daemon.json."""
    path = _state_file(base)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


# ----------------------------------------------------------------------------
# Проверки
# ----------------------------------------------------------------------------

def pid_alive(pid: int) -> bool:
    """Жив ли процесс.

    Windows: OpenProcess + GetExitCodeProcess (STILL_ACTIVE) — OpenProcess
    сам по себе успешен и для уже завершённых процессов, поэтому одного
    handle недостаточно. POSIX: os.kill(pid, 0).
    """
    if pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        STILL_ACTIVE = 259
        handle = ctypes.windll.kernel32.OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION, False, int(pid)
        )
        if not handle:
            return False
        try:
            code = wintypes.DWORD()
            ok = ctypes.windll.kernel32.GetExitCodeProcess(
                handle, ctypes.byref(code)
            )
            return bool(ok) and int(code.value) == STILL_ACTIVE
        finally:
            ctypes.windll.kernel32.CloseHandle(handle)
    if sys.platform != "win32":
        # Зомби (state «Z») — процесс уже умер, но не реапится родителем.
        # os.kill(pid, 0) успешен и на зомби → считаем мёртвым явно.
        try:
            with open(f"/proc/{pid}/stat", "r", encoding="ascii") as _f:
                _data = _f.read()
            _end = _data.rfind(")")
            if _end != -1:
                _rest = _data[_end + 2:]
                if _rest and _rest.split()[0] == "Z":
                    return False
        except Exception:
            pass
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def http_probe(host: str, port: int, timeout: float = PROBE_TIMEOUT_S) -> Optional[dict]:
    """HTTP probe GET /api/core/server → dict ответа, или None."""
    try:
        with urllib.request.urlopen(
            f"http://{host}:{port}/api/core/server", timeout=timeout
        ) as resp:
            if resp.status != 200:
                return None
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


# ----------------------------------------------------------------------------
# Спавн
# ----------------------------------------------------------------------------

def _server_command(base: Path, host: str, port: int) -> list[str]:
    """Команда api-сервера: pythonw.exe (Windows) или python (POSIX).

    Модуль запускается через `-m tools.nexus_core.api` — тот же argparse,
    что и в api.py __main__ (--host/--port/--base).
    """
    exe = Path(sys.executable)
    if sys.platform == "win32":
        pyw = exe.with_name("pythonw.exe")
        if pyw.exists():
            exe = pyw
    return [
        str(exe),
        "-m",
        "tools.nexus_core.api",
        "--host", str(host),
        "--port", str(port),
        "--base", str(base),
    ]


def _kill_pid(pid: int) -> None:
    """SIGTERM (Windows: TerminateProcess через os.kill)."""
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        pass


def start_daemon(base: Path, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> int:
    """Запускает api.py detached и ждёт HTTP-ответа.

    Возвращает 0 при успехе (pidfile записан), 1 при ошибке.
    """
    base = Path(base)
    existing = read_daemon_state(base)
    if existing and pid_alive(int(existing.get("pid", 0))):
        print(
            f"already running: pid={existing['pid']} port={existing.get('port')} "
            f"base={existing.get('base')}",
            file=sys.stderr,
        )
        return 1

    env = dict(os.environ)
    env["PYTHONPATH"] = (
        str(_package_root()) + os.pathsep + env.get("PYTHONPATH", "")
    )
    flags = 0
    if sys.platform == "win32":
        flags = subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS

    log = base / "server.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    with open(log, "ab") as logf:
        proc = subprocess.Popen(
            _server_command(base, host, port),
            stdin=subprocess.DEVNULL,
            stdout=logf,
            stderr=logf,
            cwd=str(_package_root()),
            env=env,
            creationflags=flags,
            close_fds=True,
        )

    state = {
        "pid": proc.pid,
        "port": port,
        "host": host,
        "base": str(base),
        "started": time.time(),
    }

    # дожидаемся HTTP-ответа (сервер мог упасть: порт занят, импорт и т.п.)
    deadline = time.monotonic() + SERVER_START_TIMEOUT_S
    probe: Optional[dict] = None
    while time.monotonic() < deadline:
        if not pid_alive(proc.pid):
            break
        probe = http_probe(host, port, timeout=0.5)
        if probe is not None:
            break
        time.sleep(0.1)

    if probe is None:
        _kill_pid(proc.pid)
        try:
            _state_file(base).unlink()
        except OSError:
            pass
        tail = ""
        try:
            tail = log.read_text(encoding="utf-8", errors="replace")[-800:]
        except Exception:
            pass
        print("error: server failed to start (log tail follows)", file=sys.stderr)
        print(tail, file=sys.stderr)
        return 1

    write_daemon_state(base, state)
    print(json.dumps({
        **state,
        "state": "running",
        "version": probe.get("version"),
        "terminals": probe.get("terminals"),
        "machines": probe.get("machines"),
    }, ensure_ascii=False))
    return 0


def stop_daemon(base: Path) -> int:
    """Останавливает демон по pid из daemon.json, с verify.

    Возвращает 0 (остановлен/уже не запущен), 1 если не удалось.
    """
    base = Path(base)
    state = read_daemon_state(base)
    if state is None:
        print("not running (no daemon.json)", file=sys.stderr)
        return 1
    pid = int(state.get("pid", 0))
    if not pid_alive(pid):
        # устаревший pidfile — чистим, stop идемпотентен
        try:
            _state_file(base).unlink()
        except OSError:
            pass
        print(json.dumps({"pid": pid, "stopped": True, "stale": True}))
        return 0
    _kill_pid(pid)
    deadline = time.monotonic() + STOP_VERIFY_TIMEOUT_S
    while time.monotonic() < deadline and pid_alive(pid):
        time.sleep(0.05)
    if pid_alive(pid):
        print(f"error: pid {pid} still alive after terminate", file=sys.stderr)
        return 1
    try:
        _state_file(base).unlink()
    except OSError:
        pass
    print(json.dumps({
        "pid": pid,
        "port": state.get("port"),
        "stopped": True,
    }))
    return 0


def status_daemon(base: Path) -> int:
    """Статус: pid жив + HTTP probe /api/core/server.

    Возвращает 0 если работает, 1 иначе.
    """
    base = Path(base)
    state = read_daemon_state(base)
    if state is None:
        print("not running", file=sys.stderr)
        return 1
    pid = int(state.get("pid", 0))
    if not pid_alive(pid):
        print(json.dumps({
            **state,
            "state": "stale",
            "error": "pid not alive",
        }, ensure_ascii=False))
        return 1
    probe = http_probe(
        str(state.get("host", DEFAULT_HOST)),
        int(state.get("port", DEFAULT_PORT)),
    )
    if probe is None:
        print(json.dumps({
            **state,
            "state": "running_unresponsive",
            "error": "HTTP probe /api/core/server failed",
        }, ensure_ascii=False))
        return 1
    print(json.dumps({
        **state,
        "state": "running",
        "version": probe.get("version"),
        "uptime_s": probe.get("uptime_s"),
        "terminals": probe.get("terminals"),
        "machines": probe.get("machines"),
    }, ensure_ascii=False))
    return 0
