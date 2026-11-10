#!/usr/bin/env python3
"""test_stats.py — W54 GET /api/core/stats."""
from __future__ import annotations
import shutil, tempfile, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class StatsTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="st-"))
        self.state_dir = self.tmp / "state"
        self.state_dir.mkdir(parents=True)
        self.sup = SupervisorV1(backend=MockPTYBackend(),
                                registry_path=self.state_dir
                                / "registry.json")
        super().setUp()
    def tearDown(self):
        super().tearDown(); shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.state_dir, supervisor=self.sup,
                          templates_dir=self.tmp / "templates")
    async def run_terminal(self, name):
        r = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"]})
        self.assertEqual(r.status, 200)

    @unittest_run_loop
    async def test_grouping_by_machine_and_space(self):
        await self.run_terminal("s1")
        await self.run_terminal("s2")
        await self.run_terminal("s3")
        t1 = self.sup.get_terminal("local/s1")
        t2 = self.sup.get_terminal("local/s2")
        t3 = self.sup.get_terminal("local/s3")
        t1.out_bytes = 100
        t2.out_bytes = 200
        t3.out_bytes = 400
        t3.state = "exited"
        # migrate s2 → custom space
        await self.client.post("/api/core/space",
                               json={"name": "ops"})
        r = await self.client.post(
            "/api/core/terminal/s2/migrate",
            json={"space": "ops"})
        self.assertEqual(r.status, 200)
        d = await (await self.client.get("/api/core/stats")).json()
        self.assertEqual(d["terminals_total"], 3)
        self.assertEqual(d["totals"]["out_bytes"], 700)
        self.assertEqual(d["totals"]["live"], 2)
        self.assertEqual(d["totals"]["exited"], 1)
        # by_machine: все local
        self.assertEqual(d["by_machine"]["local"]["terms"], 3)
        self.assertEqual(d["by_machine"]["local"]["out_bytes"], 700)
        self.assertEqual(d["by_machine"]["local"]["states"]
                         .get("exited"), 1)
        # by_space: local(2: s1,s3) + ops(1: s2)
        self.assertEqual(d["by_space"]["local"]["terms"], 2)
        self.assertEqual(d["by_space"]["ops"]["terms"], 1)
        self.assertEqual(d["by_space"]["ops"]["out_bytes"], 200)
        # out_mb присутствует
        self.assertIn("out_mb", d["by_space"]["ops"])
        # пустой ответ без терминалов — не падает (отдельный app)


if __name__ == "__main__":
    unittest.main()
