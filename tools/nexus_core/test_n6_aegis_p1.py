#!/usr/bin/env python3
"""test_n6_aegis_p1.py — regression-тесты Фазы 1 AEGIS GUARD.

Каждый класс закрывает bypass-вектор из аудита (aegis-audit-1105):
- A-1 caller-controlled `sensitive` → server-side operation_class
- A-2 authN/Z на policy-update / approvals (X-AEGIS-Key)
- A-3 missing payload_field → fail-closed (нарушение, не пропуск)
- A-4 stale policy_hash на approve после hot-reload
- A-6/A-7 unknown cond.type / agent_permission без маппинга → fail-closed
"""

import os
import shutil
import tempfile
import unittest
from pathlib import Path

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from tools.nexus_core.aegis import (
    COND_AGENT_PERMISSION,
    COND_ALLOWLIST,
    COND_AMOUNT_LIMIT,
    COND_BUDGET_THRESHOLD,
    COND_COMPOUND,
    OperationProposal,
    PolicyCondition,
    AegisGuard,
    PolicyRule,
    Policy,
    default_policy,
)
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


def prop(op, agent, payload=None, sensitive=True):
    return OperationProposal(op, agent, payload or {}, sensitive=sensitive)


class ServerSideSensitiveTest(unittest.TestCase):
    """A-1: клиентский sensitive=False не должен обходить gate."""

    def setUp(self):
        self.gate = AegisGuard()

    def test_sensitive_false_does_not_bypass_rules(self):
        """sensitive=False от клиента → payout всё равно проходит правила."""
        d = self.gate.evaluate(
            prop("payout", "treasury", {"amount": 60000}, sensitive=False)
        )
        self.assertEqual(d.outcome, "deny")
        self.assertEqual(d.rule_id, "N-001")

    def test_sensitive_false_unknown_op_denied(self):
        """sensitive=False на неизвестной операции → deny-by-default."""
        d = self.gate.evaluate(prop("wipe", "rogue", {}, sensitive=False))
        self.assertEqual(d.outcome, "deny")

    def test_observe_class_comes_from_policy(self):
        """observe-класс — только из policy.operation_class, не из флага."""
        d = self.gate.evaluate(prop("observe", "anyone", {}, sensitive=True))
        self.assertEqual(d.outcome, "permit")
        d = self.gate.evaluate(prop("tail", "anyone", {}, sensitive=True))
        self.assertEqual(d.outcome, "permit")

    def test_observe_flag_without_mapping_stays_sensitive(self):
        """Убрать op из operation_class → sensitive=False его не спасает."""
        policy = default_policy()
        del policy.operation_class["tail"]  # tail больше не observe
        gate = AegisGuard(policy=policy)
        d = gate.evaluate(prop("tail", "anyone", {}, sensitive=False))
        self.assertEqual(d.outcome, "deny")  # rules не матчат → default


class MissingFieldFailClosedTest(unittest.TestCase):
    """A-3: отсутствие payload_field = нарушение, не «нет совпадения»."""

    def setUp(self):
        self.gate = AegisGuard()

    def test_payout_without_amount_denied(self):
        """payout без amount: N-001 (amount_limit) теперь violation → deny."""
        d = self.gate.evaluate(prop("payout", "treasury", {}))
        self.assertEqual(d.outcome, "deny")
        self.assertEqual(d.rule_id, "N-001")

    def test_allowlist_missing_field_denied(self):
        gate = AegisGuard(policy=Policy(
            version="t",
            rules=[PolicyRule(
                id="M-1", description="vendor required", operation="order",
                condition=PolicyCondition(
                    COND_ALLOWLIST, payload_field="vendor", allowed=["acme"]
                ),
                outcome="deny", priority=10,
            )],
        ))
        d = gate.evaluate(prop("order", "a", {}))
        self.assertEqual(d.outcome, "deny")
        self.assertEqual(d.rule_id, "M-1")

    def test_budget_missing_field_denied(self):
        gate = AegisGuard(policy=Policy(
            version="t",
            rules=[PolicyRule(
                id="M-2", description="budget", operation="spend",
                condition=PolicyCondition(
                    COND_BUDGET_THRESHOLD, payload_field="amount",
                    budget_percent=50,
                ),
                outcome="deny", priority=10,
            )],
        ))
        d = gate.evaluate(
            prop("spend", "a", {}), ctx={"budget": 1000}
        )
        self.assertEqual(d.outcome, "deny")
        self.assertEqual(d.rule_id, "M-2")


