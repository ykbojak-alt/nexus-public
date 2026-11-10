#!/usr/bin/env python3
"""test_session_merge.py — W53 GET /api/core/merge."""
from __future__ import annotations
import shutil, tempfile, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class MergeTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="mg-"))
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
    async def merge(self, **kw):
        from urllib.parse import urlencode
        return await self.client.get(
            "/api/core/merge?" + urlencode(kw))

    @unittest_run_loop
    async def test_concat_and_interleave(self):
        await self.run_terminal("m1")
        await self.run_terminal("m2")
        t1 = self.sup.get_terminal("local/m1")
        t2 = self.sup.get_terminal("local/m2")
        t1.scrollback.extend(["a1", "a2", "a3"])
        t2.scrollback.extend(["b1", "b2"])
        # concat default
        d = await (await self.merge(a="m1", b="m2")).json()
        self.assertEqual(d["order"], "concat")
        self.assertEqual(d["a_lines"], 3)
        self.assertEqual(d["b_lines"], 2)
        self.assertEqual(d["feed_lines"], 5)
        srcs = [f["src"] for f in d["feed"]]
        self.assertEqual(srcs, ["a", "a", "a", "b", "b"])
        self.assertEqual(d["feed"][0],
                         {"src": "a", "line": 1, "text": "a1"})
        self.assertEqual(d["feed"][4]["text"], "b2")
        # interleave
        d = await (await self.merge(
            a="m1", b="m2", order="interleave")).json()
        srcs = [f["src"] for f in d["feed"]]
        self.assertEqual(srcs, ["a", "b", "a", "b", "a"])
        texts = [f["text"] for f in d["feed"]]
        self.assertEqual(texts, ["a1", "b1", "a2", "b2", "a3"])
        # line — 1-based в ИСТОЧНИКЕ
        self.assertEqual(d["feed"][4]["line"], 3)

    @unittest_run_loop
    async def test_validation_and_fallback(self):
        await self.run_terminal("m1")
        # missing params → 400
        self.assertEqual((await self.client.get(
            "/api/core/merge")).status, 400)
        # unknown → 404
        self.assertEqual((await self.merge(
            a="m1", b="ghost")).status, 404)
        # bad order → 400
        self.assertEqual((await self.merge(
            a="m1", b="m1", order="weird")).status, 400)
        # recent_output fallback при пустом scrollback
        t = self.sup.get_terminal("local/m1")
        t.scrollback.clear()
        t.recent_output = "fb1\nfb2"
        d = await (await self.merge(a="m1", b="m1")).json()
        self.assertEqual(d["a_lines"], 2)
        self.assertEqual(d["feed"][0]["text"], "fb1")


if __name__ == "__main__":
    unittest.main()
