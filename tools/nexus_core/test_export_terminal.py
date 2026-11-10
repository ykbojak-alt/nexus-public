#!/usr/bin/env python3
"""test_export_terminal.py — W22 GET /terminal/<n>/export."""
from __future__ import annotations
import shutil, tempfile, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class ExportTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="exp-"))
        self.state_dir = self.tmp / "state"
        self.sup = SupervisorV1(backend=MockPTYBackend())
        super().setUp()
    def tearDown(self):
        super().tearDown(); shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.state_dir, supervisor=self.sup,
                          templates_dir=self.tmp / "templates")
    async def run_terminal(self, name="e1"):
        r = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"],
            "cwd": "D:/Temp", "labels": {"k": "v"},
            "env": {"PLAIN": "yes", "MY_API_KEY": "sekret"}})
        self.assertEqual(r.status, 200)

    @unittest_run_loop
    async def test_export_shape_and_masking(self):
        await self.run_terminal()
        t = self.sup.get_terminal("local/e1")
        t.scrollback.extend(["line-A", "line-B"])
        r = await self.client.get("/api/core/terminal/e1/export")
        self.assertEqual(r.status, 200)
        d = await r.json()
        self.assertEqual(d["v"], 1)
        self.assertIn("exported_at", d)
        spec = d["spec"]
        self.assertEqual(spec["name"], "e1")
        self.assertEqual(spec["command"], ["sh", "-i"])
        self.assertEqual(spec["cwd"], "D:/Temp")
        self.assertEqual(spec["labels"], {"k": "v"})
        self.assertIn("cols", spec)
        # env маскирован: PLAIN цел, MY_API_KEY → ***
        self.assertEqual(spec["env"]["PLAIN"], "yes")
        self.assertEqual(spec["env"]["MY_API_KEY"], "***")
        self.assertTrue(d["env_masked"])
        self.assertEqual(d["scrollback"], ["line-A", "line-B"])
        self.assertEqual(d["scrollback_lines"], 2)
        self.assertIn("recent_output", d)

    @unittest_run_loop
    async def test_fallback_and_404(self):
        await self.run_terminal("e2")
        t = self.sup.get_terminal("local/e2")
        t.scrollback.clear()
        t.recent_output = "only-recent\nline2"
        d = await (await self.client.get(
            "/api/core/terminal/e2/export")).json()
        self.assertEqual(d["scrollback"],
                         ["only-recent", "line2"])
        self.assertEqual((await self.client.get(
            "/api/core/terminal/ghost/export")).status, 404)


    @unittest_run_loop
    async def test_bundle_targz(self):
        """W42: format=bundle → tar.gz spec+scrollback+meta."""
        import io, tarfile, json as _j
        await self.run_terminal("b1")
        t = self.sup.get_terminal("local/b1")
        t.scrollback.extend(["alpha", "beta"])
        r = await self.client.get(
            "/api/core/terminal/b1/export?format=bundle")
        self.assertEqual(r.status, 200)
        self.assertEqual(r.content_type, "application/gzip")
        self.assertIn("b1-export.tar.gz",
                      r.headers.get("Content-Disposition", ""))
        with tarfile.open(fileobj=io.BytesIO(await r.read()),
                          mode="r:gz") as tf:
            names = sorted(tf.getnames())
            self.assertEqual(names,
                             ["meta.json", "scrollback.txt",
                              "spec.json"])
            spec = _j.loads(tf.extractfile("spec.json").read())
            self.assertEqual(spec["spec"]["name"], "b1")
            sb = tf.extractfile("scrollback.txt").read().decode()
            self.assertIn("alpha", sb)
            self.assertIn("beta", sb)
            meta = _j.loads(tf.extractfile("meta.json").read())
            self.assertEqual(meta["term"], "local/b1")
            self.assertEqual(meta["scrollback_lines"], 2)
        # json-формат по умолчанию не тронут
        r2 = await self.client.get("/api/core/terminal/b1/export")
        d2 = await r2.json()
        self.assertIn("spec", d2)


if __name__ == "__main__":
    unittest.main()
