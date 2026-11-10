#!/usr/bin/env python3
"""
tools/nexus_core/test_n2_modules.py — юнит-тесты модулей N2:
DocStore (версионирование), TemplateStore (парсинг/перечисление),
EventChannel (subscribe/publish/replay), CLI nx (парсинг, HC_COMPAT,
unimplemented-команды).

Запуск: pytest tools/nexus_core/test_n2_modules.py
        python -m tools.nexus_core.test_n2_modules
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from tools.nexus_core._core_testserver import core_test_server
from tools.nexus_core.cli import main as cli_main
from tools.nexus_core.doc_store import DocStore
from tools.nexus_core.events import EventChannel
from tools.nexus_core.supervisor_v1 import SupervisorV1
from tools.nexus_core.templates import Template, TemplateStore, default_templates_dir


def make_temp_dir() -> Path:
    return Path(tempfile.mkdtemp(prefix="nexus-core-mod-test-"))


class TestDocStore(unittest.TestCase):
    def setUp(self):
        self.tmp = make_temp_dir()
        self.store = DocStore(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_empty_latest_none(self):
        self.assertIsNone(self.store.latest())
        self.assertEqual(self.store.version, 0)

    def test_put_increments_version(self):
        v1 = self.store.put("first")
        v2 = self.store.put("second")
        self.assertEqual(v1, 1)
        self.assertEqual(v2, 2)
        self.assertEqual(self.store.version, 2)

    def test_get_by_version(self):
        self.store.put("first")
        self.store.put("second")
        doc = self.store.get(1)
        self.assertEqual(doc["content"], "first")
        self.assertEqual(doc["version"], 1)
        doc = self.store.get(2)
        self.assertEqual(doc["content"], "second")

    def test_get_missing_none(self):
        self.assertIsNone(self.store.get(99))

    def test_latest_returns_newest(self):
        self.store.put("first")
        self.store.put("second")
        doc = self.store.latest()
        self.assertEqual(doc["content"], "second")

    def test_persistence_on_disk(self):
        self.store.put("hello")
        store2 = DocStore(self.tmp)
        self.assertEqual(store2.version, 1)
        self.assertEqual(store2.get(1)["content"], "hello")

    def test_versions_list(self):
        self.store.put("a")
        self.store.put("b")
        self.assertEqual(self.store.versions(), [1, 2])


class TestTemplateStore(unittest.TestCase):
    def setUp(self):
        self.tmp = make_temp_dir()
        self.dir = self.tmp / "templates"
        self.dir.mkdir()
        (self.dir / "coder.md").write_text(
            "---\ncommand: claude --model sonnet\n---\nYou are a coder.\n",
            encoding="utf-8",
        )
        (self.dir / "plain.md").write_text("Just a body.\n", encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_list_templates(self):
        store = TemplateStore(self.dir)
        names = [t.name for t in store.list_templates()]
        self.assertEqual(names, ["coder", "plain"])

    def test_frontmatter_parsed(self):
        store = TemplateStore(self.dir)
        tpl = store.get("coder")
        self.assertEqual(tpl.command, ["claude", "--model", "sonnet"])
        self.assertEqual(tpl.body, "You are a coder.")
        self.assertEqual(tpl.meta["command"], "claude --model sonnet")

    def test_body_only_template(self):
        store = TemplateStore(self.dir)
        tpl = store.get("plain")
        self.assertEqual(tpl.command, [])
        self.assertEqual(tpl.body, "Just a body.")

    def test_get_missing_none(self):
        store = TemplateStore(self.dir)
        self.assertIsNone(store.get("nobody"))

    def test_missing_directory_empty(self):
        store = TemplateStore(self.tmp / "nope")
        self.assertEqual(store.list_templates(), [])

    def test_default_templates_dir_env(self):
        os.environ["NX_TEMPLATES_DIR"] = str(self.dir)
        try:
            self.assertEqual(default_templates_dir(), self.dir)
        finally:
            del os.environ["NX_TEMPLATES_DIR"]


class TestEventChannel(unittest.TestCase):
    def test_subscribe_publish(self):
        async def run():
            ch = EventChannel()
            q = await ch.subscribe()
            ch.publish({"type": "status", "state": "working"})
            event = await asyncio.wait_for(q.get(), timeout=1.0)
            self.assertEqual(event["type"], "status")
            self.assertEqual(event["state"], "working")
            self.assertIn("seq", event)
            self.assertIn("ts", event)

        asyncio.run(run())

    def test_unsubscribe_stops_delivery(self):
        async def run():
            ch = EventChannel()
            q = await ch.subscribe()
            await ch.unsubscribe(q)
            ch.publish({"type": "status"})
            self.assertTrue(q.empty())

        asyncio.run(run())

    def test_replay_history(self):
        async def run():
            ch = EventChannel()
            ch.publish({"type": "spawn", "address": "local/t1"})
            ch.publish({"type": "status", "state": "working"})
            history = ch.replay()
            self.assertEqual(len(history), 2)
            self.assertEqual(history[0]["type"], "spawn")
            # replay после seq
            after = ch.replay(after_seq=history[0]["seq"])
            self.assertEqual(len(after), 1)
            self.assertEqual(after[0]["type"], "status")

        asyncio.run(run())

    def test_history_capped(self):
        async def run():
            ch = EventChannel()
            for i in range(1500):
                ch.publish({"type": "e", "i": i})
            self.assertEqual(len(ch.replay()), 1000)
            self.assertEqual(ch.replay()[0]["i"], 500)

        asyncio.run(run())


class TestCli(unittest.TestCase):
    """#515: nx — thin client → real core API (CoreTestServer, mock-PTY).

    cli_main бьёт по HTTP в поднятый в потоке create_app(base=tmp):
    CORE_MOCK=1 → MockPTYBackend, registry_path=tmp/registry.json —
    тот же контур, что у `nx serve`.
    """

    def setUp(self):
        self._env = os.environ.copy()
        os.environ["CORE_MOCK"] = "1"
        self.tmp = make_temp_dir()
        os.environ["NX_STATE_DIR"] = str(self.tmp)
        # machines-мутации требуют NEXUS_CORE_TOKEN всегда (HERETIC #438);
        # клиент подхватывает его же из env → X-Nexus-Key.
        os.environ["NEXUS_CORE_TOKEN"] = "test-token"
        self._srv_ctx = core_test_server(self.tmp)
        self.server = self._srv_ctx.__enter__()
        os.environ["NEXUS_CORE_URL"] = self.server.url

    def tearDown(self):
        self._srv_ctx.__exit__(None, None, None)
        os.environ.clear()
        os.environ.update(self._env)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_ls_empty(self):
        rc = cli_main(["ls", "--json"])
        self.assertEqual(rc, 0)

    def test_run_and_ls_persists(self):
        rc = cli_main(["run", "t1", "sh", "-i", "--label", "role=coder"])
        self.assertEqual(rc, 0)
        rc = cli_main(["ls", "--json"])
        self.assertEqual(rc, 0)
        # персистентность: registry.json на диске виден новому supervisor
        sup = SupervisorV1(registry_path=self.tmp / "registry.json")
        self.assertIsNotNone(sup.get_terminal("local/t1"))

    def test_send_requires_terminal_id(self):
        rc = cli_main(["send", "hello"])
        self.assertEqual(rc, 1)

    def test_send_with_env_terminal(self):
        os.environ["NX_TERMINAL_ID"] = "local/t1"
        cli_main(["run", "t1", "sh", "-i"])
        rc = cli_main(["send", "echo hi"])
        self.assertEqual(rc, 0)

    def test_kill_escalation(self):
        cli_main(["run", "t1", "sh", "-i"])
        rc = cli_main(["kill", "--term", "t1"])
        self.assertEqual(rc, 0)

    def test_unimplemented_command_exists(self):
        rc = cli_main(["server", "restart"])
        self.assertEqual(rc, 2)
        rc = cli_main(["update", "--version", "1.2"])
        self.assertEqual(rc, 2)

    def test_machine_ls_ok(self):
        rc = cli_main(["machine", "ls"])
        self.assertEqual(rc, 0)

    def test_machine_add(self):
        rc = cli_main(["machine", "add", "vps", "user@host", "--transport", "ssh"])
        self.assertEqual(rc, 0)

    def test_events_command_lists_events(self):
        cli_main(["run", "t1", "sh", "-i"])
        # --limit: SSE живой поток, для теста ограничиваем N событий
        rc = cli_main(["events", "--limit", "3"])
        self.assertEqual(rc, 0)

    def test_doc_put(self):
        rc = cli_main(["doc", "--content", "hello", "--json"])
        self.assertEqual(rc, 0)
        rc = cli_main(["doc", "--json"])
        self.assertEqual(rc, 0)

    def test_hc_compat_alias(self):
        os.environ["HC_COMPAT"] = "1"
        rc = cli_main(["hc", "ls", "--json"])
        self.assertEqual(rc, 0)

    def test_templates_command(self):
        rc = cli_main(["templates", "--json"])
        self.assertEqual(rc, 0)


if __name__ == "__main__":
    unittest.main()