class FailClosedConditionTest(unittest.TestCase):
    """A-6/A-7: неизвестный тип / отсутствующий маппинг → нарушение."""

    def test_unknown_cond_type_rejected_on_load(self):
        with self.assertRaises(ValueError):
            AegisGuard(policy=Policy(
                version="t",
                rules=[PolicyRule(
                    id="X-1", description="bogus", operation="op",
                    condition=PolicyCondition("no_such_type"),
                    outcome="deny", priority=10,
                )],
            ))

    def test_invalid_compound_operator_rejected(self):
        with self.assertRaises(ValueError):
            AegisGuard(policy=Policy(
                version="t",
                rules=[PolicyRule(
                    id="X-2", description="bad op", operation="op",
                    condition=PolicyCondition(
                        COND_COMPOUND, operator="XOR",
                        conditions=[PolicyCondition("always")],
                    ),
                    outcome="deny", priority=10,
                )],
            ))

    def test_unknown_cond_type_mutated_fail_closed(self):
        """Мутация cond.type после загрузки → нарушение, а не пропуск."""
        gate = AegisGuard(policy=Policy(
            version="t",
            rules=[
                PolicyRule(
                    id="X-3", description="deny-rule", operation="op",
                    condition=PolicyCondition("always"),
                    outcome="deny", priority=10,
                ),
                PolicyRule(
                    id="X-4", description="permit-tail", operation="op",
                    condition=PolicyCondition("always"),
                    outcome="permit", priority=1,
                ),
            ],
        ))
        gate.policy.rules[0].condition.type = "mutated_unknown"
        d = gate.evaluate(prop("op", "a", {}))
        self.assertEqual(d.outcome, "deny")
        self.assertEqual(d.rule_id, "X-3")

    def test_agent_permission_missing_map_is_violation(self):
        """agent_permission без маппинга op → правило денит, не молчит."""
        gate = AegisGuard(policy=Policy(
            version="t",
            operation_permissions={"payout": ["treasury"]},
            rules=[
                PolicyRule(
                    id="P-1", description="agents", operation="exec",
                    condition=PolicyCondition(COND_AGENT_PERMISSION),
                    outcome="deny", priority=10,
                ),
                PolicyRule(
                    id="P-2", description="tail permit", operation="exec",
                    condition=PolicyCondition("always"),
                    outcome="permit", priority=1,
                ),
            ],
        ))
        # 'exec' нет в operation_permissions → violation → deny, а не permit
        d = gate.evaluate(prop("exec", "orchestrator", {}))
        self.assertEqual(d.outcome, "deny")
        self.assertEqual(d.rule_id, "P-1")

    def test_operation_class_invalid_rejected(self):
        with self.assertRaises(ValueError):
            AegisGuard(policy=Policy(
                version="t", rules=[],
                operation_class={"observe": "bogus"},
            ))


class StalePolicyApprovalTest(unittest.TestCase):
    """A-4: approve() под новой политикой → stale-deny, аудит несёт оба хэша."""

    def setUp(self):
        self.events = []
        self.gate = AegisGuard(event_sink=self.events.append)

    def _escalate(self):
        d = self.gate.evaluate(prop("payout", "treasury", {"amount": 30000}))
        self.assertEqual(d.outcome, "escalate")
        return d.approval_id

    def test_approve_after_reload_stale_denied(self):
        approval_id = self._escalate()
        old_hash = self.gate.policy_hash
        new_policy = default_policy()
        new_policy.version = "1.0.1"  # другой canonical → другой hash
        self.gate.reload_policy(new_policy)
        self.assertNotEqual(self.gate.policy_hash, old_hash)

        d2 = self.gate.approve(approval_id, True, "bojak")
        self.assertEqual(d2.outcome, "deny")
        self.assertIn("stale", d2.reason)

        rec = self.events[-1]
        self.assertEqual(rec["outcome"], "deny")
        self.assertTrue(rec["stale"])
        self.assertEqual(rec["requested_policy_hash"], old_hash)
        self.assertEqual(rec["policy_hash"], self.gate.policy_hash)

    def test_pending_marked_stale_after_reload(self):
        self._escalate()
        new_policy = default_policy()
        new_policy.version = "9.9.9"
        self.gate.reload_policy(new_policy)
        pend = self.gate.pending_approvals()
        self.assertTrue(pend[0]["stale"])

    def test_approve_without_reload_binds_hashes(self):
        approval_id = self._escalate()
        d2 = self.gate.approve(approval_id, True, "bojak")
        self.assertEqual(d2.outcome, "permit")
        rec = self.events[-1]
        self.assertFalse(rec["stale"])
        self.assertEqual(rec["requested_policy_hash"], rec["policy_hash"])
        # rule_id эскалации проносится в approve-запись
        self.assertEqual(rec["rule_id"], "N-002")


