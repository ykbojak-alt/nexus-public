#!/usr/bin/env python3
"""
tools/nexus_core/test_spawn_child.py — #566 spawn-child endpoint.

API (AioHTTPTestCase + MockPTYBackend): поля дочернего терминала
(parent/die_with_parent/cwd-наследование/auto-name), uniq-имена,
dup-409, unknown-parent-404, dead-parent-409, die_with_parent
связка: kill родителя → step_once → дочка exited; die=false →
дочка выживает (parent_lost).

Запуск: pytest tools/nexus_core/test_spawn_child.py
"""

from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class SpawnChildApiTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="spawn-child-"))
        self.backend = MockPTYBackend()
        self.sup = SupervisorV1(backend=self.backend)
        super().setUp()

    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.tmp / "state",
                          supervisor=self.sup,
                          templates_dir=self.tmp / "templates")

    async def run_terminal(self, name="t1", **kwargs):
        resp = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"], **kwargs})
        self.assertEqual(resp.status, 200)
        return await resp.json()

    async def spawn_child(self, parent="t1", **body):
        payload = {"command": ["child-cmd"], **body}
        return await self.client.post(
            f"/api/core/terminal/{parent}/spawn-child", json=payload)

    # -- базовые поля ----------------------------------------------------

    @unittest_run_loop
    async def test_spawn_child_fields_and_auto_name(self):
        await self.run_terminal("t1")
        resp = await self.spawn_child("t1")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["name"], "t1-1")
        self.assertEqual(data["address"], "local/t1-1")
        self.assertEqual(data["parent"], "local/t1")
        self.assertTrue(data["die_with_parent"])
        self.assertEqual(data["command"], ["child-cmd"])
        # второй ребёнок — следующий номер
        resp = await self.spawn_child("t1")
        data = await resp.json()
        self.assertEqual(data["name"], "t1-2")

    @unittest_run_loop
    async def test_spawn_child_explicit_name_and_dup_409(self):
        await self.run_terminal("t1")
        resp = await self.spawn_child("t1", name="kid")
        self.assertEqual(resp.status, 200)
        self.assertEqual((await resp.json())["name"], "kid")
        resp = await self.spawn_child("t1", name="kid")
        self.assertEqual(resp.status, 409)
        resp = await self.spawn_child("t1", name="BAD NAME")
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_spawn_child_cwd_inherits_parent(self):
        cwd_dir = self.tmp / "work"; cwd_dir.mkdir()
        other = self.tmp / "other"; other.mkdir()
        await self.run_terminal("t1", cwd=str(cwd_dir))
        # без cwd — наследует родительский
        resp = await self.spawn_child("t1")
        data = await resp.json()
        self.assertEqual(data["cwd"], str(cwd_dir))
        # с cwd — явный перекрывает
        resp = await self.spawn_child("t1", name="kid2", cwd=str(other))
        data = await resp.json()
        self.assertEqual(data["cwd"], str(other))

    @unittest_run_loop
    async def test_spawn_child_unknown_and_dead_parent(self):
        resp = await self.spawn_child("ghost")
        self.assertEqual(resp.status, 404)
        await self.run_terminal("t1")
        parent = self.sup.get_terminal("local/t1")
        parent.handle.close()
        self.sup.step_once()  # → state=exited, handle=None
        self.assertEqual(parent.state, "exited")
        resp = await self.spawn_child("t1")
        self.assertEqual(resp.status, 409)

    @unittest_run_loop
    async def test_spawn_child_bad_command_400(self):
        await self.run_terminal("t1")
        for bad in ({}, {"command": []}, {"command": "x"},
                    {"command": ["ok", 5]},
                    {"command": ["ok"], "die_with_parent": "yes"}):
            resp = await self.client.post(
                "/api/core/terminal/t1/spawn-child", json=bad)
            self.assertEqual(resp.status, 400, msg=str(bad))

    # -- die_with_parent связка ------------------------------------------

    @unittest_run_loop
    async def test_parent_kill_reaps_dying_child(self):
        await self.run_terminal("t1")
        resp = await self.spawn_child("t1")  # die_with_parent=true
        self.assertEqual(resp.status, 200)
        child = self.sup.get_terminal("local/t1-1")
        self.assertTrue(child.die_with_parent)
        # родитель умирает → step_once → reaper
        self.sup.get_terminal("local/t1").handle.kill()
        self.sup.step_once()
        self.assertEqual(child.state, "exited")
        self.assertTrue(child.parent_reaped)

    @unittest_run_loop
    async def test_die_false_child_survives_parent(self):
        await self.run_terminal("t1")
        resp = await self.spawn_child("t1", name="survivor",
                                      die_with_parent=False)
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertFalse(data["die_with_parent"])
        child = self.sup.get_terminal("local/survivor")
        self.sup.get_terminal("local/t1").handle.kill()
        self.sup.step_once()
        self.assertNotEqual(child.state, "exited")
        self.assertTrue(child.parent_reaped)
        self.assertTrue(child.handle.alive())


if __name__ == "__main__":
    unittest.main()
