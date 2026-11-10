"""AEGIS #468: W3 panic circuit-breaker + W1 verdict-attestation +
gate coverage для core mutating endpoints.

Паттерны взяты из near-aegis (watchdog panic / verdicts), адаптированы
под наш fail-closed deny-by-default gate. Детерминированно, без сети.
"""
import shutil
import tempfile
import time
import unittest
from pathlib import Path

from tools.nexus_core.aegis import (
    AegisGuard,
    COND_ALWAYS,
    OperationProposal,
    Policy,
    PolicyCondition,
    PolicyRule,
    default_policy,
)


def _permit_policy() -> Policy:
    """policy, разрешающая payout — чтобы отличать panic/veto от rules."""
    return Policy(
        version="w3",
        rules=[
            PolicyRule(
                id="P-ok", description="permit tail",
                operation="*", agent="*", outcome="permit",
                priority=1, condition=PolicyCondition(COND_ALWAYS),
            ),
        ],
        default_outcome="deny",
    )


def _gate(**kw) -> AegisGuard:
    return AegisGuard(policy=_permit_policy(), **kw)


# =============================================================================
# W3 panic circuit-breaker
# =============================================================================

class PanicTest(unittest.TestCase):
    """panic_on → все evaluate deny panic_mode; panic_off — owner+cooldown."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="nexus-aegis-w3-"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _prop(self, op="payout", agent="bot", payload=None):
        return OperationProposal(op, agent, payload or {"amount": 1})

    def test_panic_freezes_sensitive(self):
        g = _gate(panic_cooldown_s=60)
        self.assertEqual(g.evaluate(self._prop()).outcome, "permit")
        g.panic_on(by="op1")
        d = g.evaluate(self._prop())
        self.assertEqual(d.outcome, "deny")
        self.assertEqual(d.rule_id, "PANIC")
        self.assertIn("panic_mode", d.reason)

    def test_panic_freezes_observe_too(self):
        """Заморозка сильнее observe-class: даже read-only probe deny —
        оператор видит честный 'система заморожена'."""
        pol = _permit_policy()
        pol.operation_class = {"status.poll": "observe"}
        g = AegisGuard(policy=pol, panic_cooldown_s=60)
        self.assertEqual(
            g.evaluate(self._prop("status.poll")).outcome, "permit")
        g.panic_on(by="op1")
        d = g.evaluate(self._prop("status.poll"))
        self.assertEqual(d.outcome, "deny")
        self.assertEqual(d.rule_id, "PANIC")

    def test_panic_simulate_shows_real_deny(self):
        """simulate=True во время panic → deny (честный dry-run:
        'если исполнить — будет отказ'), а не permit-иллюзия."""
        g = _gate(panic_cooldown_s=60)
        g.panic_on(by="op1")
        d = g.evaluate(self._prop(), simulate=True)
        self.assertEqual(d.outcome, "deny")
        self.assertEqual(d.rule_id, "PANIC")
        self.assertEqual(g._pending, {})  # pending не создан

    def test_panic_off_cooldown_blocks_release(self):
        g = _gate(panic_cooldown_s=60, panic_owner="owner")
        g.panic_on(by="op1")
        r = g.panic_off(by="owner", now=time.time() + 10)
        self.assertFalse(r["released"])
        self.assertIn("cooldown", r["reason"])
        # gate всё ещё заморожен
        self.assertEqual(g.evaluate(self._prop()).outcome, "deny")

    def test_panic_off_owner_only(self):
        g = _gate(panic_cooldown_s=0, panic_owner="owner")
        g.panic_on(by="op1")
        r = g.panic_off(by="mallory", now=time.time() + 100)
        self.assertFalse(r["released"])
        self.assertIn("owner", r["reason"])
        self.assertTrue(g.panic_status()["active"])
        # owner после cooldown — отпускает
        r2 = g.panic_off(by="owner", now=time.time() + 100)
        self.assertTrue(r2["released"])
        self.assertEqual(g.evaluate(self._prop()).outcome, "permit")

    def test_panic_off_before_cooldown_then_after(self):
        g = _gate(panic_cooldown_s=30, panic_owner="owner")
        g.panic_on(by="op1")
        started = g.panic_status()["started_at"]
        r_early = g.panic_off(by="owner", now=started + 5)
        self.assertFalse(r_early["released"])
        r_late = g.panic_off(by="owner", now=started + 31)
        self.assertTrue(r_late["released"])

    def test_panic_idempotent_first_started_at_wins(self):
        g = _gate(panic_cooldown_s=60)
        g.panic_on(by="first")
        t1 = g.panic_status()["started_at"]
        time.sleep(0.01)
        g.panic_on(by="second")  # повтор — не сдвигает окно cooldown
        self.assertEqual(g.panic_status()["started_at"], t1)
        self.assertEqual(g.panic_status()["by"], "first")

    def test_panic_persists_across_restart(self):
        """panic в aegis-windows.json: новый guard на том же state_path
        видит заморозку — рестарт не снимает emergency-stop."""
        sp = str(self.tmp / "windows.json")
        g1 = _gate(state_path=sp, panic_cooldown_s=60)
        g1.panic_on(by="op1")
        g1._maybe_save_windows(force=True)
        g2 = _gate(state_path=sp, panic_cooldown_s=60)
        self.assertTrue(g2.panic_status()["active"])
        self.assertEqual(
            g2.evaluate(self._prop()).outcome, "deny")

    def test_panic_audit_trail(self):
        """on + off_denied + off — три записи в аудите (forensics)."""
        ap = str(self.tmp / "audit.jsonl")
        g = _gate(audit_path=ap, panic_cooldown_s=0, panic_owner="owner")
        g.panic_on(by="op1")
        g.panic_off(by="mallory", now=time.time() + 1)
        g.panic_off(by="owner", now=time.time() + 1)
        acts = [r.get("action") for r in g.audit_records()
                if r.get("type") == "panic"]
        self.assertEqual(acts, ["on", "off_denied", "off"])


# =============================================================================
# W1 verdict-attestation
# =============================================================================

class VerdictTest(unittest.TestCase):
    """attested_operations требует verdict по payload_hash;
    no-verdict → deny (fail-closed); verdict deny/risk → veto."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="nexus-aegis-w1-"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _attested_gate(self, ops=("payout",), reviewers=("rev1",), **kw):
        return _gate(reviewers=reviewers,
                     attested_operations=ops, **kw)

    def _hash(self, payload):
        return AegisGuard._payload_hash(payload)

    def test_no_verdict_denies_fail_closed(self):
        g = self._attested_gate()
        d = g.evaluate(OperationProposal("payout", "bot", {"amount": 5}))
        self.assertEqual(d.outcome, "deny")
        self.assertEqual(d.rule_id, "VERDICT")
        self.assertIn("no_verdict", d.reason)

    def test_unattested_op_unaffected(self):
        """op вне attested_operations работает как раньше — verdict не нужен."""
        g = self._attested_gate(ops=("payout",))
        d = g.evaluate(OperationProposal("exec", "bot", {}))
        self.assertEqual(d.outcome, "permit")  # permit-tail rule

    def test_verdict_permit_allows_rules_decide(self):
        g = self._attested_gate()
        payload = {"amount": 5}
        h = self._hash(payload)
        rec = g.submit_verdict(h, "permit", by="rev1")
        self.assertIsNotNone(rec)
        d = g.evaluate(OperationProposal("payout", "bot", payload))
        self.assertEqual(d.outcome, "permit")

    def test_verdict_deny_vetoes_permit_rule(self):
        """verdict deny сильнее permit-правила — veto до rules-цикла."""
        g = self._attested_gate()
        payload = {"amount": 5}
        g.submit_verdict(self._hash(payload), "deny", by="rev1",
                         note="phishing pattern")
        d = g.evaluate(OperationProposal("payout", "bot", payload))
        self.assertEqual(d.outcome, "deny")
        self.assertEqual(d.rule_id, "VERDICT")
        self.assertIn("verdict_deny", d.reason)

    def test_verdict_hash_keyed_not_payload_fuzzy(self):
        """verdict по hash(A) не покрывает payload B — привязка точная."""
        g = self._attested_gate()
        g.submit_verdict(self._hash({"amount": 5}), "permit", by="rev1")
        d = g.evaluate(OperationProposal("payout", "bot", {"amount": 6}))
        self.assertEqual(d.outcome, "deny")
        self.assertIn("no_verdict", d.reason)

    def test_non_reviewer_cannot_submit(self):
        g = self._attested_gate(reviewers=("rev1",))
        self.assertIsNone(
            g.submit_verdict("a" * 64, "permit", by="mallory"))
        self.assertEqual(g.list_verdicts(), [])

    def test_invalid_verdict_inputs_rejected(self):
        g = self._attested_gate()
        self.assertIsNone(g.submit_verdict("a" * 64, "maybe", by="rev1"))
        self.assertIsNone(g.submit_verdict("short", "permit", by="rev1"))
        self.assertIsNone(
            g.submit_verdict("a" * 64, "permit", by="rev1", risk=1.5))
        self.assertIsNone(
            g.submit_verdict("a" * 64, "permit", by="rev1",
                             risk=float("nan")))

    def test_risk_threshold_denies(self):
        g = self._attested_gate(verdict_deny_risk=0.5)
        payload = {"amount": 5}
        g.submit_verdict(self._hash(payload), "permit", by="rev1",
                         risk=0.9)
        d = g.evaluate(OperationProposal("payout", "bot", payload))
        self.assertEqual(d.outcome, "deny")
        self.assertIn("verdict_risk", d.reason)
        # risk ниже порога — пропускает к правилам
        payload2 = {"amount": 6}
        g.submit_verdict(self._hash(payload2), "permit", by="rev1",
                         risk=0.2)
        self.assertEqual(
            g.evaluate(OperationProposal("payout", "bot", payload2))
            .outcome, "permit")

    def test_wildcard_attested_ops(self):
        g = self._attested_gate(ops=("*",))
        d = g.evaluate(OperationProposal("exec", "bot", {}))
        self.assertEqual(d.outcome, "deny")
        self.assertIn("no_verdict", d.reason)

    def test_verdict_persists_across_restart(self):
        sp = str(self.tmp / "windows.json")
        g1 = self._attested_gate(state_path=sp)
        payload = {"amount": 5}
        g1.submit_verdict(self._hash(payload), "permit", by="rev1")
        g1._maybe_save_windows(force=True)
        g2 = self._attested_gate(state_path=sp)
        self.assertIsNotNone(g2.get_verdict(self._hash(payload)))
        self.assertEqual(
            g2.evaluate(OperationProposal("payout", "bot", payload))
            .outcome, "permit")

    def test_verdict_store_cap_fail_closed(self):
        """MAX_VERDICTS переполнение → новые verdicts не принимаются,
        attested ops остаются no_verdict deny (не open!)."""
        g = self._attested_gate()
        g._verdicts = {f"{i:064x}": {"verdict": "permit"}
                       for i in range(10000)}
        self.assertIsNone(
            g.submit_verdict("f" * 64, "permit", by="rev1"))
        # и evaluate всё ещё deny — attestation не подменяется
        d = g.evaluate(OperationProposal("payout", "bot", {"a": 1}))
        self.assertEqual(d.outcome, "deny")


