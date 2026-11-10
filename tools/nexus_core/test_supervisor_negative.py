#!/usr/bin/env python3
"""
tools/nexus_core/test_supervisor_negative.py — adversarial-прогон supervisor-
уровня (напрямую, НЕ через HTTP). CORE_MOCK=1.

Каждый кейс → ожидание: False/None/безопасный дефолт/контрактное исключение
(KeyError). НИ ОДНОГО uncaught-исключения (неожиданного).
"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("CORE_MOCK", "1")

from tools.nexus_core.mock_pty import MockPTYBackend  # noqa: E402
from tools.nexus_core.supervisor_v1 import SupervisorV1  # noqa: E402


def make_supervisor() -> tuple[SupervisorV1, MockPTYBackend]:
    backend = MockPTYBackend()
    return SupervisorV1(backend=backend), backend


class SupervisorNegativeTest(unittest.TestCase):
    def setUp(self):
        self.sup, self.backend = make_supervisor()
        self.term = self.sup.create_terminal(name="t1", command=["sh", "-i"])

    # ------------------------------------------------------------------
    # escalate_kill
    # ------------------------------------------------------------------
    def test_escalate_kill_unknown_term_raises_keyerror(self):
        with self.assertRaises(KeyError):
            self.sup.escalate_kill("nope")

    def test_escalate_kill_dead_handle(self):
        # мёртвый хендл (exited) → безопасный "not_running"
        self.term.handle.close()
        self.term.handle = None
        result = self.sup.escalate_kill("t1")
        self.assertEqual(result["final"], "not_running")

    def test_escalate_kill_stage_bogus_safe(self):
        # неизвестная ступень → не бросает (start=0, с hangup)
        result = self.sup.escalate_kill("t1", stage="bogus")
        self.assertIn("final", result)

    def test_escalate_kill_stage_non_string(self):
        # не-строка stage → ValueError (контрактно)
        with self.assertRaises(ValueError):
            self.sup.escalate_kill("t1", stage=123)

    # ------------------------------------------------------------------
    # get_terminal: пустая/битая строка адреса
    # ------------------------------------------------------------------
    def test_get_terminal_empty(self):
        self.assertIsNone(self.sup.get_terminal(""))

    def test_get_terminal_slash(self):
        self.assertIsNone(self.sup.get_terminal("/"))

    def test_get_terminal_x_slash(self):
        self.assertIsNone(self.sup.get_terminal("x/"))

    def test_get_terminal_slash_y(self):
        self.assertIsNone(self.sup.get_terminal("/y"))

    def test_get_terminal_double_slash(self):
        self.assertIsNone(self.sup.get_terminal("a//b"))

    def test_get_terminal_short_name(self):
        self.assertIsNotNone(self.sup.get_terminal("t1"))

    # ------------------------------------------------------------------
    # set_labels
    # ------------------------------------------------------------------
    def test_set_labels_nonexistent_raises_keyerror(self):
        with self.assertRaises(KeyError):
            self.sup.set_labels("nope", {"a": "b"})

    def test_set_labels_normalized(self):
        self.sup.set_labels("t1", {"role": "coder"})
        self.assertEqual(self.term.labels["role"], "coder")

    # ------------------------------------------------------------------
    # wait_for_exit: нулевой/отрицательный timeout
    # ------------------------------------------------------------------
    def test_wait_timeout_zero_returns_none(self):
        self.assertIsNone(self.sup.wait_for_exit("t1", timeout=0))

    def test_wait_timeout_negative_returns_none(self):
        self.assertIsNone(self.sup.wait_for_exit("t1", timeout=-5))

    # ------------------------------------------------------------------
    # respawn при handle=None
    # ------------------------------------------------------------------
    def test_step_once_handle_none_does_not_raise(self):
        self.term.handle = None
        # step_once не должен падать на handle=None
        self.sup.step_once()

    def test_respawn_with_none_handle_safe(self):
        # _respawn на handle=None: старый None, spawn нового — без падения
        self.term.handle = None
        self.sup._respawn(self.term)  # noqa: SLF001

    # ------------------------------------------------------------------
    # keys
    # ------------------------------------------------------------------
    def test_keys_empty_list_safe(self):
        self.assertTrue(self.sup.keys("t1", []))

    def test_keys_non_dict_elements_safe(self):
        # элементы не из словаря клавиш (числа/строки) → не бросает
        self.assertTrue(self.sup.keys("t1", [123, "ctrl+c"]))

    def test_keys_unknown_term_returns_false(self):
        self.assertFalse(self.sup.keys("nope", ["enter"]))

    # ------------------------------------------------------------------
    # interrupt/send на handle=None (exited)
    # ------------------------------------------------------------------
    def test_interrupt_handle_none_returns_false(self):
        self.term.handle = None
        self.assertFalse(self.sup.interrupt("t1"))

    def test_send_handle_none_returns_false(self):
        self.term.handle = None
        self.assertFalse(self.sup.send("t1", "hi"))

    def test_send_unknown_term_returns_false(self):
        self.assertFalse(self.sup.send("nope", "hi"))

    def test_interrupt_unknown_term_returns_false(self):
        self.assertFalse(self.sup.interrupt("nope"))


if __name__ == "__main__":
    unittest.main()
