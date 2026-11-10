#!/usr/bin/env python3
"""
tools/nexus_core/events.py — события супервизора (N2, SSE).

`events.subscribe`-эквивалент: один JSON-объект на событие, формат SSE
    event: <type>
    data: <json>

    (keep-alive heartbeat)

Источник событий — широковещательный канал: супервизор опубликовывает
каждое событие (status/attention/done/lost/respawn/exited/...), подписчики
получают его в реальном времени. При подключении опционально отдаётся
история (replay) из канала; `Last-Event-ID: <seq>` продолжает с seq.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from typing import AsyncGenerator, Optional

# HERETIC #414 E-1: etype идёт в SSE-фрейм `event:` сырым — CRLF/управляющие
# символы в type позволяли инъектировать фреймы. Санитизируем до записи.
_EVENT_TYPE_UNSAFE = re.compile(r"[^a-zA-Z0-9_-]+")

# HERETIC #414 E-4: потолок одновременных SSE-подписчиков.
MAX_SUBSCRIBERS = 64

EVENT_TYPES = (
    # Канонические виды RFC-001 §18 (12)
    "created", "lost", "restarted", "keep", "finished", "removed",
    "status", "turn", "title", "labels", "size", "doc",
    # Легаси/дополнительные (наблюдаемые, не из RFC-таблицы)
    "attention", "done", "respawn", "exited", "spawn", "park",
    "interrupt", "parent_lost", "respawn_failed",
    # AO-1c: прогресс-события gate-графа (node_start до работы узла,
    # node_done по завершении). Имена узлов — только [a-zA-Z0-9_-]:
    # точка в node/type вырезается санитайзером _EVENT_TYPE_UNSAFE.
    "node_start", "node_done",
)

# #570: все типы, реально публикуемые в канал (supervisor _emit +
# api/aegis/gate_graph publish). EVENT_TYPES — канонический список;
# KNOWN_EVENT_TYPES — то, что валидирует ?types= у /api/core/events.
# Держать в синхроне с местами publish/_emit.
KNOWN_EVENT_TYPES = frozenset(EVENT_TYPES) | frozenset({
    # supervisor: rename/sanitize/registry-integrity
    "renamed", "spawn_sanitized", "respawn_sanitized",
    "registry_quarantined", "registry_untrusted",
    # api: custom spaces
    "space_created", "space_renamed", "space_deleted",
    "space_migrated",
    # supervisor: output pipes (W9), watch rules (W13), idle-kick (W17),
    # freeze/resume (W21)
    "pipe", "watch_hit", "idle_kick", "frozen", "resumed",
    "file_pipe", "file_pipe_full", "file_pipe_rotate", "alert",
    "scheduled", "output_limited", "send_queue",
    "scrollback_compressed", "relay_spawn", "space_labels",
    "registry_migrated",
    "webhook_test",
    # aegis/gate: решения и состояние политики
    "guardian", "panic", "policy", "policy_reload", "simulate",
    "verdict",
})


class EventChannel:
    """Широковещательный канал событий (publish → все подписчики)."""

    def __init__(self) -> None:
        self._subscribers: list[asyncio.Queue] = []
        self._lock = asyncio.Lock()
        self._history: list[dict] = []
        self._seq = 0

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    async def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=1024)
        async with self._lock:
            if len(self._subscribers) >= MAX_SUBSCRIBERS:
                raise RuntimeError("SSE subscriber cap reached")
            self._subscribers.append(q)
        return q

    async def unsubscribe(self, q: asyncio.Queue) -> None:
        async with self._lock:
            try:
                self._subscribers.remove(q)
            except ValueError:
                pass

    def publish(self, event: dict) -> None:
        """Публикует событие всем подписчикам (без блокировок)."""
        event = dict(event)
        event.setdefault("ts", time.time())
        # #570: терминальные события несут data.term=<address> —
        # фронт вяжет кадр к терминалу без парсинга address.
        # Override, не setdefault: spawn/created исторически несли
        # term=<short-name> — на SSE-границе term унифицирован = address
        # (короткое имя выводится из хвоста address).
        if isinstance(event.get("address"), str):
            event["term"] = event["address"]
        self._seq += 1
        event["seq"] = self._seq
        self._history.append(event)
        if len(self._history) > 1000:
            del self._history[:-1000]
        for q in list(self._subscribers):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass

    def replay(self, after_seq: Optional[int] = None, limit: int = 1000) -> list[dict]:
        """События из истории: все либо после after_seq (для резюме)."""
        events = self._history
        if after_seq is not None:
            events = [e for e in events if e.get("seq", 0) > after_seq]
        return events[-limit:]

    @property
    def seq(self) -> int:
        return self._seq


class SupervisorEventStream:
    """Подключение супервизора к каналу событий."""

    def __init__(self, supervisor) -> None:
        self.supervisor = supervisor
        self.channel = EventChannel()

    def start(self) -> None:
        """Публикует уже накопленные события супервизора в канал."""
        for event in self.supervisor.events:
            self.channel.publish(event)

    async def stream(
        self,
        last_event_id: Optional[str] = None,
        replay: bool = True,
        types: Optional[set] = None,
    ) -> AsyncGenerator[str, None]:
        """SSE-поток: `event:` + `data:` строки, heartbeat каждые 15с.

        #570: types — множество разрешённых типов события (фильтр
        и replay, и live); None/пусто — весь поток. Heartbeat идёт
        независимо от фильтра — тихий поток не рвёт соединение.
        """
        q = await self.channel.subscribe()
        wanted = frozenset(types) if types else None

        def _wanted(event: dict) -> bool:
            return wanted is None or event.get("type") in wanted

        try:
            after_seq = None
            if replay and last_event_id is not None:
                try:
                    after_seq = int(last_event_id)
                except ValueError:
                    after_seq = None
            if replay:
                for event in self.channel.replay(after_seq=after_seq):
                    if _wanted(event):
                        yield self._format(event)
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=15.0)
                    if _wanted(event):
                        yield self._format(event)
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            await self.channel.unsubscribe(q)

    @staticmethod
    def _format(event: dict) -> str:
        etype = _EVENT_TYPE_UNSAFE.sub(
            "", str(event.get("type", "event"))) or "event"
        data = json.dumps(event, ensure_ascii=False)
        return f"event: {etype}\ndata: {data}\n\n"