# =============================================================================
# Gate coverage: mutating core endpoints теперь проходят gate
# =============================================================================

class GateCoverageTest(unittest.TestCase):
    """#68 находка: mutating хендлеры не звали gate. Теперь
    core.machine_mutation / aegis.policy_update / aegis.ratings_score
    имеют permit-правила в default_policy и реальный gate-вызов."""

    def _eval(self, op, payload=None, agent="core-api"):
        return default_policy() and AegisGuard(
            policy=default_policy()).evaluate(
            OperationProposal(op, agent, payload or {}), {})

    _GATED_OPS = ("core.machine_mutation", "aegis.policy_update",
                  "aegis.ratings_score", "core.exec",
                  # #469b: остаток mutating-поверхности
                  "core.terminal_mutation", "core.file_mutation",
                  "core.doc_mutation",
                  # #472: template-run вынесен в свой op-класс
                  "core.template_mutation")

    def test_gated_ops_permit_under_default_policy(self):
        for op in self._GATED_OPS:
            d = self._eval(op)
            self.assertEqual(d.outcome, "permit", op)
            self.assertIsNotNone(d.audit_id if hasattr(d, "audit_id")
                                 else True)

    def test_gated_ops_still_deny_under_restrictive_policy(self):
        """policy без permit-правил → deny-by-default работает и для
        новых op-типов — gate реальный, не декоративный."""
        pol = Policy(version="strict", rules=[], default_outcome="deny")
        g = AegisGuard(policy=pol)
        for op in self._GATED_OPS:
            d = g.evaluate(OperationProposal(op, "core-api", {}), {})
            self.assertEqual(d.outcome, "deny", op)

    def test_panic_freezes_gated_core_ops(self):
        """end-to-end смысл: panic_on блокирует и machine_mutation —
        именно то, ради чего breaker ставили."""
        g = AegisGuard(policy=default_policy(), panic_cooldown_s=0)
        g.panic_on(by="op1")
        for op in self._GATED_OPS:
            d = g.evaluate(OperationProposal(op, "core-api", {}), {})
            self.assertEqual(d.outcome, "deny", op)
            self.assertEqual(d.rule_id, "PANIC")


