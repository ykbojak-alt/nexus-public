#!/usr/bin/env python3
"""test_backup.py — W38 registry backup endpoint."""
from __future__ import annotations
import io, json, shutil, tarfile, tempfile, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class BackupTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="bak-"))
        self.state_dir = self.tmp / "state"
        self.state_dir.mkdir(parents=True)
        self.sup = SupervisorV1(backend=MockPTYBackend())
        super().setUp()
    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.state_dir, supervisor=self.sup,
                          templates_dir=self.tmp / "templates")

    @unittest_run_loop
    async def test_backup_cycle(self):
        # state-файлы
        (self.state_dir / "registry.json").write_text(
            json.dumps([{"name": "x"}]), encoding="utf-8")
        (self.state_dir / "spaces.json").write_text(
            json.dumps({"spaces": []}), encoding="utf-8")
        # files/ и snapshots/ НЕ должны попасть
        (self.state_dir / "files").mkdir()
        (self.state_dir / "files" / "big.bin").write_bytes(b"x" * 100)
        r = await self.client.post("/api/core/backup")
        self.assertEqual(r.status, 200, await r.text())
        d = await r.json()
        self.assertIn("backups/backup-", d["path"])
        self.assertIn("registry.json", d["files"])
        self.assertIn("spaces.json", d["files"])
        self.assertNotIn("big.bin", d["files"])
        # файл реально лежит
        out = self.state_dir / d["path"]
        self.assertTrue(out.is_file())
        # tar валиден и содержит registry.json
        with tarfile.open(out, "r:gz") as tf:
            names = tf.getnames()
        self.assertIn("registry.json", names)
        self.assertIn("spaces.json", names)
        self.assertFalse(any("files/" in n for n in names))
        # list
        d = await (await self.client.get("/api/core/backups")).json()
        self.assertEqual(d["count"], 1)
        self.assertEqual(d["backups"][0]["name"], out.name)
        # download
        r = await self.client.get(f"/api/core/backups/{out.name}")
        self.assertEqual(r.status, 200)
        self.assertEqual(r.content_type, "application/gzip")
        # bad name → 400, unknown → 404
        r = await self.client.get("/api/core/backups/evil.txt")
        self.assertEqual(r.status, 400)
        r = await self.client.get("/api/core/backups/backup-1.tar.gz")
        self.assertEqual(r.status, 404)

    @unittest_run_loop
    async def test_minimal_state_still_works(self):
        # «пустой» state-dir: app init мог уже положить *.json
        # (doc-store и пр.) — backup берёт что есть, не падает.
        r = await self.client.post("/api/core/backup")
        self.assertIn(r.status, (200, 404))
        if r.status == 200:
            d = await r.json()
            self.assertTrue(d["files"])


if __name__ == "__main__":
    unittest.main()
