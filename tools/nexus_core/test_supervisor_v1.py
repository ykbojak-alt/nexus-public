#!/usr/bin/env python3
"""
tools/nexus_core/test_supervisor_v1.py — юнит-тесты супервизора v1 на mock.

Режим: CORE_MOCK=1 (mock-PTY). Реальный ConPTY/forkpty в юнит-тестах
не используется (см. ручной smoke-тест в отчёте).

Запуск: pytest tools/nexus_core/test_supervisor_v1.py
        python -m tools.nexus_core.test_supervisor_v1
"""

from __future__ import annotations

import asyncio
import os
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path

from tools.nexus_core.mock_pty import MockPTYBackend, MockPTYHandle
from tools.nexus_core.pty_backend import SpawnSpec, default_shell
from tools.nexus_core.supervisor_v1 import SupervisorV1, Terminal, parse_address


def make_supervisor(**kwargs) -> SupervisorV1:
    backend = kwargs.pop("backend", MockPTYBackend())
    return SupervisorV1(backend=backend, **kwargs)


class TestTerminalAddressing(unittest.TestCase):
    def test_default_machine_local(self):
        sup = make_supervisor()
        term = sup.create_terminal("t1")
        self.assertEqual(term.address, "local/t1")
        self.assertEqual(term.name, "t1")
        self.assertEqual(sup.get_terminal("local/t1"), term)
        # короткий адрес резолвится в self.machine
        self.assertEqual(sup.get_terminal("t1"), term)

    def test_custom_machine(self):
        sup = make_supervisor(machine="roy2")
        term = sup.create_terminal("t2")
        self.assertEqual(term.address, "roy2/t2")

    def test_parse_address(self):
        self.assertEqual(parse_address("local/t1"), ("local", "t1"))
        self.assertEqual(parse_address("roy2/term-x"), ("roy2", "term-x"))
        with self.assertRaises(ValueError):
            parse_address("t1")

    def test_labels(self):
        sup = make_supervisor()
        term = sup.create_terminal("t1", labels={"role": "coder", "persona": "forge"})
        self.assertEqual(term.labels["role"], "coder")
        sup.set_labels("local/t1", {"task": "N1"})
        self.assertEqual(term.labels["task"], "N1")

    def test_duplicate_address_rejected(self):
        sup = make_supervisor()
        sup.create_terminal("t1")
        with self.assertRaises(ValueError):
            sup.create_terminal("t1")


class TestPurgeExited(unittest.TestCase):
    """Registry-leak fix #371: exited-терминалы подчищаются по TTL."""

    def _make_exited(self, sup, name, exited_at):
        term = sup.create_terminal(name)
        term.state = "exited"
        term.exit_code = 0
        term.handle = None
        term.exited_at = exited_at
        return term

    def test_purge_removes_stale_exited(self):
        sup = make_supervisor()
        self._make_exited(sup, "t1", time.time() - 120)  # старше TTL
        self._make_exited(sup, "t2", time.time() - 5)    # свежий
        removed = sup.purge_exited(exited_ttl=60)
        self.assertEqual(removed, 1)
        self.assertIsNone(sup.get_terminal("local/t1"))
        self.assertIsNotNone(sup.get_terminal("local/t2"))

    def test_list_terminals_lazy_cleans(self):
        sup = make_supervisor()
        self._make_exited(sup, "a1", time.time() - 120)
        sup.create_terminal("live1")
        terms = sup.list_terminals()
        self.assertNotIn("local/a1", sup.terminals)
        self.assertIn("local/live1", [t.address for t in terms])

    def test_purge_skips_non_exited(self):
        sup = make_supervisor()
        sup.create_terminal("idle1")  # idle — не exited
        removed = sup.purge_exited(exited_ttl=0)
        self.assertEqual(removed, 0)
        self.assertIsNotNone(sup.get_terminal("local/idle1"))

    def test_to_dict(self):
        sup = make_supervisor()
        term = sup.create_terminal("t1", labels={"role": "coder"})
        d = term.to_dict()
        self.assertEqual(d["address"], "local/t1")
        self.assertEqual(d["labels"], {"role": "coder"})
        self.assertEqual(d["state"], "idle")


