#!/usr/bin/env python3
"""
tools/nexus_core/test_events_filter.py — #570 events?types= фильтр + data.term.

API (AioHTTPTestCase + MockPTYBackend): фильтрация replay+live по типам,
400 на неизвестный тип со списком known, пустой types = весь поток,
data.term=<address> на терминальных событиях (включая renamed).

Запуск: pytest tools/nexus_core/test_events_filter.py
"""

from __future__ import annotations

import asyncio
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


def _sse_events(text: str) -> list[dict]:
    """Распарсить SSE-чанк в список data-объектов."""
    out = []
    for block in text.split("\n\n"):
        if "data: " in block:
            try:
                out.append(json.loads(block.split("data: ", 1)[1].strip()))
            except json.JSONDecodeError:
                pass
    return out


class EventsFilterApiTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="evfilter-"))
        self.backend = MockPTYBackend()
        self.sup = SupervisorV1(backend=self.backend)
        super().setUp()

    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.tmp / "state",
                          supervisor=self.sup,
                          templates_dir=self.tmp / "templates")

    async def run_terminal(self, name="t1", **kwargs):
        resp = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"], **kwargs})
        self.assertEqual(resp.status, 200)
        return await resp.json()

    async def read_chunk(self, resp, timeout=5.0) -> str:
        return (await asyncio.wait_for(
            resp.content.read(8192), timeout=timeout)).decode("utf-8")

    # -- фильтрация --------------------------------------------------------

    @unittest_run_loop
    async def test_types_filter_live_and_replay(self):
        await self.run_terminal("t1")
        term = self.sup.get_terminal("local/t1")
        # replay под фильтром attention: spawn/created/size НЕ проходят
        resp = await self.client.get(
            "/api/core/events?types=attention")
        self.assertEqual(resp.status, 200)
        # live: attention (raw output) + status (OSC) — проходит только attention
        term.handle.emit_raw(b"some output\n")
        term.handle.emit_osc("working")
        self.sup.step_once()
        chunk = await self.read_chunk(resp)
        types = {e.get("type") for e in _sse_events(chunk)}
        self.assertIn("attention", types)
        self.assertNotIn("status", types)
        self.assertNotIn("spawn", types)
        self.assertNotIn("created", types)
        await resp.release()

    @unittest_run_loop
    async def test_types_unknown_400_with_known_list(self):
        resp = await self.client.get(
            "/api/core/events?types=attention,bogus-type")
        self.assertEqual(resp.status, 400)
        body = await resp.json()
        self.assertIn("bogus-type", body["error"])
        self.assertIn("attention", body["known_types"])
        self.assertIn("exited", body["known_types"])
        self.assertIn("renamed", body["known_types"])

    @unittest_run_loop
    async def test_types_empty_and_spaces_full_stream(self):
        await self.run_terminal("t1")
        for q in ("types=", "types=%20%20,,%20"):
            resp = await self.client.get(f"/api/core/events?{q}")
            self.assertEqual(resp.status, 200)
            chunk = await self.read_chunk(resp)
            self.assertIn("event: spawn", chunk, msg=q)
            await resp.release()

    @unittest_run_loop
    async def test_types_spaces_and_case_tolerant(self):
        resp = await self.client.get(
            "/api/core/events?types=%20attention%20,%20exited%20")
        self.assertEqual(resp.status, 200)
        await resp.release()

    # -- data.term ----------------------------------------------------------

    @unittest_run_loop
    async def test_data_term_on_terminal_events(self):
        await self.run_terminal("t1")
        resp = await self.client.get("/api/core/events")
        chunk = await self.read_chunk(resp)
        events = _sse_events(chunk)
        term_events = [e for e in events if e.get("address")]
        self.assertTrue(term_events, f"no terminal events: {events}")
        for e in term_events:
            self.assertEqual(e.get("term"), e["address"],
                             msg=f"event {e.get('type')} missing term")
        await resp.release()

    @unittest_run_loop
    async def test_renamed_event_carries_term(self):
        await self.run_terminal("t1")
        resp = await self.client.post(
            "/api/core/terminal/t1/rename", json={"new_name": "t2"})
        self.assertEqual(resp.status, 200)
        resp = await self.client.get("/api/core/events?types=renamed")
        self.assertEqual(resp.status, 200)
        chunk = await self.read_chunk(resp)
        events = _sse_events(chunk)
        renamed = [e for e in events if e.get("type") == "renamed"]
        self.assertTrue(renamed, f"no renamed event: {events}")
        self.assertEqual(renamed[0]["term"], "local/t2")
        self.assertEqual(renamed[0]["new"], "local/t2")
        await resp.release()


if __name__ == "__main__":
    unittest.main()
