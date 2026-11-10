#!/usr/bin/env python3
"""test_replay_file.py — W40 replay команд из файла."""
from __future__ import annotations
import asyncio, shutil, tempfile, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class ReplayFileTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="rf-"))
        self.state_dir = self.tmp / "state"
        self.state_dir.mkdir(parents=True)
        self.sup = SupervisorV1(backend=MockPTYBackend())
        super().setUp()
    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.state_dir, supervisor=self.sup,
                          templates_dir=self.tmp / "templates")

    def write_script(self, name="script.txt", lines=None):
        p = self.state_dir / name
        p.write_text("\n".join(lines or []), encoding="utf-8")
        return name

    @unittest_run_loop
    async def test_replay_file_runs_commands(self):
        self.write_script(lines=[
            "# comment", "", "echo one", "echo two\r", "  ",
            "echo three"])
        r = await self.client.post("/api/core/replay-file", json={
            "file": "script.txt", "name": "rf1"})
        self.assertEqual(r.status, 200, await r.text())
        d = await r.json()
        self.assertEqual(d["replayed"], 3)
        self.assertEqual(d["replay"], "scheduled")
        # ждём фон-прогон
        for _ in range(50):
            await asyncio.sleep(0.05)
            t = self.sup.get_terminal("local/rf1")
            if t and len(t.input_log) >= 3:
                break
        t = self.sup.get_terminal("local/rf1")
        texts = [e["text"] for e in t.input_log]
        self.assertEqual(texts, ["echo one", "echo two",
                                 "echo three"])
        self.assertTrue(all(e["enter"] for e in t.input_log))

    @unittest_run_loop
    async def test_validation(self):
        # missing file param
        r = await self.client.post("/api/core/replay-file", json={})
        self.assertEqual(r.status, 400)
        # unknown file → 404
        r = await self.client.post("/api/core/replay-file", json={
            "file": "nope.txt"})
        self.assertEqual(r.status, 404)
        # traversal → 400 (sandbox)
        r = await self.client.post("/api/core/replay-file", json={
            "file": "../outside.txt"})
        self.assertIn(r.status, (400, 404))
        # пустой/только-комменты → 400
        self.write_script("empty.txt", ["# nothing", "", "   "])
        r = await self.client.post("/api/core/replay-file", json={
            "file": "empty.txt"})
        self.assertEqual(r.status, 400)
        # auto-name
        self.write_script("s2.txt", ["echo hi"])
        r = await self.client.post("/api/core/replay-file", json={
            "file": "s2.txt"})
        d = await r.json()
        self.assertTrue(d["name"].startswith("replay-file-"))


if __name__ == "__main__":
    unittest.main()