# =============================================================================
# W2 guardian M-of-N (#469b)
# =============================================================================

def _escalate_policy() -> Policy:
    return Policy(
        version="w2",
        rules=[
            PolicyRule(
                id="E-sc", description="escalate payout",
                operation="payout", agent="*", outcome="escalate",
                priority=10,
                condition=PolicyCondition(COND_ALWAYS),
            ),
        ],
        default_outcome="deny",
    )


def _pending_gate(**kw) -> tuple:
    """gate с escalate-policy + guardians; возвращает (gate, approval_id)."""
    g = AegisGuard(policy=_escalate_policy(), **kw)
    d = g.evaluate(OperationProposal("payout", "bot", {"amount": 1}))
    assert d.outcome == "escalate" and d.approval_id
    return g, d.approval_id


class GuardianTest(unittest.TestCase):
    """M-of-N параллельные голоса: threshold approve → release через
    approve(); один deny → reject; dedup/expiry/not-configured fail-closed."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="nexus-aegis-w2-"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_not_configured_rejects(self):
        g, aid = _pending_gate()
        r = g.guardian_vote(aid, by="g1", decision="approve")
        self.assertFalse(r["ok"])
        self.assertIn("not configured", r["reason"])

    def test_non_guardian_rejected(self):
        g, aid = _pending_gate(guardians=("g1", "g2"), guardian_threshold=1)
        r = g.guardian_vote(aid, by="mallory", decision="approve")
        self.assertFalse(r["ok"])
        self.assertIn("not a configured guardian", r["reason"])

    def test_threshold_1_single_vote_releases(self):
        g, aid = _pending_gate(guardians=("g1", "g2"), guardian_threshold=1)
        r = g.guardian_vote(aid, by="g1", decision="approve")
        self.assertTrue(r["released"])
        self.assertEqual(r["outcome"], "permit")
        self.assertNotIn(aid, g._pending)

    def test_m_of_n_collects_then_releases(self):
        g, aid = _pending_gate(
            guardians=("g1", "g2", "g3"), guardian_threshold=2)
        r1 = g.guardian_vote(aid, by="g1", decision="approve")
        self.assertTrue(r1["ok"])
        self.assertFalse(r1["released"])
        self.assertEqual(r1["approve_count"], 1)
        # pending жив — ещё не решено
        self.assertIn(aid, g._pending)
        r2 = g.guardian_vote(aid, by="g2", decision="approve")
        self.assertTrue(r2["released"])
        self.assertEqual(r2["outcome"], "permit")
        self.assertEqual(sorted(r2["voters"]), ["g1", "g2"])

    def test_single_deny_rejects_immediately(self):
        g, aid = _pending_gate(
            guardians=("g1", "g2", "g3"), guardian_threshold=3)
        g.guardian_vote(aid, by="g1", decision="approve")
        g.guardian_vote(aid, by="g2", decision="approve")
        r = g.guardian_vote(aid, by="g3", decision="deny",
                            note="looks like drain")
        self.assertTrue(r["released"])
        self.assertFalse(r["approved"])
        self.assertEqual(r["outcome"], "deny")
        self.assertNotIn(aid, g._pending)

    def test_dedup_same_guardian(self):
        g, aid = _pending_gate(
            guardians=("g1", "g2"), guardian_threshold=2)
        g.guardian_vote(aid, by="g1", decision="approve")
        r = g.guardian_vote(aid, by="g1", decision="approve")
        self.assertFalse(r["ok"])
        self.assertIn("already voted", r["reason"])

    def test_vote_unknown_or_expired(self):
        g, aid = _pending_gate(guardians=("g1",), guardian_threshold=1)
        r = g.guardian_vote("deadbeef" * 8, by="g1", decision="approve")
        self.assertFalse(r["ok"])
        self.assertIn("unknown", r["reason"])
        # expired pending → vote rejected
        g2, aid2 = _pending_gate(guardians=("g1",), guardian_threshold=1)
        g2._pending[aid2]["expires_at"] = time.time() - 1
        r2 = g2.guardian_vote(aid2, by="g1", decision="approve")
        self.assertFalse(r2["ok"])
        self.assertIn("expired", r2["reason"])

    def test_threshold_validation(self):
        with self.assertRaises(ValueError):
            AegisGuard(policy=_escalate_policy(),
                       guardians=("g1", "g2"), guardian_threshold=3)
        with self.assertRaises(ValueError):
            AegisGuard(policy=_escalate_policy(),
                       guardians=("g1",), guardian_threshold=0)
        # пустые guardians — threshold игнорируется, фича off
        g = AegisGuard(policy=_escalate_policy(), guardian_threshold=5)
        self.assertFalse(g._guardians)

    def test_default_threshold_is_unanimous(self):
        g, aid = _pending_gate(guardians=("g1", "g2", "g3"))
        self.assertEqual(g.guardian_threshold, 3)
        g.guardian_vote(aid, by="g1", decision="approve")
        g.guardian_vote(aid, by="g2", decision="approve")
        r = g.guardian_vote(aid, by="g3", decision="approve")
        self.assertTrue(r["released"])

    def test_votes_persist_across_restart(self):
        sp = str(self.tmp / "windows.json")
        g1, aid = _pending_gate(
            guardians=("g1", "g2"), guardian_threshold=2, state_path=sp)
        g1.guardian_vote(aid, by="g1", decision="approve")
        g1._maybe_save_windows(force=True)
        # новый guard на том же state: pending НЕ персистится (in-memory),
        # но голоса загружены — голос g2 не найдёт pending → unknown.
        # Это честная семантика: restart теряет pending (как и раньше),
        # голоса не воскрешают мёртвую заявку.
        g2 = AegisGuard(policy=_escalate_policy(),
                        guardians=("g1", "g2"), guardian_threshold=2,
                        state_path=sp)
        st = g2.guardian_status(aid)
        self.assertIn("g1", st["votes"])
        r = g2.guardian_vote(aid, by="g2", decision="approve")
        self.assertFalse(r["ok"])
        self.assertIn("unknown", r["reason"])

    def test_guardian_audit_trail(self):
        ap = str(self.tmp / "audit.jsonl")
        g, aid = _pending_gate(
            guardians=("g1", "g2"), guardian_threshold=2, audit_path=ap)
        g.guardian_vote(aid, by="g1", decision="approve")
        g.guardian_vote(aid, by="g2", decision="approve")
        acts = [r.get("type") for r in g.audit_records()
                if r.get("type") == "guardian"]
        self.assertEqual(len(acts), 2)


if __name__ == "__main__":
    unittest.main()