class TestSpawnAndIO(unittest.TestCase):
    def test_spawn_creates_terminal(self):
        sup = make_supervisor()
        term = sup.create_terminal("t1")
        self.assertIsNotNone(term.handle)
        self.assertTrue(term.handle.alive())
        self.assertIsInstance(term.handle, MockPTYHandle)

    def test_shell_command_default(self):
        sup = make_supervisor()
        term = sup.create_terminal("t1", command=["sh", "-i"])
        spec: SpawnSpec = term.handle.spec
        self.assertEqual(spec.command, ["sh", "-i"])
        self.assertIsInstance(default_shell(), list)
        self.assertTrue(default_shell())

    def test_send_writes_to_pty(self):
        sup = make_supervisor()
        term = sup.create_terminal("t1")
        self.assertTrue(sup.send("local/t1", "echo hi"))
        self.assertTrue(term.handle.stdin_data().endswith(b"echo hi\r"))

    def test_send_unknown_terminal_fails(self):
        sup = make_supervisor()
        self.assertFalse(sup.send("local/missing", "x"))

    def test_read_output(self):
        sup = make_supervisor()
        term = sup.create_terminal("t1")
        term.handle.emit_raw(b"hello from shell\n")
        data = term.handle.read()
        self.assertIn(b"hello from shell", data)


