#!/usr/bin/env python3
"""
tools/nexus_core/test_n5_conformance.py — конформность RFC-001 §28 (5 MUST).

Закрывает находки QODER #299 (docs/RFC_001_CONFORMANCE_v02.md §28):
  1. keep рестартует SHELL в последнем cwd, НЕ исходную команду (RFC §10/K5).
  2. adoption: registry-терминал восстанавливает recent_output из реестра
     (без живого screen), shell-заменой (RFC §13).
  3. die-with-parent включён ПО УМОЛЧАНИЮ (RFC §12 MUST); outlive-parent —
     явный opt-out (SHOULD).
  4. события: все 12 канонических видов RFC §18 эмиттятся
     (created|lost|restarted|keep|finished|removed|status|turn|title|labels|size|doc).
  5. doc CAS: запись отклоняется при mismatch-версии (RFC §16).

Запуск: pytest tools/nexus_core/test_n5_conformance.py
        python -m tools.nexus_core.test_n5_conformance
"""

from __future__ import annotations

import asyncio
import shutil
import tempfile
import unittest
from pathlib import Path

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from tools.nexus_core.api import create_app
from tools.nexus_core.doc_store import DocConflictError, DocStore
from tools.nexus_core.events import EVENT_TYPES
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.pty_backend import default_shell
from tools.nexus_core.supervisor_v1 import SupervisorV1

# Канонические виды событий из RFC-001 §18 (12).
RFC_EVENT_KINDS = {
    "created", "lost", "restarted", "keep", "finished", "removed",
    "status", "turn", "title", "labels", "size", "doc",
}


def make_supervisor(base: Path, **kwargs) -> SupervisorV1:
    kwargs.setdefault("backend", MockPTYBackend())
    kwargs.setdefault("registry_path", base / "registry.json")
    return SupervisorV1(**kwargs)


class TestKeepRespawnsShell(unittest.TestCase):
    """Пункт 1: keep рестартует SHELL (не команду) в последнем cwd."""

    def test_respawn_uses_shell_not_command_and_keeps_cwd(self):
        with tempfile.TemporaryDirectory(prefix="nc-n5-kill-") as td:
            base = Path(td)
            sup = make_supervisor(base)
            cwd = base / "work"
            cwd.mkdir()
            term = sup.create_terminal(
                "t1",
                command=["echo", "side-effect"],
                cwd=str(cwd),
                labels={"role": "n5"},
            )
            term.handle.kill()
            sup.step_once()
            # потеря по RFC §18: 2 пропущенных тика → respawn
            sup.step_once()

            self.assertEqual(term.respawn_count, 1)
            # должен быть SHELL, а не исходная команда
            self.assertEqual(term.handle.spec.command, default_shell())
            self.assertNotEqual(term.handle.spec.command, ["echo", "side-effect"])
            self.assertEqual(term.command, default_shell())
            # последний cwd сохраняется
            self.assertEqual(term.handle.spec.cwd, str(cwd))
            self.assertEqual(term.cwd, str(cwd))
            # лейблы переживают респаун
            self.assertEqual(term.labels["role"], "n5")


class TestAdoptionRestoresRecentOutput(unittest.TestCase):
    """Пункт 2: adoption восстанавливает recent_output из registry (без screen)."""

    def test_adoption_restores_recent_output_without_screen(self):
        with tempfile.TemporaryDirectory(prefix="nc-n5-adopt-") as td:
            base = Path(td)
            reg = base / "registry.json"
            sup1 = make_supervisor(base)
            term = sup1.create_terminal("t1", cwd=str(base))
            term.handle.emit_raw(b"ADOPTED_OUTPUT_MARKER\n")
            sup1.step_once()          # recent_output наполняется
            self.assertIn("ADOPTED_OUTPUT_MARKER", term.recent_output)
            sup1._save_registry()     # персистим recent_output

            # Следующее ядро (adoption): тот же registry, свежий бэкенд.
            sup2 = make_supervisor(base)
            adopted = sup2.get_terminal("local/t1")
            self.assertIsNotNone(adopted)
            # recent_output восстановлен из реестра без живого экрана
            self.assertIn("ADOPTED_OUTPUT_MARKER", adopted.recent_output)
            # восстановлен shell-заменой, а не исходной командой
            self.assertEqual(adopted.command, default_shell())
            self.assertEqual(adopted.handle.spec.command, default_shell())


