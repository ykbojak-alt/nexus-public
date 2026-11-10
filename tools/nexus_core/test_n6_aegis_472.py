# test_n6_aegis_472.py — #472 AEGIS-волна-2: интеграция QODER #69 fix-design.
#
# Покрывает:
#  PC-3a canonical payload hash: Decimal/non-finite/non-str-key → deny
#       PAYLOAD-CANON; -0.0==0.0, tuple==list → одинаковый хэш;
#       Decimal("1.0") vs "1.0" → РАЗНЫЕ хэши (закрыта коллизия default=str).
#  PC-3.6 терминальный approve/audit несёт payload_hash.
#  PC-1 two-person: AEGIS_ADMIN_KEYS-роли на каждом шаге цепочки;
#       нарушенный шаг не потребляет pending; reject не гейтится;
#       та же идентичность не закрывает два шага.
#  PC-3.1 list_pending: signed_by + payload_hash до исполнения.
#
# Запуск: python tools/nexus_core/test_n6_aegis_472.py  (из корня D:\nexus)

import json
import os
import sys
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tools.nexus_core.aegis import (  # noqa: E402
    AegisGuard, COND_ALWAYS, OperationProposal, Policy,
    PolicyCondition, PolicyRule, _canonical_payload_bytes,
    _json_native_violation, default_policy,
)


def _canon(payload) -> str:
    return __import__("hashlib").sha256(
        _canonical_payload_bytes(payload)).hexdigest()


def _proposal(op="core.exec", payload=None, agent="t"):
    return OperationProposal(op, agent, payload if payload is not None else {})


class CanonicalHashTest(unittest.TestCase):
    """PC-3a: канонический JSON — fail-closed, без коллизий типов."""

    def test_decimal_denied_not_stringified(self):
        """Decimal("1.0") и "1.0" давали ОДИН хэш при default=str —
        verdict/approve подменялось содержимое. Теперь: deny."""
        g = AegisGuard(policy=default_policy())
        d = g.evaluate(_proposal(payload={"amount": Decimal("1.0")}), {})
        self.assertEqual(d.outcome, "deny")
        self.assertEqual(d.rule_id, "PAYLOAD-CANON")
        self.assertIn("Decimal", d.reason)

    def test_nan_and_inf_denied(self):
        g = AegisGuard(policy=default_policy())
        for bad in (float("nan"), float("inf"), float("-inf")):
            d = g.evaluate(_proposal(payload={"x": bad}), {})
            self.assertEqual(d.outcome, "deny", bad)
            self.assertEqual(d.rule_id, "PAYLOAD-CANON")

    def test_non_str_dict_key_denied(self):
        g = AegisGuard(policy=default_policy())
        d = g.evaluate(_proposal(payload={1: "x"}), {})
        self.assertEqual(d.outcome, "deny")
        self.assertEqual(d.rule_id, "PAYLOAD-CANON")

    def test_arbitrary_object_denied(self):
        g = AegisGuard(policy=default_policy())
        d = g.evaluate(_proposal(payload={"dt": object()}), {})
        self.assertEqual(d.outcome, "deny")
        self.assertEqual(d.rule_id, "PAYLOAD-CANON")

    def test_hash_distinguishes_decimal_from_string(self):
        """Decimal нельзя сериализовать → TypeError; строка и число
        дают разные хэши (тип не коллапсирует)."""
        self.assertNotEqual(_canon({"amount": "1.0"}),
                            _canon({"amount": 1.0}))
        with self.assertRaises(TypeError):
            _canonical_payload_bytes({"amount": Decimal("1.0")})

    def test_negative_zero_equals_zero(self):
        # -0.0 нормализуется в 0.0; int 0 — другой JSON-тип, хэш другой
        self.assertEqual(_canon({"amount": -0.0}), _canon({"amount": 0.0}))
        self.assertNotEqual(_canon({"amount": -0.0}),
                            _canon({"amount": 0}))

    def test_tuple_equals_list(self):
        self.assertEqual(_canon({"a": (1, 2)}), _canon({"a": [1, 2]}))

    def test_key_order_and_whitespace_stable(self):
        a = _canon({"b": 1, "a": {"y": 2, "x": 3}})
        b = _canon({"a": {"x": 3, "y": 2}, "b": 1})
        self.assertEqual(a, b)

    def test_violation_helper_paths(self):
        self.assertIsNone(_json_native_violation({"a": [1, "x", None]}))
        self.assertIn("payload.a[1]", _json_native_violation(
            {"a": [1, Decimal("2")]}))

    def test_uncanonical_deny_is_audited_with_marker(self):
        """deny PAYLOAD-CANON пишется в audit — marker-payload, не краш."""
        with tempfile.TemporaryDirectory() as td:
            audit = os.path.join(td, "audit.jsonl")
            g = AegisGuard(policy=default_policy(), audit_path=audit)
            g.evaluate(_proposal(payload={"x": Decimal("1")}), {})
            recs = [json.loads(l) for l in open(audit, encoding="utf-8")]
            self.assertTrue(any(r.get("rule_id") == "PAYLOAD-CANON"
                                for r in recs))
            self.assertTrue(all("__payload_uncanonical__" in
                                json.dumps(r.get("payload", {}))
                                or r.get("rule_id") == "PAYLOAD-CANON"
                                for r in recs))


