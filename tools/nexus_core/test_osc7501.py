#!/usr/bin/env python3
"""
tools/nexus_core/test_osc7501.py — тесты парсера OSC 7501 (N1/N2).

Покрывают: key=value-формат (5 состояний + kind + msg/app/title/progress),
оба терминатора (BEL/ST), санитизацию, и JSON-совместимость (старый формат).

Запуск: pytest tools/nexus_core/test_osc7501.py
        python -m tools.nexus_core.test_osc7501
"""

from __future__ import annotations

import unittest

from tools.nexus_core.osc7501 import (
    AgentStatus,
    Osc7501Parser,
    parse_agent_status,
)


class TestParseAgentStatus(unittest.TestCase):
    def test_kv_working(self):
        s = parse_agent_status("state=working")
        self.assertIsNotNone(s)
        self.assertEqual(s.state, "working")
        self.assertFalse(s.attention)
        self.assertEqual(s.raw, "working")

    def test_kv_idle(self):
        s = parse_agent_status("state=idle")
        self.assertEqual(s.state, "idle")

    def test_kv_done(self):
        s = parse_agent_status("state=done")
        self.assertEqual(s.state, "done")
        self.assertFalse(s.attention)

    def test_kv_blocked_kind_and_fields(self):
        s = parse_agent_status(
            "state=blocked:kind=permission:msg=need access:progress=42"
        )
        self.assertEqual(s.state, "blocked")
        self.assertTrue(s.attention)
        self.assertEqual(s.kind, "permission")
        self.assertEqual(s.msg, "need access")
        self.assertEqual(s.progress, 42)

    def test_kv_blocked_kind_question(self):
        s = parse_agent_status("state=blocked:kind=question")
        self.assertEqual(s.kind, "question")
        self.assertTrue(s.attention)

    def test_kv_blocked_kind_auth(self):
        s = parse_agent_status("state=blocked:kind=auth")
        self.assertEqual(s.kind, "auth")

    def test_kv_error(self):
        s = parse_agent_status("state=error:msg=crash")
        self.assertEqual(s.state, "blocked")  # error → blocked (внимание)
        self.assertTrue(s.attention)
        self.assertEqual(s.raw, "error")

    def test_kv_unknown_state_none(self):
        self.assertIsNone(parse_agent_status("state=bogus"))
        self.assertIsNone(parse_agent_status("kind=permission"))
        self.assertIsNone(parse_agent_status(""))

    def test_json_legacy_compat(self):
        s = parse_agent_status({"status": "working"})
        self.assertEqual(s.state, "working")
        s2 = parse_agent_status("{\"status\": \"blocked\", \"kind\": \"auth\"}")
        self.assertEqual(s2.state, "blocked")
        self.assertEqual(s2.kind, "auth")

    def test_invalid_payload_none(self):
        self.assertIsNone(parse_agent_status(123))
        self.assertIsNone(parse_agent_status(None))


class TestOsc7501Parser(unittest.TestCase):
    def setUp(self):
        self.parser = Osc7501Parser()

    def test_feed_kv_bel(self):
        statuses = self.parser.feed(b"\x1b]7501;state=working\x07")
        self.assertEqual(len(statuses), 1)
        self.assertEqual(statuses[0].state, "working")

    def test_feed_kv_st(self):
        statuses = self.parser.feed(b"\x1b]7501;state=blocked:kind=question\x1b\\")
        self.assertEqual(len(statuses), 1)
        self.assertEqual(statuses[0].state, "blocked")
        self.assertEqual(statuses[0].kind, "question")

    def test_feed_surrounded_by_text(self):
        statuses = self.parser.feed(b"hello \x1b]7501;state=done\x07 world")
        self.assertEqual(len(statuses), 1)
        self.assertEqual(statuses[0].state, "done")

    def test_feed_multiple_messages(self):
        statuses = self.parser.feed(
            b"\x1b]7501;state=working\x07\x1b]7501;state=blocked:kind=auth\x07"
        )
        self.assertEqual([s.state for s in statuses], ["working", "blocked"])

    def test_feed_split_chunks(self):
        data = b"\x1b]7501;state=working\x07"
        statuses = []
        statuses += self.parser.feed(data[:5])
        statuses += self.parser.feed(data[5:])
        statuses += self.parser.feed(b"")
        self.assertEqual(len(statuses), 1)
        self.assertEqual(statuses[0].state, "working")

    def test_payload_esc_safe(self):
        # небезопасные управляющие: 0x01 (SOH) в payload
        statuses = self.parser.feed(b"\x1b]7501;state=working\x01x\x07")
        self.assertEqual(statuses, [])

    def test_payload_not_utf8(self):
        # invalid UTF-8: 0xFF
        statuses = self.parser.feed(b"\x1b]7501;state=working\xff\x07")
        self.assertEqual(statuses, [])

    def test_sequence_too_long(self):
        parser = Osc7501Parser(max_buffer=64)
        text = b"state=working:msg=" + b"x" * 128 + b"\x07"
        statuses = parser.feed(b"\x1b]7501;" + text)
        self.assertEqual(statuses, [])

    def test_json_legacy_parses(self):
        statuses = self.parser.feed(
            b"\x1b]7501;{\"status\":\"working\"}\x07"
        )
        self.assertEqual(len(statuses), 1)
        self.assertEqual(statuses[0].state, "working")


if __name__ == "__main__":
    unittest.main()
