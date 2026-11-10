#!/usr/bin/env python3
"""test_n6_aegis_p2.py — regression-тесты Фазы 2 AEGIS GUARD.

Пути из аудита (фаза 2):
- A-5 payload-TOCTOU: payload заморожен в pending/аудите + payload_hash
- A-5 unbounded pendings: max_pending cap + approval_ttl_s expiry
- A-8 audit-hash chaining: prev_audit_hash + content_hash, verify
- rate_limit: sliding window per scope, fail-closed на overflow state
"""

import os
import shutil
import tempfile
import unittest
from pathlib import Path

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from tools.nexus_core.aegis import (
    COND_RATE_LIMIT,
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


def _escalate_policy():
    """Политика: payout amount>10 → escalate (для pending-тестов)."""
    return Policy(
        version="t",
        rules=[PolicyRule(
            id="E-1", description="escalate", operation="payout",
            condition=PolicyCondition(
                "amount_limit", payload_field="amount", max_amount=10
            ),
            outcome="escalate", priority=10,
        )],
    )


class PayloadFreezeTest(unittest.TestCase):
    """A-5: мутация payload после evaluate не меняет pending/аудит."""

    def setUp(self):
        self.events = []
        self.gate = AegisGuard(event_sink=self.events.append)

    def test_pending_uses_frozen_snapshot(self):
        p = prop("payout", "treasury", {"amount": 30000, "memo": "a"})
        d = self.gate.evaluate(p)
        self.assertEqual(d.outcome, "escalate")
        # вызывающий мутирует исходный dict — pending не дрейфует
        p.payload["amount"] = 1
        p.payload["injected"] = True
        pend = self.gate.pending_approvals()[0]
        self.assertEqual(pend["payload"], {"amount": 30000, "memo": "a"})

    def test_audit_uses_frozen_snapshot_and_hash(self):
        p = prop("payout", "treasury", {"amount": 5000})
        self.gate.evaluate(p)
        p.payload["amount"] = 999999
        rec = self.events[-1]
        self.assertEqual(rec["payload"]["amount"], 5000)
        self.assertEqual(len(rec["payload_hash"]), 64)
        # hash связывает решение с содержимым — не мутируется
        p2 = prop("payout", "treasury", {"amount": 5000})
        self.gate.evaluate(p2)
        self.assertEqual(self.events[-1]["payload_hash"], rec["payload_hash"])

    def test_approved_payload_is_frozen_one(self):
        p = prop("payout", "treasury", {"amount": 30000})
        d = self.gate.evaluate(p)
        p.payload["amount"] = 1
        self.gate.approve(d.approval_id, True)
        rec = self.events[-1]
        self.assertEqual(rec["payload"]["amount"], 30000)


class PendingBoundsTest(unittest.TestCase):
    """A-5: cap очереди + TTL на approval-запросы."""

    def test_pending_cap_fail_closed(self):
        gate = AegisGuard(policy=_escalate_policy(), max_pending=2)
        gate.evaluate(prop("payout", "a", {"amount": 20}))
        gate.evaluate(prop("payout", "b", {"amount": 20}))
        d = gate.evaluate(prop("payout", "c", {"amount": 20}))
        self.assertEqual(d.outcome, "deny")
        self.assertIsNone(d.approval_id)
        self.assertIn("pending cap", d.reason)
        self.assertEqual(len(gate.pending_approvals()), 2)

    def test_approval_expired_denied(self):
        gate = AegisGuard(policy=_escalate_policy())
        d = gate.evaluate(prop("payout", "a", {"amount": 20}))
        # отматываем срок жизни назад (детерминистично, без sleep)
        gate._pending[d.approval_id]["expires_at"] = 0.0
        d2 = gate.approve(d.approval_id, True, "bojak")
        self.assertEqual(d2.outcome, "deny")
        self.assertEqual(d2.reason, "approval_expired")
        self.assertEqual(gate.pending_approvals(), [])

    def test_expired_gc_on_next_escalate(self):
        gate = AegisGuard(policy=_escalate_policy())
        d = gate.evaluate(prop("payout", "a", {"amount": 20}))
        gate._pending[d.approval_id]["expires_at"] = 0.0
        gate.evaluate(prop("payout", "b", {"amount": 20}))  # GC в _finalize
        self.assertEqual(len(gate.pending_approvals()), 1)
        # истёкший запрос оставил аудит-запись approval_expired
        recs = gate.audit_records(limit=10)
        self.assertTrue(any(r["reason"] == "approval_expired" for r in recs))

    def test_pending_expired_flag(self):
        gate = AegisGuard(policy=_escalate_policy())
        d = gate.evaluate(prop("payout", "a", {"amount": 20}))
        gate._pending[d.approval_id]["expires_at"] = 0.0
        self.assertTrue(gate.pending_approvals()[0]["expired"])


class AuditChainTest(unittest.TestCase):
    """A-8: prev_audit_hash + content_hash — проверяемая цепочка."""

    def setUp(self):
        self.gate = AegisGuard()

    def test_chain_links_records(self):
        self.gate.evaluate(prop("observe", "a", {}))
        self.gate.evaluate(prop("observe", "a", {}))
        recs = self.gate._audit
        self.assertIsNone(recs[0]["prev_audit_hash"])
        self.assertEqual(recs[1]["prev_audit_hash"], recs[0]["content_hash"])

    def test_verify_ok(self):
        for _ in range(3):
            self.gate.evaluate(prop("observe", "a", {}))
        self.assertEqual(self.gate.audit_chain_verify()["ok"], True)

    def test_verify_detects_dropped_record(self):
        for _ in range(3):
            self.gate.evaluate(prop("observe", "a", {}))
        del self.gate._audit[1]
        v = self.gate.audit_chain_verify()
        self.assertFalse(v["ok"])
        self.assertEqual(v["first_bad"], 1)

    def test_verify_detects_tampered_record(self):
        self.gate.evaluate(prop("observe", "a", {}))
        self.gate._audit[0]["outcome"] = "permit-forged"
        v = self.gate.audit_chain_verify()
        self.assertFalse(v["ok"])
        self.assertEqual(v["error"], "content_hash mismatch")

    def test_chain_survives_restart(self):
        tmp = Path(tempfile.mkdtemp(prefix="aegis-chain-"))
        try:
            ap = str(tmp / "audit.jsonl")
            g1 = AegisGuard(audit_path=ap)
            g1.evaluate(prop("observe", "a", {}))
            g2 = AegisGuard(audit_path=ap)
            g2.evaluate(prop("observe", "a", {}))
            # новая запись продолжает цепочку загруженного хвоста
            recs = g2._audit
            self.assertEqual(recs[-1]["prev_audit_hash"], recs[-2]["content_hash"])
            self.assertTrue(g2.audit_chain_verify()["ok"])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class RateLimitTest(unittest.TestCase):
    """rate_limit: sliding window, scope, fail-closed overflow."""

    def _gate(self, scope="agent", max_count=2, window_s=3600, **kw):
        return AegisGuard(policy=Policy(
            version="t",
            rules=[
                PolicyRule(
                    id="R-1", description="rate", operation="op",
                    condition=PolicyCondition(
                        COND_RATE_LIMIT, window_s=window_s,
                        max_count=max_count, rate_scope=scope,
                    ),
                    outcome="deny", priority=10,
                ),
                PolicyRule(
                    id="R-2", description="tail permit", operation="op",
                    condition=PolicyCondition("always"),
                    outcome="permit", priority=1,
                ),
            ],
        ), **kw)

    def test_count_over_limit_denied(self):
        g = self._gate(max_count=2)
        self.assertEqual(g.evaluate(prop("op", "a")).outcome, "permit")
        self.assertEqual(g.evaluate(prop("op", "a")).outcome, "permit")
        d = g.evaluate(prop("op", "a"))
        self.assertEqual(d.outcome, "deny")
        self.assertEqual(d.rule_id, "R-1")

    def test_agent_scope_isolated(self):
        g = self._gate(scope="agent", max_count=1)
        g.evaluate(prop("op", "a"))
        self.assertEqual(g.evaluate(prop("op", "b")).outcome, "permit")
        self.assertEqual(g.evaluate(prop("op", "a")).outcome, "deny")

    def test_operation_scope_shared(self):
        g = self._gate(scope="operation", max_count=1)
        g.evaluate(prop("op", "a"))
        self.assertEqual(g.evaluate(prop("op", "b")).outcome, "deny")

    def test_agent_operation_pair_scope(self):
        g = AegisGuard(policy=Policy(
            version="t",
            rules=[
                PolicyRule(
                    id="R-1", description="rate", operation="*",
                    condition=PolicyCondition(
                        COND_RATE_LIMIT, window_s=3600,
                        max_count=1, rate_scope="agent:operation",
                    ),
                    outcome="deny", priority=10,
                ),
                PolicyRule(
                    id="R-2", description="tail permit", operation="*",
                    condition=PolicyCondition("always"),
                    outcome="permit", priority=1,
                ),
            ],
        ))
        g.evaluate(prop("op", "a"))
        # другая пара (a, op2) — отдельный счётчик → permit
        self.assertEqual(g.evaluate(prop("op2", "a")).outcome, "permit")
        # та же пара (a, op) — лимит исчерпан → deny
        self.assertEqual(g.evaluate(prop("op", "a")).outcome, "deny")

    def test_window_expiry_releases(self):
        g = self._gate(max_count=1, window_s=60)
        g.evaluate(prop("op", "a"))
        # эмулируем истёкшее окно — событие далеко в прошлом
        g._rate_events["a"] = [0.0]
        self.assertEqual(g.evaluate(prop("op", "a")).outcome, "permit")

    def test_denied_attempt_consumed(self):
        """Отклонённая попытка тоже расходует окно (fail-closed)."""
        g = self._gate(max_count=2)
        g.evaluate(prop("op", "a"))
        g.evaluate(prop("op", "a"))
        self.assertEqual(g.evaluate(prop("op", "a")).outcome, "deny")
        # 4-я — уже за лимитом, всё равно deny
        self.assertEqual(g.evaluate(prop("op", "a")).outcome, "deny")

    def test_state_overflow_fail_closed(self):
        g = self._gate(scope="agent", max_count=1, max_rate_keys=2)
        g.evaluate(prop("op", "a"))
        g.evaluate(prop("op", "b"))
        # новый ключ за пределами cap → violation, а не утечка state
        self.assertEqual(g.evaluate(prop("op", "c")).outcome, "deny")
        self.assertEqual(len(g._rate_events), 2)

    def test_rate_limit_validation(self):
        with self.assertRaises(ValueError):
            AegisGuard(policy=Policy(
                version="t",
                rules=[PolicyRule(
                    id="V-1", description="bad", operation="op",
                    condition=PolicyCondition(
                        COND_RATE_LIMIT, rate_scope="bogus"
                    ),
                    outcome="deny", priority=1,
                )],
            ))
        with self.assertRaises(ValueError):
            AegisGuard(policy=Policy(
                version="t",
                rules=[PolicyRule(
                    id="V-2", description="bad", operation="op",
                    condition=PolicyCondition(
                        COND_RATE_LIMIT, max_count=0
                    ),
                    outcome="deny", priority=1,
                )],
            ))


class AuditVerifyApiTest(AioHTTPTestCase):
    """GET /api/core/audit/verify."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="nexus-aegis-verify-"))
        self.supervisor = SupervisorV1(backend=MockPTYBackend())
        os.environ["AEGIS_ALLOW_UNATTESTED"] = "1"
        super().setUp()

    def tearDown(self):
        os.environ.pop("AEGIS_ALLOW_UNATTESTED", None)
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.tmp, supervisor=self.supervisor)

    @unittest_run_loop
    async def test_audit_verify_endpoint(self):
        await self.client.post("/api/core/proposals", json={
            "operation_type": "payout", "agent": "treasury",
            "payload": {"amount": 5},
        })
        resp = await self.client.get("/api/core/audit/verify")
        data = await resp.json()
        self.assertTrue(data["ok"])
        self.assertGreaterEqual(data["records"], 1)


if __name__ == "__main__":
    unittest.main()
