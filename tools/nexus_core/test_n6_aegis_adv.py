#!/usr/bin/env python3
"""test_n6_aegis_adv.py — adversarial/граничные случаи AEGIS (N6).

Дополняет поставленный test_n6_aegis.py (21 тест) негатив/граничными
сценариями: NaN/inf/строки-числа/unicode/гигант-payload/nested compound,
персистентный аудит (ротация + чтение при рестарте), hot-reload политики.
"""

import json
import math
import os
import tempfile
import unittest
from pathlib import Path

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from tools.nexus_core import aegis as aegis_module
from tools.nexus_core.aegis import (
    COND_ALLOWLIST,
    COND_AMOUNT_LIMIT,
    COND_BUDGET_THRESHOLD,
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


class AdversarialInputTest(unittest.TestCase):
    """NaN/inf/строки-числа/unicode/гигант-payload → fail-closed."""

    def setUp(self):
        self.events = []
        self.gate = AegisGuard(event_sink=self.events.append)

    def test_amount_nan_fail_closed(self):
        d = self.gate.evaluate(prop("payout", "treasury", {"amount": float("nan")}))
        self.assertEqual(d.outcome, "deny")

    def test_amount_pos_inf_denied(self):
        d = self.gate.evaluate(prop("payout", "treasury", {"amount": float("inf")}))
        self.assertEqual(d.outcome, "deny")

    def test_amount_neg_inf_denied(self):
        d = self.gate.evaluate(prop("payout", "treasury", {"amount": float("-inf")}))
        self.assertEqual(d.outcome, "deny")

    def test_amount_negative_denied(self):
        d = self.gate.evaluate(prop("payout", "treasury", {"amount": -100}))
        self.assertEqual(d.outcome, "deny")

    def test_amount_string_number_large_denied(self):
        """Строка-число '1e9' парсится и трактуется как превышение лимита."""
        d = self.gate.evaluate(prop("payout", "treasury", {"amount": "1e9"}))
        self.assertEqual(d.outcome, "deny")

    def test_budget_non_numeric_fail_closed(self):
        gate = AegisGuard(policy=Policy(
            version="t",
            rules=[PolicyRule(
                id="B-1", description="budget", operation="order",
                condition=PolicyCondition(COND_BUDGET_THRESHOLD, budget_percent=50.0),
                outcome="deny", priority=10,
            )],
        ))
        d = gate.evaluate(prop("order", "a", {"amount": "lots"}))
        self.assertEqual(d.outcome, "deny")

    def test_budget_negative_denied(self):
        gate = AegisGuard(policy=Policy(
            version="t",
            rules=[PolicyRule(
                id="B-2", description="budget", operation="order",
                condition=PolicyCondition(COND_BUDGET_THRESHOLD, budget_percent=50.0),
                outcome="deny", priority=10,
            )],
        ))
        d = gate.evaluate(prop("order", "a", {"amount": -5}))
        self.assertEqual(d.outcome, "deny")

    def test_budget_inf_denied(self):
        gate = AegisGuard(policy=Policy(
            version="t",
            rules=[PolicyRule(
                id="B-3", description="budget", operation="order",
                condition=PolicyCondition(COND_BUDGET_THRESHOLD, budget_percent=50.0),
                outcome="deny", priority=10,
            )],
        ))
        d = gate.evaluate(prop("order", "a", {"amount": float("inf")}))
        self.assertEqual(d.outcome, "deny")

    def test_unicode_payload_allowlist(self):
        gate = AegisGuard(policy=Policy(
            version="t",
            rules=[
                PolicyRule(
                    id="U-1", description="vendor not in list", operation="order",
                    condition=PolicyCondition(
                        COND_ALLOWLIST, payload_field="vendor",
                        allowed=["акме", "шар"],
                    ),
                    outcome="deny", priority=10,
                ),
                PolicyRule(
                    id="U-2", description="rest permit", operation="order",
                    condition=PolicyCondition("always"),
                    outcome="permit", priority=1,
                ),
            ],
        ))
        self.assertEqual(
            gate.evaluate(prop("order", "a", {"vendor": "ЗЛО"})).outcome,
            "deny",
        )
        self.assertEqual(
            gate.evaluate(prop("order", "a", {"vendor": "акме"})).outcome,
            "permit",
        )

    def test_giant_payload_handled(self):
        """Огромный payload не падает и сохраняет детерминизм."""
        giant = {"amount": 5000, "blob": "x" * (8 * 1024 * 1024)}
        d1 = self.gate.evaluate(prop("payout", "treasury", giant))
        d2 = self.gate.evaluate(prop("payout", "treasury", dict(giant)))
        self.assertEqual(d1.outcome, "permit")
        self.assertEqual(d1.outcome, d2.outcome)

    def test_deep_compound_fail_closed(self):
        """Вложенность compound > MAX_COMPOUND_DEPTH → нарушение (fail-closed)."""
        def nested(depth):
            if depth == 0:
                return PolicyCondition("always")
            return PolicyCondition(
                COND_COMPOUND, operator="AND", conditions=[nested(depth - 1)]
            )
        deep = nested(aegis_module.MAX_COMPOUND_DEPTH + 2)
        gate = AegisGuard(policy=Policy(
            version="t",
            rules=[PolicyRule(
                id="D-1", description="deep compound", operation="order",
                condition=deep, outcome="deny", priority=10,
            )],
        ))
        d = gate.evaluate(prop("order", "a", {"amount": 1}))
        self.assertEqual(d.outcome, "deny")
        self.assertEqual(d.rule_id, "D-1")


class PolicyValidationTest(unittest.TestCase):
    def test_empty_rules_default_deny(self):
        gate = AegisGuard(policy=Policy(version="t", rules=[]))
        d = gate.evaluate(prop("wipe", "agent-x", {"target": "/"}))
        self.assertEqual(d.outcome, "deny")
        self.assertIn("default", d.reason)

    def test_duplicate_rule_id_rejected(self):
        rules = [
            PolicyRule(id="X", description="a", operation="*", outcome="deny"),
            PolicyRule(id="X", description="b", operation="*", outcome="deny"),
        ]
        with self.assertRaises(ValueError):
            AegisGuard(policy=Policy(version="t", rules=rules))

    def test_empty_rule_id_rejected(self):
        rules = [PolicyRule(id="", description="a", operation="*", outcome="deny")]
        with self.assertRaises(ValueError):
            AegisGuard(policy=Policy(version="t", rules=rules))

    def test_unknown_outcome_rejected(self):
        rules = [PolicyRule(id="Y", description="a", operation="*", outcome="nope")]
        with self.assertRaises(ValueError):
            AegisGuard(policy=Policy(version="t", rules=rules))

    def test_priority_tiebreak_deterministic(self):
        """Одинаковый priority → детерминированный выбор по rule.id (лексикограф.)."""
        rules = [
            PolicyRule(
                id="B", description="later", operation="order",
                condition=PolicyCondition(COND_ALLOWLIST, payload_field="vendor",
                                          allowed=["acme"]),
                outcome="permit", priority=10,
            ),
            PolicyRule(
                id="A", description="first", operation="order",
                condition=PolicyCondition(COND_ALLOWLIST, payload_field="vendor",
                                          allowed=["acme"]),
                outcome="deny", priority=10,
            ),
        ]
        gate = AegisGuard(policy=Policy(version="t", rules=rules))
        d = gate.evaluate(prop("order", "a", {"vendor": "evil"}))
        self.assertEqual(d.outcome, "deny")
        self.assertEqual(d.rule_id, "A")


class PersistedAuditTest(unittest.TestCase):
    def test_audit_read_on_restart(self):
        """Записи JSONL читаются при рестарте (новый экземпляр gate)."""
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "aegis-audit.jsonl")
            g1 = AegisGuard(audit_path=path)
            g1.evaluate(prop("payout", "treasury", {"amount": 5000}))
            g1.evaluate(prop("payout", "rogue", {"amount": 5}))
            self.assertEqual(len(g1.audit_records()), 2)

            g2 = AegisGuard(audit_path=path)
            self.assertEqual(len(g2.audit_records()), 2)
            self.assertEqual(g2.audit_records()[0]["agent"], "treasury")
            self.assertTrue(all("content_hash" in r for r in g2.audit_records()))

    def test_audit_rotation(self):
        """По достижению MAX_AUDIT_BYTES файл ротируется (.1/.2/.3)."""
        old_max = aegis_module.MAX_AUDIT_BYTES
        aegis_module.MAX_AUDIT_BYTES = 512  # крошечный лимит для быстрого теста
        try:
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "aegis-audit.jsonl"
                gate = AegisGuard(audit_path=str(path))
                for i in range(60):
                    gate.evaluate(prop("payout", "treasury", {"amount": 1}))
                # основной файл + бэкапы существуют/ротируются
                self.assertTrue(path.exists())
                self.assertTrue(Path(f"{path}.1").exists())
                # записи всё ещё читаются из памяти
                self.assertGreaterEqual(len(gate.audit_records(limit=100)), 60)
        finally:
            aegis_module.MAX_AUDIT_BYTES = old_max