class _TwoPersonPolicy:
    """Политика с 2-шаговой цепочкой [devops, security] для op test.two."""

    @staticmethod
    def make() -> Policy:
        return Policy(
            version="tp",
            rules=[
                PolicyRule(
                    id="TP-1", description="two-person escalate",
                    operation="test.two",
                    condition=PolicyCondition(COND_ALWAYS),
                    outcome="escalate", priority=1,
                    escalation_chain=["devops", "security"]),
            ],
            default_outcome="deny",
        )


class TwoPersonTest(unittest.TestCase):
    """PC-1: роли на каждом шаге; нарушенный шаг не потребляет pending."""

    def _gate(self, **kw):
        return AegisGuard(policy=_TwoPersonPolicy.make(),
                          two_person_required=True, **kw)

    def _pending(self, g):
        d = g.evaluate(_proposal("test.two", {"v": 1}), {})
        self.assertEqual(d.outcome, "escalate")
        return d.approval_id

    def test_disabled_by_default_single_token_compat(self):
        """two_person_required=False → поведение #469b без изменений."""
        g = AegisGuard(policy=_TwoPersonPolicy.make())
        aid = self._pending(g)
        d1 = g.approve(aid, True, by="op", roles=[])
        self.assertEqual(d1.outcome, "escalate")  # шаг 1 пройден без ролей
        d2 = g.approve(aid, True, by="op", roles=[])
        self.assertEqual(d2.outcome, "permit")

    def test_wrong_role_keeps_pending_same_step(self):
        g = self._gate()
        aid = self._pending(g)
        d = g.approve(aid, True, by="mallory", roles=["intern"])
        self.assertEqual(d.outcome, "escalate")
        self.assertIn("two_person_role", d.reason)
        pend = g.pending_approvals()
        self.assertEqual(len(pend), 1)
        self.assertEqual(pend[0]["chain_step"], "1/2")
        self.assertEqual(pend[0]["signed_by"], [])

    def test_missing_role_same(self):
        g = self._gate()
        aid = self._pending(g)
        d = g.approve(aid, True, by="op", roles=None)
        self.assertEqual(d.outcome, "escalate")
        self.assertIn("two_person_role", d.reason)

    def test_same_identity_cannot_sign_two_steps(self):
        g = self._gate()
        aid = self._pending(g)
        # шаг 1: devops подписывает
        d1 = g.approve(aid, True, by="alice", roles=["devops"])
        self.assertEqual(d1.outcome, "escalate")
        self.assertEqual(d1.escalate_to, "security")
        # шаг 2: та же личность, но с ролью security → ОТКАЗ,
        # pending остаётся на шаге 2/2
        d2 = g.approve(aid, True, by="alice", roles=["devops", "security"])
        self.assertEqual(d2.outcome, "escalate")
        self.assertIn("two_person_identity", d2.reason)
        pend = g.pending_approvals()
        self.assertEqual(pend[0]["chain_step"], "2/2")
        self.assertEqual(pend[0]["signed_by"], ["alice"])
        # другой человек с ролью security → permit
        d3 = g.approve(aid, True, by="bob", roles=["security"])
        self.assertEqual(d3.outcome, "permit")

    def test_reject_never_gated(self):
        """Fail-safe: любой admin может reject даже без ролей."""
        g = self._gate()
        aid = self._pending(g)
        d = g.approve(aid, False, by="anyone", roles=[])
        self.assertEqual(d.outcome, "deny")
        self.assertEqual(g.pending_approvals(), [])

    def test_full_chain_records_steps_and_hash(self):
        with tempfile.TemporaryDirectory() as td:
            audit = os.path.join(td, "a.jsonl")
            g = AegisGuard(policy=_TwoPersonPolicy.make(),
                           two_person_required=True, audit_path=audit)
            aid = self._pending(g)
            g.approve(aid, True, by="alice", roles=["devops"])
            d = g.approve(aid, True, by="bob", roles=["security"])
            self.assertEqual(d.outcome, "permit")
            recs = [json.loads(l) for l in open(audit, encoding="utf-8")]
            term = [r for r in recs if r.get("outcome") == "permit"
                    and r.get("approval_id") == aid]
            self.assertEqual(len(term), 1)
            r = term[0]
            self.assertEqual(r["approved_by"], "bob")
            self.assertEqual(r["approved_roles"], ["security"])
            self.assertEqual(len(r["approved_by_steps"]), 1)
            self.assertEqual(r["approved_by_steps"][0]["by"], "alice")
            self.assertTrue(r["two_person_required"])
            self.assertTrue(r.get("payload_hash"))
            # pending больше нет
            self.assertEqual(g.pending_approvals(), [])

    def test_pending_exposes_hash_and_signers(self):
        g = self._gate()
        aid = self._pending(g)
        g.approve(aid, True, by="alice", roles=["devops"])
        p = g.pending_approvals()[0]
        self.assertEqual(p["signed_by"], ["alice"])
        self.assertEqual(len(p["payload_hash"]), 64)
        self.assertEqual(p["required_role"], "security")

    def test_chain_step_audit_has_payload_hash(self):
        """PC-3: chain-step escalate-запись тоже несёт payload_hash."""
        with tempfile.TemporaryDirectory() as td:
            audit = os.path.join(td, "a.jsonl")
            g = AegisGuard(policy=_TwoPersonPolicy.make(),
                           two_person_required=True, audit_path=audit)
            aid = self._pending(g)
            g.approve(aid, True, by="alice", roles=["devops"])
            recs = [json.loads(l) for l in open(audit, encoding="utf-8")]
            steps = [r for r in recs
                     if r.get("escalation_step") == 1
                     and r.get("approved_by") == "alice"
                     and r.get("approval_id") == aid]
            self.assertTrue(steps)
            self.assertTrue(steps[0].get("payload_hash"))


