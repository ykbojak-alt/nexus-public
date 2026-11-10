#!/usr/bin/env python3
"""test_markers.py — W12 POST /terminal/<n>/marker {label} → scrollback."""
from __future__ import annotations
import shutil, tempfile, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class MarkerApiTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="mark-"))
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
    async def mark(self, term="m1", **body):
        return await self.client.post(
            f"/api/core/terminal/{term}/marker", json=body)

    @unittest_run_loop
    async def test_marker_in_scrollback_and_dump(self):
        await self.run_terminal()
        t = self.sup.get_terminal("local/m1")
        t.scrollback.extend(["before"])
        resp = await self.mark(label="checkpoint-A")
        self.assertEqual(resp.status, 200)
        d = await resp.json()
        self.assertEqual(d["status"], "marked")
        self.assertEqual(d["marker"]["label"], "checkpoint-A")
        self.assertEqual(d["markers_total"], 1)
        lines = list(t.scrollback)
        self.assertTrue(any("MARKER" in x and "checkpoint-A" in x
                            for x in lines), lines)
        # structured record для W32
        self.assertEqual(t.markers[0]["label"], "checkpoint-A")
        # dump отдаёт строку маркера
        r = await self.client.get("/api/core/terminal/m1/dump")
        self.assertIn("checkpoint-A", await r.text())
        # recent_output (экран) НЕ загрязнён
        self.assertNotIn("MARKER", t.recent_output)

    @unittest_run_loop
    async def test_label_sanitized_single_line(self):
        await self.run_terminal()
        resp = await self.mark(label="  multi\nline\tlabel  ")
        d = await resp.json()
        self.assertEqual(d["marker"]["label"], "multi line label")
        t = self.sup.get_terminal("local/m1")
        self.assertNotIn("\n", t.scrollback[-1])

    @unittest_run_loop
    async def test_label_required_and_404(self):
        await self.run_terminal()
        for bad in ({}, {"label": ""}, {"label": "   "}, {"label": 5}):
            resp = await self.mark(**bad)
            self.assertEqual(resp.status, 400, msg=str(bad))
        resp = await self.mark(term="ghost", label="x")
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_multiple_markers_order(self):
        await self.run_terminal()
        await self.mark(label="first")
        await self.mark(label="second")
        t = self.sup.get_terminal("local/m1")
        self.assertEqual(len(t.markers), 2)
        marks = [x for x in t.scrollback if "MARKER" in x]
        self.assertEqual(len(marks), 2)
        self.assertIn("first", marks[0])
        self.assertIn("second", marks[1])


    @unittest_run_loop
    async def test_screen_and_screens_carry_markers(self):
        """W32: marker-поле в scrollback-кадрах /screen + /screens."""
        await self.run_terminal()
        t = self.sup.get_terminal("local/m1")
        t.scrollback.extend(["line1", "line2"])
        await self.mark(label="checkpoint")
        t.scrollback.append("after")
        # /screen
        resp = await self.client.get("/api/core/screen/m1?lines=50")
        d = await resp.json()
        self.assertIn("markers", d)
        self.assertEqual(len(d["markers"]), 1)
        mk = d["markers"][0]
        self.assertEqual(mk["label"], "checkpoint")
        self.assertIsInstance(mk["ts"], float)
        # idx указывает на строку маркера в scrollback
        self.assertIn("MARKER", t.scrollback[mk["idx"]])
        # /screens batch
        resp = await self.client.get("/api/core/screens?terms=m1")
        d = await resp.json()
        self.assertEqual(len(d["screens"][0]["markers"]), 1)
        self.assertEqual(d["screens"][0]["markers"][0]["label"],
                         "checkpoint")


if __name__ == "__main__":
    unittest.main()
