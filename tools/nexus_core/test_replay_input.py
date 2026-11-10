#!/usr/bin/env python3
"""test_replay_input.py — W20 POST /terminal/<n>/replay."""
from __future__ import annotations
import asyncio, shutil, tempfile, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app, _replay_inputs
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class ReplayTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="rep-"))
        self.state_dir = self.tmp / "state"
        self.sup = SupervisorV1(backend=MockPTYBackend())
        super().setUp()
    def tearDown(self):
        super().tearDown(); shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.state_dir, supervisor=self.sup,
                          templates_dir=self.tmp / "templates")
    async def run_terminal(self, name):
        r = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"],
            "cwd": "D:/Temp"})
        self.assertEqual(r.status, 200)
    async def send(self, name, text, enter=True):
        return await self.client.post("/api/core/send", json={
            "term": name, "text": text, "enter": enter})
    def stdin_of(self, name):
        t = self.sup.get_terminal(f"local/{name}")
        return bytes(t.handle._stdin) if t.handle else b""

    @unittest_run_loop
    async def test_send_records_input_log(self):
        await self.run_terminal("r1")
        await self.send("r1", "echo one")
        await self.send("r1", "echo two", enter=False)
        t = self.sup.get_terminal("local/r1")
        self.assertEqual(len(t.input_log), 2)
        self.assertEqual(t.input_log[0]["text"], "echo one")
        self.assertTrue(t.input_log[0]["enter"])
        self.assertFalse(t.input_log[1]["enter"])

    @unittest_run_loop
    async def test_replay_creates_and_replays(self):
        await self.run_terminal("r1")
        await self.send("r1", "echo AAA")
        await self.send("r1", "echo BBB", enter=False)
        r = await self.client.post(
            "/api/core/terminal/r1/replay",
            json={"name": "r1-copy"})
        self.assertEqual(r.status, 200)
        d = await r.json()
        self.assertEqual(d["name"], "r1-copy")
        self.assertEqual(d["replayed"], 2)
        self.assertEqual(d["source"], "local/r1")
        self.assertEqual(d["replay"], "scheduled")
        self.assertEqual(d["cwd"], "D:/Temp")  # наследование spec
        # дождаться фоновой задачи
        for _ in range(50):
            await asyncio.sleep(0.05)
            if b"echo BBB" in self.stdin_of("r1-copy"):
                break
        stdin = self.stdin_of("r1-copy")
        self.assertIn(b"echo AAA\r", stdin)
        self.assertIn(b"echo BBB", stdin)
        self.assertNotIn(b"echo BBB\r", stdin)  # enter=false соблюдён
        # replay записался в input_log копии → цепочка работает
        t2 = self.sup.get_terminal("local/r1-copy")
        self.assertGreaterEqual(len(t2.input_log), 2)

    @unittest_run_loop
    async def test_replay_auto_name_and_empty(self):
        await self.run_terminal("r2")
        # пустая история → replay:"empty", терминал всё равно создаётся
        r = await self.client.post("/api/core/terminal/r2/replay",
                                   json={})
        d = await r.json()
        self.assertEqual(d["replayed"], 0)
        self.assertEqual(d["replay"], "empty")
        self.assertTrue(d["name"].startswith("r2-replay"))
        # 404 + bad name + bad command
        self.assertEqual((await self.client.post(
            "/api/core/terminal/ghost/replay", json={})).status, 404)
        self.assertEqual((await self.client.post(
            "/api/core/terminal/r2/replay",
            json={"name": "BAD NAME!"})).status, 400)
        self.assertEqual((await self.client.post(
            "/api/core/terminal/r2/replay",
            json={"command": "notalist"})).status, 400)

    @unittest_run_loop
    async def test_replay_delay_and_overrides(self):
        await self.run_terminal("r3")
        await self.send("r3", "x")
        r = await self.client.post("/api/core/terminal/r3/replay",
                                   json={"name": "r3-c",
                                         "command": ["cmd", "/c", "x"],
                                         "delay_ms": 1})
        d = await r.json()
        t = self.sup.get_terminal("local/r3-c")
        self.assertEqual(t.command, ["cmd", "/c", "x"])
        self.assertEqual(d["replayed"], 1)


if __name__ == "__main__":
    unittest.main()
