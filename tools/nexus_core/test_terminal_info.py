#!/usr/bin/env python3
"""
tools/nexus_core/test_terminal_info.py — W6 terminal info endpoint.

GET /api/core/terminal/<name>/info → to_dict + env с маскировкой
секретов (*_KEY|*_TOKEN|*_SECRET → "***"). Тесты: поля спеки,
маскировка (API_KEY/AUTH_TOKEN/DB_SECRET/bare KEY), false-positive
(MONKEY/plain), 404.

Запуск: pytest tools/nexus_core/test_terminal_info.py
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


class TerminalInfoTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="term-info-"))
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

    async def info(self, term="t1"):
        return await self.client.get(f"/api/core/terminal/{term}/info")

    # -- поля ---------------------------------------------------------------

    @unittest_run_loop
    async def test_info_full_spec_fields(self):
        await self.run_terminal(
            "t1", cwd=str(self.tmp), labels={"role": "x"},
            keep=False, cols=111, rows=44)
        resp = await self.info("t1")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["address"], "local/t1")
        self.assertEqual(data["command"], ["sh", "-i"])
        term = self.sup.get_terminal("local/t1")
        self.assertEqual(data["cwd"], term.cwd)
        self.assertEqual(data["labels"], {"role": "x"})
        self.assertFalse(data["keep"])
        self.assertEqual(data["cols"], 111)
        self.assertEqual(data["rows"], 44)
        self.assertEqual(data["state"], "idle")
        self.assertEqual(data["respawn_count"], 0)
        self.assertIsInstance(data["created_at"], (int, float))
        self.assertIn("env", data)
        self.assertIsInstance(data["env"], dict)

    # -- маскировка ---------------------------------------------------------

    @unittest_run_loop
    async def test_env_secrets_masked(self):
        await self.run_terminal("t1", env={
            "API_KEY": "s3cr3t-value",
            "AUTH_TOKEN": "tok-123",
            "DB_SECRET": "dbpass",
            "plain_var": "visible",
            "MONKEY": "not-a-secret-name",
            "TOKENIZE": "also-fine",
        })
        resp = await self.info("t1")
        self.assertEqual(resp.status, 200)
        env = (await resp.json())["env"]
        self.assertEqual(env["API_KEY"], "***")
        self.assertEqual(env["AUTH_TOKEN"], "***")
        self.assertEqual(env["DB_SECRET"], "***")
        self.assertEqual(env["plain_var"], "visible")
        # false positives НЕ маскируются
        self.assertEqual(env["MONKEY"], "not-a-secret-name")
        self.assertEqual(env["TOKENIZE"], "also-fine")
        # NX_TERMINAL_ID — внутренний, не секрет → виден
        self.assertEqual(env.get("NX_TERMINAL_ID"), "local/t1")

    @unittest_run_loop
    async def test_env_case_insensitive_and_bare_names(self):
        await self.run_terminal("t1", env={
            "my_key": "lower",       # lowercase суффикс
            "SessionToken": "camel",  # camelCase содержит Token не в конце _TOKEN?
            "CLIENT_SECRET": "up",
        })
        resp = await self.info("t1")
        env = (await resp.json())["env"]
        self.assertEqual(env["my_key"], "***")
        self.assertEqual(env["CLIENT_SECRET"], "***")
        # "SessionToken" — не *_TOKEN (нет подчёркивания перед Token) → виден
        self.assertEqual(env["SessionToken"], "camel")

    @unittest_run_loop
    async def test_no_env_gives_empty_dict(self):
        await self.run_terminal("t1")
        resp = await self.info("t1")
        env = (await resp.json())["env"]
        # NX_TERMINAL_ID всегда инжектится → dict не пуст
        self.assertIn("NX_TERMINAL_ID", env)

    # -- ошибки ---------------------------------------------------------------

    @unittest_run_loop
    async def test_unknown_terminal_404(self):
        resp = await self.info("ghost")
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_full_address_works(self):
        await self.run_terminal("t1")
        resp = await self.client.get("/api/core/terminal/local/t1/info")
        self.assertEqual(resp.status, 200)
        self.assertEqual((await resp.json())["address"], "local/t1")


if __name__ == "__main__":
    unittest.main()
