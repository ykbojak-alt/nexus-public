#!/usr/bin/env python3
"""test_space_batch.py — W60 space batch ops."""
from __future__ import annotations
import shutil, tempfile, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class SpaceBatchTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="sb-"))
        self.sup = SupervisorV1(backend=MockPTYBackend())
        super().setUp()
    def tearDown(self):
        super().tearDown(); shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.tmp / "state",
                          supervisor=self.sup,
                          templates_dir=self.tmp / "tpl")
    async def run_terminal(self, name, machine="local"):
        r = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"],
            "machine": machine})
        self.assertEqual(r.status, 200)

    @unittest_run_loop
    async def test_send_and_freeze(self):
        await self.run_terminal("b1")
        await self.run_terminal("b2")
        # send в space local (machine-derived)
        r = await self.client.post("/api/core/space/local/batch",
                                   json={"op": "send",
                                         "text": "hello-all"})
        d = await r.json()
        self.assertTrue(d["ok"])
        self.assertEqual(d["count"], 2)
        for n in ("b1", "b2"):
            t = self.sup.get_terminal(f"local/{n}")
            self.assertIn("hello-all",
                          [e["text"] for e in t.input_log])
        # freeze всех в space
        r = await self.client.post("/api/core/space/local/batch",
                                   json={"op": "freeze"})
        d = await r.json()
        self.assertTrue(all(x["frozen"] for x in d["results"]))
        self.assertTrue(all(self.sup.get_terminal(f"local/{n}").frozen
                            for n in ("b1", "b2")))
        # resume
        await self.client.post("/api/core/space/local/batch",
                               json={"op": "resume"})
        self.assertFalse(
            self.sup.get_terminal("local/b1").frozen)

    @unittest_run_loop
    async def test_custom_space_membership(self):
        await self.run_terminal("m1")
        await self.run_terminal("m2")
        # space ops должен существовать (W48)
        r = await self.client.post("/api/core/space",
                                   json={"name": "ops"})
        self.assertIn(r.status, (200, 201))
        # m1 → space ops (W48 migrate)
        r = await self.client.post(
            "/api/core/terminal/m1/migrate",
            json={"space": "ops"})
        self.assertEqual(r.status, 200)
        # batch send в ops → только m1
        r = await self.client.post("/api/core/space/ops/batch",
                                   json={"op": "send",
                                         "text": "ops-only"})
        d = await r.json()
        self.assertEqual(d["count"], 1)
        t1 = self.sup.get_terminal("local/m1")
        t2 = self.sup.get_terminal("local/m2")
        self.assertIn("ops-only",
                      [e["text"] for e in t1.input_log])
        self.assertNotIn("ops-only",
                         [e["text"] for e in t2.input_log])
        # batch в local → только m2 (m1 в ops)
        r = await self.client.post("/api/core/space/local/batch",
                                   json={"op": "send",
                                         "text": "local-only"})
        d = await r.json()
        self.assertEqual(d["count"], 1)
        self.assertIn("local-only",
                      [e["text"] for e in t2.input_log])

    @unittest_run_loop
    async def test_validation(self):
        await self.run_terminal("v1")
        # bad op
        self.assertEqual((await self.client.post(
            "/api/core/space/local/batch",
            json={"op": "explode"})).status, 400)
        # send без text
        self.assertEqual((await self.client.post(
            "/api/core/space/local/batch",
            json={"op": "send"})).status, 400)
        # пустой/несуществующий space → 404
        self.assertEqual((await self.client.post(
            "/api/core/space/nowhere/batch",
            json={"op": "freeze"})).status, 404)


if __name__ == "__main__":
    unittest.main()
