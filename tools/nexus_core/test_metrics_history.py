#!/usr/bin/env python3
"""test_metrics_history.py — W14 GET /terminal/<n>/metrics."""
from __future__ import annotations
import shutil, tempfile, time, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class MetricsApiTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="met-"))
        self.state_dir = self.tmp / "state"
        self.sup = SupervisorV1(backend=MockPTYBackend())
        super().setUp()
    def tearDown(self):
        super().tearDown(); shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.state_dir, supervisor=self.sup,
                          templates_dir=self.tmp / "templates")
    async def run_terminal(self, name="m1"):
        r = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"]})
        self.assertEqual(r.status, 200)
    def term(self, name="m1"):
        return self.sup.get_terminal(f"local/{name}")
    def force_sample(self):
        t = self.term()
        t._m_ts = time.time() - 2.0
        self.sup.step_once()

    @unittest_run_loop
    async def test_samples_and_output_rate(self):
        await self.run_terminal()
        t = self.term()
        self.sup.step_once()  # первый сэмпл всегда (m_ts=0)
        self.assertEqual(len(t.metrics), 1)
        self.assertEqual(t.metrics[-1]["state"], t.state)
        self.assertEqual(t.metrics[-1]["out_bps"], 0.0)
        # инжектим вывод → out_bps > 0 на следующем сэмпле
        t.handle.stdout.extend(b"x" * 100)
        self.force_sample()
        self.assertGreaterEqual(len(t.metrics), 2)
        self.assertGreater(t.metrics[-1]["out_bps"], 0)
        self.assertIn("x" * 10, t.recent_output)

    @unittest_run_loop
    async def test_state_changes_journal(self):
        await self.run_terminal()
        t = self.term()
        self.sup.step_once()
        old = t.state
        t.state = "exited" if old != "exited" else "idle"
        self.force_sample()
        self.assertEqual(len(t.state_changes), 1)
        ch = t.state_changes[0]
        self.assertEqual(ch["from"], old)
        self.assertEqual(ch["to"], t.state)
        self.assertIn("ts", ch)

    @unittest_run_loop
    async def test_api_shape_and_filters(self):
        await self.run_terminal()
        self.sup.step_once()
        t = self.term()
        t.handle.stdout.extend(b"data")
        self.force_sample()
        r = await self.client.get("/api/core/terminal/m1/metrics")
        self.assertEqual(r.status, 200)
        d = await r.json()
        self.assertEqual(d["term"], "local/m1")
        self.assertGreaterEqual(d["points"], 2)
        self.assertTrue(all("ts" in s and "state" in s
                            and "out_bps" in s for s in d["samples"]))
        self.assertIn("states_seen", d)
        self.assertEqual(d["current"]["state"], t.state)
        # since-фильтр: будущее → пусто
        r2 = await self.client.get(
            "/api/core/terminal/m1/metrics?since=9999999999")
        d2 = await r2.json()
        self.assertEqual(d2["points"], 0)
        # points-кап
        r3 = await self.client.get(
            "/api/core/terminal/m1/metrics?points=1")
        self.assertEqual((await r3.json())["points"], 1)
        # bad params
        r4 = await self.client.get(
            "/api/core/terminal/m1/metrics?points=abc")
        self.assertEqual(r4.status, 400)
        # 404
        r5 = await self.client.get("/api/core/terminal/ghost/metrics")
        self.assertEqual(r5.status, 404)


if __name__ == "__main__":
    unittest.main()
