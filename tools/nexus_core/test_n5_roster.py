#!/usr/bin/env python3
"""
tools/nexus_core/test_n5_roster.py — тесты волны #316 (ГАП-8/ГАП-9).

ГАП-8 (M): roster §25.1 — 8 полей на агента + /v1/roster.json.
ГАП-9 (S): валидация --name терминала (1-32 [a-z0-9-_]) в
    supervisor.create_terminal И api.handle_run → 400.

Режим: CORE_MOCK=1 (mock-PTY).

Запуск: pytest tools/nexus_core/test_n5_roster.py
        python -m tools.nexus_core.test_n5_roster
"""

from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1

ROSTER_FIELDS = {"agent_id", "role", "status", "machine", "term", "cwd", "labels", "turn"}

VALID_NAMES = ["a", "t1", "zro-dev", "hello_world", "x" * 32, "0-9_", "dash-name-ok"]
INVALID_NAMES = ["A B", "x!", "", "x" * 33, "UPPER", "has space", "tab\tname"]


def make_temp_base() -> Path:
    return Path(tempfile.mkdtemp(prefix="nexus-core-roster-test-"))


class RosterApiTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = make_temp_base()
        self.backend = MockPTYBackend()
        self.supervisor = SupervisorV1(backend=self.backend)
        super().setUp()

    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.tmp, supervisor=self.supervisor,
                          templates_dir=self.tmp / "templates")

    async def post_run(self, name, **kw):
        return await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"], **kw,
        })


class TestRosterContract(RosterApiTestCase):
    @unittest_run_loop
    async def test_roster_empty(self):
        resp = await self.client.get("/v1/roster.json")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["count"], 0)
        self.assertEqual(data["roster"], [])

    @unittest_run_loop
    async def test_roster_eight_fields(self):
        resp = await self.post_run("t1", labels={"role": "coder"})
        self.assertEqual(resp.status, 200)
        resp = await self.client.get("/v1/roster.json")
        data = await resp.json()
        self.assertEqual(data["count"], 1)
        entry = data["roster"][0]
        self.assertEqual(set(entry.keys()), ROSTER_FIELDS)
        self.assertEqual(entry["agent_id"], "t1")
        self.assertEqual(entry["role"], "coder")
        self.assertEqual(entry["machine"], "local")
        self.assertEqual(entry["term"], "t1")
        self.assertIn("status", entry)
        self.assertIsInstance(entry["turn"], int)

    @unittest_run_loop
    async def test_roster_distinct_from_agents(self):
        await self.post_run("t1", labels={"persona": "forge"})
        agents = await (await self.client.get("/api/core/agents")).json()
        roster = await (await self.client.get("/v1/roster.json")).json()
        # /api/core/agents сохраняет старое имя полей (address/name/state/...)
        self.assertIn("address", agents["agents"][0])
        self.assertNotIn("address", roster["roster"][0])
        # roster — только 8-полевой контракт
        self.assertEqual(set(roster["roster"][0].keys()), ROSTER_FIELDS)


class TestNameValidation(RosterApiTestCase):
    @unittest_run_loop
    async def test_valid_names_accepted(self):
        for name in VALID_NAMES:
            resp = await self.post_run(name)
            self.assertEqual(resp.status, 200, f"expected 200 for {name!r}")

    @unittest_run_loop
    async def test_invalid_names_400(self):
        for name in INVALID_NAMES:
            resp = await self.post_run(name)
            self.assertEqual(resp.status, 400, f"expected 400 for {name!r}")
            body = await resp.json()
            self.assertIn("error", body)

    @unittest_run_loop
    async def test_missing_name_400(self):
        resp = await self.client.post("/api/core/run", json={"command": ["sh"]})
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_supervisor_rejects_invalid_name(self):
        with self.assertRaises(ValueError):
            self.supervisor.create_terminal("A B")
        with self.assertRaises(ValueError):
            self.supervisor.create_terminal("x" * 33)
        with self.assertRaises(ValueError):
            self.supervisor.create_terminal("")


class TestScreenRouteRosterCompat(RosterApiTestCase):
    @unittest_run_loop
    async def test_screen_route_valid_name(self):
        await self.post_run("smoke-live")
        resp = await self.client.get("/api/core/screen/smoke-live")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertIn("screen", data)


if __name__ == "__main__":
    unittest.main()
