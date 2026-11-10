#!/usr/bin/env python3
"""test_out_rate.py — W51 output rate-limit per term."""
from __future__ import annotations
import os, shutil, tempfile, time, unittest
from pathlib import Path
from unittest import mock
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class OutRateTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="rate-"))
        self.state_dir = self.tmp / "state"
        self.sup = SupervisorV1(backend=MockPTYBackend())
        super().setUp()
    def tearDown(self):
        super().tearDown(); shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.state_dir, supervisor=self.sup,
                          templates_dir=self.tmp / "templates")
    async def run_terminal(self, name="r1"):
        r = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"]})
        self.assertEqual(r.status, 200)
    def term(self, name="r1"):
        return self.sup.get_terminal(f"local/{name}")

    @unittest_run_loop
    async def test_label_limit_drops_excess(self):
        """label _out_rate=10 → чанк 20B дропается, scrollback пуст."""
        await self.run_terminal()
        t = self.term()
        t.labels["_out_rate"] = "10"
        t.handle.stdout.extend(b"X" * 20 + b"\n")
        self.sup.step_once()
        self.assertEqual(t.scrollback, __import__("collections")
                         .deque())
        self.assertEqual(t._rl_dropped, 21)
        self.assertEqual(t.out_bytes, 0)  # dropped не считается
        # в пределах лимита — пишется
        t.handle.stdout.extend(b"OK\n")
        self.sup.step_once()
        self.assertIn("OK", list(t.scrollback)[-1])

    @unittest_run_loop
    async def test_window_reset_emits_event(self):
        """Граница 1с-окна → output_limited event с dropped_bytes."""
        await self.run_terminal()
        t = self.term()
        t.labels["_out_rate"] = "5"
        t.handle.stdout.extend(b"A" * 10)
        self.sup.step_once()
        # форсируем границу окна
        t._rl_ts = time.time() - 2
        t.handle.stdout.extend(b"B" * 3)  # 3 ≤ 5 — пройдёт
        self.sup.step_once()
        ev = [e for e in self.sup.events
              if e["type"] == "output_limited"]
        self.assertEqual(len(ev), 1)
        self.assertEqual(ev[0]["dropped_bytes"], 10)
        self.assertEqual(ev[0]["address"], "local/r1")

    @unittest_run_loop
    async def test_env_default_and_unlimited(self):
        """env NEXUS_OUT_RATE=8 → дефолт-лимит; 0 → unlimited."""
        await self.run_terminal()
        with mock.patch.dict(os.environ, {"NEXUS_OUT_RATE": "8"}):
            sup2 = SupervisorV1(backend=MockPTYBackend())
        self.assertEqual(sup2.out_rate_limit, 8)
        t = self.term()
        # без label → env-лимит sup... но self.sup создан без env.
        # проверяем _term_out_rate напрямую:
        t.labels.pop("_out_rate", None)
        self.assertEqual(self.sup._term_out_rate(t),
                         self.sup.out_rate_limit)
        # label "0" → unlimited даже при env-лимите
        self.sup.out_rate_limit = 8
        t.labels["_out_rate"] = "0"
        self.assertEqual(self.sup._term_out_rate(t), 0)
        # невалидный label → env default
        t.labels["_out_rate"] = "abc"
        self.assertEqual(self.sup._term_out_rate(t), 8)
        # сам unlimited-терминал не дропает
        t.labels["_out_rate"] = "0"
        t.handle.stdout.extend(b"Z" * 100)
        self.sup.step_once()
        self.assertGreater(len(list(t.scrollback)), 0)


if __name__ == "__main__":
    unittest.main()
