#!/usr/bin/env python3
"""
tools/nexus_core/test_supervisor_n2.py — юнит-тесты N2-расширений
супервизора v1: kill-эскалация, die-with-parent/outlive-parent,
parents, wait-семантика.

Запуск: pytest tools/nexus_core/test_supervisor_n2.py
        python -m tools.nexus_core.test_supervisor_n2
"""

from __future__ import annotations

import unittest

from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


def make_supervisor(**kwargs) -> SupervisorV1:
    backend = kwargs.pop("backend", MockPTYBackend())
    return SupervisorV1(backend=backend, **kwargs)


class TestKillEscalation(unittest.TestCase):
    def test_hangup_terminate_kill_all_stages(self):
        sup = make_supervisor()
        term = sup.create_terminal("t1")
        result = sup.escalate_kill("local/t1")
        self.assertEqual(len(result["steps"]), 3)
        self.assertEqual([s["stage"] for s in result["steps"]], ["hangup", "terminate", "kill"])
        self.assertEqual(result["final"], "kill")
        # после kill терминал мёртв (exited, handle None)
        self.assertEqual(term.state, "exited")
        self.assertIsNone(term.handle)

    def test_escalate_reports_state_after_each_stage(self):
        sup = make_supervisor()
        sup.create_terminal("t1")
        result = sup.escalate_kill("local/t1")
        self.assertEqual(result["steps"][0]["state"], "alive")   # hangup игнор
        self.assertEqual(result["steps"][1]["state"], "alive")   # terminate игнор
        self.assertEqual(result["steps"][2]["state"], "dead")    # kill убил

    def test_escalate_from_terminate_stage(self):
        sup = make_supervisor()
        sup.create_terminal("t1")
        result = sup.escalate_kill("local/t1", stage="terminate")
        self.assertEqual([s["stage"] for s in result["steps"]], ["terminate", "kill"])

    def test_escalate_unknown_terminal(self):
        sup = make_supervisor()
        with self.assertRaises(KeyError):
            sup.escalate_kill("local/missing")

    def test_escalate_not_running(self):
        sup = make_supervisor()
        term = sup.create_terminal("t1")
        term.handle.close()
        result = sup.escalate_kill("local/t1")
        self.assertEqual(result["final"], "not_running")


class TestParentSemantics(unittest.TestCase):
    def test_child_records_parent(self):
        sup = make_supervisor()
        sup.create_terminal("parent")
        child = sup.create_terminal("child", parent="local/parent")
        self.assertEqual(child.parent, "local/parent")
        self.assertEqual(sup.children("local/parent"), ["local/child"])

    def test_die_with_parent_kills_child(self):
        sup = make_supervisor()
        sup.create_terminal("parent")
        child = sup.create_terminal("child", parent="local/parent", die_with_parent=True)
        # родитель умирает (intentional close)
        sup.get_terminal("local/parent").handle.close()
        sup.step_once()
        # потомок должен быть убит
        self.assertEqual(child.state, "exited")
        self.assertIsNone(child.handle)

    def test_child_survives_parent_without_die_flag(self):
        # RFC §12: дефолт die-with-parent=ON — выживание только при явном opt-out
        sup = make_supervisor()
        sup.create_terminal("parent")
        child = sup.create_terminal(
            "child", parent="local/parent", die_with_parent=False
        )
        sup.get_terminal("local/parent").handle.close()
        sup.step_once()
        self.assertNotEqual(child.state, "exited")
        self.assertIsNotNone(child.handle)

    def test_die_with_parent_child_not_killed_if_parent_alive(self):
        sup = make_supervisor()
        sup.create_terminal("parent")
        child = sup.create_terminal("child", parent="local/parent", die_with_parent=True)
        sup.step_once()
        self.assertIsNotNone(child.handle)
        self.assertEqual(child.state, "idle")


class TestWaitSemantics(unittest.TestCase):
    def test_wait_exit(self):
        sup = make_supervisor()
        term = sup.create_terminal("t1")
        term.handle.close()
        result = sup.wait_for_exit("local/t1", timeout=1.0)
        self.assertIsNotNone(result)
        self.assertEqual(result["state"], "exited")

    def test_wait_timeout(self):
        sup = make_supervisor()
        sup.create_terminal("t1")
        result = sup.wait_for_exit("local/t1", timeout=0.05)
        self.assertIsNone(result)

    def test_wait_children_all(self):
        sup = make_supervisor()
        sup.create_terminal("parent")
        c1 = sup.create_terminal("c1", parent="local/parent")
        c2 = sup.create_terminal("c2", parent="local/parent")
        c1.handle.close()
        c2.handle.close()
        result = sup.wait_for_exit("local/parent", children="all", timeout=1.0)
        self.assertIsNotNone(result)
        self.assertEqual(result["state"], "exited")
        self.assertEqual(set(result["children"]), {"local/c1", "local/c2"})

    def test_wait_children_any(self):
        sup = make_supervisor()
        sup.create_terminal("parent")
        c1 = sup.create_terminal("c1", parent="local/parent")
        c2 = sup.create_terminal("c2", parent="local/parent")
        c1.handle.close()
        result = sup.wait_for_exit("local/parent", children="any", timeout=1.0)
        self.assertIsNotNone(result)
        self.assertEqual(result["children"], ["local/c1"])

    def test_wait_output_match(self):
        sup = make_supervisor()
        term = sup.create_terminal("t1")
        term.handle.emit_raw(b"READY\n")
        result = sup.wait_for_exit("local/t1", output="READY", timeout=1.0)
        self.assertIsNotNone(result)
        self.assertEqual(result["state"], "output_match")
        self.assertEqual(result["matched"], "READY")


if __name__ == "__main__":
    unittest.main()
