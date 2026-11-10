#!/usr/bin/env python3
"""test_gate_graph.py — AO-1c: node_start события gate-графа.

Семантика зеркалит auto-ontology tests/test_node_start_events.py:
- анонс приходит ДО завершения узла (lead time — весь смысл паттерна)
- каждый узел анонсируется (announce в runner.run — универсально)
- sink=None / сломанный sink не роняют run (best-effort)
- suspend/resume: escalate паркует run, approve_step продолжает цепочку
"""

import time
import unittest

from tools.nexus_core.gate_graph import (
    END, NODE_START_EVENT, SUSPEND, GateGraph, GateRun, GateRunner,
    build_payout_graph, route_gate_decision,
)


def _impls(**over):
    """Базовые node-реализации: permit-решение → execute → done."""
    impls = {
        "build_intent": lambda run: setattr(run, "op", "hivebid.release"),
        "propose": lambda run: setattr(run, "decision", "permit"),
        "approve_step": lambda run: setattr(run, "decision", "permit"),
        "execute": lambda run: setattr(run, "result", "executed"),
        "register_pending": lambda run: None,
    }
    impls.update(over)
    return impls


def _run(**kw) -> GateRun:
    return GateRun(run_id="t1", **kw)


class TestNodeStart(unittest.TestCase):
    def test_start_arrives_before_node_finishes(self):
        events = []
        slow_done = []

        def slow(run):
            time.sleep(0.2)
            slow_done.append(time.time())

        g = GateGraph()
        g.add_node("slow", slow)
        g.set_entry("slow")
        g.add_edge("slow", END)
        r = GateRunner(g, sink=lambda e: events.append((e["type"], time.time())))
        t0 = time.time()
        r.run(_run())
        start_ev = [e for e in events if e[0] == NODE_START_EVENT]
        self.assertTrue(start_ev)
        # node_start записан раньше, чем узел завершил работу
        self.assertLess(start_ev[0][1] - t0, slow_done[0] - t0)

    def test_every_node_announces(self):
        events = []
        g = GateGraph()
        g.add_node("a", lambda run: None)
        g.add_node("b", lambda run: None)
        g.set_entry("a")
        g.add_edge("a", "b")
        g.add_edge("b", END)
        GateRunner(g, sink=events.append).run(_run())
        nodes = [e["node"] for e in events if e["type"] == NODE_START_EVENT]
        self.assertEqual(nodes, ["a", "b"])

    def test_no_sink_and_broken_sink_not_fatal(self):
        g = build_payout_graph(_impls())
        GateRunner(g, sink=None).run(_run())

        def boom(ev):
            raise RuntimeError("sink down")

        run = _run()
        GateRunner(g, sink=boom).run(run)
        self.assertEqual(run.result, "executed")


class TestGateFlow(unittest.TestCase):
    def test_permit_executes(self):
        g = build_payout_graph(_impls())
        run = GateRunner(g).run(_run())
        self.assertEqual(run.result, "executed")
        self.assertEqual(run.node, "done")

    def test_deny_terminates(self):
        g = build_payout_graph(_impls(
            propose=lambda run: setattr(run, "decision", "deny")))
        run = GateRunner(g).run(_run())
        self.assertEqual(run.node, "denied")
        self.assertIsNone(run.result)

    def test_escalate_suspends_then_resume_permits(self):
        events = []
        calls = {"approve": 0}

        def approve_step(run):
            calls["approve"] += 1
            run.decision = "permit" if calls["approve"] > 1 else "escalate"

        impls = _impls()
        impls["propose"] = lambda run: setattr(run, "decision", "escalate")
        impls["approve_step"] = approve_step
        g = build_payout_graph(impls)
        runner = GateRunner(g, sink=events.append)

        run = runner.run(_run())
        self.assertTrue(run.suspended)
        self.assertEqual(run.node, "await_approval")
        # suspend-точка — approve_step: каждый approve() продолжает цепочку
        for _ in range(3):
            if not run.suspended:
                break
            run.resume_from = "approve_step"
            run = runner.run(run)
        self.assertEqual(run.result, "executed")
        self.assertEqual(run.node, "done")
        # approve_step: шаг 1 → escalate → повторный suspend, шаг 2 → permit
        self.assertEqual(calls["approve"], 2)

    def test_router_unknown_decision_fails_closed(self):
        g = build_payout_graph(_impls(
            propose=lambda run: setattr(run, "decision", "weird")))
        run = GateRunner(g).run(_run())
        # "invalid" edge → denied, а не молчаливый permit
        self.assertEqual(run.node, "denied")

    def test_event_carries_op_and_approval(self):
        events = []
        impls = _impls()
        impls["propose"] = lambda run: (
            setattr(run, "decision", "escalate"),
            setattr(run, "approval_id", "appr-1"))
        g = build_payout_graph(impls)
        run = GateRun(run_id="r9")
        GateRunner(g, sink=events.append).run(run)
        starts = [e for e in events if e["type"] == NODE_START_EVENT]
        self.assertTrue(any(e.get("approval_id") == "appr-1" for e in starts))
        self.assertTrue(all(e["run_id"] == "r9" for e in starts))


if __name__ == "__main__":
    unittest.main()
