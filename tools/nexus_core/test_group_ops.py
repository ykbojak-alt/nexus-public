#!/usr/bin/env python3
"""
tools/nexus_core/test_group_ops.py — W8 POST /api/core/group.

match.label (все пары k→v) | match.names/top-level names (unknown →
per-term ошибка); action kill/respawn/rename-prefix; per-term
results, дедуп по адресу, gate один на операцию.

Запуск: pytest tools/nexus_core/test_group_ops.py
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


class GroupOpsApiTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="group-"))
        self.state_dir = self.tmp / "state"
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

    async def run_terminal(self, name, labels=None, **kwargs):
        body = {"name": name, "command": ["sh", "-i"]}
        if labels:
            body["labels"] = labels
        body.update(kwargs)
        resp = await self.client.post("/api/core/run", json=body)
        self.assertEqual(resp.status, 200)
        return await resp.json()

    async def group(self, **body):
        return await self.client.post("/api/core/group", json=body)

    def state_of(self, name):
        t = self.sup.get_terminal(f"local/{name}")
        return t.state if t else None

    # -- kill ---------------------------------------------------------------

    @unittest_run_loop
    async def test_kill_by_label_only_matches(self):
        await self.run_terminal("g1", labels={"wt": "x"})
        await self.run_terminal("g2", labels={"wt": "x", "role": "r"})
        await self.run_terminal("g3", labels={"wt": "x"})
        await self.run_terminal("other", labels={"wt": "y"})
        resp = await self.group(
            match={"label": {"wt": "x"}}, action="kill")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["action"], "kill")
        self.assertEqual(data["matched"], 3)
        for n in ("g1", "g2", "g3"):
            self.assertTrue(data["results"][f"local/{n}"]["ok"], n)
        self.assertNotIn("local/other", data["results"])
        self.sup.step_once()
        for n in ("g1", "g2", "g3"):
            self.assertEqual(self.state_of(n), "exited", n)
        self.assertNotEqual(self.state_of("other"), "exited")

    @unittest_run_loop
    async def test_kill_by_names_with_unknown(self):
        await self.run_terminal("n1")
        await self.run_terminal("n2")
        resp = await self.group(
            match={"names": ["n1", "local/n2", "ghost"]},
            action="kill")
        data = await resp.json()
        self.assertEqual(resp.status, 200)
        self.assertEqual(data["matched"], 3)
        self.assertTrue(data["results"]["local/n1"]["ok"])
        self.assertTrue(data["results"]["local/n2"]["ok"])
        self.assertFalse(data["results"]["ghost"]["ok"])
        self.assertEqual(data["results"]["ghost"]["error"],
                         "terminal not found")

    @unittest_run_loop
    async def test_top_level_names_accepted(self):
        await self.run_terminal("tn1")
        resp = await self.group(names=["tn1"], action="kill")
        data = await resp.json()
        self.assertEqual(resp.status, 200)
        self.assertTrue(data["results"]["local/tn1"]["ok"])

    # -- respawn -------------------------------------------------------------

    @unittest_run_loop
    async def test_respawn_exited_terminal(self):
        await self.run_terminal("dead", labels={"grp": "r"})
        t = self.sup.get_terminal("local/dead")
        t.handle.close()
        self.sup.step_once()
        self.assertEqual(t.state, "exited")
        resp = await self.group(
            match={"label": {"grp": "r"}}, action="respawn")
        data = await resp.json()
        self.assertEqual(resp.status, 200)
        self.assertTrue(data["results"]["local/dead"]["ok"])
        self.assertEqual(self.state_of("dead"), "idle")
        self.assertEqual(t.respawn_count, 1)

    @unittest_run_loop
    async def test_respawn_running_is_per_term_error(self):
        await self.run_terminal("alive", labels={"grp": "r"})
        await self.run_terminal("dead2", labels={"grp": "r"})
        d = self.sup.get_terminal("local/dead2")
        d.handle.close()
        self.sup.step_once()
        resp = await self.group(
            match={"label": {"grp": "r"}}, action="respawn")
        data = await resp.json()
        self.assertFalse(data["results"]["local/alive"]["ok"])
        self.assertIn("still running",
                      data["results"]["local/alive"]["error"])
        self.assertTrue(data["results"]["local/dead2"]["ok"])

    # -- rename-prefix ---------------------------------------------------------

    @unittest_run_loop
    async def test_rename_prefix(self):
        await self.run_terminal("ra", labels={"batch": "1"})
        await self.run_terminal("rb", labels={"batch": "1"})
        await self.run_terminal("keep", labels={"batch": "0"})
        resp = await self.group(
            match={"label": {"batch": "1"}},
            action="rename-prefix", prefix="done")
        data = await resp.json()
        self.assertEqual(resp.status, 200)
        self.assertEqual(data["results"]["local/ra"]["new"],
                         "local/done-ra")
        self.assertEqual(data["results"]["local/rb"]["new"],
                         "local/done-rb")
        self.assertIsNone(self.sup.get_terminal("local/ra"))
        self.assertIsNotNone(self.sup.get_terminal("local/done-ra"))
        self.assertIsNotNone(self.sup.get_terminal("local/keep"))

    @unittest_run_loop
    async def test_rename_prefix_collision_per_term(self):
        await self.run_terminal("x1", labels={"b": "1"})
        await self.run_terminal("p-x1")  # целевое имя занято
        resp = await self.group(
            match={"label": {"b": "1"}},
            action="rename-prefix", prefix="p")
        data = await resp.json()
        self.assertFalse(data["results"]["local/x1"]["ok"])
        self.assertIn("already exists",
                      data["results"]["local/x1"]["error"])

    @unittest_run_loop
    async def test_rename_prefix_requires_valid_prefix(self):
        await self.run_terminal("rp1", labels={"b": "1"})
        for bad in ({}, {"prefix": ""}, {"prefix": "Bad Name!"},
                    {"prefix": 5}):
            body = {"match": {"label": {"b": "1"}},
                    "action": "rename-prefix"}
            body.update(bad)
            resp = await self.group(**body)
            self.assertEqual(resp.status, 400, msg=str(bad))

    # -- валидация -------------------------------------------------------------

    @unittest_run_loop
    async def test_bad_action_400(self):
        resp = await self.group(match={"names": ["x"]}, action="nuke")
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_no_match_400(self):
        resp = await self.group(action="kill")
        self.assertEqual(resp.status, 400)
        resp = await self.group(match={}, action="kill")
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_bad_match_type_400(self):
        for bad in ({"match": "x", "action": "kill"},
                    {"match": {"label": "x"}, "action": "kill"},
                    {"match": {"names": "x"}, "action": "kill"},
                    {"match": {"names": [1]}, "action": "kill"}):
            resp = await self.client.post("/api/core/group", json=bad)
            self.assertEqual(resp.status, 400, msg=str(bad))

    @unittest_run_loop
    async def test_empty_match_returns_zero(self):
        await self.run_terminal("e1", labels={"wt": "x"})
        resp = await self.group(
            match={"label": {"wt": "no-such"}}, action="kill")
        data = await resp.json()
        self.assertEqual(resp.status, 200)
        self.assertEqual(data["matched"], 0)
        self.assertEqual(data["results"], {})

    @unittest_run_loop
    async def test_label_and_names_dedupe(self):
        await self.run_terminal("d1", labels={"g": "1"})
        resp = await self.group(
            match={"label": {"g": "1"}, "names": ["d1", "d1"]},
            action="kill")
        data = await resp.json()
        self.assertEqual(data["matched"], 1)
        self.assertEqual(list(data["results"].keys()), ["local/d1"])


if __name__ == "__main__":
    unittest.main()