class TerminalPayloadHashTest(unittest.TestCase):
    """PC-3.6: approve()-путь для обычной (не-chain) эскалации."""

    def test_terminal_permit_carries_payload_hash(self):
        pol = Policy(
            version="t",
            rules=[PolicyRule(
                id="E-1", description="escalate", operation="test.e",
                condition=PolicyCondition(COND_ALWAYS),
                outcome="escalate", priority=1,
                escalation_chain=["human"])],
            default_outcome="deny")
        with tempfile.TemporaryDirectory() as td:
            audit = os.path.join(td, "a.jsonl")
            g = AegisGuard(policy=pol, audit_path=audit)
            d = g.evaluate(_proposal("test.e", {"amount": 5}), {})
            aid = d.approval_id
            dec = g.approve(aid, True, by="op", roles=["human"])
            self.assertEqual(dec.outcome, "permit")
            recs = [json.loads(l) for l in open(audit, encoding="utf-8")]
            term = [r for r in recs if r.get("outcome") == "permit"
                    and r.get("approval_id") == aid]
            self.assertEqual(len(term), 1)
            self.assertEqual(term[0]["payload_hash"],
                             _canon({"amount": 5}))
            self.assertIn("payload_hash", term[0])


# -----------------------------------------------------------------------------
# PC-2 route-level: template_run → core.template_mutation; wait не gated
# -----------------------------------------------------------------------------

import shutil  # noqa: E402

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop  # noqa: E402

from tools.nexus_core.api import create_app  # noqa: E402
from tools.nexus_core.mock_pty import MockPTYBackend  # noqa: E402
from tools.nexus_core.supervisor_v1 import SupervisorV1  # noqa: E402


class GateRouteApiTest(AioHTTPTestCase):
    """Живой API: каждый закрытый роут пишет gate-аудит со своим op-классом."""

    def setUp(self):
        import tempfile as _tf
        self.tmp = Path(_tf.mkdtemp(prefix="aegis472-api-"))
        self.backend = MockPTYBackend()
        self.supervisor = SupervisorV1(backend=self.backend)
        self._app = create_app(
            base=self.tmp, supervisor=self.supervisor,
            templates_dir=self.tmp / "templates")
        super().setUp()

    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return self._app

    def _gate_recs(self, op=None):
        recs = self._app["state"].gate.audit_records(limit=200)
        return [r for r in recs
                if op is None or r.get("operation_type") == op]

    @unittest_run_loop
    async def test_template_run_audited_as_template_mutation(self):
        d = self.tmp / "templates"
        d.mkdir(parents=True, exist_ok=True)
        (d / "coder.md").write_text(
            "---\ncommand: claude\n---\nBe a coder.\n", encoding="utf-8")
        resp = await self.client.post("/api/core/templates/coder/run",
                                      json={"args": [], "term": "tpl-x"})
        self.assertEqual(resp.status, 200)
        recs = self._gate_recs("core.template_mutation")
        self.assertTrue(recs, "template_run не прошёл через gate")
        self.assertEqual(recs[-1]["outcome"], "permit")
        self.assertEqual(recs[-1]["payload"]["action"], "template_run")
        # и НЕ под doc_mutation
        self.assertFalse(self._gate_recs("core.doc_mutation"))

    @unittest_run_loop
    async def test_wait_produces_no_gate_record(self):
        """PC-2: wait — чистое опрашивание (QODER OPEN), gate не зовётся."""
        resp = await self.client.post("/api/core/run", json={
            "name": "w1", "command": ["sh", "-i"]})
        self.assertEqual(resp.status, 200)
        resp = await self.client.post("/api/core/wait",
                                      json={"term": "local/w1",
                                            "timeout": 0.05})
        self.assertIn(resp.status, (200, 408))
        waits = [r for r in self._gate_recs()
                 if (r.get("payload") or {}).get("action") == "wait"]
        self.assertEqual(waits, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
