#!/usr/bin/env python3
"""test_script.py — W58 input scripting / runbook."""
from __future__ import annotations
import shutil, tempfile, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class ScriptTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="sc-"))
        self.state_dir = self.tmp / "state"
        self.sup = SupervisorV1(backend=MockPTYBackend())
        super().setUp()
    def tearDown(self):
        super().tearDown(); shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.state_dir, supervisor=self.sup,
                          templates_dir=self.tmp / "templates")
    async def run_terminal(self, name="s1"):
        r = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"]})
        self.assertEqual(r.status, 200)

    @unittest_run_loop
    async def test_script_exec_and_partial_fail(self):
        await self.run_terminal()
        steps = [
            {"term": "s1", "text": "ls"},
            {"term": "ghost", "text": "x"},      # ok:false, не роняет
            {"term": "s1", "keys": ["ctrl+c"]},
        ]
        r = await self.client.post("/api/core/script",
                                   json={"steps": steps})
        d = await r.json()
        self.assertEqual(d["steps"], 3)
        self.assertFalse(d["ok"])               # шаг 1 упал
        self.assertEqual([x["ok"] for x in d["results"]],
                         [True, False, True])
        t = self.sup.get_terminal("local/s1")
        texts = [e["text"] for e in t.input_log]
        self.assertIn("ls", texts)

    @unittest_run_loop
    async def test_save_list_run(self):
        await self.run_terminal()
        steps = [{"term": "s1", "text": "whoami"}]
        r = await self.client.post("/api/core/script", json={
            "steps": steps, "save": "boot"})
        d = await r.json()
        self.assertEqual(d.get("saved"), "boot")
        self.assertTrue((self.state_dir / "scripts"
                         / "boot.json").exists())
        # list
        d = await (await self.client.get(
            "/api/core/scripts")).json()
        self.assertEqual(d["count"], 1)
        self.assertEqual(d["scripts"][0]["name"], "boot")
        # run
        r = await self.client.post("/api/core/script/run",
                                   json={"name": "boot"})
        d = await r.json()
        self.assertTrue(d["ok"])
        t = self.sup.get_terminal("local/s1")
        # два прогона → whoami дважды в input_log
        self.assertEqual(
            sum(1 for e in t.input_log if e["text"] == "whoami"), 2)
        # unknown → 404, bad name → 404
        self.assertEqual((await self.client.post(
            "/api/core/script/run",
            json={"name": "ghost"})).status, 404)

    @unittest_run_loop
    async def test_validation(self):
        # пустые/битые steps
        self.assertEqual((await self.client.post(
            "/api/core/script", json={"steps": []})).status, 400)
        self.assertEqual((await self.client.post(
            "/api/core/script", json={})).status, 400)
        # bad save name
        r = await self.client.post("/api/core/script", json={
            "steps": [{"term": "x"}], "save": "bad name!"})
        self.assertEqual(r.status, 400)
        # traversal name → 404 на run (regex не пускает)
        self.assertEqual((await self.client.post(
            "/api/core/script/run",
            json={"name": "../evil"})).status, 404)


if __name__ == "__main__":
    unittest.main()
