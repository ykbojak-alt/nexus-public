#!/usr/bin/env python3
"""test_space_labels.py — W66 space→terminal labels inheritance."""
from __future__ import annotations
import shutil, tempfile, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class SpaceLabelsTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="sl-"))
        self.sup = SupervisorV1(backend=MockPTYBackend())
        super().setUp()
    def tearDown(self):
        super().tearDown(); shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.tmp / "state",
                          supervisor=self.sup,
                          templates_dir=self.tmp / "tpl")
    async def run_terminal(self, name, labels=None):
        body = {"name": name, "command": ["sh", "-i"]}
        if labels:
            body["labels"] = labels
        r = await self.client.post("/api/core/run", json=body)
        self.assertEqual(r.status, 200)

    @unittest_run_loop
    async def test_inherit_on_migrate(self):
        await self.run_terminal("i1")
        await self.run_terminal("i2", labels={"env": "prod"})
        # space с labels
        r = await self.client.post("/api/core/space", json={
            "name": "ops", "labels": {"team": "ops", "env": "dev"}})
        self.assertEqual(r.status, 201)
        # migrate i1 → наследует team+env
        r = await self.client.post("/api/core/terminal/i1/migrate",
                                   json={"space": "ops"})
        d = await r.json()
        self.assertEqual(d["labels_inherited"], 2)
        t1 = self.sup.get_terminal("local/i1")
        self.assertEqual(t1.labels["team"], "ops")
        self.assertEqual(t1.labels["env"], "dev")
        # migrate i2 → env НЕ перезаписан (term wins), team добавлен
        r = await self.client.post("/api/core/terminal/i2/migrate",
                                   json={"space": "ops"})
        d = await r.json()
        self.assertEqual(d["labels_inherited"], 1)
        t2 = self.sup.get_terminal("local/i2")
        self.assertEqual(t2.labels["env"], "prod")
        self.assertEqual(t2.labels["team"], "ops")
        # spaces list несёт labels
        d = await (await self.client.get("/api/core/spaces")).json()
        ops = next(s for s in d["spaces"] if s["id"] == "ops")
        self.assertEqual(ops["labels"]["team"], "ops")

    @unittest_run_loop
    async def test_space_labels_update_propagates(self):
        await self.run_terminal("p1")
        await self.client.post("/api/core/space",
                               json={"name": "sec"})
        await self.client.post("/api/core/terminal/p1/migrate",
                               json={"space": "sec"})
        # PUT labels → член получает отсутствующие
        r = await self.client.put("/api/core/space/sec/labels",
                                  json={"labels": {"zone": "dmz",
                                                   "crit": "1"}})
        d = await r.json()
        self.assertEqual(d["propagated"], 2)
        t = self.sup.get_terminal("local/p1")
        self.assertEqual(t.labels["zone"], "dmz")
        # явный лейбл термина не затирается повторным PUT
        t.labels["zone"] = "custom"
        await self.client.put("/api/core/space/sec/labels",
                              json={"labels": {"zone": "other"}})
        self.assertEqual(t.labels["zone"], "custom")
        # clear labels
        r = await self.client.put("/api/core/space/sec/labels",
                                  json={"labels": {}})
        d = await r.json()
        self.assertEqual(d["labels"], {})
        # unknown space → 404
        self.assertEqual((await self.client.put(
            "/api/core/space/ghost/labels",
            json={"labels": {"a": "b"}})).status, 404)


if __name__ == "__main__":
    unittest.main()