class AegisAuthApiTest(AioHTTPTestCase):
    """A-2: authN/Z на /approvals и /policy при заданном AEGIS_ADMIN_TOKEN."""

    TOKEN = "test-admin-token-42"

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="nexus-aegis-auth-"))
        self.supervisor = SupervisorV1(backend=MockPTYBackend())
        os.environ["AEGIS_ADMIN_TOKEN"] = self.TOKEN
        os.environ["AEGIS_TOKEN_NAMES"] = f'{{"{self.TOKEN}": "alice"}}'
        os.environ["AEGIS_ALLOW_UNATTESTED"] = "1"
        super().setUp()

    def tearDown(self):
        super().tearDown()
        os.environ.pop("AEGIS_ADMIN_TOKEN", None)
        os.environ.pop("AEGIS_TOKEN_NAMES", None)
        os.environ.pop("AEGIS_ALLOW_UNATTESTED", None)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.tmp, supervisor=self.supervisor)

    async def _escalate(self):
        resp = await self.client.post("/api/core/proposals", json={
            "operation_type": "payout", "agent": "treasury",
            "payload": {"amount": 30000},
        })
        data = await resp.json()
        return data["approval_id"]

    @unittest_run_loop
    async def test_approval_requires_key(self):
        approval_id = await self._escalate()
        # без ключа → 401
        resp = await self.client.post(
            f"/api/core/approvals/{approval_id}", json={"approved": True}
        )
        self.assertEqual(resp.status, 401)
        # неверный ключ → 401
        resp = await self.client.post(
            f"/api/core/approvals/{approval_id}",
            json={"approved": True},
            headers={"X-AEGIS-Key": "wrong"},
        )
        self.assertEqual(resp.status, 401)
        # верный ключ → решение; by из токена, а не из тела
        resp = await self.client.post(
            f"/api/core/approvals/{approval_id}",
            json={"approved": True, "by": "mallory"},
            headers={"X-AEGIS-Key": self.TOKEN},
        )
        self.assertEqual(resp.status, 200)
        self.assertEqual((await resp.json())["outcome"], "permit")
        # approved_by = identity токена ("alice"), не "mallory"
        audit = await self.client.get("/api/core/audit")
        recs = (await audit.json())["records"]
        self.assertEqual(recs[-1]["approved_by"], "alice")

    @unittest_run_loop
    async def test_policy_update_requires_key(self):
        pol = {"version": "2.0.0", "rules": [], "default_outcome": "deny"}
        resp = await self.client.post("/api/core/policy", json={"policy": pol})
        self.assertEqual(resp.status, 401)
        resp = await self.client.post(
            "/api/core/policy", json={"policy": pol},
            headers={"X-AEGIS-Key": self.TOKEN},
        )
        self.assertEqual(resp.status, 200)

    @unittest_run_loop
    async def test_proposals_sensitive_flag_ignored(self):
        """API: sensitive:false в теле не открывает байпас."""
        resp = await self.client.post("/api/core/proposals", json={
            "operation_type": "payout", "agent": "rogue",
            "payload": {"amount": 5}, "sensitive": False,
        })
        self.assertEqual(resp.status, 403)


if __name__ == "__main__":
    unittest.main()