class TestTerminalResize(unittest.TestCase):
    def test_resize_updates_handle_registry_and_respawn_spec(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            registry_path = Path(temp_dir) / "terminals.json"
            backend = MockPTYBackend()
            sup = make_supervisor(backend=backend, registry_path=registry_path)
            term = sup.create_terminal("resize-me")

            resized = sup.resize_terminal("local/resize-me", 96, 34)

            self.assertIs(resized, term)
            self.assertEqual((term.cols, term.rows), (96, 34))
            self.assertEqual((term.handle.cols, term.handle.rows), (96, 34))
            saved = json.loads(registry_path.read_text(encoding="utf-8"))
            # W67: registry всегда {"v":N,"rows":[…]} — v0 bare-list
            # тоже поддерживается читателем
            rows = saved["rows"] if isinstance(saved, dict) else saved
            self.assertEqual((rows[0]["cols"], rows[0]["rows"]), (96, 34))

            term.handle.kill()
            sup.step_once()
            sup.step_once()
            self.assertEqual((term.handle.spec.cols, term.handle.spec.rows), (96, 34))

    def test_resize_unknown_or_exited_terminal_raises_key_error(self):
        sup = make_supervisor()
        with self.assertRaises(KeyError):
            sup.resize_terminal("missing", 96, 34)

        term = sup.create_terminal("closed")
        term.handle.close()
        sup.step_once()
        with self.assertRaises(KeyError):
            sup.resize_terminal("closed", 96, 34)


class TestAsyncRegistryRestore(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def _write_registry(path, rows):
        path.write_text(json.dumps(rows), encoding="utf-8")

    @staticmethod
    def _row(name, parent=None):
        return {
            "name": name, "machine": "local", "state": "idle",
            "keep": True, "command": default_shell(), "parent": parent,
            "labels": {}, "cols": 120, "rows": 30,
        }

    async def test_restoring_state_and_counts_cover_spawn_failure(self):
        class BlockingBackend(MockPTYBackend):
            def __init__(self):
                super().__init__()
                self.started = threading.Event()
                self.release = threading.Event()

            def spawn(self, spec):
                self.started.set()
                self.release.wait(timeout=3)
                address = spec.env.get("NX_TERMINAL_ID", "")
                if address.endswith("/bad"):
                    raise RuntimeError("mock spawn failure")
                return super().spawn(spec)

        with tempfile.TemporaryDirectory() as temp_dir:
            registry = Path(temp_dir) / "registry.json"
            self._write_registry(registry, [self._row("good"), self._row("bad")])
            backend = BlockingBackend()
            sup = SupervisorV1(backend=backend, registry_path=registry,
                              restore=False)

            task = asyncio.create_task(sup.restore_registry_async())
            started = await asyncio.to_thread(backend.started.wait, 1)
            self.assertTrue(started)
            self.assertEqual(
                {term.state for term in sup.list_terminals()}, {"restoring"})
            self.assertEqual(sup.restore_status,
                             {"pending": 2, "done": 0, "failed": 0})

            backend.release.set()
            await task
            self.assertEqual(sup.restore_status,
                             {"pending": 0, "done": 1, "failed": 1})
            self.assertEqual(sup.get_terminal("good").state, "idle")
            self.assertEqual(sup.get_terminal("bad").state, "lost")
            self.assertTrue(sup._registry_restored)

    async def test_restore_limits_spawn_parallelism_and_keeps_parent_first(self):
        class CountingBackend(MockPTYBackend):
            def __init__(self):
                super().__init__()
                self.active = 0
                self.max_active = 0
                self.order = []
                self.lock = threading.Lock()

            def spawn(self, spec):
                address = spec.env["NX_TERMINAL_ID"]
                with self.lock:
                    self.active += 1
                    self.max_active = max(self.max_active, self.active)
                    self.order.append(address)
                try:
                    time.sleep(0.04)
                    return super().spawn(spec)
                finally:
                    with self.lock:
                        self.active -= 1

        with tempfile.TemporaryDirectory() as temp_dir:
            registry = Path(temp_dir) / "registry.json"
            # Child precedes parent in the file; restore must still spawn parent first.
            rows = [
                self._row("child", parent="local/parent"),
                self._row("parent"), self._row("root-a"), self._row("root-b"),
            ]
            self._write_registry(registry, rows)
            backend = CountingBackend()
            sup = SupervisorV1(backend=backend, registry_path=registry,
                              restore=False)

            await sup.restore_registry_async()

            self.assertLessEqual(backend.max_active, 2)
            self.assertEqual(backend.max_active, 2)
            self.assertLess(backend.order.index("local/parent"),
                            backend.order.index("local/child"))
            self.assertEqual(sup.restore_status,
                             {"pending": 0, "done": 4, "failed": 0})


class TestOscStatusFlow(unittest.TestCase):
    def setUp(self):
        self.sup = make_supervisor()
        self.term = self.sup.create_terminal("t1")

    def test_working_status(self):
        self.term.handle.emit_osc("working")
        transitions = self.sup.step_once()
        self.assertEqual(transitions, 1)
        self.assertEqual(self.term.state, "working")
        self.assertFalse(self.term.attention)

    def test_blocked_sets_attention(self):
        self.term.handle.emit_osc("blocked")
        self.sup.step_once()
        self.assertEqual(self.term.state, "blocked")
        self.assertTrue(self.term.attention)
        types = [e["type"] for e in self.sup.events]
        self.assertIn("attention", types)

    def test_done(self):
        self.term.handle.emit_osc("done")
        self.sup.step_once()
        self.assertEqual(self.term.state, "done")
        types = [e["type"] for e in self.sup.events]
        self.assertIn("done", types)

    def test_status_events_emitted(self):
        self.term.handle.emit_osc("working")
        self.sup.step_once()
        events = [e for e in self.sup.events if e["type"] == "status"]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["state"], "working")
        self.assertEqual(events[0]["address"], "local/t1")

    def test_status_noop_if_unchanged(self):
        self.term.handle.emit_osc("working")
        self.sup.step_once()
        n_events = len(self.sup.events)
        self.term.handle.emit_osc("working")
        self.assertEqual(self.sup.step_once(), 0)
        self.assertEqual(len(self.sup.events), n_events)

    def test_restores_idle_after_respawn(self):
        self.term.handle.emit_osc("working")
        self.sup.step_once()
        self.assertEqual(self.term.state, "working")
        self.term.handle.kill()
        self.sup.step_once()
        # потеря по RFC §18: требуется 2 пропущенных тика → respawn → idle
        self.sup.step_once()
        self.assertEqual(self.term.state, "idle")


class TestKeepAlive(unittest.TestCase):
    def test_loss_triggers_respawn(self):
        sup = make_supervisor()
        term = sup.create_terminal("t1")
        old_handle = term.handle
        old_handle.kill()
        self.assertFalse(old_handle.alive())
        sup.step_once()
        # потеря по RFC §18: 2 пропущенных тика → lost → respawn
        sup.step_once()
        self.assertIsNotNone(term.handle)
        self.assertIsNot(term.handle, old_handle)
        self.assertTrue(term.handle.alive())
        self.assertEqual(term.respawn_count, 1)
        types = [e["type"] for e in sup.events]
        self.assertIn("lost", types)
        self.assertIn("respawn", types)

    def test_respawn_uses_same_shell_and_labels(self):
        # RFC §10/K5: keep рестартует SHELL (не исходную команду); лейблы живут
        from tools.nexus_core.pty_backend import default_shell
        sup = make_supervisor()
        term = sup.create_terminal(
            "t1", command=["sh", "-i"], labels={"role": "coder"}
        )
        term.handle.kill()
        sup.step_once()
        # потеря по RFC §18: 2 пропущенных тика → respawn
        sup.step_once()
        self.assertEqual(term.handle.spec.command, default_shell())
        self.assertEqual(term.labels["role"], "coder")
        # лейблы переживают респаун
        self.assertEqual(term.labels["role"], "coder")

    def test_no_respawn_when_keep_false(self):
        sup = make_supervisor()
        term = sup.create_terminal("t1", keep=False)
        old_handle = term.handle
        old_handle.kill()
        sup.step_once()
        self.assertTrue(term.handle is None or term.handle is old_handle)
        if term.handle is not None:
            self.assertFalse(term.handle.alive())

    def test_intentional_close_no_respawn(self):
        sup = make_supervisor()
        term = sup.create_terminal("t1")
        term.handle.close()
        sup.step_once()
        self.assertIsNone(term.handle)
        self.assertEqual(term.state, "exited")
        self.assertEqual(term.respawn_count, 0)
        types = [e["type"] for e in sup.events]
        self.assertIn("exited", types)
        self.assertNotIn("respawn", types)

    def test_close_all(self):
        sup = make_supervisor()
        t1 = sup.create_terminal("t1")
        t2 = sup.create_terminal("t2")
        sup.close()
        self.assertIsNone(t1.handle)
        self.assertIsNone(t2.handle)


class TestCoreMockEnv(unittest.TestCase):
    def test_core_mock_selects_mock_backend(self):
        old = os.environ.get("CORE_MOCK")
        os.environ["CORE_MOCK"] = "1"
        try:
            sup = SupervisorV1()  # без явного backend
            self.assertIsInstance(sup.backend, MockPTYBackend)
        finally:
            if old is None:
                os.environ.pop("CORE_MOCK", None)
            else:
                os.environ["CORE_MOCK"] = old


class TestMockBackend(unittest.TestCase):
    def test_spawn_returns_handle(self):
        backend = MockPTYBackend()
        handle = backend.spawn(SpawnSpec(command=["sh"]))
        self.assertIsInstance(handle, MockPTYHandle)
        self.assertTrue(handle.alive())

    def test_write_roundtrip(self):
        backend = MockPTYBackend()
        handle = backend.spawn(SpawnSpec(command=["sh"]))
        handle.emit_raw(b"$ ")
        self.assertEqual(handle.read(), b"$ ")

    def test_kill_then_dead(self):
        backend = MockPTYBackend()
        handle = backend.spawn(SpawnSpec(command=["sh"]))
        handle.kill()
        self.assertFalse(handle.alive())

    def test_second_spawn_new_id(self):
        backend = MockPTYBackend()
        h1 = backend.spawn(SpawnSpec(command=["sh"]))
        h2 = backend.spawn(SpawnSpec(command=["sh"]))
        self.assertNotEqual(h1.name, h2.name)


if __name__ == "__main__":
    unittest.main()
