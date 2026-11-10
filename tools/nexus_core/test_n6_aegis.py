#!/usr/bin/env python3
"""test_n6_aegis.py — контракт aegis (N6/CERBERUS-фича)."""

import os
import shutil
import tempfile
import unittest
from pathlib import Path

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from tools.nexus_core.aegis import (
    COND_ALLOWLIST,
    COND_COMPOUND,
    OperationProposal,
    PolicyCondition,
    AegisGuard,
    PolicyRule,
    Policy,
)
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


def prop(op, agent, payload=None, sensitive=True):
    return OperationProposal(op, agent, payload or {}, sensitive=sensitive)


class DefaultPolicyTest(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.gate = AegisGuard(event_sink=self.events.append)

    def test_unlisted_sensitive_op_denied_by_default(self):
        """Нет совпавшего правила + sensitive → DENY (не PERMIT как у них)."""
        d = self.gate.evaluate(prop("wipe", "agent-x", {"target": "/"}))
        self.assertEqual(d.outcome, "deny")
        self.assertIn("default", d.reason)

    def test_observe_class_always_permitted(self):
        d = self.gate.evaluate(prop("tail", "anyone", {}, sensitive=False))
        self.assertEqual(d.outcome, "permit")

    def test_payout_over_hard_limit_denied(self):
        d = self.gate.evaluate(prop("payout", "treasury", {"amount": 60000}))
        self.assertEqual(d.outcome, "deny")

    def test_payout_mid_range_escalates(self):
        d = self.gate.evaluate(prop("payout", "treasury", {"amount": 30000}))
        self.assertEqual(d.outcome, "escalate")
        self.assertIsNotNone(d.approval_id)
        self.assertEqual(len(self.gate.pending_approvals()), 1)

    def test_payout_unauthorized_agent_denied(self):
        """AGENT_PERMISSION бьёт раньше permit-хвоста (priority 200 > 5)."""
        d = self.gate.evaluate(prop("payout", "rogue", {"amount": 5}))
        self.assertEqual(d.outcome, "deny")

    def test_payout_within_limit_permitted(self):
        d = self.gate.evaluate(prop("payout", "treasury", {"amount": 5000}))
        self.assertEqual(d.outcome, "permit")

    def test_non_numeric_amount_fail_closed(self):
        """Нечисловая сумма трактуется как нарушение (fail-closed)."""
        d = self.gate.evaluate(
            prop("payout", "treasury", {"amount": "lots"})
        )
        self.assertIn(d.outcome, ("deny", "escalate"))

    def test_escalate_resolves_to_deny_over_hard_limit(self):
        """ESCALATE понижается до DENY при сумме выше ctx.hard_limit."""
        d = self.gate.evaluate(
            prop("payout", "treasury", {"amount": 30000}),
            ctx={"hard_limit": 20000},
        )
        self.assertEqual(d.outcome, "deny")

    def test_human_approval_flow(self):
        d = self.gate.evaluate(prop("payout", "treasury", {"amount": 30000}))
        pend = self.gate.pending_approvals()
        self.assertEqual(pend[0]["approval_id"], d.approval_id)
        d2 = self.gate.approve(d.approval_id, True, "bojak")
        self.assertEqual(d2.outcome, "permit")
        self.assertEqual(self.gate.pending_approvals(), [])

    def test_human_rejection_flow(self):
        d = self.gate.evaluate(prop("payout", "treasury", {"amount": 30000}))
        d2 = self.gate.approve(d.approval_id, False, "bojak")
        self.assertEqual(d2.outcome, "deny")

    def test_unknown_approval_id(self):
        self.assertIsNone(self.gate.approve("nope", True))

    def test_policy_hash_stamped_on_every_decision(self):
        d = self.gate.evaluate(prop("observe", "a", {}, sensitive=False))
        self.assertEqual(len(d.policy_hash), 64)
        self.assertEqual(d.policy_hash, self.gate.policy_hash)

    def test_audit_written_to_event_channel(self):
        """Аудит уходит в event-канал (не только in-memory как у них)."""
        self.gate.evaluate(prop("payout", "treasury", {"amount": 5000}))
        # в канале также node_start/node_done прогресс (AO-1c) — фильтруем аудит
        audits = [e for e in self.events if e.get("type") == "policy"]
        self.assertEqual(len(audits), 1)
        ev = audits[0]
        self.assertEqual(len(ev["content_hash"]), 64)
        self.assertEqual(ev["policy_hash"], self.gate.policy_hash)

    def test_node_start_events_on_evaluate_and_approve(self):
        """AO-1c: node_start/node_done текут в тот же event_sink до/после
        узлов графа; approve() эмитит aegis_approve_step start+done."""
        d = self.gate.evaluate(prop("payout", "treasury", {"amount": 30000}))
        self.assertEqual(d.outcome, "escalate")
        types = [(e["type"], e.get("node")) for e in self.events]
        self.assertIn(("node_start", "aegis_evaluate"), types)
        self.assertIn(("node_start", "aegis_await_approval"), types)
        self.assertIn(("node_done", "aegis_decide"), types)
        # node_start пришёл ДО node_done того же прогона
        self.assertLess(
            types.index(("node_start", "aegis_evaluate")),
            types.index(("node_done", "aegis_decide")))
        n_ev = len(self.events)
        d2 = self.gate.approve(d.approval_id, True, "bojak")
        self.assertEqual(d2.outcome, "permit")
        new_types = [(e["type"], e.get("node")) for e in self.events[n_ev:]]
        self.assertEqual(
            new_types[0], ("node_start", "aegis_approve_step"))
        self.assertIn(("node_done", "aegis_approve_step"), new_types)
        # имена узлов — sanitizer-safe [a-zA-Z0-9_-] (HERETIC #456)
        for e in self.events:
            if e.get("node"):
                self.assertRegex(e["node"], r"^[a-zA-Z0-9_-]+$")

    def test_audit_filter(self):
        self.gate.evaluate(prop("payout", "treasury", {"amount": 5000}))
        self.gate.evaluate(prop("payout", "rogue", {"amount": 5}))
        denied = self.gate.audit_records(outcome="deny")
        self.assertEqual(len(denied), 1)
        self.assertEqual(denied[0]["agent"], "rogue")


class CustomPolicyTest(unittest.TestCase):
    def test_allowlist_condition(self):
        gate = AegisGuard(policy=Policy(
            version="t",
            rules=[
                PolicyRule(
                    id="A-1",
                    description="vendor not in list",
                    operation="order",
                    condition=PolicyCondition(
                        COND_ALLOWLIST,
                        payload_field="vendor",
                        allowed=["acme"],
                    ),
                    outcome="deny",
                    priority=10,
                ),
                PolicyRule(
                    id="A-2",
                    description="allow rest",
                    operation="order",
                    condition=PolicyCondition("always"),
                    outcome="permit",
                    priority=1,
                ),
            ],
        ))
        self.assertEqual(
            gate.evaluate(prop("order", "charon", {"vendor": "evil"})).outcome,
            "deny",
        )
        self.assertEqual(
            gate.evaluate(prop("order", "charon", {"vendor": "acme"})).outcome,
            "permit",
        )

    def test_compound_and_or(self):
        cond = PolicyCondition(
            COND_COMPOUND,
            operator="AND",
            conditions=[
                PolicyCondition(COND_ALLOWLIST, payload_field="vendor", allowed=["acme"]),
                PolicyCondition("amount_limit", payload_field="amount", max_amount=100),
            ],
        )
        gate = AegisGuard(policy=Policy(
            version="t",
            rules=[PolicyRule(id="C-1", description="compound", operation="order",
                              condition=cond, outcome="deny", priority=10)],
        ))
        # оба нарушения → deny; одно — нет (default deny тут тоже deny, но по другой причине)
        d = gate.evaluate(prop("order", "c", {"vendor": "x", "amount": 200}))
        self.assertEqual(d.outcome, "deny")
        self.assertEqual(d.rule_id, "C-1")
        d = gate.evaluate(prop("order", "c", {"vendor": "x", "amount": 50}))
        self.assertIsNone(d.rule_id)  # compound не сработал → default


class AegisApiTest(AioHTTPTestCase):
    """API-уровень AEGIS: /proposals /approvals /policy /audit."""

    ADMIN_TOKEN = "test-aegis-token"

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="nexus-aegis-test-"))
        self.supervisor = SupervisorV1(backend=MockPTYBackend())
        os.environ["AEGIS_ADMIN_TOKEN"] = self.ADMIN_TOKEN
        os.environ["AEGIS_ALLOW_UNATTESTED"] = "1"
        super().setUp()

    def tearDown(self):
        os.environ.pop("AEGIS_ADMIN_TOKEN", None)
        os.environ.pop("AEGIS_ALLOW_UNATTESTED", None)
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.tmp, supervisor=self.supervisor)

    @unittest_run_loop
    async def test_proposal_permit(self):
        resp = await self.client.post("/api/core/proposals", json={
            "operation_type": "payout", "agent": "treasury",
            "payload": {"amount": 5000},
        })
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["outcome"], "permit")
        self.assertEqual(len(data["policy_hash"]), 64)

    @unittest_run_loop
    async def test_proposal_deny_403(self):
        resp = await self.client.post("/api/core/proposals", json={
            "operation_type": "payout", "agent": "rogue",
            "payload": {"amount": 5},
        })
        self.assertEqual(resp.status, 403)
        self.assertEqual((await resp.json())["outcome"], "deny")

    @unittest_run_loop
    async def test_proposal_escalate_and_approve(self):
        resp = await self.client.post("/api/core/proposals", json={
            "operation_type": "payout", "agent": "treasury",
            "payload": {"amount": 30000},
        })
        self.assertEqual(resp.status, 202)
        data = await resp.json()
        self.assertEqual(data["outcome"], "escalate")
        approval_id = data["approval_id"]

        pend = await self.client.get("/api/core/approvals")
        plist = (await pend.json())["approvals"]
        self.assertEqual(plist[0]["approval_id"], approval_id)

        ok = await self.client.post(
            f"/api/core/approvals/{approval_id}",
            json={"approved": True, "by": "mallory"},
            headers={"X-AEGIS-Key": self.ADMIN_TOKEN},
        )
        self.assertEqual((await ok.json())["outcome"], "permit")

        # повтор — pending пуст
        again = await self.client.post(
            f"/api/core/approvals/{approval_id}",
            json={"approved": True},
            headers={"X-AEGIS-Key": self.ADMIN_TOKEN},
        )
        self.assertEqual(again.status, 404)

    @unittest_run_loop
    async def test_policy_and_audit_endpoints(self):
        await self.client.post("/api/core/proposals", json={
            "operation_type": "payout", "agent": "treasury",
            "payload": {"amount": 1},
        })
        pol = await self.client.get("/api/core/policy")
        pdata = await pol.json()
        self.assertEqual(pdata["default_outcome"], "deny")
        self.assertEqual(pdata["evaluations"], 1)
        audit = await self.client.get("/api/core/audit")
        records = (await audit.json())["records"]
        self.assertEqual(len(records), 1)
        self.assertEqual(len(records[0]["content_hash"]), 64)

    @unittest_run_loop
    async def test_proposal_validation(self):
        resp = await self.client.post("/api/core/proposals", json={})
        self.assertEqual(resp.status, 400)
        resp = await self.client.post("/api/core/proposals", json={
            "operation_type": "x", "payload": "no",
        })
        self.assertEqual(resp.status, 400)


