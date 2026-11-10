#!/usr/bin/env python3
"""test_batch_screens.py — W16 GET /api/core/screens?terms=."""
from __future__ import annotations
import shutil, tempfile, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class BatchScreensTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="bscr-"))
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

    @unittest_run_loop
    async def test_multi_terms_single_frame(self):
        await self.run_terminal("s1"); await self.run_terminal("s2")
        t1 = self.sup.get_terminal("local/s1")
        t1.scrollback.extend(["AAA-unique"])
        t1.attention = True
        r = await self.client.get("/api/core/screens?terms=s1,s2")
        self.assertEqual(r.status, 200)
        d = await r.json()
        self.assertEqual(d["count"], 2)
        by_term = {s["term"]: s for s in d["screens"]}
        self.assertIn("AAA-unique", by_term["local/s1"]["screen"])
        self.assertEqual(by_term["local/s1"]["state"], t1.state)
        self.assertTrue(by_term["local/s1"]["attention"])  # pre-clear
        self.assertIn("screen", by_term["local/s2"])
        # attention очищен после чтения (семантика /screen)
        self.assertFalse(t1.attention)

    @unittest_run_loop
    async def test_unknown_per_term_error_and_dedup(self):
        await self.run_terminal("s1")
        r = await self.client.get("/api/core/screens?terms=s1,ghost,s1")
        d = await r.json()
        self.assertEqual(d["count"], 2)  # s1 dedup + ghost error
        errs = [s for s in d["screens"] if "error" in s]
        self.assertEqual(errs[0]["term"], "ghost")

    @unittest_run_loop
    async def test_all_and_lines_param(self):
        await self.run_terminal("s1"); await self.run_terminal("s2")
        self.sup.get_terminal("local/s1").scrollback.extend(
            [f"L{i}" for i in range(50)])
        r = await self.client.get("/api/core/screens?terms=all&lines=5")
        d = await r.json()
        self.assertEqual(d["count"], 2)
        s1 = next(s for s in d["screens"] if s["term"] == "local/s1")
        self.assertEqual(s1["lines"], 5)
        self.assertTrue(s1["truncated"])
        self.assertIn("L49", s1["screen"])
        self.assertNotIn("L0\n", s1["screen"])

    @unittest_run_loop
    async def test_validation(self):
        r = await self.client.get("/api/core/screens")
        self.assertEqual(r.status, 400)
        r = await self.client.get("/api/core/screens?terms=")
        self.assertEqual(r.status, 400)
        r = await self.client.get("/api/core/screens?terms=s1&lines=x")
        self.assertEqual(r.status, 400)


    @unittest_run_loop
    async def test_format_diff_compact(self):
        """W36: format=diff — compact-diff vs prev scrollback."""
        await self.run_terminal("df1")
        t = self.sup.get_terminal("local/df1")
        t.scrollback.extend(["a", "b", "c"])
        # первый diff-запрос → first:true, без hunks
        d = await (await self.client.get(
            "/api/core/screens?terms=df1&format=diff")).json()
        s = d["screens"][0]
        self.assertEqual(d["format"], "diff")
        self.assertTrue(s["first"])
        self.assertNotIn("hunks", s)
        h1 = s["hash"]
        # меняем scrollback → второй запрос → changed + hunks
        t.scrollback.extend(["d", "e"])
        d = await (await self.client.get(
            "/api/core/screens?terms=df1&format=diff")).json()
        s = d["screens"][0]
        self.assertFalse(s["first"])
        self.assertTrue(s["changed"])
        self.assertNotEqual(s["hash"], h1)
        self.assertEqual(s["hunks_total"], 1)
        self.assertEqual(s["hunks"][0]["tag"], "insert")
        self.assertEqual(s["hunks"][0]["lines"], ["d", "e"])
        # без изменений → changed:false, similarity 1.0
        d = await (await self.client.get(
            "/api/core/screens?terms=df1&format=diff")).json()
        s = d["screens"][0]
        self.assertFalse(s["changed"])
        self.assertEqual(s["similarity"], 1.0)
        # bad format → 400
        r = await self.client.get(
            "/api/core/screens?terms=df1&format=xml")
        self.assertEqual(r.status, 400)


if __name__ == "__main__":
    unittest.main()
