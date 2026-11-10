#!/usr/bin/env python3
"""
tools/nexus_core/test_system_endpoint.py — GET /api/core/system (#537).

Покрытие:
- endpoint отдаёт полный контракт {cpu_pct, mem_*, disks, net, gpu, uptime_s}
  через реальный create_app (AioHTTPTestCase, ephemeral-порт);
- rate-математика SystemMetrics._rates: cpu busy-delta, net bps,
  клэмп на 100%, поведение при сбросе/падении счётчиков;
- двойной collect() даёт живые rate'ы (не вечные нули).
"""

from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from tools.nexus_core.api import create_app
from tools.nexus_core.system_metrics import SystemMetrics, _collect_gpu


def make_temp_base() -> Path:
    return Path(tempfile.mkdtemp(prefix="nexus-core-system-test-"))


class SystemEndpointTestCase(AioHTTPTestCase):
    """GET /api/core/system через реальный aiohttp app."""

    def setUp(self):
        self.tmp = make_temp_base()
        super().setUp()

    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.tmp)

    @unittest_run_loop
    async def test_system_endpoint_contract(self):
        resp = await self.client.get("/api/core/system")
        self.assertEqual(resp.status, 200)
        data = await resp.json()

        for key in ("cpu_pct", "mem_used", "mem_total", "disks",
                    "net", "gpu", "uptime_s"):
            self.assertIn(key, data, f"missing key: {key}")

        self.assertIsInstance(data["cpu_pct"], (int, float))
        self.assertGreaterEqual(data["cpu_pct"], 0.0)
        self.assertLessEqual(data["cpu_pct"], 100.0)

        self.assertIsInstance(data["mem_used"], int)
        self.assertIsInstance(data["mem_total"], int)
        self.assertGreater(data["mem_total"], 0)
        self.assertLessEqual(data["mem_used"], data["mem_total"])

        self.assertIsInstance(data["disks"], list)
        for d in data["disks"]:
            self.assertEqual(set(d.keys()), {"letter", "free", "total"})
            self.assertIsInstance(d["letter"], str)
            self.assertLessEqual(d["free"], d["total"])

        self.assertEqual(set(data["net"].keys()), {"rx_bps", "tx_bps"})
        self.assertGreaterEqual(data["net"]["rx_bps"], 0.0)
        self.assertGreaterEqual(data["net"]["tx_bps"], 0.0)

        gpu = data["gpu"]
        if gpu is not None:
            self.assertEqual(set(gpu.keys()),
                             {"pct", "vram_used", "vram_total", "temp"})

        self.assertGreater(data["uptime_s"], 0.0)

    @unittest_run_loop
    async def test_system_endpoint_repeatable(self):
        """Повторные запросы стабильны по форме (сэмпл-кэш singleton)."""
        for _ in range(2):
            resp = await self.client.get("/api/core/system")
            self.assertEqual(resp.status, 200)
            data = await resp.json()
            self.assertIn("cpu_pct", data)
            self.assertIn("net", data)


class TestRatesMath(unittest.TestCase):
    """SystemMetrics._rates — чистая математика дельт."""

    def _m(self) -> SystemMetrics:
        return SystemMetrics()

    def test_cpu_busy_delta(self):
        m = self._m()
        # t, idle, total, rx, tx
        prev = (0.0, 100.0, 1000.0, 0, 0)
        cur = (1.0, 150.0, 2000.0, 0, 0)
        cpu, rx, tx = m._rates(prev, cur)
        # dtotal=1000, didle=50 → busy = 95%
        self.assertAlmostEqual(cpu, 95.0, places=3)
        self.assertEqual(rx, 0.0)
        self.assertEqual(tx, 0.0)

    def test_cpu_clamped_100(self):
        m = self._m()
        prev = (0.0, 0.0, 1000.0, 0, 0)
        cur = (1.0, 0.0, 2000.0, 0, 0)  # нулевой idle → 100% busy
        cpu, _, _ = m._rates(prev, cur)
        self.assertEqual(cpu, 100.0)

    def test_net_bps(self):
        m = self._m()
        prev = (0.0, 0.0, 0.0, 1_000_000, 500_000)
        cur = (2.0, 0.0, 0.0, 3_000_000, 1_500_000)
        _, rx, tx = m._rates(prev, cur)
        self.assertAlmostEqual(rx, 1_000_000.0)  # 2MB / 2s
        self.assertAlmostEqual(tx, 500_000.0)

    def test_counter_reset_clamps_zero(self):
        """Счётчики упали (interface flap / 32-bit wrap) → rate=0,
        следующий сэмпл ребазится через self._prev=cur в collect()."""
        m = self._m()
        prev = (0.0, 0.0, 0.0, 5_000_000_000 % 2**32, 5_000_000_000 % 2**32)
        cur = (1.0, 0.0, 0.0, 1000, 1000)
        _, rx, tx = m._rates(prev, cur)
        self.assertEqual(rx, 0.0)
        self.assertEqual(tx, 0.0)

    def test_zero_dt_safe(self):
        m = self._m()
        s = (1.0, 10.0, 100.0, 5, 5)
        cpu, rx, tx = m._rates(s, s)
        self.assertEqual((cpu, rx, tx), (0.0, 0.0, 0.0))


class TestCollectLive(unittest.TestCase):
    """Живой collect() на реальной машине (без моков ОС)."""

    def test_collect_shape_and_live_rates(self):
        m = SystemMetrics()
        d1 = m.collect()          # первый: двойной замер ~100мс
        d2 = m.collect()          # второй: дельта от d1
        for d in (d1, d2):
            self.assertIn("cpu_pct", d)
            self.assertIn("mem_total", d)
            self.assertIn("disks", d)
            self.assertIn("net", d)
            self.assertIn("gpu", d)
            self.assertIn("uptime_s", d)
        # rate-поля всегда числа ≥ 0 (на тихой машине могут быть 0.0)
        self.assertGreaterEqual(d2["net"]["rx_bps"], 0.0)
        self.assertGreaterEqual(d2["net"]["tx_bps"], 0.0)
        self.assertGreaterEqual(d2["cpu_pct"], 0.0)
        self.assertLessEqual(d2["cpu_pct"], 100.0)

    def test_gpu_collector_contract(self):
        """_collect_gpu: либо None (нет nvidia-smi/ошибка), либо контракт."""
        gpu = _collect_gpu()
        if gpu is not None:
            self.assertEqual(set(gpu.keys()),
                             {"pct", "vram_used", "vram_total", "temp"})
            self.assertGreaterEqual(gpu["pct"], 0.0)
            self.assertLessEqual(gpu["pct"], 100.0)
            self.assertGreaterEqual(gpu["vram_used"], 0)
            self.assertGreaterEqual(gpu["vram_total"], 0)


if __name__ == "__main__":
    unittest.main()
