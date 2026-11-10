#!/usr/bin/env python3
"""test_share_tokens.py — W63 read-only view tokens."""
from __future__ import annotations
import shutil, tempfile, time, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class ShareTokenTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="sh-"))
        self.sup = SupervisorV1(backend=MockPTYBackend())
        super().setUp()
    def tearDown(self):
        super().tearDown(); shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.tmp / "state",
                          supervisor=self.sup,
                          templates_dir=self.tmp / "tpl")
    async def run_terminal(self, name="v1"):
        r = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"]})
        self.assertEqual(r.status, 200)
    async def make_share(self, **kw):
        body = {"term": "v1"}
        body.update(kw)
        r = await self.client.post("/api/core/share", json=body)
        return r.status, await r.json()

    @unittest_run_loop
    async def test_share_and_view(self):
        await self.run_terminal()
        s, d = await self.make_share()
        self.assertEqual(s, 201)
        token = d["token"]
        self.assertTrue(token)
        # публичный view без core-token
        r = await self.client.get(f"/view/{token}/info")
        self.assertEqual(r.status, 200)
        d = await r.json()
        self.assertEqual(d["term"], "local/v1")
        # screen scope
        r = await self.client.get(f"/view/{token}/screen")
        self.assertEqual(r.status, 200)
        d = await r.json()
        self.assertIn("screen", d)
        # dump → text/plain
        r = await self.client.get(f"/view/{token}/dump")
        self.assertEqual(r.status, 200)
        self.assertIn("text/plain", r.content_type)
        # hits считаются
        d = await (await self.client.get(
            "/api/core/shares")).json()
        self.assertEqual(d["shares"][0]["hits"], 3)

    @unittest_run_loop
    async def test_scope_and_expiry(self):
        await self.run_terminal()
        s, d = await self.make_share(scopes=["info"], ttl_s=60)
        token = d["token"]
        self.assertEqual((await self.client.get(
            f"/view/{token}/info")).status, 200)
        # screen не в scopes → 403
        self.assertEqual((await self.client.get(
            f"/view/{token}/screen")).status, 403)
        # bad token → 404
        self.assertEqual((await self.client.get(
            "/view/nope/info")).status, 404)
        # expire вручную
        rec = self.sup.share_tokens[token]
        rec["expires"] = time.time() - 1
        self.assertEqual((await self.client.get(
            f"/view/{token}/info")).status, 404)

    @unittest_run_loop
    async def test_validation_and_revoke(self):
        await self.run_terminal()
        # bad scopes
        r = await self.client.post("/api/core/share", json={
            "term": "v1", "scopes": ["admin"]})
        self.assertEqual(r.status, 400)
        r = await self.client.post("/api/core/share", json={
            "term": "v1", "scopes": []})
        self.assertEqual(r.status, 400)
        # unknown term → 404
        r = await self.client.post("/api/core/share",
                                   json={"term": "ghost"})
        self.assertEqual(r.status, 404)
        # create + revoke
        s, d = await self.make_share()
        token = d["token"]
        r = await self.client.delete(f"/api/core/share/{token}")
        self.assertEqual(r.status, 200)
        self.assertEqual((await self.client.get(
            f"/view/{token}/info")).status, 404)
        # revoke unknown → 404
        self.assertEqual((await self.client.delete(
            "/api/core/share/nope")).status, 404)


if __name__ == "__main__":
    unittest.main()
