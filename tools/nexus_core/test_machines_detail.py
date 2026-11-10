#!/usr/bin/env python3
"""
tools/nexus_core/test_machines_detail.py — W3 machines detail.

GET /api/core/machines?detail=1 → [{name, terminals, uptime_s, state,
host, transport, since_ms, why, labels}] + local.metrics
{cpu_pct, mem_*, uptime_s}. Дефолтный merge-шейп (#482) не тронут.

Запуск: pytest tools/nexus_core/test_machines_detail.py
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


class MachinesDetailTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="machines-detail-"))
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

    async def run_terminal(self, name="t1"):
        resp = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"]})
        self.assertEqual(resp.status, 200)
        return await resp.json()

    # -- дефолтный шейп не тронут -----------------------------------------

    @unittest_run_loop
    async def test_default_shape_unchanged(self):
        await self.run_terminal("t1")
        resp = await self.client.get("/api/core/machines")
        data = await resp.json()
        self.assertIsInstance(data["machines"], dict)
        self.assertIn("local", data["machines"])
        entry = data["machines"]["local"]
        self.assertEqual(
            set(entry),
            {"terminals", "state", "host", "transport", "since_ms", "why"})

    # -- detail shape ------------------------------------------------------

    @unittest_run_loop
    async def test_detail_shape_and_local_metrics(self):
        await self.run_terminal("t1")
        resp = await self.client.get("/api/core/machines?detail=1")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertIsInstance(data["machines"], list)
        self.assertEqual(data["count"], len(data["machines"]))
        local = next(m for m in data["machines"] if m["name"] == "local")
        for key in ("name", "terminals", "uptime_s", "state",
                    "host", "transport", "since_ms", "why", "labels"):
            self.assertIn(key, local)
        self.assertEqual(local["terminals"], 1)
        self.assertEqual(local["state"], "connected")
        self.assertIsInstance(local["uptime_s"], (int, float))
        self.assertGreaterEqual(local["uptime_s"], 0)
        metrics = local["metrics"]
        for key in ("cpu_pct", "mem_used", "mem_total",
                    "mem_used_pct", "uptime_s"):
            self.assertIn(key, metrics)
        self.assertGreater(metrics["mem_total"], 0)
        self.assertGreaterEqual(metrics["uptime_s"], 0)

    @unittest_run_loop
    async def test_detail_terminals_counts_live_only(self):
        await self.run_terminal("t1")
        await self.run_terminal("t2")
        resp = await self.client.get("/api/core/machines?detail=1")
        local = next(m for m in (await resp.json())["machines"]
                     if m["name"] == "local")
        self.assertEqual(local["terminals"], 2)
        # гасим t2 → exited не считается
        term = self.sup.get_terminal("local/t2")
        term.handle.close()
        self.sup.step_once()
        resp = await self.client.get("/api/core/machines?detail=1")
        local = next(m for m in (await resp.json())["machines"]
                     if m["name"] == "local")
        self.assertEqual(local["terminals"], 1)

    @unittest_run_loop
    async def test_detail_registry_machine_without_terminals(self):
        # ssh-машина — только реестр (прямой add, как в n8-тестах:
        # PUT шёл бы через machine_mutation gate)
        state = self.client.app["state"]
        state.machines.add("vps", host="user@host", transport="ssh")
        resp = await self.client.get("/api/core/machines?detail=1")
        data = await resp.json()
        vps = next(m for m in data["machines"] if m["name"] == "vps")
        self.assertEqual(vps["terminals"], 0)
        self.assertEqual(vps["host"], "user@host")
        self.assertEqual(vps["transport"], "ssh")
        self.assertNotIn("metrics", vps)  # метрики только у local
        # default-вызов по-прежнему dict
        resp = await self.client.get("/api/core/machines")
        data = await resp.json()
        self.assertIn("vps", data["machines"])

    @unittest_run_loop
    async def test_detail_true_alias(self):
        resp = await self.client.get("/api/core/machines?detail=true")
        data = await resp.json()
        self.assertIsInstance(data["machines"], list)


if __name__ == "__main__":
    unittest.main()
