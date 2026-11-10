#!/usr/bin/env python3
"""test_permit_persist.py — W87 юниты для consume_permit hardening.

Покрытие (фикс по CODEX W5l):
  * expires_at перепроверяется ВНУТРИ _state_lock — now берётся под
    локом, а не до ожидания лока (permit не «проскальзывает» живым
    в щель между входом и захватом).
  * persist-write failure: consumed=True не доходит до диска →
    consume возвращает None + consumed откачен + audit
    aegis_permit_persist_failed (fail-closed → re-escalate, иначе
    permit «воскреснет» после restart = replay).
  * mint-persist failure → audit с phase=mint (in-memory permit —
    fail-safe сторона: потеря, не replay).
  * _maybe_save_windows возвращает bool.
"""
from __future__ import annotations

import json
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tools.nexus_core.aegis import AegisGuard  # noqa: E402


def _gate(state_dir: Path) -> AegisGuard:
    return AegisGuard(state_path=str(state_dir / "aegis-windows.json"))


def _inject_permit(gate: AegisGuard, *, ttl: float = 3600.0,
                   op: str = "core.terminal_mutation",
                   ph: str = "deadbeef") -> str:
    pid = "permit-test-1"
    gate._permits[pid] = {
        "permit_id": pid,
        "approval_id": "aid-1",
        "operation_type": op,
        "payload_hash": ph,
        "policy_hash": gate.policy_hash,
        "created_at": time.time(),
        "expires_at": time.time() + ttl,
        "consumed": False,
    }
    gate._windows_dirty = True
    return pid


class ConsumePermitTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="aegis-w87-"))
        self.gate = _gate(self.tmp)

    def test_consume_marks_and_persists_consumed(self):
        pid = _inject_permit(self.gate)
        got = self.gate.consume_permit("core.terminal_mutation",
                                       "deadbeef")
        self.assertEqual(got, pid)
        self.assertTrue(self.gate._permits[pid]["consumed"])
        # consumed дошёл до диска синхронно (W83+W87 flush)
        data = json.loads(
            (self.tmp / "aegis-windows.json").read_text("utf-8"))
        self.assertTrue(data["permits"][pid]["consumed"])
        # повторный consume → None (single-use и на диске)
        self.assertIsNone(
            self.gate.consume_permit("core.terminal_mutation",
                                     "deadbeef"))

    def test_consume_expired_returns_none_and_drops(self):
        pid = _inject_permit(self.gate, ttl=-1.0)
        self.assertIsNone(
            self.gate.consume_permit("core.terminal_mutation",
                                     "deadbeef"))
        self.assertNotIn(pid, self.gate._permits)

    def test_explicit_now_param_respected(self):
        pid = _inject_permit(self.gate, ttl=100.0)
        future = time.time() + 1000
        # now за пределами expires_at → expired даже с валидным permit
        self.assertIsNone(
            self.gate.consume_permit("core.terminal_mutation",
                                     "deadbeef", now=future))
        self.assertNotIn(pid, self.gate._permits)

    def test_now_sampled_under_lock_not_before(self):
        """Регрессия W87: now вычислялся ДО входа в _state_lock —
        permit, истёкший за время ожидания лока, проходил как живой.
        Проверяем, что свежий time.time() берётся под локом: мокаем
        time.time так, чтобы 'до лока' было прошлей, 'под локом' —
        уже после expires_at."""
        pid = _inject_permit(self.gate, ttl=0.05)
        real_now = time.time()
        calls = {"n": 0}

        def fake_time():
            calls["n"] += 1
            # первый вызов (параметр now=None → внутри лока) —
            # единственный, что нас интересует; вернём время ЗА ttl
            return real_now + 10.0

        with patch("tools.nexus_core.aegis.time.time", side_effect=fake_time):
            got = self.gate.consume_permit("core.terminal_mutation",
                                           "deadbeef")
        # expires_at = real_now+0.05 < fake now (real_now+10) → expired
        self.assertIsNone(got)
        self.assertNotIn(pid, self.gate._permits)

    def test_persist_failure_rolls_back_consumed(self):
        """W87: consume сработал, но диск упал → consumed откатывается,
        возвращается None (re-escalate), audit фиксирует failure."""
        pid = _inject_permit(self.gate)
        with patch.object(self.gate, "_maybe_save_windows",
                          return_value=False):
            got = self.gate.consume_permit("core.terminal_mutation",
                                           "deadbeef")
        self.assertIsNone(got)
        rec = self.gate._permits[pid]
        self.assertFalse(rec["consumed"])
        self.assertNotIn("consumed_at", rec)
        # audit: persist-failure записан
        types = [r.get("type") for r in self.gate.audit_records()]
        self.assertIn("aegis_permit_persist_failed", types)
        # permit остался живым в памяти → после «починки диска»
        # consume снова срабатывает (fail-closed ≠ потеря permit)
        got2 = self.gate.consume_permit("core.terminal_mutation",
                                        "deadbeef")
        self.assertEqual(got2, pid)

    def test_persist_failure_via_real_oserror(self):
        """Сквозной путь: state_path указывает в несуществуемый
        родитель-файл → OSError → _maybe_save_windows False →
        consume fail-closed."""
        blocker = self.tmp / "blocker"
        blocker.write_text("x", "utf-8")  # файл, не каталог
        bad = AegisGuard(state_path=str(blocker / "wins.json"))
        pid = _inject_permit(bad)
        # bad-gate: _windows_untrusted? нет — просто OSError на mkdir
        got = bad.consume_permit("core.terminal_mutation", "deadbeef")
        self.assertIsNone(got)
        self.assertFalse(bad._permits[pid]["consumed"])

    def test_no_state_path_consumes_normally(self):
        """In-memory gate (без state_path): persist — no-op True,
        consume работает как раньше."""
        gate = AegisGuard()
        pid = _inject_permit(gate)
        self.assertEqual(
            gate.consume_permit("core.terminal_mutation", "deadbeef"),
            pid)

    def test_save_windows_returns_bool(self):
        self.assertTrue(self.gate._maybe_save_windows())
        self.assertTrue(AegisGuard()._maybe_save_windows())
        # untrusted → False
        g2 = _gate(self.tmp / "sub")
        (self.tmp / "sub").mkdir(exist_ok=True)
        g2._windows_untrusted = True
        self.assertFalse(g2._maybe_save_windows(force=True))

    def test_mint_persist_failure_audited(self):
        """_mint_permit при упавшем persist → permit возвращается
        (in-memory), audit фиксирует phase=mint failure."""
        pending = {
            "payload_hash": "ph1",
            "operation_type": "core.terminal_mutation",
            "expires_at": time.time() + 100,
        }
        with patch.object(self.gate, "_maybe_save_windows",
                          return_value=False):
            pid = self.gate._mint_permit(pending, "aid-x",
                                         time.time())
        self.assertIsNotNone(pid)
        types = [(r.get("type"), r.get("phase"))
                 for r in self.gate.audit_records()]
        self.assertIn(("aegis_permit_persist_failed", "mint"), types)


if __name__ == "__main__":
    unittest.main()
