#!/usr/bin/env python3
"""
tools/nexus_core/test_clone.py — W4 clone terminal endpoint.

POST /api/core/terminal/<name>/clone {name?} → новый терминал с
той же спекой (command/cwd/env/labels/keep/machine/cols/rows);
parent НЕ копируется. Авто-имя <src>-<N>, uniq; explicit name;
dup → 409; invalid → 400; unknown → 404.

Запуск: pytest tools/nexus_core/test_clone.py
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


class CloneApiTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="clone-"))
        self.state_dir = self.tmp / "state"
        self.cwd_dir = self.tmp / "workdir"
        self.cwd_dir.mkdir(parents=True, exist_ok=True)
        self.backend = MockPTYBackend()
        self.sup = SupervisorV1(backend=self.backend)
        super().setUp()

    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.state_dir,
                          supervisor=self.sup,
                          templates_dir=self.tmp / "templates")

    async def run_terminal(self, name="t1", **kwargs):
        resp = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"], **kwargs})
        self.assertEqual(resp.status, 200)
        return await resp.json()

    async def clone(self, term="t1", **body):
        return await self.client.post(
            f"/api/core/terminal/{term}/clone", json=body)

    # -- spec-равенство ----------------------------------------------------

    @unittest_run_loop
    async def test_clone_copies_spec(self):
        await self.run_terminal(
            "t1", cwd=str(self.cwd_dir), keep=False,
            labels={"role": "coder", "wt": "x"},
            env={"MY_FLAG": "1"}, cols=100, rows=40)
        resp = await self.clone("t1")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        src = self.sup.get_terminal("local/t1")
        clone = self.sup.get_terminal(data["address"])
        self.assertIsNotNone(clone)
        # spec-поля равны
        self.assertEqual(clone.command, src.command)
        self.assertEqual(clone.cwd, src.cwd)
        self.assertEqual(clone.labels, src.labels)
        self.assertEqual(clone.keep, src.keep)
        self.assertEqual(clone.machine, src.machine)
        self.assertEqual(clone.cols, src.cols)
        self.assertEqual(clone.rows, src.rows)
        # env: клон несёт MY_FLAG (и внутренние NEXUS_* — ок)
        self.assertEqual((clone.env or {}).get("MY_FLAG"), "1")
        # parent НЕ скопирован — siblings
        self.assertIsNone(clone.parent)
        self.assertNotEqual(clone.address, src.address)

    @unittest_run_loop
    async def test_clone_auto_name_unique(self):
        await self.run_terminal("t1")
        r1 = await self.clone("t1")
        r2 = await self.clone("t1")
        self.assertEqual(r1.status, 200)
        self.assertEqual(r2.status, 200)
        n1 = (await r1.json())["name"]
        n2 = (await r2.json())["name"]
        self.assertNotEqual(n1, n2)
        self.assertTrue(n1.startswith("t1-"))
        self.assertTrue(n2.startswith("t1-"))

    @unittest_run_loop
    async def test_clone_explicit_name(self):
        await self.run_terminal("t1")
        resp = await self.clone("t1", name="t1-copy")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["address"], "local/t1-copy")
        self.assertEqual(data["command"], ["sh", "-i"])

    @unittest_run_loop
    async def test_clone_dup_name_409(self):
        await self.run_terminal("t1")
        await self.run_terminal("t2")
        resp = await self.clone("t1", name="t2")
        self.assertEqual(resp.status, 409)
        # и имя источника — тоже dup
        resp = await self.clone("t1", name="t1")
        self.assertEqual(resp.status, 409)

    @unittest_run_loop
    async def test_clone_bad_name_400(self):
        await self.run_terminal("t1")
        for bad in ("Bad Name", "a/b", "x" * 40):
            resp = await self.clone("t1", name=bad)
            self.assertEqual(resp.status, 400, msg=bad)
        resp = await self.clone("t1", name=123)
        self.assertEqual(resp.status, 400)
        # "" — falsy → auto-name (конвенция spawn-child), не 400
        resp = await self.clone("t1", name="")
        self.assertEqual(resp.status, 200)
        self.assertTrue((await resp.json())["name"].startswith("t1-"))

    @unittest_run_loop
    async def test_clone_unknown_404(self):
        resp = await self.clone("ghost")
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_clone_exited_source_ok(self):
        # клон exited-терминала — легален: копируется spec, не состояние
        await self.run_terminal("t1")
        term = self.sup.get_terminal("local/t1")
        term.handle.close()
        self.sup.step_once()
        self.assertEqual(term.state, "exited")
        resp = await self.clone("t1")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["state"], "idle")
        self.assertIsNone(data["parent"])

    @unittest_run_loop
    async def test_clone_scrollback_option(self):
        """W52: scrollback:true → копия буфера в клон."""
        await self.run_terminal("t1")
        src = self.sup.get_terminal("local/t1")
        src.scrollback.extend(["alpha", "beta", "gamma"])
        # без опции — пустой scrollback
        resp = await self.clone("t1", name="c-nosb")
        self.assertEqual(resp.status, 200)
        c = self.sup.get_terminal("local/c-nosb")
        self.assertEqual(len(list(c.scrollback)), 0)
        # с опцией — копия
        resp = await self.clone("t1", name="c-sb",
                                scrollback=True)
        self.assertEqual(resp.status, 200)
        c = self.sup.get_terminal("local/c-sb")
        self.assertEqual(list(c.scrollback),
                         ["alpha", "beta", "gamma"])
        self.assertIn("gamma", c.recent_output)
        # scrollback не копирует markers источника
        src.markers.append({"ts": 1.0, "label": "m"})
        resp = await self.clone("t1", name="c-m",
                                scrollback=True)
        self.assertEqual(resp.status, 200)
        self.assertEqual(
            self.sup.get_terminal("local/c-m").markers, [])
        # fallback: пустой scrollback → recent_output источника
        src.scrollback.clear()
        src.recent_output = "ro-line-1\nro-line-2"
        resp = await self.clone("t1", name="c-ro",
                                scrollback=True)
        self.assertEqual(resp.status, 200)
        c = self.sup.get_terminal("local/c-ro")
        self.assertIn("ro-line-1", list(c.scrollback))


if __name__ == "__main__":
    unittest.main()
