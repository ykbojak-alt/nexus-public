#!/usr/bin/env python3
"""test_purge_exited.py — W18 POST /api/core/purge-exited."""
from __future__ import annotations
import shutil, tempfile, time, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class PurgeExitedTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="purge-"))
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
            "name": name, "command": ["sh", "-i"]})
        self.assertEqual(r.status, 200)
    def make_exited(self, name, age=0.0):
        t = self.sup.get_terminal(f"local/{name}")
        t.state = "exited"
        t.exited_at = time.time() - age
        return t

    @unittest_run_loop
    async def test_dry_run_then_purge(self):
        await self.run_terminal("p1")
        await self.run_terminal("p2")
        self.make_exited("p1", age=120)
        self.make_exited("p2", age=5)  # свежий — не трогаем
        # dry_run → считает, не удаляет
        r = await self.client.post("/api/core/purge-exited",
                                   json={"ttl_seconds": 60,
                                         "dry_run": True})
        d = await r.json()
        self.assertEqual(r.status, 200)
        self.assertEqual(d["removed"], 1)
        self.assertTrue(d["dry_run"])
        self.assertIsNotNone(self.sup.get_terminal("local/p1"))
        # реальный прогон
        r2 = await self.client.post("/api/core/purge-exited",
                                    json={"ttl_seconds": 60})
        d2 = await r2.json()
        self.assertEqual(d2["removed"], 1)
        self.assertFalse(d2["dry_run"])
        self.assertIsNone(self.sup.get_terminal("local/p1"))
        self.assertIsNotNone(self.sup.get_terminal("local/p2"))
        # событие removed
        ev = [e for e in self.sup.events
              if e["type"] == "removed"
              and e.get("address") == "local/p1"]
        self.assertTrue(ev)

    @unittest_run_loop
    async def test_default_ttl_and_validation(self):
        await self.run_terminal("p3")
        self.sup.exit_ttl = 30
        t = self.make_exited("p3", age=40)
        # без ttl_seconds → supervisor.exit_ttl
        r = await self.client.post("/api/core/purge-exited", json={})
        d = await r.json()
        self.assertEqual(d["ttl_seconds"], 30)
        self.assertEqual(d["removed"], 1)
        # bad ttl → 400
        r2 = await self.client.post("/api/core/purge-exited",
                                    json={"ttl_seconds": -5})
        self.assertEqual(r2.status, 400)
        r3 = await self.client.post("/api/core/purge-exited",
                                    json={"ttl_seconds": "x"})
        self.assertEqual(r3.status, 400)

    @unittest_run_loop
    async def test_running_not_touched(self):
        await self.run_terminal("p4")
        t = self.term = self.sup.get_terminal("local/p4")
        t.last_output_at = time.time() - 99999
        r = await self.client.post("/api/core/purge-exited",
                                   json={"ttl_seconds": 0})
        d = await r.json()
        self.assertEqual(d["removed"], 0)
        self.assertIsNotNone(self.sup.get_terminal("local/p4"))


if __name__ == "__main__":
    unittest.main()
