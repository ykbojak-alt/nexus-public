#!/usr/bin/env python3
"""test_n6_aegis_p3.py — regression-тесты Фазы 3 AEGIS GUARD.

- escalation-цепочки: outcome=escalate + escalation_chain [роли];
  промежуточный approve → следующий шаг, финальный → permit,
  reject на любом шаге → deny chain_aborted; TTL единый на цепочку
- audit-export: entries + prev/content хэши + verify-отчёт,
  фильтр by ts, форматы json/jsonl/csv
"""

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from tools.nexus_core.aegis import (
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


def _chain_policy(chain):
    return Policy(
        version="t",
        rules=[PolicyRule(
            id="CH-1", description="chained escalate", operation="payout",
            condition=PolicyCondition(
                "amount_limit", payload_field="amount", max_amount=10
            ),
            outcome="escalate", priority=10,
            escalation_chain=chain,
        )],
    )


class EscalationChainTest(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.gate = AegisGuard(
            policy=_chain_policy(["operator", "admin"]),
            event_sink=self.events.append,
        )
        self.d = self.gate.evaluate(prop("payout", "treasury", {"amount": 50}))

    def test_first_role_in_escalate_to(self):
        self.assertEqual(self.d.outcome, "escalate")
        self.assertEqual(self.d.escalate_to, "operator")
        pend = self.gate.pending_approvals()[0]
        self.assertEqual(pend["required_role"], "operator")
        self.assertEqual(pend["chain_step"], "1/2")

    def test_chain_advances_to_next_role(self):
        d2 = self.gate.approve(self.d.approval_id, True, "op-vassya")
        self.assertEqual(d2.outcome, "escalate")
        self.assertEqual(d2.escalate_to, "admin")
        self.assertEqual(d2.approval_id, self.d.approval_id)
        pend = self.gate.pending_approvals()[0]
        self.assertEqual(pend["chain_pos"], 1)
        self.assertEqual(pend["required_role"], "admin")
        # аудит: escalation_step
        rec = self.events[-1]
        self.assertEqual(rec["outcome"], "escalate")
        self.assertEqual(rec["escalation_step"], 1)

    def test_chain_completes_permit(self):
        self.gate.approve(self.d.approval_id, True, "op")
        d3 = self.gate.approve(self.d.approval_id, True, "adm")
        self.assertEqual(d3.outcome, "permit")
        self.assertIn("chain complete", d3.reason)
        self.assertEqual(self.gate.pending_approvals(), [])

    def test_chain_abort_midway_denied(self):
        self.gate.approve(self.d.approval_id, True, "op")
        d3 = self.gate.approve(self.d.approval_id, False, "adm")
        self.assertEqual(d3.outcome, "deny")
        self.assertIn("chain aborted", d3.reason)
        self.assertIn("2/2", d3.reason)
        self.assertEqual(self.gate.pending_approvals(), [])

    def test_chain_abort_first_step(self):
        d2 = self.gate.approve(self.d.approval_id, False, "op")
        self.assertEqual(d2.outcome, "deny")
        self.assertIn("1/2", d2.reason)

    def test_three_step_chain(self):
        gate = AegisGuard(policy=_chain_policy(["a", "b", "c"]))
        d = gate.evaluate(prop("payout", "t", {"amount": 50}))
        self.assertEqual(d.escalate_to, "a")
        d = gate.approve(d.approval_id, True, "u1")
        self.assertEqual(d.escalate_to, "b")
        d = gate.approve(d.approval_id, True, "u2")
        self.assertEqual(d.escalate_to, "c")
        d = gate.approve(d.approval_id, True, "u3")
        self.assertEqual(d.outcome, "permit")
        self.assertIn("3/3", d.reason)

    def test_no_chain_single_step_unchanged(self):
        gate = AegisGuard(policy=_chain_policy([]))
        d = gate.evaluate(prop("payout", "t", {"amount": 50}))
        self.assertEqual(d.escalate_to, "human")
        d2 = gate.approve(d.approval_id, True, "op")
        self.assertEqual(d2.outcome, "permit")
        self.assertNotIn("chain", d2.reason)

    def test_chain_on_non_escalate_rejected(self):
        with self.assertRaises(ValueError):
            AegisGuard(policy=Policy(
                version="t",
                rules=[PolicyRule(
                    id="B-1", description="bad", operation="op",
                    condition=PolicyCondition("always"), outcome="deny",
                    escalation_chain=["a"],
                )],
            ))

    def test_chain_empty_step_rejected(self):
        with self.assertRaises(ValueError):
            AegisGuard(policy=Policy(
                version="t",
                rules=[PolicyRule(
                    id="B-2", description="bad", operation="op",
                    condition=PolicyCondition("always"), outcome="escalate",
                    escalation_chain=["a", "  "],
                )],
            ))

    def test_chain_in_pending_audit_snapshot(self):
        self.gate.approve(self.d.approval_id, True, "op")
        rec = self.events[-1]
        self.assertEqual(rec["escalation_chain"], ["operator", "admin"])
        # chain идёт в canonical → в policy_hash
        p2 = _chain_policy(["operator", "boss"])
        self.assertNotEqual(
            AegisGuard(policy=p2).policy_hash, self.gate.policy_hash
        )


class AuditExportTest(unittest.TestCase):
    def setUp(self):
        self.gate = AegisGuard()
        for i in range(3):
            self.gate.evaluate(prop("observe", "a", {"i": i}))

    def test_export_bundle_verifiable(self):
        b = self.gate.audit_export()
        self.assertEqual(b["format"], "aegis-audit-export/1")
        self.assertEqual(b["count"], 3)
        self.assertTrue(b["verify"]["ok"])
        self.assertEqual(len(b["entries"]), 3)
        # entries несут хэши цепочки — сторонний проверяющий пересчитает
        self.assertIn("prev_audit_hash", b["entries"][0])
        self.assertIn("content_hash", b["entries"][0])
        self.assertEqual(b["policy_hash"], self.gate.policy_hash)

    def test_export_ts_filter(self):
        # детерминистичные метки (time.time() может совпадать на быстрых eval'ах)
        for i, rec in enumerate(self.gate._audit):
            rec["ts"] = float(i + 1)
        b = self.gate.audit_export(from_ts=2.0)
        self.assertEqual(b["count"], 2)
        b = self.gate.audit_export(to_ts=1.5)
        self.assertEqual(b["count"], 1)
        b = self.gate.audit_export(from_ts=2.0, to_ts=2.5)
        self.assertEqual(b["count"], 1)

    def test_export_verify_reflects_tamper(self):
        self.gate._audit[1]["agent"] = "forged"
        b = self.gate.audit_export()
        self.assertFalse(b["verify"]["ok"])
        self.assertEqual(b["verify"]["first_bad"], 1)


class AuditExportApiTest(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="nexus-aegis-export-"))
        self.supervisor = SupervisorV1(backend=MockPTYBackend())
        os.environ["AEGIS_ALLOW_UNATTESTED"] = "1"
        super().setUp()

    def tearDown(self):
        os.environ.pop("AEGIS_ALLOW_UNATTESTED", None)
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.tmp, supervisor=self.supervisor)

    async def _gen(self):
        await self.client.post("/api/core/proposals", json={
            "operation_type": "payout", "agent": "treasury",
            "payload": {"amount": 5},
        })

    @unittest_run_loop
    async def test_export_json_bundle(self):
        await self._gen()
        resp = await self.client.get("/api/core/audit/export")
        self.assertEqual(resp.status, 200)
        b = await resp.json()
        self.assertEqual(b["format"], "aegis-audit-export/1")
        self.assertTrue(b["verify"]["ok"])
        self.assertGreaterEqual(b["count"], 1)

    @unittest_run_loop
    async def test_export_jsonl(self):
        await self._gen()
        resp = await self.client.get("/api/core/audit/export?format=jsonl")
        self.assertEqual(resp.status, 200)
        self.assertEqual(resp.content_type, "application/x-ndjson")
        lines = [l for l in (await resp.text()).splitlines() if l.strip()]
        rec = json.loads(lines[0])
        self.assertIn("content_hash", rec)

    @unittest_run_loop
    async def test_export_csv(self):
        await self._gen()
        resp = await self.client.get("/api/core/audit/export?format=csv")
        self.assertEqual(resp.status, 200)
        text = await resp.text()
        self.assertIn("content_hash", text.splitlines()[0])
        self.assertGreaterEqual(len(text.splitlines()), 2)

    @unittest_run_loop
    async def test_export_bad_ts_400(self):
        resp = await self.client.get("/api/core/audit/export?from_ts=abc")
        self.assertEqual(resp.status, 400)


if __name__ == "__main__":
    unittest.main()
