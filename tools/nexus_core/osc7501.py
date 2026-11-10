#!/usr/bin/env python3
"""
tools/nexus_core/osc7501.py — парсер OSC 7501 (статусы агентов).

Контракт herdr-core (NEXUS_CORE_SPEC.md §0a.2): терминал эмитит
последовательность

    ESC ] 7501 ; <payload> BEL | ST

<payload> — key=value-секвенции через ':', например:

    state=working:kind=permission:progress=42
    state=blocked:kind=question:msg=need help
    state=error:msg=crash

Поля:
    state  — 5 состояний: idle, working, done, blocked, error;
    kind   — причина блокировки: permission | question | auth (для blocked);
    msg    — человекочитаемое сообщение;
    app, title — вспомогательные атрибуты;
    progress — 0-100.

Санитизация (как у hc):
    - «payload is not escape code safe UTF-8» — вход, содержащий байты,
      небезопасные внутри escape-последовательностей, отклоняется;
    - «OSC 7501 sequence too long» — последовательности сверх MAX_BUFFER
      отклоняются.

Совместимость: старый JSON-формат {"status": "working", ...} продолжает
парситься (не норма, но не ломает N1-код и тесты).

Маппинг в каноническую модель супервизора (N1):

    raw state → state    attention
    working   → working  False
    idle      → idle     False
    done      → done     False
    blocked   → blocked  True     (внимание из blocked)
    error     → blocked  True     (error тоже требует внимания)
    attention → blocked  True     (совместимость со старым форматом)
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Optional

VALID_STATES = frozenset(("working", "blocked", "idle", "done", "error"))
VALID_KINDS = frozenset(("permission", "question", "auth"))

_STATUS_MAP = {
    "working": ("working", False),
    "idle": ("idle", False),
    "done": ("done", False),
    "blocked": ("blocked", True),
    "error": ("blocked", True),
    "attention": ("blocked", True),  # совместимость со старым JSON
}

# Байты, небезопасные внутри escape-последовательности OSC: управляющие
# символы (кроме допустимых разделителей BEL/ST, которые завершают payload
# раньше времени), и всё, что может сломать парсинг последовательности.
# 0x1b (ESC) внутри payload — тоже небезопасен: вложенная escape-строка.
_ESCAPE_UNSAFE = frozenset(
    b"\x00\x01\x02\x03\x04\x05\x06\x08\x0b\x0c\x0e\x0f"
    b"\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f"
    b"\x7f"
)

# Байты, которые не могут встречаться в UTF-8 (подтверждают "не escape-code
# safe UTF-8"): 0x80-0xBF вне много-байтовых последовательностей и т.п.
def _is_safe_utf8(data: bytes) -> bool:
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        return False
    return True


def parse_agent_status(payload: object) -> Optional["AgentStatus"]:
    """Переводит payload OSC 7501 (key=value или JSON) в AgentStatus.

    Возвращает None, если состояние не распознано.
    """
    if isinstance(payload, dict):
        return _parse_dict_payload(payload)
    if isinstance(payload, str):
        status = _parse_kv_payload(payload)
        if status is not None:
            return status
        # JSON-совместимость (старый формат)
        try:
            obj = json.loads(payload)
        except (json.JSONDecodeError, TypeError):
            obj = None
        return _parse_dict_payload(obj) if isinstance(obj, dict) else None
    return None


def _parse_dict_payload(payload: dict) -> Optional["AgentStatus"]:
    """JSON-совместимость: {"status"|"state": <state>, ...}."""
    raw = payload.get("status")
    if not isinstance(raw, str):
        raw = payload.get("state")
    if not isinstance(raw, str) or raw not in _STATUS_MAP:
        return None
    state, attention = _STATUS_MAP[raw]
    kind = payload.get("kind")
    if not isinstance(kind, str) or kind not in VALID_KINDS:
        kind = None
    return AgentStatus(
        state=state,
        attention=attention,
        raw=raw,
        kind=kind,
        msg=payload.get("msg"),
        app=payload.get("app"),
        title=payload.get("title"),
        progress=payload.get("progress"),
        payload=dict(payload),
    )


def _parse_kv_payload(text: str) -> Optional["AgentStatus"]:
    """key=value-секвенции через ':' (основной формат N2)."""
    fields: dict[str, str] = {}
    for part in text.split(":"):
        part = part.strip()
        if not part:
            continue
        if "=" not in part:
            continue
        key, _, value = part.partition("=")
        key = key.strip()
        value = value.strip()
        if key:
            fields[key] = value
    raw = fields.get("state")
    if raw is None:
        raw = fields.get("status")
    if not isinstance(raw, str) or raw not in _STATUS_MAP:
        return None
    state, attention = _STATUS_MAP[raw]
    kind = fields.get("kind")
    if kind not in VALID_KINDS:
        kind = None
    progress: object = None
    pv = fields.get("progress")
    if pv is not None:
        try:
            progress = int(pv)
        except ValueError:
            progress = None
    return AgentStatus(
        state=state,
        attention=attention,
        raw=raw,
        kind=kind,
        msg=fields.get("msg"),
        app=fields.get("app"),
        title=fields.get("title"),
        progress=progress,
        payload=dict(fields),
    )


@dataclass(frozen=True)
class AgentStatus:
    """Канонический статус агента из сообщения OSC 7501."""

    state: str  # working | blocked | idle | done | error
    attention: bool  # True, если агент просит внимания (blocked/error)
    raw: str  # исходное значение поля state (или status)
    kind: Optional[str] = None  # permission | question | auth
    msg: Optional[str] = None
    app: Optional[str] = None
    title: Optional[str] = None
    progress: Optional[int] = None  # 0-100
    payload: dict = field(default_factory=dict)  # полный разобранный payload


class Osc7501Parser:
    """Потоковый парсер OSC 7501.

    Пример:
        parser = Osc7501Parser()
        statuses = parser.feed(
            b"hello \x1b]7501;state=working\x07 world"
        )
        # → [AgentStatus(state='working', attention=False, raw='working', ...)]
    """

    OSC_BEGIN = b"\x1b]7501;"
    TERM_BEL = b"\x07"
    TERM_ST = b"\x1b\\"
    MAX_BUFFER = 65536

    def __init__(self, max_buffer: int = MAX_BUFFER) -> None:
        self._buffer = bytearray()
        self._max_buffer = max_buffer

    def feed(self, data: bytes) -> list[AgentStatus]:
        """Скармливает байты вывода терминала; возвращает распознанные статусы."""
        if not isinstance(data, bytes):
            data = bytes(data)
        if len(self._buffer) + len(data) > self._max_buffer:
            # «OSC 7501 sequence too long» — отклоняем накопленное,
            # но сохраняем возможный хвост потенциального префикса.
            self._buffer.clear()
            self._keep_only_partial_prefix()
        self._buffer.extend(data)
        messages: list[AgentStatus] = []
        while True:
            start = self._buffer.find(self.OSC_BEGIN)
            if start < 0:
                self._keep_only_partial_prefix()
                break

            begin_end = start + len(self.OSC_BEGIN)
            bel = self._buffer.find(self.TERM_BEL, begin_end)
            st = self._buffer.find(self.TERM_ST, begin_end)
            ends = [pos for pos in (bel, st) if pos >= 0]
            if not ends:
                # Терминатора ещё нет — держим только с начала OSC-строки.
                del self._buffer[:start]
                if len(self._buffer) > self._max_buffer:
                    del self._buffer[len(self.OSC_BEGIN):]
                break

            end = min(ends)
            term_len = 1 if end == bel else 2
            raw = bytes(self._buffer[begin_end:end])
            if len(raw) > self._max_buffer:
                # «OSC 7501 sequence too long» — отклоняем последовательность
                del self._buffer[:end + term_len]
                continue
            status = self._parse_payload(raw)
            if status is not None:
                messages.append(status)
            del self._buffer[:end + term_len]
        return messages

    def _parse_payload(self, raw: bytes) -> Optional[AgentStatus]:
        """Парсит и санитизирует payload последовательности."""
        # «payload is not escape code safe UTF-8»
        if not _is_safe_utf8(raw):
            return None
        if any(b in _ESCAPE_UNSAFE for b in raw):
            return None
        text = raw.decode("utf-8")
        # Сначала новый формат (key=value), затем JSON-совместимость.
        status = _parse_kv_payload(text)
        if status is not None:
            return status
        try:
            payload = json.loads(text)
        except (json.JSONDecodeError, TypeError):
            payload = None
        return _parse_dict_payload(payload) if isinstance(payload, dict) else None

    def _keep_only_partial_prefix(self) -> None:
        """Оставляет суффикс буфера, который может быть началом OSC_BEGIN."""
        prefix = self.OSC_BEGIN
        keep = 0
        for n in range(len(prefix) - 1, 0, -1):
            if self._buffer.endswith(prefix[:n]):
                keep = n
                break
        if keep:
            del self._buffer[:-keep]
        else:
            self._buffer.clear()
