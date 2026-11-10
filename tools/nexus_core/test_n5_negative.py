#!/usr/bin/env python3
"""
tools/nexus_core/test_n5_negative.py — adversarial на MUST-фичи N5
(die_with_parent default, adoption, doc CAS, set_keep, события). CORE_MOCK=1.

Цель: доказать, что фичи сломаны. Каждый кейс фиксирует фактическое поведение.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("CORE_MOCK", "1")

from tools.nexus_core.doc_store import DocConflictError, DocStore  # noqa: E402
from tools.nexus_core.mock_pty import MockPTYBackend  # noqa: E402
from tools.nexus_core.supervisor_v1 import SupervisorV1, RECENT_OUTPUT_CAP  # noqa: E402


def make_sup() -> tuple[SupervisorV1, MockPTYBackend, list]:
    backend = MockPTYBackend()
    events = []
    sup = SupervisorV1(backend=backend, event_sink=events.append)
    return sup, backend, events


class DieWithParentTest(unittest.TestCase):
    def setUp(self):
        self.sup, self.backend, _ = make_sup()
        self.parent = self.sup.create_terminal(name="p", command=["sh", "-i"])


    def test_die_with_parent_default_reaps_child(self):
        # НАХОДКА: при handle=None (state не exited) _parent_alive=True →
        # child НЕ реaps (state остаётся idle). Ожидаем exited.
        child = self.sup.create_terminal(name="c", command=["sh", "-i"],
                                         parent=self.parent.address)
        self.assertTrue(child.die_with_parent)  # default True
        # убиваем родителя
        self.parent.handle.close()
        self.parent.handle = None
        self.sup.step_once()
        # НАХОДКА: ожидали "exited", фактически "idle"
        self.assertEqual(child.state, "exited")

    def test_outlive_parent_disables_die(self):
        child = self.sup.create_terminal(name="c2", command=["sh", "-i"],
                                         parent=self.parent.address, outlive_parent=True)
        self.assertFalse(child.die_with_parent)
        self.parent.handle.close()
        self.parent.handle = None
        self.sup.step_once()
        self.assertNotEqual(child.state, "exited")


    def test_parent_dead_before_child_creation(self):
        # НАХОДКА: родитель мёртв (handle=None, state=idle) к моменту создания
        # child → _parent_alive=True → child НЕ реaps. Ожидаем exited.
        self.parent.handle.close()
        self.parent.handle = None
        child = self.sup.create_terminal(name="c3", command=["sh", "-i"],
                                         parent=self.parent.address)
        self.sup.step_once()
        self.assertEqual(child.state, "exited")

    def test_parent_nonexistent_but_valid(self):
        # parent="local/ghost" — не существует → _parent_alive False → reap
        child = self.sup.create_terminal(name="c4", command=["sh", "-i"],
                                         parent="local/ghost")
        self.sup.step_once()
        self.assertEqual(child.state, "exited")


    def test_reaped_not_repeated(self):
        child = self.sup.create_terminal(name="c5", command=["sh", "-i"],
                                         parent=self.parent.address)
        self.parent.handle.close()
        self.parent.handle = None
        self.sup.step_once()  # первый reap
        self.assertTrue(child.parent_reaped)
        events_count = len([e for e in self.sup.events if e["type"] == "finished"])
        self.sup.step_once()  # второй — не должен повторять reap
        self.assertEqual(len([e for e in self.sup.events if e["type"] == "finished"]),
                         events_count)

    def test_explicit_die_false(self):
        child = self.sup.create_terminal(name="c6", command=["sh", "-i"],
                                         parent=self.parent.address, die_with_parent=False)
        self.assertFalse(child.die_with_parent)


ADOPT_ROW = {
    "name": "a1", "machine": "local", "command": ["sh"],
    "state": "lost", "keep": True, "col": 120, "rows": 30,
}


class AdoptionTest(unittest.TestCase):
    def _sup_with_registry(self, rows):
        backend = MockPTYBackend()
        sup = SupervisorV1(backend=backend)
        # пишем registry напрямую
        reg = Path(tempfile.mkdtemp(prefix="adopt-")) / "registry.json"
        reg.write_text(
            __import__("json").dumps(rows), encoding="utf-8"
        )
        sup._registry_path = str(reg)
        sup._load_registry()
        return sup

    def test_adopt_recent_output_null(self):
        row = dict(ADOPT_ROW, recent_output=None)
        sup = self._sup_with_registry([row])
        term = sup.get_terminal("local/a1")
        self.assertIsNotNone(term)
        self.assertEqual(term.recent_output, "")

    def test_adopt_recent_output_number(self):
        row = dict(ADOPT_ROW, recent_output=12345)
        sup = self._sup_with_registry([row])
        term = sup.get_terminal("local/a1")
        self.assertEqual(term.recent_output, "12345")


    def test_adopt_recent_output_huge(self):
        # НАХОДКА: огромный recent_output из registry НЕ обрезается до
        # RECENT_OUTPUT_CAP (len > cap). Ожидаем <= cap.
        huge = "x" * (RECENT_OUTPUT_CAP + 10_000)
        row = dict(ADOPT_ROW, recent_output=huge)
        sup = self._sup_with_registry([row])
        term = sup.get_terminal("local/a1")
        self.assertLessEqual(len(term.recent_output), RECENT_OUTPUT_CAP)

    def test_adopt_title_null(self):
        row = dict(ADOPT_ROW, title=None)
        sup = self._sup_with_registry([row])
        term = sup.get_terminal("local/a1")
        self.assertIsNone(term.title)

    def test_adopt_title_number(self):
        row = dict(ADOPT_ROW, title=42)
        sup = self._sup_with_registry([row])
        term = sup.get_terminal("local/a1")
        # title=42 — должен быть int/строка? ожидаем не-падение
        self.assertIsNotNone(term)

    def test_adopt_bad_json_row(self):
        # битый json-ряд: не-словарь
        sup = self._sup_with_registry([ADOPT_ROW, "garbage", 42, None])
        self.assertIsNotNone(sup.get_terminal("local/a1"))


class DocCasTest(unittest.TestCase):
    def setUp(self):
        self.store = DocStore(Path(tempfile.mkdtemp(prefix="cas-")))

    def test_cas_string_version(self):
        self.store.put("v1")
        with self.assertRaises(DocConflictError):
            self.store.put("v2", base_version="2")  # строка "2" != latest 1


    def test_cas_float_version(self):
        # НАХОДКА: float base_version=1.0 принимается (int(1.0)==1 == latest).
        # Ожидаем отказ (base_version должен быть int).
        self.store.put("v1")
        with self.assertRaises(DocConflictError):
            self.store.put("v2", base_version=1.0)

    def test_cas_negative_version(self):
        self.store.put("v1")
        with self.assertRaises(DocConflictError):
            self.store.put("v2", base_version=-1)

    def test_cas_zero_version(self):
        self.store.put("v1")
        with self.assertRaises(DocConflictError):
            self.store.put("v2", base_version=0)

    def test_cas_future_version(self):
        self.store.put("v1")
        with self.assertRaises(DocConflictError):
            self.store.put("v2", base_version=999)

    def test_cas_ok(self):
        self.store.put("v1")
        v = self.store.put("v2", base_version=1)
        self.assertEqual(v, 2)

    def test_race_two_put_same_base(self):
        # два put без base_version — оба проходят (монотонно)
        v1 = self.store.put("a")
        v2 = self.store.put("b")
        self.assertNotEqual(v1, v2)
        self.assertEqual(v2, v1 + 1)


class SetKeepTest(unittest.TestCase):
    def setUp(self):
        self.sup, _, _ = make_sup()
        self.term = self.sup.create_terminal(name="t1", command=["sh", "-i"])

    def test_set_keep_alive(self):
        self.assertTrue(self.sup.set_keep("t1", False))
        self.assertFalse(self.term.keep)

    def test_set_keep_dead(self):
        self.term.handle = None
        self.assertTrue(self.sup.set_keep("t1", True))
        self.assertTrue(self.term.keep)

    def test_set_keep_nonexistent(self):
        self.assertFalse(self.sup.set_keep("nope", True))


class EventPayloadTest(unittest.TestCase):
    def setUp(self):
        self.sup, _, self.events = make_sup()
        self.term = self.sup.create_terminal(name="t1", command=["sh", "-i"],
                                             labels={"a": "b"})

    def test_created_payload(self):
        e = next(e for e in self.events if e["type"] == "created")
        self.assertEqual(e["address"], "local/t1")
        self.assertIn("term", e)
        self.assertIn("machine", e)
        self.assertNotIn("labels", e)  # created не несёт labels

    def test_size_payload(self):
        e = next(e for e in self.events if e["type"] == "size")
        self.assertIn("cols", e)
        self.assertIn("rows", e)
        self.assertIn("address", e)

    def test_labels_event(self):
        self.sup.set_labels("t1", {"role": "coder"})
        e = next(e for e in self.events if e["type"] == "labels")
        self.assertEqual(e["labels"]["role"], "coder")

    def test_keep_event(self):
        self.sup.set_keep("t1", False)
        e = next(e for e in self.events if e["type"] == "keep")
        self.assertIn("keep", e)
        self.assertFalse(e["keep"])

    def test_title_event(self):
        self.term.handle.emit_osc("working", title="xyz")
        self.sup.step_once()
        e = next((e for e in self.events if e["type"] == "title"), None)
        self.assertIsNotNone(e)
        self.assertEqual(e["title"], "xyz")

    def test_finished_event_on_exit(self):
        self.term.handle.close()
        self.sup.step_once()
        e = next((e for e in self.events if e["type"] == "finished"), None)
        self.assertIsNotNone(e)
        self.assertIn("exit_code", e)

    def test_restarted_event_on_respawn(self):
        # keep + потеря (kill) → respawn: события "lost"+"respawn"
        self.term.handle.kill()
        self.sup.step_once()
        # потеря по RFC §18: 2 пропущенных тика → lost
        self.sup.step_once()
        e = next((e for e in self.events if e["type"] == "lost"), None)
        self.assertIsNotNone(e)
        self.assertIn("address", e)


if __name__ == "__main__":
    unittest.main()
