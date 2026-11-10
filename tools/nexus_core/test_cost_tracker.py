#!/usr/bin/env python3
"""test_cost_tracker.py — W24 GET /terminal/<n>/cost."""
from __future__ import annotations
import shutil, tempfile, time, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class CostTrackerTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cost-"))
        self.state_dir = self.tmp / "state"
        self.sup = SupervisorV1(backend=MockPTYBackend())
        super().setUp()
    def tearDown(self):
        super().tearDown(); shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.state_dir, supervisor=self.sup,
                          templates_dir=self.tmp / "templates")
    async def run_terminal(self, name="c1"):
        r = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"]})
        self.assertEqual(r.status, 200)

    @unittest_run_loop
    async def test_out_bytes_and_state_time(self):
        await self.run_terminal()
        t = self.sup.get_terminal("local/c1")
        # имитируем проход тиков: state_time копится
        t._st_ts = time.time() - 0.2
        self.sup.step_once()
        self.assertGreater(t.state_time.get(t.state, 0), 0)
        # вывод → out_bytes
        t.handle.stdout.extend(b"y" * 50)
        self.sup.step_once()
        self.assertGreaterEqual(t.out_bytes, 50)
        # API
        d = await (await self.client.get(
            "/api/core/terminal/c1/cost")).json()
        self.assertEqual(d["term"], "local/c1")
        self.assertEqual(d["out_bytes"], t.out_bytes)
        self.assertGreater(d["out_mb"], 0)
        self.assertIn(t.state, d["state_time"])
        self.assertGreater(d["state_time_total"], 0)
        self.assertGreaterEqual(d["uptime_s"], 0)
        # to_dict несёт счётчики
        terms = await (await self.client.get(
            "/api/core/terminals")).json()
        tl = terms.get("terminals", terms if isinstance(terms, list)
                       else [])
        c1 = next(x for x in tl if x.get("name") == "c1")
        self.assertEqual(c1["out_bytes"], t.out_bytes)
        self.assertIn("state_time", c1)

    @unittest_run_loop
    async def test_state_transition_accounting(self):
        await self.run_terminal()
        t = self.sup.get_terminal("local/c1")
        self.sup.step_once()  # тик → idle-время
        old = t.state
        t.state = "exited" if old != "exited" else "running"
        t._st_ts = time.time() - 0.1
        self.sup.step_once()
        # время после перехода ушло в новое состояние
        self.assertGreater(t.state_time.get(t.state, 0), 0)

    @unittest_run_loop
    async def test_404(self):
        self.assertEqual((await self.client.get(
            "/api/core/terminal/ghost/cost")).status, 404)

    @unittest_run_loop
    async def test_cost_report_aggregation(self):
        """W44: /cost-report — totals + top по out_bytes."""
        await self.run_terminal("c1")
        await self.run_terminal("c2")
        t1 = self.sup.get_terminal("local/c1")
        t2 = self.sup.get_terminal("local/c2")
        t1.out_bytes = 500
        t2.out_bytes = 900
        t1.state_time = {"idle": 1.5}
        t2.state_time = {"idle": 2.5, "exited": 1.0}
        r = await self.client.get("/api/core/cost-report")
        self.assertEqual(r.status, 200)
        d = await r.json()
        self.assertEqual(d["terms_total"], 2)
        self.assertEqual(d["out_bytes"], 1400)
        self.assertEqual(d["out_mb"], 0.0014)
        self.assertEqual(d["by_state"]["idle"]["terms"], 2)
        self.assertEqual(d["by_state"]["idle"]["out_bytes"], 1400)
        self.assertEqual(d["state_time"]["idle"], 4.0)
        self.assertEqual(d["state_time"]["exited"], 1.0)
        # top — c2 первым (больше байт)
        self.assertEqual(d["top"][0]["term"], "local/c2")
        self.assertEqual(d["top"][0]["out_bytes"], 900)
        # top=1 режет
        d1 = await (await self.client.get(
            "/api/core/cost-report?top=1")).json()
        self.assertEqual(len(d1["top"]), 1)
        # bad top → 400
        self.assertEqual((await self.client.get(
            "/api/core/cost-report?top=x")).status, 400)


if __name__ == "__main__":
    unittest.main()
