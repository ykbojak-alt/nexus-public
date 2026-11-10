#!/usr/bin/env python3
"""
tools/nexus_core/mock_pty.py — mock-PTY для режима CORE_MOCK=1.

Класс MockPTYBackend имитирует PTY-бэкенд (spawn/read/write/close/alive)
и умеет эмитить OSC-строки 7501 в поток вывода — так тесты и демонстрации
проверяют парсер статусов и keep-alive без реального PTY.
"""

from __future__ import annotations

import time
from typing import Optional

from tools.nexus_core.osc7501 import Osc7501Parser
from tools.nexus_core.pty_backend import PTYBackend, PTYHandle, SpawnSpec


DEFAULT_SHELL_CMD = ["sh", "-i"]


class MockPTYHandle(PTYHandle):
    """Хендл mock-терминала: буфер вывода + эмуляция процесса."""

    def __init__(self, name: str, spec: SpawnSpec) -> None:
        super().__init__()
        self.name = name
        self.spec = spec
        self.stdout = bytearray()
        self._stdin = bytearray()
        self._alive = True
        self._closed = False
        self._spawn_t = time.time()
        self.cols = int(getattr(spec, "cols", 0) or 0)
        self.rows = int(getattr(spec, "rows", 0) or 0)
        self._parser = Osc7501Parser()

    # -- поток данных ----------------------------------------------------

    def read(self, timeout: float = 0.0) -> bytes:
        out = bytes(self.stdout)
        self.stdout.clear()
        return out

    def write(self, data: bytes) -> int:
        if not self._alive:
            raise RuntimeError(f"MockPTY {self.name}: write to dead terminal")
        self._stdin.extend(data)
        return len(data)

    def resize(self, cols: int, rows: int) -> None:
        """Фиксирует последний размер (тесты #542: spawn→resize→assert)."""
        self.cols = int(cols)
        self.rows = int(rows)

    # -- жизненный цикл --------------------------------------------------

    def close(self) -> None:
        self._closed = True
        self._alive = False
    def alive(self) -> bool:
        return self._alive and not self._closed

    def kill(self) -> None:
        """Имитация смерти процесса (lost) без намеренного close()."""
        self._alive = False

    def escalate_kill(self, stage: str) -> str:
        """Одна ступень эскалации kill (для тестов и API).

        Ступени: hangup → terminate → kill. По умолчанию hangup и
        terminate не убивают процесс (как в реальности — сигналы могут
        быть проигнорированы), kill — убивает. `terminate_kills=True`
        в конструкторе переключает: terminate убивает (эскалация
        останавливается раньше).
        """
        order = ("hangup", "terminate", "kill")
        if stage not in order:
            return "error: unknown stage"
        if not self._alive:
            return "not_running"
        if stage == "hangup":
            return "hangup_ignored"
        if stage == "terminate":
            if getattr(self, "_terminate_kills", False):
                self._alive = False
                return "terminate"
            return "terminate_ignored"
        self._alive = False
        return "kill"

    @property
    def session_ended(self) -> bool:
        """True, если сессия завершилась (close() или terminate)."""
        return self._closed

    def stdin_data(self) -> bytes:
        """Что было записано в терминал (для проверок в тестах)."""
        return bytes(self._stdin)

    @property
    def spawn_age(self) -> float:
        return time.time() - self._spawn_t

    # -- эмиссия OSC 7501 -----------------------------------------------

    def emit_osc(
        self,
        status: str,
        kind: Optional[str] = None,
        msg: Optional[str] = None,
        app: Optional[str] = None,
        title: Optional[str] = None,
        progress: Optional[int] = None,
        json_legacy: bool = False,
        **extra,
    ) -> None:
        """Эмитит последовательность OSC 7501 в поток вывода.

        Основной формат — key=value: "state=working:kind=permission".
        `json_legacy=True` эмитит старый JSON-формат (для проверки
        совместимости парсера).
        """
        if json_legacy:
            payload = {"status": status}
            if kind is not None:
                payload["kind"] = kind
            if msg is not None:
                payload["msg"] = msg
            if app is not None:
                payload["app"] = app
            if title is not None:
                payload["title"] = title
            if progress is not None:
                payload["progress"] = progress
            payload.update(extra)
            import json as _json
            text = _json.dumps(payload, separators=(",", ":"))
        else:
            parts = [f"state={status}"]
            for key, value in (
                ("kind", kind),
                ("msg", msg),
                ("app", app),
                ("title", title),
            ):
                if value is not None:
                    parts.append(f"{key}={value}")
            if progress is not None:
                parts.append(f"progress={progress}")
            for key, value in extra.items():
                parts.append(f"{key}={value}")
            text = ":".join(parts)
        self.stdout.extend(b"\x1b]7501;" + text.encode("utf-8") + b"\x07")

    def emit_osc_st(self, status: str, **extra) -> None:
        """Эмитит OSC 7501 с терминатором ST (ESC \\) вместо BEL."""
        parts = [f"state={status}"]
        for key, value in extra.items():
            parts.append(f"{key}={value}")
        text = ":".join(parts)
        self.stdout.extend(b"\x1b]7501;" + text.encode("utf-8") + b"\x1b\\")

    def emit_raw(self, data: bytes) -> None:
        """Прямая вставка сырых байтов в поток вывода."""
        self.stdout.extend(data)


class MockPTYBackend(PTYBackend):
    """Бэкенд-фабрика mock-терминалов."""

    def __init__(self) -> None:
        self.terminals: dict[str, MockPTYHandle] = {}
        self.next_id = 0

    def spawn(self, spec: SpawnSpec) -> MockPTYHandle:
        self.next_id += 1
        name = f"mockpty-{self.next_id}"
        handle = MockPTYHandle(name, spec)
        self.terminals[name] = handle
        return handle
