#!/usr/bin/env python3
"""
tools/nexus_core/test_terminal_pipe.py — W9 output pipes.

POST /api/core/terminal/<a>/pipe {"to":"<b>"} — вывод a → stdin b
на step_once; {"to":null}|{} — снять все от a; {"to":"b","remove":true}
— конкретный. GET /api/core/pipes — список. Ошибки: unknown→404,
self-pipe→400, remote→400. dst exited → пропуск, respawn → снова пишет.

Запуск: pytest tools/nexus_core/test_terminal_pipe.py
"""

from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1, Terminal


class TerminalPipeApiTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="pipe-"))
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

    async def pipe(self, src, **body):
        return await self.client.post(
            f"/api/core/terminal/{src}/pipe", json=body)

    def term(self, name):
        return self.sup.get_terminal(f"local/{name}")

    def emit_and_step(self, name, data: bytes):
        self.term(name).handle.emit_raw(data)
        self.sup.step_once()

    # -- add / flow ---------------------------------------------------------

    @unittest_run_loop
    async def test_pipe_forwards_output_to_dst_stdin(self):
        await self.run_terminal("src")
        await self.run_terminal("dst")
        resp = await self.pipe("src", to="dst")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["src"], "local/src")
        self.assertEqual(data["dst"], "local/dst")
        self.emit_and_step("src", b"PIPE-MARKER-123\r\n")
        self.assertIn(b"PIPE-MARKER-123", self.term("dst").handle.stdin_data())

    @unittest_run_loop
    async def test_pipe_idempotent_and_multi_dst(self):
        await self.run_terminal("s")
        await self.run_terminal("d1")
        await self.run_terminal("d2")
        await self.pipe("s", to="d1")
        await self.pipe("s", to="d1")  # повтор — не дублирует
        await self.pipe("s", to="local/d2")
        pipes = self.sup.list_pipes()
        self.assertEqual(len(pipes), 2)
        resp = await self.client.get("/api/core/pipes")
        pdata = await resp.json()
        self.assertEqual(pdata["count"], 2)
        self.emit_and_step("s", b"X")
        self.assertIn(b"X", self.term("d1").handle.stdin_data())
        self.assertIn(b"X", self.term("d2").handle.stdin_data())

    @unittest_run_loop
    async def test_no_pipe_no_forward(self):
        await self.run_terminal("s")
        await self.run_terminal("d")
        self.emit_and_step("s", b"NOPE")
        self.assertNotIn(b"NOPE", self.term("d").handle.stdin_data())

    # -- remove ---------------------------------------------------------------

    @unittest_run_loop
    async def test_remove_all_and_specific(self):
        await self.run_terminal("s")
        await self.run_terminal("d1")
        await self.run_terminal("d2")
        await self.pipe("s", to="d1")
        await self.pipe("s", to="d2")
        # конкретный
        resp = await self.pipe("s", to="d1", remove=True)
        data = await resp.json()
        self.assertEqual(data["removed"], 1)
        self.assertEqual(len(self.sup.list_pipes()), 1)
        # все остальные
        resp = await self.pipe("s", to=None)
        data = await resp.json()
        self.assertEqual(data["removed"], 1)
        self.assertEqual(self.sup.list_pipes(), [])
        self.emit_and_step("s", b"AFTER")
        self.assertNotIn(b"AFTER", self.term("d2").handle.stdin_data())

    @unittest_run_loop
    async def test_empty_body_removes_all(self):
        await self.run_terminal("s")
        await self.run_terminal("d")
        await self.pipe("s", to="d")
        resp = await self.client.post(
            "/api/core/terminal/s/pipe", data=b"")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["removed"], 1)

    # -- dst lifecycle ---------------------------------------------------------

    @unittest_run_loop
    async def test_exited_dst_skipped_respawn_resumes(self):
        await self.run_terminal("s")
        await self.run_terminal("d")
        await self.pipe("s", to="d")
        d = self.term("d")
        d.handle.close()
        self.sup.step_once()
        self.assertEqual(d.state, "exited")
        self.emit_and_step("s", b"WHILE-DEAD")
        # exited → handle None; ничего не упало, pipe жив
        self.assertEqual(len(self.sup.list_pipes()), 1)
        # respawn → новый handle → поток возобновляется
        self.sup.restart_terminal("local/d")
        self.emit_and_step("s", b"AFTER-RESPAWN")
        self.assertIn(b"AFTER-RESPAWN",
                      self.term("d").handle.stdin_data())

    # -- ошибки -----------------------------------------------------------------

    @unittest_run_loop
    async def test_unknown_src_404_unknown_dst_404(self):
        await self.run_terminal("d")
        resp = await self.pipe("ghost", to="d")
        self.assertEqual(resp.status, 404)
        await self.run_terminal("s")
        resp = await self.pipe("s", to="ghost")
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_self_pipe_400(self):
        await self.run_terminal("selfish")
        resp = await self.pipe("selfish", to="selfish")
        self.assertEqual(resp.status, 400)
        resp = await self.pipe("selfish", to="local/selfish")
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_remote_rejected(self):
        await self.run_terminal("s")
        fake = Terminal(name="rx", machine="remote1",
                        command=["sh"], state="idle")
        self.sup.terminals["remote1/rx"] = fake
        resp = await self.pipe("s", to="remote1/rx")
        self.assertEqual(resp.status, 400)
        # и remote src
        resp = await self.pipe("remote1/rx", to="s")
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_bad_to_type_400(self):
        await self.run_terminal("s")
        resp = await self.pipe("s", to=42)
        self.assertEqual(resp.status, 400)
        resp = await self.pipe("s", to="")
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_pipe_event_emitted(self):
        await self.run_terminal("s")
        await self.run_terminal("d")
        await self.pipe("s", to="d")
        types = [e["type"] for e in self.sup.events]
        self.assertIn("pipe", types)
        ev = [e for e in self.sup.events if e["type"] == "pipe"][-1]
        self.assertEqual(ev["op"], "add")
        self.assertEqual(ev["src"], "local/s")
        self.assertEqual(ev["dst"], "local/d")


if __name__ == "__main__":
    unittest.main()
