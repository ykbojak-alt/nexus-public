#!/usr/bin/env python3
"""test_state_migrate.py — W68 state-dir migration tool."""
from __future__ import annotations
import json, shutil, tempfile, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.state_migrate import migrate_state
from tools.nexus_core.supervisor_v1 import (
    REGISTRY_SCHEMA_VERSION, SupervisorV1)


class StateMigrateUnitTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="sm-"))
        self.src = self.tmp / "old-state"
        self.src.mkdir()
    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _old_registry(self, payload):
        (self.src / "registry.json").write_text(
            json.dumps(payload), encoding="utf-8")

    def test_v0_list_to_v2(self):
        self._old_registry([{"name": "a", "machine": "local",
                             "command": ["sh"], "state": "exited"}])
        (self.src / "spaces.json").write_text('{"spaces": []}')
        (self.src / "scripts").mkdir()
        (self.src / "scripts" / "s.json").write_text('{"name":"s"}')
        report = migrate_state(self.src, self.tmp / "new-state")
        self.assertTrue(report["ok"])
        dst = self.tmp / "new-state"
        reg = json.loads((dst / "registry.json").read_text())
        self.assertEqual(reg["v"], REGISTRY_SCHEMA_VERSION)
        self.assertEqual(len(reg["rows"]), 1)
        self.assertTrue((dst / "spaces.json").exists())
        self.assertTrue((dst / "scripts" / "s.json").exists())
        self.assertFalse((dst / "files").exists())  # copy_files off

    def test_v3_refused(self):
        self._old_registry({"v": 99, "rows": []})
        report = migrate_state(self.src, self.tmp / "n2")
        self.assertFalse(report["ok"])
        self.assertFalse((self.tmp / "n2" / "registry.json").exists())

    def test_corrupt_registry_skipped(self):
        (self.src / "registry.json").write_text("{broken")
        report = migrate_state(self.src, self.tmp / "n3")
        self.assertTrue(report["ok"])  # skipped ≠ refused
        self.assertFalse((self.tmp / "n3" / "registry.json").exists())

    def test_copy_files_flag(self):
        self._old_registry([])
        (self.src / "files").mkdir()
        (self.src / "files" / "x.bin").write_bytes(b"1")
        migrate_state(self.src, self.tmp / "n4", copy_files=True)
        self.assertTrue((self.tmp / "n4" / "files" / "x.bin").exists())


class StateMigrateApiTest(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="sma-"))
        self.sup = SupervisorV1(backend=MockPTYBackend())
        super().setUp()
    def tearDown(self):
        super().tearDown(); shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.tmp / "state",
                          supervisor=self.sup,
                          templates_dir=self.tmp / "tpl")

    @unittest_run_loop
    async def test_api_migrate(self):
        src = self.tmp / "legacy"
        src.mkdir()
        (src / "registry.json").write_text(json.dumps(
            [{"name": "old", "machine": "local",
              "command": ["sh"], "state": "exited"}]))
        r = await self.client.post("/api/core/state/migrate",
                                   json={"src": str(src)})
        self.assertEqual(r.status, 200)
        d = await r.json()
        self.assertTrue(d["ok"])
        self.assertTrue((src.parent / "legacy-migrated"
                         / "registry.json").exists())
        # src missing → 404; src required → 400
        self.assertEqual((await self.client.post(
            "/api/core/state/migrate",
            json={"src": str(self.tmp / "nope")})).status, 404)
        self.assertEqual((await self.client.post(
            "/api/core/state/migrate", json={})).status, 400)


if __name__ == "__main__":
    unittest.main()
