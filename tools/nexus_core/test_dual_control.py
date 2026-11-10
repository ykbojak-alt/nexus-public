#!/usr/bin/env python3
"""test_dual_control.py — W6 AEGIS dual-control для mutation approvals."""
from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


def _tmp() -> Path:
    return Path(tempfile.mkdtemp(prefix="nexus-dual-"))


class DualControlCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = _tmp()
        self.backend = MockPTYBackend()
        self.supervisor = SupervisorV1(backend=self.backend)
        super().setUp()

    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.tmp, supervisor=self.supervisor,
                          templates_dir=self.tmp / "templates")

    # -- helpers ---------------------------------------------------------

    def _policy(self, rules):
        (self.tmp / "gate-policy.json").write_text(
            json.dumps(rules), encoding="utf-8")

    def _admin_env(self):
        return patch.dict(os.environ, {
            "AEGIS_ADMIN_KEYS": json.dumps({
                "key-alice": {"name": "alice", "roles": ["operator"]},
                "key-bob": {"name": "bob", "roles": ["operator"]},
            }),
            "NEXUS_CORE_TOKEN": "",
            "NEXUS_CORE_READ_TOKEN": "",
        })

    @staticmethod
    def _h(key):
        return {"X-AEGIS-Key": key}

    async def _run_approval_flow(self, action_rule, run_name="dual-run"):
        """run → 202 → approval_id. Возвращает (resp_json, approval_id)."""
        resp = await self.client.post("/api/core/run", json={
            "name": run_name, "command": ["sh", "-i"]})
        self.assertEqual(resp.status, 202)
        body = await resp.json()
        return body, body["approval_id"]

    # -- tests -----------------------------------------------------------

    @unittest_run_loop
    async def test_policy_dual_flag_requires_two_approvers(self):
        self._policy([{"match": {"action": "run"},
                       "decision": "require_approval",
                       "dual_control": True}])
        with self._admin_env():
            body, aid = await self._run_approval_flow(None)
            self.assertTrue(body["dual_control"])
            self.assertEqual(body["required_approvals"], 2)
            self.assertEqual(self.supervisor.list_terminals(), [])

            # первый голос — pending, терминал НЕ создан
            r1 = await self.client.post(
                f"/api/core/approvals/{aid}",
                json={"approved": True}, headers=self._h("key-alice"))
            self.assertEqual(r1.status, 202)
            d1 = await r1.json()
            self.assertEqual(d1["status"], "pending")
            self.assertEqual(d1["decided_by"], ["alice"])
            self.assertEqual(d1["remaining"], 1)
            self.assertEqual(self.supervisor.list_terminals(), [])

            # тот же principal повторно → 409
            r2 = await self.client.post(
                f"/api/core/approvals/{aid}",
                json={"approved": True}, headers=self._h("key-alice"))
            self.assertEqual(r2.status, 409)
            d2 = await r2.json()
            self.assertIn("already decided", d2["error"])
            self.assertEqual(d2["decided_by"], ["alice"])

            # второй distinct approver → execute
            r3 = await self.client.post(
                f"/api/core/approvals/{aid}",
                json={"approved": True}, headers=self._h("key-bob"))
            self.assertEqual(r3.status, 200)
            d3 = await r3.json()
            self.assertEqual(d3["status"], "executed")
            names = [t.address for t in self.supervisor.list_terminals()]
            self.assertIn("local/dual-run", names)

    @unittest_run_loop
    async def test_dangerous_action_auto_dual_without_flag(self):
        """kill при require_approval без dual_control — всё равно dual."""
        # терминал для kill
        resp = await self.client.post("/api/core/run", json={
            "name": "victim", "command": ["sh", "-i"]})
        self.assertEqual(resp.status, 200)
        self._policy([{"match": {"action": "kill"},
                       "decision": "require_approval"}])
        with self._admin_env():
            r = await self.client.post("/api/core/kill",
                                       json={"term": "local/victim"})
            self.assertEqual(r.status, 202)
            body = await r.json()
            self.assertTrue(body["dual_control"])
            aid = body["approval_id"]
            # первый голос — kill НЕ выполнен
            await self.client.post(
                f"/api/core/approvals/{aid}",
                json={"approved": True}, headers=self._h("key-alice"))
            states = {t.address: t.state
                      for t in self.supervisor.list_terminals()}
            self.assertNotEqual(states.get("local/victim"), "exited")
            # bob добивает
            r3 = await self.client.post(
                f"/api/core/approvals/{aid}",
                json={"approved": True}, headers=self._h("key-bob"))
            self.assertEqual(r3.status, 200)
            d3 = await r3.json()
            self.assertEqual(d3["status"], "executed")

    @unittest_run_loop
    async def test_dual_decision_dict_forms(self):
        """decision {"dual":true} и {"dual_control":true} — dual."""
        for i, dec in enumerate(({"dual": True},
                                  {"dual_control": True})):
            name = f"dict-{i}"
            self._policy([{"match": {"action": "run", "subject": name},
                           "decision": dec}])
            with self._admin_env():
                resp = await self.client.post("/api/core/run", json={
                    "name": name, "command": ["sh", "-i"]})
                self.assertEqual(resp.status, 202)
                body = await resp.json()
                self.assertTrue(body["dual_control"], dec)
                # cleanup approval
                await self.client.post(
                    f"/api/core/approvals/{body['approval_id']}",
                    json={"approved": False},
                    headers=self._h("key-alice"))

    @unittest_run_loop
    async def test_deny_resolves_immediately(self):
        self._policy([{"match": {"action": "run"},
                       "decision": "require_approval",
                       "dual_control": True}])
        with self._admin_env():
            body, aid = await self._run_approval_flow(None)
            r = await self.client.post(
                f"/api/core/approvals/{aid}",
                json={"approved": False}, headers=self._h("key-alice"))
            self.assertEqual(r.status, 200)
            self.assertEqual((await r.json())["status"], "denied")
            self.assertEqual(self.supervisor.list_terminals(), [])
            # resolved → повторное решение 409
            r2 = await self.client.post(
                f"/api/core/approvals/{aid}",
                json={"approved": True}, headers=self._h("key-bob"))
            self.assertEqual(r2.status, 409)

    @unittest_run_loop
    async def test_approvals_list_exposes_dual_fields(self):
        self._policy([{"match": {"action": "run"},
                       "decision": "require_approval",
                       "dual_control": True}])
        with self._admin_env():
            body, aid = await self._run_approval_flow(None)
            await self.client.post(
                f"/api/core/approvals/{aid}",
                json={"approved": True}, headers=self._h("key-alice"))
            r = await self.client.get("/api/core/approvals")
            listing = await r.json()
            mut = next(m for m in listing["mutations"]
                       if m["approval_id"] == aid)
            self.assertTrue(mut["dual_control"])
            self.assertEqual(mut["decided_by"], ["alice"])
            self.assertEqual(mut["required_approvals"], 2)
            await self.client.post(
                f"/api/core/approvals/{aid}",
                json={"approved": False}, headers=self._h("key-bob"))

    @unittest_run_loop
    async def test_malformed_policy_dual_flag_denies(self):
        """dual_control:true + decision allow → policy invalid → deny."""
        self._policy([{"match": {"action": "run"},
                       "decision": "allow", "dual_control": True}])
        resp = await self.client.post("/api/core/run", json={
            "name": "badpol", "command": ["sh", "-i"]})
        # невалидная политика → gate deny (fail-closed), не 202/200
        self.assertEqual(resp.status, 403)
        self.assertEqual(self.supervisor.list_terminals(), [])

    @unittest_run_loop
    async def test_space_delete_gated_and_dual(self):
        """space-delete теперь за gate; require_approval → dual."""
        self._policy([{"match": {"action": "space-delete"},
                       "decision": "require_approval"}])
        # space должен существовать, иначе replay handler → 404
        cr = await self.client.post("/api/core/space",
                                    json={"name": "ops"})
        self.assertIn(cr.status, (200, 201))
        with self._admin_env():
            r = await self.client.delete("/api/core/space/ops")
            self.assertEqual(r.status, 202)
            body = await r.json()
            self.assertTrue(body["dual_control"])  # auto-опасный action
            aid = body["approval_id"]
            r1 = await self.client.post(
                f"/api/core/approvals/{aid}",
                json={"approved": True}, headers=self._h("key-alice"))
            self.assertEqual(r1.status, 202)
            r2 = await self.client.post(
                f"/api/core/approvals/{aid}",
                json={"approved": True}, headers=self._h("key-bob"))
            self.assertEqual(r2.status, 200)


if __name__ == "__main__":
    unittest.main()
