#!/usr/bin/env python3
"""test_registry_versioning.py — W67 registry.json schema v+migrations."""
from __future__ import annotations
import json, shutil, tempfile, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import (
    REGISTRY_SCHEMA_VERSION, SupervisorV1)


def _sup_with_registry(tmp: Path) -> SupervisorV1:
    sup = SupervisorV1(backend=MockPTYBackend())
    sup._registry_path = tmp / "state" / "registry.json"
    (tmp / "state").mkdir(parents=True, exist_ok=True)
    return sup


class RegistryVersioningTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="rv-"))
    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_save_writes_v2_dict(self):
        sup = _sup_with_registry(self.tmp)
        sup.create_terminal("v1", command=["sh"], machine="local")
        sup._save_registry()
        data = json.loads(
            (self.tmp / "state" / "registry.json").read_text())
        self.assertIsInstance(data, dict)
        self.assertEqual(data["v"], REGISTRY_SCHEMA_VERSION)
        self.assertIn("rows", data)
        self.assertNotIn("sig", data)  # без ключа — unsigned

    def test_load_v0_list_migrates(self):
        # legacy bare-list → принимается + registry_migrated event
        reg = self.tmp / "state" / "registry.json"
        reg.parent.mkdir(parents=True, exist_ok=True)
        reg.write_text(json.dumps([{
            "name": "old", "machine": "local",
            "command": ["sh"], "state": "exited",
            "labels": {"a": "1", 5: "x"},   # не-str ключ отфильтруется
            "space": 123,                     # не-str → None
        }]), encoding="utf-8")
        sup = _sup_with_registry(self.tmp)
        q = sup._load_registry()
        t = sup.get_terminal("local/old")
        self.assertIsNotNone(t)
        self.assertEqual(t.space, None)
        self.assertNotIn(5, t.labels)
        self.assertTrue(any(e["type"] == "registry_migrated"
                            for e in sup.events))

    def test_load_v1_dict_migrates(self):
        reg = self.tmp / "state" / "registry.json"
        reg.parent.mkdir(parents=True, exist_ok=True)
        reg.write_text(json.dumps({
            "v": 1, "rows": [{
                "name": "m1", "machine": "local",
                "command": ["sh"], "state": "exited",
                "frozen": "yes",   # → True
            }]}), encoding="utf-8")
        sup = _sup_with_registry(self.tmp)
        sup._load_registry()
        t = sup.get_terminal("local/m1")
        self.assertIsNotNone(t)
        self.assertTrue(t.frozen)

    def test_newer_schema_refused(self):
        reg = self.tmp / "state" / "registry.json"
        reg.parent.mkdir(parents=True, exist_ok=True)
        reg.write_text(json.dumps({
            "v": REGISTRY_SCHEMA_VERSION + 1,
            "rows": [{"name": "x", "command": ["sh"]}]}),
            encoding="utf-8")
        sup = _sup_with_registry(self.tmp)
        sup._load_registry()
        self.assertIsNone(sup.get_terminal("local/x"))
        self.assertTrue(any(
            e["type"] == "registry_untrusted"
            and "schema" in e.get("reason", "")
            for e in sup.events))

    def test_server_reports_schema(self):
        pass  # покрыто API-тестом ниже


class RegistrySchemaApiTest(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="rva-"))
        self.sup = SupervisorV1(backend=MockPTYBackend())
        super().setUp()
    def tearDown(self):
        super().tearDown(); shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.tmp / "state",
                          supervisor=self.sup,
                          templates_dir=self.tmp / "tpl")

    @unittest_run_loop
    async def test_server_schema_field(self):
        d = await (await self.client.get(
            "/api/core/server")).json()
        self.assertEqual(d["registry_schema"],
                         REGISTRY_SCHEMA_VERSION)


if __name__ == "__main__":
    unittest.main()
