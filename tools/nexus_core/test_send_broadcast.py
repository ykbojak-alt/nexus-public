#!/usr/bin/env python3
"""
tools/nexus_core/test_send_broadcast.py — W10 POST /api/core/send-broadcast.

{terms:[...]|"all", text, enter?} → только живым; per-term results,
unknown→error, exited→skipped, terms="all", enter=false без \r.

Запуск: pytest tools/nexus_core/test_send_broadcast.py
"""

from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class SendBroadcastApiTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="bcast-"))
        self.state_dir = self.tmp / "state"
        self.backend = MockPTYBackend()
        self.sup = SupervisorV1(backend=self.backend)
        super().setUp()

    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.state_dir,
                          supervisor=self.sup,
                          templates_dir=self.tmp / "templates")

    async def run_terminal(self, name, **kwargs):
        resp = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"], **kwargs})
        self.assertEqual(resp.status, 200)
        return await resp.json()

    async def bcast(self, **body):
        return await self.client.post(
            "/api/core/send-broadcast", json=body)

    def stdin_of(self, name):
        t = self.sup.get_terminal(f"local/{name}")
        return t.handle.stdin_data() if t and t.handle else b""

    # -- основное ------------------------------------------------------------

    @unittest_run_loop
    async def test_broadcast_to_list(self):
        await self.run_terminal("b1")
        await self.run_terminal("b2")
        await self.run_terminal("b3")
        resp = await self.bcast(
            terms=["b1", "local/b2"], text="HELLO-ALL")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["sent"], 2)
        self.assertEqual(data["skipped"], 0)
        self.assertIn(b"HELLO-ALL", self.stdin_of("b1"))
        self.assertIn(b"HELLO-ALL", self.stdin_of("b2"))
        self.assertNotIn(b"HELLO-ALL", self.stdin_of("b3"))

    @unittest_run_loop
    async def test_terms_all(self):
        await self.run_terminal("a1")
        await self.run_terminal("a2")
        resp = await self.bcast(terms="all", text="TO-ALL")
        data = await resp.json()
        self.assertEqual(resp.status, 200)
        self.assertEqual(data["sent"], 2)
        self.assertIn(b"TO-ALL", self.stdin_of("a1"))
        self.assertIn(b"TO-ALL", self.stdin_of("a2"))

    @unittest_run_loop
    async def test_dead_and_unknown_skipped(self):
        await self.run_terminal("live1")
        await self.run_terminal("dead1")
        d = self.sup.get_terminal("local/dead1")
        d.handle.close()
        self.sup.step_once()
        self.assertEqual(d.state, "exited")
        resp = await self.bcast(
            terms=["live1", "dead1", "ghost"], text="PING")
        data = await resp.json()
        self.assertEqual(data["sent"], 1)
        self.assertEqual(data["skipped"], 2)
        self.assertTrue(data["results"]["local/live1"]["ok"])
        self.assertFalse(data["results"]["local/dead1"]["ok"])
        self.assertTrue(data["results"]["local/dead1"]["skipped"])
        self.assertFalse(data["results"]["ghost"]["ok"])
        self.assertIn(b"PING", self.stdin_of("live1"))
        self.assertNotIn(b"PING", self.stdin_of("dead1") or b"")

    @unittest_run_loop
    async def test_enter_false_no_cr(self):
        await self.run_terminal("e1")
        resp = await self.bcast(
            terms=["e1"], text="no-enter", enter=False)
        self.assertEqual(resp.status, 200)
        self.assertEqual(self.stdin_of("e1"), b"no-enter")

    @unittest_run_loop
    async def test_enter_default_adds_cr(self):
        await self.run_terminal("e2")
        resp = await self.bcast(terms=["e2"], text="with-enter")
        self.assertEqual(resp.status, 200)
        self.assertEqual(self.stdin_of("e2"), b"with-enter\r")

    # -- валидация -------------------------------------------------------------

    @unittest_run_loop
    async def test_missing_text_400(self):
        resp = await self.bcast(terms=["x"])
        self.assertEqual(resp.status, 400)
        resp = await self.bcast(terms=["x"], text=123)
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_bad_terms_400(self):
        for bad in ({"terms": "x", "text": "t"},
                    {"terms": [1], "text": "t"},
                    {"text": "t"},
                    {"terms": [], "text": "t"}):
            resp = await self.client.post(
                "/api/core/send-broadcast", json=bad)
            # terms=[] → 200 matched 0 (пустой список валиден)
            if bad.get("terms") == []:
                self.assertEqual(resp.status, 200)
                data = await resp.json()
                self.assertEqual(data["sent"], 0)
            else:
                self.assertEqual(resp.status, 400, msg=str(bad))

    @unittest_run_loop
    async def test_empty_result_no_gate_needed(self):
        resp = await self.bcast(terms=[], text="nothing")
        data = await resp.json()
        self.assertEqual(resp.status, 200)
        self.assertEqual(data["results"], {})


if __name__ == "__main__":
    unittest.main()
