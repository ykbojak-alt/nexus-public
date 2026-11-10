#!/usr/bin/env python3
"""test_core_metrics.py — W34 GET /api/core/metrics."""
from __future__ import annotations
import shutil, tempfile, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class CoreMetricsTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="met-"))
        self.state_dir = self.tmp / "state"
        self.sup = SupervisorV1(backend=MockPTYBackend())
        super().setUp()
    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.state_dir, supervisor=self.sup,
                          templates_dir=self.tmp / "templates")

    @unittest_run_loop
    async def test_counters_and_gauges(self):
        r = await self.client.get("/api/core/metrics")
        self.assertEqual(r.status, 200)
        d = await r.json()
        self.assertIn("counters", d)
        self.assertIn("gauges", d)
        c, g = d["counters"], d["gauges"]
        self.assertEqual(c["terminals_created"], 0)
        self.assertEqual(g["terminals_live"], 0)
        # создаём терминал → счётчики растут
        await self.client.post("/api/core/run", json={
            "name": "m1", "command": ["sh", "-i"]})
        d = await (await self.client.get("/api/core/metrics")).json()
        self.assertEqual(d["counters"]["terminals_created"], 1)
        self.assertEqual(d["gauges"]["terminals_live"], 1)
        self.assertEqual(d["gauges"]["by_state"].get("idle"), 1)
        self.assertGreater(d["counters"]["events_total"], 0)
        self.assertIsNotNone(d["uptime_s"])
        # kill → exited counter
        t = self.sup.get_terminal("local/m1")
        self.sup.step_once()
        t.handle.close()
        self.sup.step_once()
        d = await (await self.client.get("/api/core/metrics")).json()
        self.assertEqual(d["counters"]["terminals_exited"], 1)
        self.assertEqual(d["gauges"]["terminals_live"], 0)


if __name__ == "__main__":
    unittest.main()
