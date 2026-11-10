#!/usr/bin/env python3
"""test_terminal_diff.py — W13 GET /api/core/diff/{a}/{b}."""
from __future__ import annotations
import shutil, tempfile, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class DiffApiTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="diff-"))
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
    def set_screen(self, name, text):
        self.sup.get_terminal(f"local/{name}").recent_output = text
    async def diff(self, a, b):
        return await self.client.get(f"/api/core/diff/{a}/{b}")

    @unittest_run_loop
    async def test_identical_screens(self):
        await self.run_terminal("d1"); await self.run_terminal("d2")
        self.set_screen("d1", "line1\nline2\nline3")
        self.set_screen("d2", "line1\nline2\nline3")
        r = await self.diff("d1", "d2")
        self.assertEqual(r.status, 200)
        d = await r.json()
        self.assertTrue(d["identical"])
        self.assertEqual(d["similarity"], 1.0)
        self.assertEqual(d["hunks"], [])
        self.assertEqual(d["a"], "local/d1")

    @unittest_run_loop
    async def test_diverged_screens_hunks(self):
        await self.run_terminal("d1"); await self.run_terminal("d2")
        self.set_screen("d1", "same\nalpha\nsame2\nomega")
        self.set_screen("d2", "same\nbeta\nsame2\ngamma")
        d = await (await self.diff("d1", "d2")).json()
        self.assertFalse(d["identical"])
        self.assertLess(d["similarity"], 1.0)
        self.assertGreater(d["hunks_total"], 0)
        tags = {h["tag"] for h in d["hunks"]}
        self.assertIn("replace", tags)
        joined_a = "\n".join(
            l for h in d["hunks"] for l in h["a_lines"])
        self.assertIn("alpha", joined_a)
        self.assertIn("omega", joined_a)
        joined_b = "\n".join(
            l for h in d["hunks"] for l in h["b_lines"])
        self.assertIn("beta", joined_b)
        self.assertIn("gamma", joined_b)
        # equal-строки не попадают в hunks
        self.assertNotIn("same", joined_a)

    @unittest_run_loop
    async def test_insert_delete(self):
        await self.run_terminal("d1"); await self.run_terminal("d2")
        self.set_screen("d1", "a\nb\nc")
        self.set_screen("d2", "a\nx\nb\nc\ny")
        d = await (await self.diff("d1", "d2")).json()
        tags = [h["tag"] for h in d["hunks"]]
        self.assertIn("insert", tags)

    @unittest_run_loop
    async def test_404s_and_self_diff(self):
        await self.run_terminal("d1")
        self.assertEqual((await self.diff("d1", "ghost")).status, 404)
        self.assertEqual((await self.diff("ghost", "d1")).status, 404)
        # self-diff → identical
        d = await (await self.diff("d1", "d1")).json()
        self.assertTrue(d["identical"])

    @unittest_run_loop
    async def test_empty_screens(self):
        await self.run_terminal("d1"); await self.run_terminal("d2")
        d = await (await self.diff("d1", "d2")).json()
        self.assertTrue(d["identical"])
        self.assertEqual(d["similarity"], 1.0)


    @unittest_run_loop
    async def test_detail_line_positions(self):
        """W33: hunk.detail — позиции каждой расходящейся строки."""
        await self.run_terminal("p1")
        await self.run_terminal("p2")
        t1 = self.sup.get_terminal("local/p1")
        t2 = self.sup.get_terminal("local/p2")
        t1.recent_output = "same1\nold-line\nsame2\n"
        t2.recent_output = "same1\nnew-line\nextra\nsame2\n"
        d = await (await self.diff("p1", "p2")).json()
        self.assertFalse(d["identical"])
        h = d["hunks"][0]
        self.assertIn("detail", h)
        # detail несёт 1-based позиции обеих сторон
        tags = {(x["tag"], x.get("a"), x.get("b"))
                for x in h["detail"]}
        self.assertTrue(any(t[0] == "rep" for t in tags))
        self.assertTrue(any(t[0] == "ins" for t in tags))
        rep = next(x for x in h["detail"] if x["tag"] == "rep")
        self.assertEqual(rep["a"], 2)
        self.assertEqual(rep["b"], 2)
        self.assertEqual(rep["a_text"], "old-line")
        self.assertEqual(rep["b_text"], "new-line")


if __name__ == "__main__":
    unittest.main()
