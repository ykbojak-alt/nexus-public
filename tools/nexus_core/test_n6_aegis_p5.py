"""AEGIS Phase-5 (#391): simulate/dry-run, one-shot consume, approval_ttl,
agent attestation, concurrency hardening — threat-model regression suite."""

import json
import os
import shutil
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import mock

try:
    from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
    from tools.nexus_core.api import create_app
    from tools.nexus_core.mock_pty import MockPTYBackend
    from tools.nexus_core.supervisor_v1 import SupervisorV1
    _HAS_AIOHTTP = True
except ImportError:  # store-only окружение (без aiohttp)
    _HAS_AIOHTTP = False

    class AioHTTPTestCase:  # type: ignore[no-redef]
        pass

    def unittest_run_loop(fn):  # type: ignore[no-redef]
        return fn

from tools.nexus_core.aegis import (
    COND_ALWAYS,
    COND_AMOUNT_WINDOW,
    COND_RATE_LIMIT,
    AegisGuard,
    OperationProposal,
    Policy,
    PolicyCondition,
    PolicyRule,
)


def _escalate_policy() -> Policy:
    # condition=violation-predicate; always → правило матчит любой payout
    return Policy(
        version="p5",
        rules=[
            PolicyRule(
                id="E-1", description="any payout → human",
                operation="payout", agent="*", outcome="escalate",
                priority=10,
                condition=PolicyCondition(COND_ALWAYS),
            ),
        ],
        default_outcome="deny",
    )


def _rate_policy(max_count: int = 2) -> Policy:
    # deny-правило срабатывает на rate-violation; хвост — permit
    return Policy(
        version="p5-rate",
        rules=[
            PolicyRule(
                id="R-deny", description="rate exceeded",
                operation="exec", agent="*", outcome="deny",
                priority=10,
                condition=PolicyCondition(
                    COND_RATE_LIMIT, window_s=60.0,
                    max_count=max_count, rate_scope="agent"),
            ),
            PolicyRule(
                id="R-ok", description="tail permit",
                operation="exec", agent="*", outcome="permit",
                priority=1,
                condition=PolicyCondition(COND_ALWAYS),
            ),
        ],
        default_outcome="deny",
    )


class SimulateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="nexus-aegis-p5-"))
        self.gate = AegisGuard(policy=_escalate_policy(),
                               audit_path=str(self.tmp / "a.jsonl"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_simulate_escalate_no_pending(self):
        d = self.gate.evaluate(
            OperationProposal("payout", "treasury", {"amount": 30000}),
            simulate=True,
        )
        self.assertEqual(d.outcome, "escalate")
        self.assertIsNone(d.approval_id)          # ничего не создано
        self.assertEqual(self.gate._pending, {})  # pending пуст
        # аудит помечен simulate — пробинг виден в цепочке
        recs = self.gate.audit_records()
        self.assertEqual(recs[-1]["type"], "simulate")

    def test_simulate_does_not_consume_rate_window(self):
        gate = AegisGuard(policy=_rate_policy(max_count=2))
        prop = lambda: OperationProposal("exec", "bot", {})
        # 5 симуляций — окно не расходуется
        for _ in range(5):
            self.assertEqual(
                gate.evaluate(prop(), simulate=True).outcome, "permit")
        # реальные evaluate: 2 permit, 3-я уже deny (счётчик цел)
        outcomes = [gate.evaluate(prop()).outcome for _ in range(3)]
        self.assertEqual(outcomes, ["permit", "permit", "deny"])

    def test_real_escalate_still_creates_pending(self):
        d = self.gate.evaluate(
            OperationProposal("payout", "treasury", {"amount": 30000}))
        self.assertEqual(d.outcome, "escalate")
        self.assertIsNotNone(d.approval_id)
        self.assertIn(d.approval_id, self.gate._pending)


def _amount_window_policy(cap: float = 1000.0, scope: str = "agent:operation",
                          window_s: float = 3600.0) -> Policy:
    # deny-правило на кумулятивное превышение; хвост — permit
    return Policy(
        version="p5-aw",
        rules=[
            PolicyRule(
                id="AW-deny", description="cumulative amount exceeded",
                operation="hivebid.release", agent="*", outcome="deny",
                priority=10,
                condition=PolicyCondition(
                    COND_AMOUNT_WINDOW, payload_field="amount_near",
                    max_amount=cap, window_s=window_s, rate_scope=scope),
            ),
            PolicyRule(
                id="AW-ok", description="tail permit",
                operation="hivebid.release", agent="*", outcome="permit",
                priority=1,
                condition=PolicyCondition(COND_ALWAYS),
            ),
        ],
        default_outcome="deny",
    )


class AmountWindowTest(unittest.TestCase):
    """HERETIC G-2: split-amount bypass — N ops ≤ per-op cap в сумме
    пробивают кумулятивный лимит за окно."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="nexus-aegis-aw-"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _rel(self, agent="auctioneer", amount=400.0):
        return OperationProposal(
            "hivebid.release", agent,
            {"lot_id": "L", "amount_near": amount})

    def test_split_amount_eventually_denied(self):
        gate = AegisGuard(policy=_amount_window_policy(cap=1000.0))
        # 3 × 400 = 1200 > 1000 — per-op потолка нет, кумулятив ловит
        outs = [gate.evaluate(self._rel()).outcome for _ in range(3)]
        self.assertEqual(outs, ["permit", "permit", "deny"])

    def test_under_cap_all_permit(self):
        gate = AegisGuard(policy=_amount_window_policy(cap=1000.0))
        outs = [gate.evaluate(self._rel(amount=300.0)).outcome
                for _ in range(3)]
        self.assertEqual(outs, ["permit"] * 3)  # 900 ≤ 1000

    def test_window_expiry_resets_sum(self):
        gate = AegisGuard(policy=_amount_window_policy(
            cap=1000.0, window_s=0.05))
        self.assertEqual(gate.evaluate(self._rel(amount=900)).outcome,
                         "permit")
        time.sleep(0.08)
        self.assertEqual(gate.evaluate(self._rel(amount=900)).outcome,
                         "permit")  # старое окно истекло — сумма обнулилась

    def test_scope_isolation_per_agent(self):
        gate = AegisGuard(policy=_amount_window_policy(
            cap=1000.0, scope="agent"))
        self.assertEqual(gate.evaluate(self._rel("a1", 900)).outcome,
                         "permit")
        # другой агент — свой счётчик, не пробит
        self.assertEqual(gate.evaluate(self._rel("a2", 900)).outcome,
                         "permit")
        # тот же a1 ещё 200 → 1100 > 1000 → deny
        self.assertEqual(gate.evaluate(self._rel("a1", 200)).outcome,
                         "deny")

    def test_scope_operation_shared_across_agents(self):
        gate = AegisGuard(policy=_amount_window_policy(
            cap=1000.0, scope="operation"))
        self.assertEqual(gate.evaluate(self._rel("a1", 600)).outcome,
                         "permit")
        # agent:operationscope=operation → сумма по типу операции
        self.assertEqual(gate.evaluate(self._rel("a2", 600)).outcome,
                         "deny")  # 1200 > 1000 суммарно по операции

    def test_simulate_does_not_consume(self):
        gate = AegisGuard(policy=_amount_window_policy(cap=1000.0))
        for _ in range(5):
            self.assertEqual(
                gate.evaluate(self._rel(amount=900), simulate=True).outcome,
                "permit")
        # реальные: 900+900=1800 → вторая уже deny
        self.assertEqual(gate.evaluate(self._rel(amount=900)).outcome,
                         "permit")
        self.assertEqual(gate.evaluate(self._rel(amount=900)).outcome,
                         "deny")

    def test_missing_or_bad_field_fails_closed(self):
        gate = AegisGuard(policy=_amount_window_policy(cap=1000.0))
        for payload in ({}, {"amount_near": "abc"}, {"amount_near": -5},
                        {"amount_near": float("nan")}):
            d = gate.evaluate(OperationProposal(
                "hivebid.release", "auctioneer", payload))
            self.assertEqual(d.outcome, "deny", payload)

    def test_validation_requires_finite_cap(self):
        for bad in (None, float("inf"), -1):
            with self.assertRaises(ValueError):
                AegisGuard(policy=Policy(
                    version="bad",
                    rules=[PolicyRule(
                        id="X", description="x", operation="op",
                        outcome="deny", priority=1,
                        condition=PolicyCondition(
                            COND_AMOUNT_WINDOW, payload_field="amount",
                            max_amount=bad, window_s=60,
                            rate_scope="agent"))],
                    default_outcome="deny"))
        # неизвестный scope тоже отклоняется
        with self.assertRaises(ValueError):
            AegisGuard(policy=Policy(
                version="bad2",
                rules=[PolicyRule(
                    id="X", description="x", operation="op",
                    outcome="deny", priority=1,
                    condition=PolicyCondition(
                        COND_AMOUNT_WINDOW, payload_field="amount",
                        max_amount=1.0, window_s=60,
                        rate_scope="bogus"))],
                default_outcome="deny"))

    def test_amount_window_inside_compound(self):
        pol = Policy(
            version="aw-c",
            rules=[
                PolicyRule(
                    id="C-deny", description="compound breach",
                    operation="op", agent="*", outcome="deny",
                    priority=10,
                    condition=PolicyCondition(
                        "compound", operator="AND",
                        conditions=[
                            PolicyCondition(COND_ALWAYS),
                            PolicyCondition(
                                COND_AMOUNT_WINDOW,
                                payload_field="amount",
                                max_amount=100.0, window_s=60,
                                rate_scope="agent"),
                        ]),
                ),
                PolicyRule(
                    id="C-ok", description="tail", operation="op",
                    agent="*", outcome="permit", priority=1,
                    condition=PolicyCondition(COND_ALWAYS)),
            ],
            default_outcome="deny")
        gate = AegisGuard(policy=pol)
        p = lambda a: OperationProposal("op", "bot", {"amount": a})
        self.assertEqual(gate.evaluate(p(60)).outcome, "permit")
        self.assertEqual(gate.evaluate(p(60)).outcome, "deny")  # 120>100


class WindowPersistenceTest(unittest.TestCase):
    """HERETIC #399 A-1: rate/amount окна in-memory → рестарт обнулял
    кумулятивные потолки (холодный обход). state_path → atomic persist."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="nexus-aegis-wp-"))
        self.state = self.tmp / "aegis-windows.json"

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _gate(self, policy):
        return AegisGuard(policy=policy, state_path=str(self.state))

    def _rel(self, agent="auctioneer", amount=400.0):
        return OperationProposal(
            "hivebid.release", agent,
            {"lot_id": "L", "amount_near": amount})

    def test_amount_window_survives_restart(self):
        g1 = self._gate(_amount_window_policy(cap=1000.0))
        g1.evaluate(self._rel(amount=900))
        g1._maybe_save_windows(force=True)
        # «рестарт»: новый guard, тот же state_path
        g2 = self._gate(_amount_window_policy(cap=1000.0))
        # 900 уже в окне → ещё 200 пробивает 1100 → deny
        self.assertEqual(g2.evaluate(self._rel(amount=200)).outcome,
                         "deny")

    def test_rate_limit_survives_restart(self):
        pol = _rate_policy(max_count=2)
        g1 = self._gate(pol)
        p = OperationProposal("exec", "bot", {})
        g1.evaluate(p); g1.evaluate(p)
        g1._maybe_save_windows(force=True)
        g2 = self._gate(pol)
        # 2 события в окне → третий deny даже после «рестарта»
        self.assertEqual(g2.evaluate(p).outcome, "deny")

    def test_expired_entries_filtered_on_load(self):
        # подсовываем протухшую запись напрямую в файл
        old = time.time() - 7200  # window_s=3600 → вне горизонта
        self.state.write_text(json.dumps({
            "rate": {"bot": [old]},
            "amount": {"auctioneer:hivebid.release": [[old, 900.0]]},
        }), encoding="utf-8")
        g = self._gate(_amount_window_policy(cap=1000.0))
        self.assertEqual(g._amount_windows, {})
        self.assertEqual(g._rate_events, {})

    def test_malformed_state_file_starts_empty(self):
        for junk in ("{not json", "[1,2]", '{"rate": "x", "amount": 5}',
                     '{"rate": {"k": ["bad", null]}, "amount": {}}'):
            self.state.write_text(junk, encoding="utf-8")
            g = self._gate(_amount_window_policy(cap=1000.0))
            self.assertEqual(g._rate_events, {})
            self.assertEqual(g._amount_windows, {})

    def test_scope_keys_persisted(self):
        g1 = self._gate(_amount_window_policy(
            cap=1000.0, scope="agent"))
        g1.evaluate(self._rel("a1", 900))
        g1._maybe_save_windows(force=True)
        g2 = self._gate(_amount_window_policy(
            cap=1000.0, scope="agent"))
        self.assertIn("a1", g2._amount_windows)


class WindowsCorruptTest(unittest.TestCase):
    """HERETIC #410: corrupt aegis-windows.json → fail-closed.

    Раньше `except Exception: return` молча обнулял окна → кумулятивные
    потолки обходились битым файлом + рестартом. Теперь: quarantine
    .corrupt + _windows_untrusted → window-условия = violation до
    ручного reset; persist пропускается (evidence не затираем)."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="nexus-aegis-wc-"))
        self.state = self.tmp / "aegis-windows.json"

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _gate(self, policy=None):
        return AegisGuard(
            policy=policy or _amount_window_policy(cap=1000.0),
            state_path=str(self.state))

    def _rel(self, agent="auctioneer", amount=400.0):
        return OperationProposal(
            "hivebid.release", agent,
            {"lot_id": "L", "amount_near": amount})

    def test_corrupt_json_untrusted_and_fails_closed(self):
        self.state.write_text("{not json", encoding="utf-8")
        g = self._gate()
        self.assertTrue(g._windows_untrusted)
        self.assertTrue((self.tmp / "aegis-windows.json.corrupt").exists())
        # window-условие → violation → deny-правило срабатывает
        self.assertEqual(g.evaluate(self._rel()).outcome, "deny")
        # и rate_limit тоже
        g2 = self._gate(_rate_policy(max_count=2))
        p = OperationProposal("exec", "bot", {})
        self.assertEqual(g2.evaluate(p).outcome, "deny")

    def test_non_dict_json_untrusted(self):
        for junk in ("[1,2]", '"str"', "42"):
            self.state.write_text(junk, encoding="utf-8")
            g = self._gate()
            self.assertTrue(g._windows_untrusted, junk)

    def test_valid_state_loads_trusted(self):
        self.state.write_text(json.dumps({
            "rate": {}, "amount": {}}), encoding="utf-8")
        g = self._gate()
        self.assertFalse(g._windows_untrusted)

    def test_stale_tmp_cleaned_on_init(self):
        tmp = self.state.with_suffix(".tmp")
        tmp.write_text("{partial", encoding="utf-8")
        g = self._gate()
        self.assertFalse(tmp.exists())
        self.assertFalse(g._windows_untrusted)  # state файла нет → чисто

    def test_untrusted_skips_persist_preserves_evidence(self):
        self.state.write_text("{not json", encoding="utf-8")
        g = self._gate()
        g._maybe_save_windows(force=True)
        # corrupt-оригинал не перезаписан «чистым» state
        self.assertEqual(self.state.read_text(encoding="utf-8"),
                         "{not json")

    def test_manual_reset_restores_trust(self):
        self.state.write_text("{not json", encoding="utf-8")
        g1 = self._gate()
        self.assertTrue(g1._windows_untrusted)
        # operator reset: заменяем файл валидным state
        self.state.write_text(json.dumps({"rate": {}, "amount": {}}),
                              encoding="utf-8")
        g2 = self._gate()
        self.assertFalse(g2._windows_untrusted)
        self.assertEqual(g2.evaluate(self._rel()).outcome, "permit")

    def test_unreadable_state_untrusted(self):
        # state_path — каталог → read_text падает → untrusted
        self.state.mkdir()
        g = self._gate()
        self.assertTrue(g._windows_untrusted)

    def test_save_oserror_warns_and_redirties(self):
        g = self._gate()
        g.evaluate(self._rel())  # consume → dirty
        with mock.patch("os.replace",
                        side_effect=OSError("disk full")):
            with self.assertLogs("tools.nexus_core.aegis",
                                 level="WARNING") as cm:
                g._maybe_save_windows(force=True)
        self.assertTrue(any("persist failed" in m for m in cm.output))
        self.assertTrue(g._windows_dirty)  # re-dirty → retry на след. evaluate

    def test_state_lock_contention_warns(self):
        # второй guard на тот же state_path → advisory warning
        g1 = self._gate()
        with self.assertLogs("tools.nexus_core.aegis",
                             level="WARNING") as cm:
            g2 = self._gate()
        self.assertTrue(any("state lock" in m for m in cm.output))
        self.assertIsNone(g2._state_lock_fd)
        self.assertIsNotNone(g1._state_lock_fd)


class OneShotConsumeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="nexus-aegis-p5c-"))
        self.gate = AegisGuard(policy=_escalate_policy(),
                               audit_path=str(self.tmp / "a.jsonl"))
        d = self.gate.evaluate(
            OperationProposal("payout", "treasury", {"amount": 30000}))
        self.approval_id = d.approval_id

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_replay_second_approve_is_none(self):
        first = self.gate.approve(self.approval_id, True, by="op")
        self.assertIsNotNone(first)
        self.assertEqual(first.outcome, "permit")
        # replay: approval потреблён — второй approve не существует
        self.assertIsNone(self.gate.approve(self.approval_id, True, by="op"))

    def test_forged_approval_id(self):
        self.assertIsNone(self.gate.approve("deadbeef" * 4, True))
        self.assertIsNone(self.gate.approve("", True))

    def test_concurrent_approve_single_winner(self):
        results = []
        with ThreadPoolExecutor(max_workers=8) as ex:
            futs = [ex.submit(self.gate.approve, self.approval_id, True,
                              f"op{i}") for i in range(8)]
            results = [f.result() for f in futs]
        wins = [r for r in results if r is not None]
        self.assertEqual(len(wins), 1)               # ровно один permit
        self.assertEqual(wins[0].outcome, "permit")
        # и permit выдан ровно одному by
        permits = [r for r in self.gate.audit_records()
                   if r.get("outcome") == "permit"]
        self.assertEqual(len(permits), 1)

    def test_concurrent_rate_limit_no_overflow(self):
        gate = AegisGuard(policy=_rate_policy(max_count=5))
        prop = lambda: OperationProposal("exec", "bot", {})
        with ThreadPoolExecutor(max_workers=12) as ex:
            outs = list(ex.map(lambda _: gate.evaluate(prop()).outcome,
                               range(20)))
        self.assertLessEqual(outs.count("permit"), 5)
        self.assertGreaterEqual(outs.count("deny"), 15)


class ApprovalTtlTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="nexus-aegis-p5t-"))
        self.gate = AegisGuard(policy=_escalate_policy(),
                               audit_path=str(self.tmp / "a.jsonl"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_custom_ttl(self):
        d = self.gate.evaluate(
            OperationProposal("payout", "t", {"amount": 1}),
            approval_ttl=30.0)
        pend = self.gate._pending[d.approval_id]
        self.assertAlmostEqual(
            pend["expires_at"] - pend["requested_at"], 30.0, places=3)

    def test_ttl_clamped_to_max(self):
        d = self.gate.evaluate(
            OperationProposal("payout", "t", {"amount": 1}),
            approval_ttl=10 ** 9)
        pend = self.gate._pending[d.approval_id]
        self.assertLessEqual(
            pend["expires_at"] - pend["requested_at"], 86400.0 + 1)

    def test_short_ttl_expires(self):
        d = self.gate.evaluate(
            OperationProposal("payout", "t", {"amount": 1}),
            approval_ttl=0.05)
        time.sleep(0.08)
        res = self.gate.approve(d.approval_id, True)
        self.assertEqual(res.outcome, "deny")
        self.assertIn("expired", res.reason)


@unittest.skipUnless(_HAS_AIOHTTP, "aiohttp not installed")
class AgentAttestationApiTest(AioHTTPTestCase):
    """AEGIS_AGENT_KEYS: proposals требуют X-Agent-Key под заявленного agent."""

    KEYS = {"spark": "k-spark", "forge": "k-forge"}

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="nexus-aegis-p5a-"))
        self.supervisor = SupervisorV1(backend=MockPTYBackend())
        os.environ.pop("AEGIS_AGENT_KEYS", None)
        os.environ.pop("AEGIS_ADMIN_TOKEN", None)
        # дефолт open для non-auth тестов; attestation-тесты снимают явно
        os.environ["AEGIS_ALLOW_UNATTESTED"] = "1"
        super().setUp()

    def tearDown(self):
        os.environ.pop("AEGIS_AGENT_KEYS", None)
        os.environ.pop("AEGIS_ADMIN_TOKEN", None)
        os.environ.pop("AEGIS_ALLOW_UNATTESTED", None)
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.tmp, supervisor=self.supervisor)

    def _proposal(self, agent="spark", key=None, **extra):
        body = {"operation_type": "observe", "agent": agent,
                "payload": {}}
        body.update(extra)
        headers = {}
        if key is not None:
            headers["X-Agent-Key"] = key
        return self.client.post("/api/core/proposals", json=body,
                                headers=headers)

    @unittest_run_loop
    async def test_open_only_with_explicit_flag(self):
        # A-2: flag=1 → open
        resp = await self._proposal(agent="anyone")
        self.assertEqual(resp.status, 200)
        # A-2 fail-closed: без keys И без flag → 503
        os.environ.pop("AEGIS_ALLOW_UNATTESTED", None)
        resp = await self._proposal(agent="anyone")
        self.assertEqual(resp.status, 503)

    @unittest_run_loop
    async def test_attestation_enforced(self):
        os.environ.pop("AEGIS_ALLOW_UNATTESTED", None)
        os.environ["AEGIS_AGENT_KEYS"] = json.dumps(self.KEYS)
        # нет ключа → 401
        self.assertEqual((await self._proposal()).status, 401)
        # неверный ключ → 401
        self.assertEqual((await self._proposal(key="wrong")).status, 401)
        # агент не в карте → 401 даже с чужим валидным ключом
        self.assertEqual(
            (await self._proposal(agent="mallory", key="k-spark")).status, 401)
        # правильный агент+ключ → 200
        self.assertEqual(
            (await self._proposal(agent="forge", key="k-forge")).status, 200)

    @unittest_run_loop
    async def test_malformed_keys_env_503(self):
        os.environ.pop("AEGIS_ALLOW_UNATTESTED", None)
        os.environ["AEGIS_AGENT_KEYS"] = "{not json"
        resp = await self._proposal(agent="spark", key="k-spark")
        self.assertEqual(resp.status, 503)

    @unittest_run_loop
    async def test_simulate_via_api(self):
        resp = await self.client.post("/api/core/proposals", json={
            "operation_type": "payout", "agent": "treasury",
            "payload": {"amount": 30000}, "simulate": True,
        })
        self.assertEqual(resp.status, 200)          # dry-run всегда 200
        data = await resp.json()
        self.assertEqual(data["outcome"], "escalate")
        self.assertIsNone(data.get("approval_id"))
        self.assertTrue(data.get("simulate"))
        # pending не создан
        pend = await self.client.get("/api/core/approvals")
        self.assertEqual((await pend.json())["approvals"], [])

    @unittest_run_loop
    async def test_approval_ttl_via_api(self):
        resp = await self.client.post("/api/core/proposals", json={
            "operation_type": "payout", "agent": "treasury",
            "payload": {"amount": 30000}, "approval_ttl": 30,
        })
        self.assertEqual(resp.status, 202)
        pend = await self.client.get("/api/core/approvals")
        row = (await pend.json())["approvals"][0]
        self.assertLessEqual(row["expires_at"] - row["requested_at"], 31)


if __name__ == "__main__":
    unittest.main()