class AegisAdminAuthTest(AioHTTPTestCase):
    """B-C1: пустой AEGIS_ADMIN_TOKEN → admin-роуты DISABLED (503),
    не operator-fallback; заданный токен → 401 без/с плохим ключом."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="nexus-aegis-auth-"))
        self.supervisor = SupervisorV1(backend=MockPTYBackend())
        os.environ.pop("AEGIS_ADMIN_TOKEN", None)
        os.environ["AEGIS_ALLOW_UNATTESTED"] = "1"
        super().setUp()

    def tearDown(self):
        os.environ.pop("AEGIS_ADMIN_TOKEN", None)
        os.environ.pop("AEGIS_ALLOW_UNATTESTED", None)
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.tmp, supervisor=self.supervisor)

    @unittest_run_loop
    async def test_admin_routes_disabled_without_token(self):
        # mutations → 503
        for method, path, body in (
            ("post", "/api/core/approvals/x", {"approved": True}),
            ("post", "/api/core/policy", {"policy": {}}),
            ("post", "/api/core/ratings/a/score", {"score": 5}),
        ):
            resp = await getattr(self.client, method)(path, json=body)
            self.assertEqual(resp.status, 503, path)
        # reads остаются открытыми
        self.assertEqual((await self.client.get("/api/core/policy")).status, 200)
        self.assertEqual((await self.client.get("/api/core/ratings")).status, 200)
        self.assertEqual((await self.client.get("/api/core/approvals")).status, 200)
        # proposals (public eval) не затронуты
        resp = await self.client.post("/api/core/proposals", json={
            "operation_type": "observe", "agent": "a", "payload": {},
        })
        self.assertEqual(resp.status, 200)

    @unittest_run_loop
    async def test_admin_routes_401_with_token_no_key(self):
        os.environ["AEGIS_ADMIN_TOKEN"] = "tok-1"
        resp = await self.client.post(
            "/api/core/approvals/x", json={"approved": True}
        )
        self.assertEqual(resp.status, 401)
        resp = await self.client.post(
            "/api/core/policy", json={"policy": {}},
            headers={"X-AEGIS-Key": "wrong"},
        )
        self.assertEqual(resp.status, 401)
        # пустая строка токена = disabled
        os.environ["AEGIS_ADMIN_TOKEN"] = ""
        resp = await self.client.post(
            "/api/core/policy", json={"policy": {}}
        )
        self.assertEqual(resp.status, 503)


if __name__ == "__main__":
    unittest.main()
