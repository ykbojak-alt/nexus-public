#!/usr/bin/env python3
"""
tools/nexus_core/test_terminal_rename.py — #550 terminal rename.

Unit: SupervisorV1.rename_terminal — key-rename (name→address),
сохранение spec/labels/meta, parent-links детей, registry-persist.
API: POST /api/core/terminal/<name>/rename — 200/400/404 маппинг.

Запуск: pytest tools/nexus_core/test_terminal_rename.py
"""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class TestRenameUnit(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="rn-unit-"))
        self.backend = MockPTYBackend()
        self.sup = SupervisorV1(
            backend=self.backend,
            registry_path=self.tmp / "registry.json",
        )

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _mk(self, name="old", **kw):
        return self.sup.create_terminal(name=name, **kw)

    def test_rename_basic_key_changes(self):
        t = self._mk("old", labels={"role": "agent"})
        old_addr = t.address
        self.sup.rename_terminal(old_addr, "new")
        self.assertNotIn("local/old", self.sup.terminals)
        self.assertIn("local/new", self.sup.terminals)
        term = self.sup.terminals["local/new"]
        self.assertEqual(term.name, "new")
        self.assertEqual(term.address, "local/new")
        self.assertEqual(term.labels, {"role": "agent"})

    def test_rename_preserves_meta(self):
        t = self._mk("old", cwd=str(self.tmp), keep=True)
        created = t.created_at
        t.respawn_count = 3
        self.sup.rename_terminal("old", "new")
        term = self.sup.terminals["local/new"]
        self.assertEqual(term.created_at, created)
        self.assertEqual(term.respawn_count, 3)
        self.assertEqual(term.cwd, str(self.tmp))
        self.assertTrue(term.keep)

    def test_rename_updates_children_parent(self):
        parent = self._mk("parent")
        child = self._mk("child", parent=parent.address)
        self.assertEqual(child.parent, "local/parent")
        self.sup.rename_terminal("local/parent", "renamed-p")
        self.assertEqual(
            self.sup.terminals["local/child"].parent, "local/renamed-p")

    def test_rename_dup_and_invalid_and_unknown(self):
        self._mk("aaa")
        self._mk("bbb")
        with self.assertRaises(ValueError):
            self.sup.rename_terminal("local/aaa", "bbb")
        for bad in ("", "A B", "../x", "a/b", "a" * 33, "dot.name"):
            with self.assertRaises(ValueError, msg=bad):
                self.sup.rename_terminal("local/aaa", bad)
        with self.assertRaises(KeyError):
            self.sup.rename_terminal("local/ghost", "zzz")

    def test_rename_same_name_noop(self):
        self._mk("same")
        term = self.sup.rename_terminal("local/same", "same")
        self.assertEqual(term.address, "local/same")
        self.assertIn("local/same", self.sup.terminals)

    def test_rename_persists_registry(self):
        self._mk("old", labels={"k": "v"})
        self.sup.rename_terminal("local/old", "new")
        # «рестарт»: новый supervisor на том же registry_path
        sup2 = SupervisorV1(
            backend=MockPTYBackend(),
            registry_path=self.tmp / "registry.json",
        )
        self.assertIn("local/new", sup2.terminals)
        self.assertNotIn("local/old", sup2.terminals)
        self.assertEqual(
            sup2.terminals["local/new"].labels, {"k": "v"})

    def test_rename_emits_event(self):
        self._mk("old")
        self.sup.rename_terminal("local/old", "new")
        types = [e["type"] for e in self.sup.events]
        self.assertIn("renamed", types)
        ev = [e for e in self.sup.events if e["type"] == "renamed"][0]
        self.assertEqual(ev["old"], "local/old")
        self.assertEqual(ev["new"], "local/new")


class RenameApiTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="rn-api-"))
        self.backend = MockPTYBackend()
        self.sup = SupervisorV1(
            backend=self.backend,
            registry_path=self.tmp / "registry.json",
        )
        super().setUp()

    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.tmp / "state",
                          supervisor=self.sup,
                          templates_dir=self.tmp / "templates")

    async def _post(self, url, payload):
        resp = await self.client.post(url, json=payload)
        body = await resp.text()
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            data = None
        return resp.status, data, body

    @unittest_run_loop
    async def test_api_rename_short_and_full(self):
        self.sup.create_terminal(name="alpha")
        # короткое имя
        s, d, _ = await self._post(
            "/api/core/terminal/alpha/rename", {"new_name": "beta"})
        self.assertEqual(s, 200, d)
        self.assertEqual(d["name"], "beta")
        self.assertEqual(d["address"], "local/beta")
        # полный адрес тоже принимается
        s, d, _ = await self._post(
            "/api/core/terminal/local/beta/rename", {"new_name": "gamma"})
        self.assertEqual(s, 200, d)
        self.assertEqual(d["address"], "local/gamma")

    @unittest_run_loop
    async def test_api_404_unknown(self):
        s, d, _ = await self._post(
            "/api/core/terminal/ghost/rename", {"new_name": "x"})
        self.assertEqual(s, 404)

    @unittest_run_loop
    async def test_api_400_invalid_and_dup(self):
        self.sup.create_terminal(name="one")
        self.sup.create_terminal(name="two")
        for bad in ("", "Bad Name", "../x"):
            s, d, _ = await self._post(
                "/api/core/terminal/one/rename", {"new_name": bad})
            self.assertEqual(s, 400, (bad, d))
        s, d, _ = await self._post(
            "/api/core/terminal/one/rename", {"new_name": "two"})
        self.assertEqual(s, 400)
        self.assertIn("already exists", d["error"])

    @unittest_run_loop
    async def test_api_rename_via_terminals_list(self):
        """После rename старый адрес исчезает из /terminals."""
        self.sup.create_terminal(name="old")
        await self._post(
            "/api/core/terminal/old/rename", {"new_name": "fresh"})
        resp = await self.client.get("/api/core/terminals")
        data = await resp.json()
        terms = data["terminals"] if isinstance(data, dict) else data
        addrs = {t["address"] for t in terms}
        self.assertIn("local/fresh", addrs)
        self.assertNotIn("local/old", addrs)


if __name__ == "__main__":
    unittest.main()
