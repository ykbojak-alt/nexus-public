#!/usr/bin/env python3
"""test_scrollback_compress.py — W62 gzip scrollback при idle."""
from __future__ import annotations
import shutil, tempfile, time, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1, scrollback_all


class ScrollbackCompressTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="sbc-"))
        self.sup = SupervisorV1(backend=MockPTYBackend())
        # малые пороги для тестов
        self.sup.sbc_idle_s = 0.01
        self.sup.sbc_min_lines = 5
        super().setUp()
    def tearDown(self):
        super().tearDown(); shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.tmp / "state",
                          supervisor=self.sup,
                          templates_dir=self.tmp / "tpl")
    async def run_terminal(self, name="c1"):
        r = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"]})
        self.assertEqual(r.status, 200)
    def fill(self, term, n, prefix="L"):
        for i in range(n):
            term.scrollback.append(f"{prefix}{i}")

    @unittest_run_loop
    async def test_compress_and_read_back(self):
        await self.run_terminal()
        t = self.sup.get_terminal("local/c1")
        self.fill(t, 10)
        # ручной compress min_lines=3
        r = await self.client.post(
            "/api/core/terminal/c1/compress-scrollback",
            json={"min_lines": 3})
        d = await r.json()
        self.assertTrue(d["compressed"])
        self.assertEqual(d["lines"], 10)
        self.assertGreater(d["gz_bytes"], 0)
        self.assertEqual(len(t.scrollback), 0)   # deque очищен
        # идемпотентно
        d2 = await (await self.client.post(
            "/api/core/terminal/c1/compress-scrollback",
            json={})).json()
        self.assertTrue(d2["already"])
        # scrollback_all → архив + новые строки
        t.scrollback.append("NEW")
        lines = scrollback_all(t)
        self.assertEqual(lines[0], "L0")
        self.assertEqual(lines[-1], "NEW")
        self.assertEqual(len(lines), 11)
        # info endpoint
        d = await (await self.client.get(
            "/api/core/terminal/c1/scrollback-info")).json()
        self.assertTrue(d["compressed"])
        self.assertEqual(d["archived_lines"], 10)
        self.assertEqual(d["live_lines"], 1)

    @unittest_run_loop
    async def test_auto_compress_on_idle(self):
        await self.run_terminal()
        t = self.sup.get_terminal("local/c1")
        self.fill(t, 8)
        t.last_output_at = time.time() - 10  # давно idle
        self.sup.step_once()
        self.sup._last_sbc_scan = 0  # debounce
        self.sup.step_once()
        self.assertIsNotNone(t.scrollback_gz)
        # событие
        self.assertTrue(any(e["type"] == "scrollback_compressed"
                            for e in self.sup.events))
        # свежий вывод НЕ сжимается (last_output_at свежий)
        t2 = self.sup.get_terminal("local/c1")
        t2.scrollback_gz = None
        t2.scrollback_gz_count = 0
        self.fill(t2, 8, "F")
        t2.last_output_at = time.time()
        self.sup.step_once()
        self.assertIsNone(t2.scrollback_gz)

    @unittest_run_loop
    async def test_dump_sees_archived(self):
        await self.run_terminal()
        t = self.sup.get_terminal("local/c1")
        self.fill(t, 6, "D")
        await self.client.post(
            "/api/core/terminal/c1/compress-scrollback",
            json={"force": True})
        r = await self.client.get(
            "/api/core/terminal/c1/dump")
        text = await r.text()
        self.assertIn("D0", text)
        self.assertIn("D5", text)


if __name__ == "__main__":
    unittest.main()
