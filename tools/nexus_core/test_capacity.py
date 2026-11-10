#!/usr/bin/env python3
"""test_capacity.py — W28 GET /api/core/capacity."""
from __future__ import annotations
import os, shutil, tempfile, time, unittest
from pathlib import Path
from unittest import mock
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class CapacityTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cap-"))
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
    async def test_shape_and_counts(self):
        r = await self.client.get("/api/core/capacity")
        self.assertEqual(r.status, 200)
        d = await r.json()
        for k in ("live", "exited", "total", "per_terminal_mb",
                  "mem_total_mb", "mem_free_mb", "mem_slots_estimate",
                  "slots_estimate", "estimate"):
            self.assertIn(k, d)
        self.assertEqual(d["live"], 0)
        self.assertTrue(d["estimate"])
        # live растёт с терминалами
        await self.client.post("/api/core/run", json={
            "name": "c1", "command": ["sh", "-i"]})
        d2 = await (await self.client.get(
            "/api/core/capacity")).json()
        self.assertEqual(d2["live"], 1)
        self.assertEqual(d2["total"], 1)

    @unittest_run_loop
    async def test_max_terms_caps_slots(self):
        await self.client.post("/api/core/run", json={
            "name": "c1", "command": ["sh", "-i"]})
        await self.client.post("/api/core/run", json={
            "name": "c2", "command": ["sh", "-i"]})
        with mock.patch.dict(os.environ, {"NEXUS_MAX_TERMS": "3"}):
            d = await (await self.client.get(
                "/api/core/capacity")).json()
        self.assertEqual(d["max_terms"], 3)
        self.assertEqual(d["slots_estimate"], 1)  # 3-2 live
        with mock.patch.dict(os.environ, {"NEXUS_MAX_TERMS": "1"}):
            d = await (await self.client.get(
                "/api/core/capacity")).json()
        self.assertEqual(d["slots_estimate"], 0)  # переполнено

    @unittest_run_loop
    async def test_mem_slots_math(self):
        fake = {"mem_total": 128 * 1024**3,
                "mem_used": 64 * 1024**3}
        with mock.patch(
                "tools.nexus_core.system_metrics."
                "SystemMetrics.collect", return_value=fake):
            d = await (await self.client.get(
                "/api/core/capacity")).json()
        # 64 GiB free / 48 MB ≈ 1365
        self.assertEqual(d["mem_free_mb"], 64 * 1024)
        self.assertEqual(d["mem_slots_estimate"],
                         (64 * 1024) // 48)
        self.assertEqual(d["slots_estimate"],
                         d["mem_slots_estimate"])

    @unittest_run_loop
    async def test_forecast_trend(self):
        """W47: capacity_history → slope + eta + projected."""
        now = time.time()
        # mem_free падает 100 MB/с на протяжении 100с, live растёт
        for i in range(20):
            self.sup.capacity_history.append({
                "ts": now - 100 + i * 5,
                "live": 2 + i // 10,
                "mem_free_mb": 10000 - i * 500})
        d = await (await self.client.get(
            "/api/core/capacity/forecast")).json()
        self.assertEqual(d["samples"], 20)
        self.assertTrue(d["estimate"])
        # mem_slope ≈ -100 MB/с (500MB за 5с)
        self.assertLess(d["mem_slope_mb_per_s"], -50)
        # live растёт ~0.2/с
        self.assertGreater(d["live_slope_per_s"], 0)
        # eta: mem_now=1000, slope~-100 → ~10с? точнее считаем
        self.assertIsNotNone(d["eta_mem_exhaust_s"])
        self.assertGreater(d["eta_mem_exhaust_s"], 0)
        self.assertEqual(d["projected"]["live_1h"],
                         max(0, round(d["live_now"]
                                      + d["live_slope_per_s"] * 3600, 1)))

    @unittest_run_loop
    async def test_forecast_empty_and_bad_window(self):
        d = await (await self.client.get(
            "/api/core/capacity/forecast")).json()
        self.assertEqual(d["samples"], 0)
        self.assertIn("note", d)
        self.assertEqual((await self.client.get(
            "/api/core/capacity/forecast?window=abc")).status, 400)
        # window клампится: огромный → 86400, крошечный → 30
        d = await (await self.client.get(
            "/api/core/capacity/forecast?window=999999")).json()
        self.assertEqual(d["window_s"], 86400.0)
        d = await (await self.client.get(
            "/api/core/capacity/forecast?window=1")).json()
        self.assertEqual(d["window_s"], 30.0)


if __name__ == "__main__":
    unittest.main()