class HotReloadTest(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.gate = AegisGuard(event_sink=self.events.append)

    def test_hot_reload_changes_hash_and_policy(self):
        old_hash = self.gate.policy_hash
        new_policy = Policy(
            version="2.0.0",
            rules=[PolicyRule(
                id="R-1", description="all order permit", operation="order",
                condition=PolicyCondition("always"),
                outcome="permit", priority=5,
            )],
        )
        new_hash = self.gate.reload_policy(new_policy)
        self.assertNotEqual(new_hash, old_hash)
        self.assertEqual(self.gate.policy_hash, new_hash)
        d = self.gate.evaluate(prop("order", "anyone", {}))
        self.assertEqual(d.outcome, "permit")
        # событие policy_reload ушло в event-канал
        self.assertTrue(any(ev["type"] == "policy_reload" for ev in self.events))

    def test_hot_reload_invalid_keeps_old(self):
        old_hash = self.gate.policy_hash
        bad = Policy(version="bad", rules=[
            PolicyRule(id="D", description="a", operation="*", outcome="deny"),
            PolicyRule(id="D", description="b", operation="*", outcome="deny"),
        ])
        with self.assertRaises(ValueError):
            self.gate.reload_policy(bad)
        # старая политика не тронута
        self.assertEqual(self.gate.policy_hash, old_hash)


class AdversarialApiTest(AioHTTPTestCase):
    """API-уровень: NaN/inf payload → fail-closed, валидация."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="nexus-aegis-adv-"))
        self.supervisor = SupervisorV1(backend=MockPTYBackend())
        os.environ["AEGIS_ALLOW_UNATTESTED"] = "1"
        super().setUp()

    def tearDown(self):
        os.environ.pop("AEGIS_ALLOW_UNATTESTED", None)
        super().tearDown()
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.tmp, supervisor=self.supervisor)

    @unittest_run_loop
    async def test_proposal_nan_deny(self):
        resp = await self.client.post("/api/core/proposals", json={
            "operation_type": "payout", "agent": "treasury",
            "payload": {"amount": "NaN"},
        })
        self.assertEqual(resp.status, 403)
        self.assertEqual((await resp.json())["outcome"], "deny")

    @unittest_run_loop
    async def test_proposal_inf_deny(self):
        resp = await self.client.post("/api/core/proposals", json={
            "operation_type": "payout", "agent": "treasury",
            "payload": {"amount": float("inf")},
        })
        self.assertEqual(resp.status, 403)
        self.assertEqual((await resp.json())["outcome"], "deny")

    @unittest_run_loop
    async def test_proposal_giant_payload_ok(self):
        # <1MB (дефолтный client_max_size aiohttp); true-giant 8MB уже на unit-уровне
        payload = {"amount": 5000, "blob": "x" * (500 * 1024)}
        resp = await self.client.post("/api/core/proposals", json={
            "operation_type": "payout", "agent": "treasury", "payload": payload,
        })
        self.assertEqual(resp.status, 200)

    @unittest_run_loop
    async def test_proposal_empty_rules_fail_closed_api(self):
        resp = await self.client.post("/api/core/proposals", json={
            "operation_type": "payout", "agent": "treasury",
            "payload": {"amount": 5},
        })
        self.assertEqual(resp.status, 200)  # default policy: permit в пределах лимита


if __name__ == "__main__":
    unittest.main()
