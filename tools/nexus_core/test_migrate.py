#!/usr/bin/env python3
"""test_migrate.py — W48 POST /terminal/<n>/migrate."""
from __future__ import annotations
import json, shutil, tempfile, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class MigrateTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="mig-"))
        self.state_dir = self.tmp / "state"
        self.state_dir.mkdir(parents=True)
        self.sup = SupervisorV1(backend=MockPTYBackend(),
                                registry_path=self.state_dir
                                / "registry.json")
        super().setUp()
    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.state_dir, supervisor=self.sup,
                          templates_dir=self.tmp / "templates")
    async def run_terminal(self, name="m1"):
        r = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"]})
        self.assertEqual(r.status, 200)
    async def migrate(self, name="m1", **kw):
        return await self.client.post(
            f"/api/core/terminal/{name}/migrate", json=kw)
    async def make_space(self, name="ops"):
        r = await self.client.post("/api/core/space",
                                   json={"name": name})
        self.assertEqual(r.status, 201)

    @unittest_run_loop
    async def test_migrate_to_custom_space(self):
        await self.run_terminal()
        await self.make_space("ops")
        r = await self.migrate(space="ops")
        self.assertEqual(r.status, 200)
        d = await r.json()
        self.assertEqual(d["space"], "ops")
        self.assertEqual(d["effective_space"], "ops")
        # терминал реально перенесён: /spaces считает по space
        spaces = await (await self.client.get(
            "/api/core/spaces")).json()
        ops = next(s for s in spaces["spaces"] if s["id"] == "ops")
        self.assertEqual(ops["terminals"], 1)
        # space_migrated событие
        self.assertTrue(any(e["type"] == "space_migrated"
                            for e in self.sup.events))
        # registry persist: space в записи
        reg = json.loads(
            (self.state_dir / "registry.json").read_text(
                encoding="utf-8"))
        # unsigned → list; signed → {"v":1,"rows":[...]}
        rows = reg.get("rows") if isinstance(reg, dict) else reg
        row = next(r for r in rows
                   if r.get("address") == "local/m1"
                   or r.get("name") == "m1")
        self.assertEqual(row.get("space"), "ops")

    @unittest_run_loop
    async def test_migrate_back_and_idempotent(self):
        await self.run_terminal()
        await self.make_space("ops")
        await self.migrate(space="ops")
        # обратно в machine-space через null
        r = await self.migrate(space=None)
        self.assertEqual(r.status, 200)
        d = await r.json()
        self.assertIsNone(d["space"])
        self.assertEqual(d["effective_space"], "local")
        # повторный migrate в тот же space — ок (идемпотентно)
        r = await self.migrate(space="ops")
        self.assertEqual(r.status, 200)
        # migrate в machine-space по имени тоже ок
        r = await self.migrate(space="local")
        self.assertEqual(r.status, 200)
        self.assertEqual((await r.json())["effective_space"],
                         "local")

    @unittest_run_loop
    async def test_migrate_validation(self):
        await self.run_terminal()
        # unknown term → 404
        self.assertEqual((await self.migrate(
            name="ghost", space="ops")).status, 404)
        # unknown space → 404
        self.assertEqual((await self.migrate(
            space="no-such-space")).status, 404)
        # bad type → 400
        self.assertEqual((await self.migrate(space=5)).status, 400)
        # missing key → 400
        self.assertEqual((await self.client.post(
            "/api/core/terminal/m1/migrate",
            json={})).status, 400)


if __name__ == "__main__":
    unittest.main()
