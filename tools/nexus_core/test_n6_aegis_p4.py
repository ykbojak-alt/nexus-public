#!/usr/bin/env python3
"""test_n6_aegis_p4.py — зачистка A-9/A-10 (low).

- A-9: ESCALATE→DENY downgrade по ctx.hard_limit работает для amount_limit,
  завёрнутого в compound (раньше только top-level)
- A-10: audit_records cap=MAX_AUDIT_READ; emit/rotation под lock —
  конкурентные writers не вилочат hash-цепочку
"""

import threading
import unittest

from tools.nexus_core.aegis import (
    COND_AMOUNT_LIMIT,
    COND_COMPOUND,
    MAX_AUDIT_READ,
    OperationProposal,
    PolicyCondition,
    AegisGuard,
    PolicyRule,
    Policy,
)


def prop(op, agent, payload=None, sensitive=True):
    return OperationProposal(op, agent, payload or {}, sensitive=sensitive)


def _compound_escalate_policy():
    """escalate-правило с amount_limit внутри compound-AND."""
    return Policy(
        version="t",
        rules=[PolicyRule(
            id="CX-1", description="compound escalate", operation="order",
            condition=PolicyCondition(
                COND_COMPOUND, operator="AND",
                conditions=[
                    PolicyCondition(
                        COND_AMOUNT_LIMIT,
                        payload_field="amount", max_amount=10,
                    ),
                    PolicyCondition(
                        "allowlist", payload_field="vendor", allowed=["acme"],
                    ),
                ],
            ),
            outcome="escalate", priority=10,
        )],
    )


class CompoundHardLimitTest(unittest.TestCase):
    """A-9: compound-вложенный amount_limit тоже довнгрейдится по hard_limit."""

    def test_compound_amount_over_hard_limit_denied(self):
        gate = AegisGuard(policy=_compound_escalate_policy())
        # оба условия нарушены → правило матчит → escalate…
        # но amount=30 > hard_limit=20 → downgrade deny
        d = gate.evaluate(
            prop("order", "a", {"amount": 30, "vendor": "evil"}),
            ctx={"hard_limit": 20},
        )
        self.assertEqual(d.outcome, "deny")

    def test_compound_amount_under_hard_limit_escalates(self):
        gate = AegisGuard(policy=_compound_escalate_policy())
        d = gate.evaluate(
            prop("order", "a", {"amount": 15, "vendor": "evil"}),
            ctx={"hard_limit": 20},
        )
        self.assertEqual(d.outcome, "escalate")

    def test_compound_no_hard_limit_escalates(self):
        gate = AegisGuard(policy=_compound_escalate_policy())
        d = gate.evaluate(prop("order", "a", {"amount": 30, "vendor": "evil"}))
        self.assertEqual(d.outcome, "escalate")

    def test_deep_nested_amount_limit_found(self):
        """amount_limit под двойным compound тоже находится и довнгрейдит."""
        cond = PolicyCondition(
            COND_COMPOUND, operator="AND",
            conditions=[
                PolicyCondition(
                    COND_COMPOUND, operator="OR",
                    conditions=[
                        PolicyCondition("always"),
                        PolicyCondition(
                            COND_AMOUNT_LIMIT,
                            payload_field="amount", max_amount=10,
                        ),
                    ],
                ),
                PolicyCondition("always"),
            ],
        )
        gate = AegisGuard(policy=Policy(
            version="t",
            rules=[PolicyRule(
                id="DX-1", description="deep", operation="op",
                condition=cond, outcome="escalate", priority=10,
            )],
        ))
        # AND[OR[always(нарушение), amount>10], always] → правило срабатывает
        d = gate.evaluate(
            prop("op", "a", {"amount": 30}), ctx={"hard_limit": 20}
        )
        self.assertEqual(d.rule_id, "DX-1")
        self.assertEqual(d.outcome, "deny")


class AuditHygieneTest(unittest.TestCase):
    """A-10: cap на чтение + lock на emit/ротацию."""

    def test_audit_read_cap(self):
        gate = AegisGuard()
        for i in range(MAX_AUDIT_READ + 5):
            gate.evaluate(prop("observe", "a", {"i": i}))
        recs = gate.audit_records(limit=999999)
        self.assertEqual(len(recs), MAX_AUDIT_READ)

    def test_audit_read_small_limit_untouched(self):
        gate = AegisGuard()
        for _ in range(3):
            gate.evaluate(prop("observe", "a", {}))
        self.assertEqual(len(gate.audit_records(limit=2)), 2)
        self.assertEqual(len(gate.audit_records(limit=0)), 1)

    def test_concurrent_emits_keep_chain_linear(self):
        """Два writer-потока → цепочка линейна (lock в _emit)."""
        gate = AegisGuard()
        def worker(n):
            for i in range(50):
                gate.evaluate(prop("observe", f"ag{n}", {"i": i}))
        t1 = threading.Thread(target=worker, args=(1,))
        t2 = threading.Thread(target=worker, args=(2,))
        t1.start(); t2.start(); t1.join(); t2.join()
        v = gate.audit_chain_verify()
        self.assertTrue(v["ok"])
        self.assertEqual(v["records"], 100)
        # prev_hash каждой записи = content_hash предыдущей — цепь не вилочена
        recs = gate._audit
        for i in range(1, len(recs)):
            self.assertEqual(
                recs[i]["prev_audit_hash"], recs[i - 1]["content_hash"]
            )


if __name__ == "__main__":
    unittest.main()