class TestDieWithParentDefault(unittest.TestCase):
    """Пункт 3: die-with-parent по умолчанию ON; outlive-parent opt-out."""

    def test_child_dies_with_parent_by_default(self):
        with tempfile.TemporaryDirectory(prefix="nc-n5-die-") as td:
            sup = make_supervisor(Path(td))
            sup.create_terminal("parent")
            child = sup.create_terminal("child", parent="local/parent")
            self.assertTrue(child.die_with_parent)
            sup.get_terminal("local/parent").handle.close()
            sup.step_once()
            self.assertEqual(child.state, "exited")
            self.assertIsNone(child.handle)

    def test_child_survives_with_outlive_parent(self):
        with tempfile.TemporaryDirectory(prefix="nc-n5-out-") as td:
            sup = make_supervisor(Path(td))
            sup.create_terminal("parent")
            child = sup.create_terminal(
                "child", parent="local/parent", outlive_parent=True
            )
            self.assertFalse(child.die_with_parent)
            sup.get_terminal("local/parent").handle.close()
            sup.step_once()
            self.assertNotEqual(child.state, "exited")
            self.assertIsNotNone(child.handle)


class TestEventKindsConformance(unittest.TestCase):
    """Пункт 4: все 12 канонических видов RFC §18 эмиттятся."""

    def test_events_emit_all_rfc_kinds(self):
        with tempfile.TemporaryDirectory(prefix="nc-n5-evt-") as td:
            sup = make_supervisor(Path(td))
            # created / size
            sup.create_terminal("parent")
            # created / size / turn (дочерний)
            child = sup.create_terminal("child", parent="local/parent")
            # labels
            sup.set_labels("local/parent", {"role": "n5"})
            # status + title
            p = sup.get_terminal("local/parent")
            p.handle.emit_osc("working", title="TITLE_N5")
            sup.step_once()
            # finished/exited: родитель + потомок (die default)
            sup.get_terminal("local/parent").handle.close()
            sup.step_once()
            # lost / keep / restarted: респаун (2 тика по RFC §18)
            t3 = sup.create_terminal("t3")
            t3.handle.kill()
            sup.step_once()
            sup.step_once()
            # removed
            sup.destroy_terminal("local/t3")

            types = {e["type"] for e in sup.events}
            # все канонические виды, кроме doc (doc — на API-уровне)
            self.assertTrue(
                RFC_EVENT_KINDS - {"doc"} <= types,
                f"missing kinds: {sorted(RFC_EVENT_KINDS - {'doc'} - types)}",
            )
            # ключевые наблюдаемые переходы на месте
            self.assertIn("created", types)
            self.assertIn("title", types)
            self.assertIn("turn", types)
            self.assertIn("labels", types)

    def test_event_types_registry_lists_rfc_kinds(self):
        self.assertTrue(RFC_EVENT_KINDS <= set(EVENT_TYPES))


class TestDocCasConformance(AioHTTPTestCase):
    """Пункт 4 (doc-событие) + пункт 5 (CAS mismatch-отклонение)."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="nexus-core-n5-doc-"))
        self.backend = MockPTYBackend()
        self.supervisor = SupervisorV1(backend=self.backend)
        super().setUp()

    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(
            base=self.tmp, supervisor=self.supervisor,
            templates_dir=self.tmp / "templates",
        )

    @unittest_run_loop
    async def test_doc_put_ok_monotonic_and_event(self):
        resp = await self.client.put("/api/core/doc", json={"content": "v1"})
        self.assertEqual(resp.status, 200)
        self.assertEqual((await resp.json())["version"], 1)

        resp = await self.client.put("/api/core/doc", json={"content": "v2"})
        self.assertEqual(resp.status, 200)
        self.assertEqual((await resp.json())["version"], 2)

        # событие doc в истории канала
        hist = self.app["state"].events.channel.replay()
        doc_events = [e for e in hist if e["type"] == "doc"]
        self.assertGreaterEqual(len(doc_events), 2)
        self.assertTrue(any(e["version"] == 2 for e in doc_events))

    @unittest_run_loop
    async def test_doc_cas_rejects_stale_base_version(self):
        await self.client.put("/api/core/doc", json={"content": "v1"})
        # корректный base_version → 200, версия 2
        resp = await self.client.put(
            "/api/core/doc", json={"content": "v2", "base_version": 1}
        )
        self.assertEqual(resp.status, 200)
        self.assertEqual((await resp.json())["version"], 2)

        # устаревший base_version → 409 конфликт
        resp = await self.client.put(
            "/api/core/doc",
            json={"content": "stale", "base_version": 1},
        )
        self.assertEqual(resp.status, 409)
        body = await resp.json()
        self.assertIn("conflict", body["error"].lower())

    def test_docstore_cas_conflict_raises(self):
        store = DocStore(self.tmp)
        self.assertEqual(store.put("a"), 1)
        with self.assertRaises(DocConflictError):
            store.put("b", base_version=5)
        self.assertEqual(store.put("c", base_version=1), 2)


if __name__ == "__main__":
    unittest.main()
