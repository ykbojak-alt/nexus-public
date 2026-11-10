#!/usr/bin/env python3
"""test_import_terminal.py — W23 POST /terminal/import."""
from __future__ import annotations
import shutil, tempfile, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class ImportTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="imp-"))
        self.state_dir = self.tmp / "state"
        self.sup = SupervisorV1(backend=MockPTYBackend())
        super().setUp()
    def tearDown(self):
        super().tearDown(); shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.state_dir, supervisor=self.sup,
                          templates_dir=self.tmp / "templates")
    async def run_terminal(self, name="i1"):
        r = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"],
            "cwd": "D:/Temp", "labels": {"role": "src"},
            "env": {"PLAIN": "v1", "DB_TOKEN": "sekret"}})
        self.assertEqual(r.status, 200)
    async def export(self, name="i1"):
        return await (await self.client.get(
            f"/api/core/terminal/{name}/export")).json()
    async def imp(self, payload, **extra):
        body = dict(payload); body.update(extra)
        return await self.client.post("/api/core/terminal/import",
                                      json=body)

    @unittest_run_loop
    async def test_roundtrip_export_import(self):
        await self.run_terminal()
        t = self.sup.get_terminal("local/i1")
        t.scrollback.extend(["hist-1", "hist-2"])
        payload = await self.export()
        # импорт под новым именем
        r = await self.imp(payload, name="i1-copy")
        self.assertEqual(r.status, 200)
        d = await r.json()
        self.assertEqual(d["name"], "i1-copy")
        self.assertTrue(d["imported"])
        self.assertEqual(d["scrollback_lines"], 2)
        self.assertTrue(d["env_dropped_masked"])
        t2 = self.sup.get_terminal("local/i1-copy")
        self.assertEqual(t2.command, ["sh", "-i"])
        self.assertEqual(t2.cwd, "D:/Temp")
        self.assertEqual(t2.labels, {"role": "src"})
        # env: PLAIN доехал, DB_PASSWORD (masked ***) отброшен
        self.assertEqual(t2.env.get("PLAIN"), "v1")
        self.assertNotEqual(t2.env.get("DB_TOKEN"), "sekret")
        self.assertNotIn("DB_TOKEN", t2.env)
        # scrollback восстановлен
        self.assertIn("hist-1", t2.scrollback)
        self.assertIn("hist-2", t2.recent_output)
        # parent не переносится — клон-семантика
        self.assertIsNone(t2.parent)

    @unittest_run_loop
    async def test_spec_name_and_dup_409(self):
        await self.run_terminal()
        payload = await self.export()
        # без name → spec.name = "i1" → dup → 409
        r = await self.imp(payload)
        self.assertEqual(r.status, 409)
        # spec.name переименовываем → ок
        payload["spec"]["name"] = "i1-renamed"
        r2 = await self.imp(payload)
        self.assertEqual(r2.status, 200)
        self.assertEqual((await r2.json())["name"], "i1-renamed")

    @unittest_run_loop
    async def test_validation(self):
        # нет spec/scrollback
        self.assertEqual((await self.client.post(
            "/api/core/terminal/import", json={})).status, 400)
        self.assertEqual((await self.client.post(
            "/api/core/terminal/import",
            json={"spec": {}, "scrollback": "notlist"})).status, 400)
        # нет имени нигде
        self.assertEqual((await self.client.post(
            "/api/core/terminal/import",
            json={"spec": {"command": ["sh"]}, "scrollback": []})
        ).status, 400)
        # bad name
        self.assertEqual((await self.client.post(
            "/api/core/terminal/import",
            json={"name": "BAD!", "spec": {"command": ["sh"]},
                  "scrollback": []})).status, 400)
        # remote machine
        self.assertEqual((await self.client.post(
            "/api/core/terminal/import",
            json={"name": "ok1", "spec": {"machine": "remote-x",
                  "command": ["sh"]}, "scrollback": []})).status, 400)


    @unittest_run_loop
    async def test_schema_validation_details(self):
        """W43: schema-check — details[] на битых полях."""
        base = {"name": "ok1", "spec": {"command": ["sh"]},
                "scrollback": []}
        cases = [
            ({**base, "spec": "notdict"}, "spec must be an object"),
            ({**base, "scrollback": "notlist"},
             "scrollback must be a list"),
            ({**base, "scrollback": ["ok", 5]},
             "scrollback[1] must be a string"),
            ({**base, "spec": {"command": "sh"}},
             "spec.command must be list[str]"),
            ({**base, "spec": {"cols": 0}},
             "spec.cols must be int 1..500"),
            ({**base, "spec": {"cols": True}},
             "spec.cols must be int 1..500"),
            ({**base, "spec": {"labels": {"a": 1}}},
             "spec.labels must be object of string pairs"),
            ({**base, "spec": {"keep": "yes"}},
             "spec.keep must be bool"),
            ({**base, "spec": {"env": {"X": {"nested": 1}}}},
             "spec.env['X'] must be scalar"),
            # int-ключи невозможны по JSON — сервер видит строки
        ]
        for payload, frag in cases:
            r = await self.client.post(
                "/api/core/terminal/import", json=payload)
            self.assertEqual(r.status, 400, msg=frag)
            d = await r.json()
            self.assertIn("details", d)
            self.assertTrue(any(frag in x for x in d["details"]),
                            msg=f"{frag} in {d['details']}")
        # валидный край: cols=500, env bool/num — проходит схему
        r = await self.client.post("/api/core/terminal/import", json={
            "name": "edge1",
            "spec": {"command": ["sh"], "cols": 500, "rows": 1,
                     "env": {"N": 1, "B": True, "S": "x"},
                     "labels": {"a": "b"}, "keep": True},
            "scrollback": ["l1"]})
        self.assertEqual(r.status, 200, await r.text())


if __name__ == "__main__":
    unittest.main()
