#!/usr/bin/env python3
"""
tools/nexus_core/test_api.py — юнит-тесты API-слоя nexus-core (N2).

Режим: CORE_MOCK=1 (mock-PTY, без реального ConPTY). Покрывают:
run/keep-жизненный цикл, события (SSE), doc-версионирование, wait,
kill-эскалация, die-with-parent/outlive-parent, templates.

Запуск: pytest tools/nexus_core/test_api.py
        python -m tools.nexus_core.test_api
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from tools.nexus_core import api as core_api
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.pty_backend import default_shell
from tools.nexus_core.supervisor_v1 import SupervisorV1
from tools.nexus_core.templates import TemplateStore


def make_temp_base() -> Path:
    return Path(tempfile.mkdtemp(prefix="nexus-core-api-test-"))


def test_api_server_defaults_to_ops_port_5684():
    from unittest.mock import patch

    with patch.dict("os.environ", {"NEXUS_CORE_TOKEN": "test-only"}):
        with patch.object(core_api, "create_app", return_value=object()):
            with patch.object(core_api.web, "run_app") as run_app:
                core_api.run_server()

    assert core_api.DEFAULT_PORT == 5684
    assert run_app.call_args.kwargs["port"] == 5684


class CoreApiTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = make_temp_base()
        self.backend = MockPTYBackend()
        self.supervisor = SupervisorV1(backend=self.backend)
        super().setUp()

    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.tmp, supervisor=self.supervisor,
                          templates_dir=self.tmp / "templates")

    # -- helpers --------------------------------------------------------

    async def run_terminal(self, name="t1", **kwargs):
        resp = await self.client.post("/api/core/run", json={
            "name": name,
            "command": ["sh", "-i"],
            **kwargs,
        })
        self.assertEqual(resp.status, 200)
        return await resp.json()


class TestRunLifecycle(CoreApiTestCase):
    @unittest_run_loop
    async def test_run_creates_terminal(self):
        data = await self.run_terminal()
        self.assertEqual(data["address"], "local/t1")
        self.assertEqual(data["state"], "idle")

    @unittest_run_loop
    async def test_run_with_labels_and_parent(self):
        await self.run_terminal("t1")
        data = await self.run_terminal(
            name="child",
            labels={"role": "coder"},
            parent="local/t1",
            die_with_parent=True,
        )
        self.assertEqual(data["labels"], {"role": "coder"})
        self.assertEqual(data["parent"], "local/t1")
        self.assertTrue(data["die_with_parent"])

    @unittest_run_loop
    async def test_run_duplicate_name_409(self):
        await self.run_terminal("t1")
        resp = await self.client.post("/api/core/run", json={"name": "t1"})
        self.assertEqual(resp.status, 409)

    @unittest_run_loop
    async def test_terminals_list(self):
        await self.run_terminal("t1")
        await self.run_terminal("t2")
        resp = await self.client.get("/api/core/terminals")
        data = await resp.json()
        self.assertEqual(data["count"], 2)
        self.assertEqual(len(data["terminals"]), 2)


    @unittest_run_loop
    async def test_agents_list(self):
        await self.run_terminal("t1", labels={"persona": "forge"})
        resp = await self.client.get("/api/core/agents")
        data = await resp.json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["agents"][0]["address"], "local/t1")
        self.assertEqual(data["agents"][0]["labels"]["persona"], "forge")

    @unittest_run_loop
    async def test_machines_and_spaces(self):
        await self.run_terminal("t1")
        resp = await self.client.get("/api/core/machines")
        data = await resp.json()
        self.assertIn("local", data["machines"])
        resp = await self.client.get("/api/core/spaces")
        data = await resp.json()
        self.assertEqual(len(data["spaces"]), 1)
        self.assertEqual(data["spaces"][0]["machine"], "local")

    @unittest_run_loop
    async def test_send(self):
        await self.run_terminal("t1")
        resp = await self.client.post("/api/core/send", json={"term": "t1", "text": "echo hi"})
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["status"], "sent")
        handle = self.backend.terminals[list(self.backend.terminals)[0]]
        self.assertTrue(handle.stdin_data().endswith(b"echo hi\r"))

    @unittest_run_loop
    async def test_send_unknown_term_404(self):
        resp = await self.client.post("/api/core/send", json={"term": "nope", "text": "x"})
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_screen_tail_and_404(self):
        await self.run_terminal("t1")
        handle = self.backend.terminals[list(self.backend.terminals)[0]]
        handle.emit_raw(b"hello screen\nsecond line\n")
        self.supervisor.step_once()
        resp = await self.client.get("/api/core/screen/t1")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["term"], "local/t1")
        self.assertIn("hello screen", data["screen"])
        resp = await self.client.get("/api/core/screen/nope")
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_keys(self):
        await self.run_terminal("t1")
        resp = await self.client.post("/api/core/keys", json={
            "term": "t1", "keys": ["ctrl+c", "enter"],
        })
        self.assertEqual(resp.status, 200)
        handle = self.backend.terminals[list(self.backend.terminals)[0]]
        self.assertIn(b"\x03", handle.stdin_data())
        self.assertIn(b"\r", handle.stdin_data())

    @unittest_run_loop
    async def test_put_and_park(self):
        await self.run_terminal("t1")
        resp = await self.client.post("/api/core/put", json={"term": "t1", "text": "x"})
        self.assertEqual(resp.status, 200)
        resp = await self.client.post("/api/core/park", json={"term": "t1"})
        self.assertEqual(resp.status, 200)
        term = self.supervisor.get_terminal("local/t1")
        self.assertFalse(term.keep)

    @unittest_run_loop
    async def test_keep_flag(self):
        await self.run_terminal("t1", keep=True)
        term = self.supervisor.get_terminal("local/t1")
        self.assertTrue(term.keep)
        resp = await self.client.post("/api/core/keep", json={"term": "t1", "keep": False})
        self.assertEqual(resp.status, 200)
        self.assertFalse(term.keep)


class TestTerminalResize(CoreApiTestCase):
    @unittest_run_loop
    async def test_resize_updates_pty_and_terminal_listing(self):
        await self.run_terminal("resize-me")
        term = self.supervisor.get_terminal("resize-me")
        resize = Mock()
        term.handle.resize = resize

        resp = await self.client.post(
            "/api/core/terminal/local/resize-me/resize",
            json={"cols": 96, "rows": 34},
        )

        self.assertEqual(resp.status, 200)
        payload = await resp.json()
        self.assertEqual((payload["cols"], payload["rows"]), (96, 34))
        resize.assert_called_once_with(96, 34)
        listing = await (await self.client.get("/api/core/terminals")).json()
        row = next(item for item in listing["terminals"] if item["name"] == "resize-me")
        self.assertEqual((row["cols"], row["rows"]), (96, 34))

    @unittest_run_loop
    async def test_resize_unknown_terminal_is_404(self):
        resp = await self.client.post(
            "/api/core/terminal/missing/resize",
            json={"cols": 96, "rows": 34},
        )
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_resize_rejects_invalid_dimensions(self):
        await self.run_terminal("resize-me")
        term = self.supervisor.get_terminal("resize-me")
        resize = Mock()
        term.handle.resize = resize
        for body in (
            {"cols": 0, "rows": 34},
            {"cols": 96, "rows": 65536},
            {"cols": True, "rows": 34},
            {"cols": "96", "rows": 34},
            {"cols": 96},
        ):
            with self.subTest(body=body):
                resp = await self.client.post(
                    "/api/core/terminal/resize-me/resize", json=body,
                )
                self.assertEqual(resp.status, 400)
        resize.assert_not_called()
        self.assertEqual((term.cols, term.rows), (120, 30))


class RestoreMutationApiTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = make_temp_base()

        class BlockingBackend(MockPTYBackend):
            def __init__(self):
                super().__init__()
                self.started = threading.Event()
                self.release = threading.Event()

            def spawn(self, spec):
                self.started.set()
                self.release.wait(timeout=5)
                return super().spawn(spec)

        self.backend = BlockingBackend()
        rows = [{
            "name": name, "machine": "local", "state": "idle",
            "keep": True, "command": default_shell(), "cols": 120, "rows": 30,
        } for name in (
            "sendterm", "putterm", "keysterm", "killterm", "renameterm", "resizeterm",
        )]
        (self.tmp / "registry.json").write_text(
            json.dumps(rows), encoding="utf-8")
        self.supervisor = SupervisorV1(
            backend=self.backend, registry_path=self.tmp / "registry.json",
            restore=False,
        )
        super().setUp()

    def tearDown(self):
        self.backend.release.set()
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.tmp, supervisor=self.supervisor,
                          templates_dir=self.tmp / "templates", pump=True)

    @unittest_run_loop
    async def test_terminal_mutations_conflict_while_restoring_then_resume(self):
        started = await asyncio.to_thread(self.backend.started.wait, 2)
        self.assertTrue(started, "restore spawn did not start")

        status = await (await self.client.get("/api/core/server")).json()
        self.assertEqual(status["restore"], {"pending": 6, "done": 0, "failed": 0})
        terminals = await (await self.client.get("/api/core/terminals")).json()
        self.assertEqual({t["state"] for t in terminals["terminals"]}, {"restoring"})

        requests = [
            ("send", "/api/core/send", {"term": "local/sendterm", "text": "x"}),
            ("put", "/api/core/put", {"term": "local/putterm", "text": "x"}),
            ("keys", "/api/core/keys", {"term": "local/keysterm", "keys": ["enter"]}),
            ("kill", "/api/core/kill", {"term": "local/killterm", "stage": "kill"}),
            ("rename", "/api/core/terminal/local/renameterm/rename", {"new_name": "renamed"}),
            ("resize", "/api/core/terminal/local/resizeterm/resize", {"cols": 96, "rows": 34}),
        ]
        for _, url, body in requests:
            response = await self.client.post(url, json=body)
            self.assertEqual(response.status, 409)
            self.assertEqual(await response.json(), {"error": "terminal restoring"})

        self.backend.release.set()
        for _ in range(60):
            status = await (await self.client.get("/api/core/server")).json()
            if status["restore"]["pending"] == 0:
                break
            await asyncio.sleep(0.025)
        self.assertEqual(status["restore"], {"pending": 0, "done": 6, "failed": 0})

        for _, url, body in requests:
            response = await self.client.post(url, json=body)
            self.assertEqual(response.status, 200, (url, await response.text()))


class TestWaitApi(CoreApiTestCase):
    @unittest_run_loop
    async def test_wait_exit(self):
        await self.run_terminal("t1")
        term = self.supervisor.get_terminal("local/t1")
        term.handle.close()
        resp = await self.client.post("/api/core/wait", json={"term": "t1", "timeout": 1})
        data = await resp.json()
        self.assertEqual(data["state"], "exited")

    @unittest_run_loop
    async def test_wait_timeout(self):
        await self.run_terminal("t1")
        resp = await self.client.post("/api/core/wait", json={"term": "t1", "timeout": 0.05})
        data = await resp.json()
        self.assertEqual(data["state"], "timeout")

    @unittest_run_loop
    async def test_wait_output_match(self):
        await self.run_terminal("t1")
        term = self.supervisor.get_terminal("local/t1")
        term.handle.emit_raw(b"MAGIC READY\n")
        resp = await self.client.post("/api/core/wait", json={
            "term": "t1", "output": "MAGIC", "timeout": 1,
        })
        data = await resp.json()
        self.assertEqual(data["state"], "output_match")
        self.assertEqual(data["matched"], "MAGIC")

    @unittest_run_loop
    async def test_wait_children(self):
        await self.run_terminal("parent")
        await self.run_terminal("c1", parent="local/parent")
        c2 = await self.run_terminal("c2", parent="local/parent")
        self.supervisor.get_terminal("local/c1").handle.close()
        self.supervisor.get_terminal(c2["address"]).handle.close()
        resp = await self.client.post("/api/core/wait", json={
            "term": "local/parent", "children": "all", "timeout": 1,
        })
        data = await resp.json()
        self.assertEqual(data["state"], "exited")
        self.assertEqual(len(data["children"]), 2)

    @unittest_run_loop
    async def test_wait_invalid_children_value(self):
        resp = await self.client.post("/api/core/wait", json={
            "term": "t1", "children": "bogus",
        })
        self.assertEqual(resp.status, 400)


class TestKillApi(CoreApiTestCase):
    @unittest_run_loop
    async def test_kill_escalation(self):
        await self.run_terminal("t1")
        resp = await self.client.post("/api/core/kill", json={"term": "t1"})
        data = await resp.json()
        self.assertEqual(len(data["steps"]), 3)
        self.assertEqual(data["final"], "kill")
        self.assertEqual(data["steps"][2]["state"], "dead")

    @unittest_run_loop
    async def test_kill_unknown_term_404(self):
        resp = await self.client.post("/api/core/kill", json={"term": "nope"})
        self.assertEqual(resp.status, 404)


class TestEventsApi(CoreApiTestCase):
    @unittest_run_loop
    async def test_events_stream_receives_event(self):
        await self.run_terminal("t1")
        term = self.supervisor.get_terminal("local/t1")

        resp = await self.client.get("/api/core/events")
        self.assertEqual(resp.status, 200)
        self.assertEqual(resp.headers["Content-Type"], "text/event-stream")

        # первая порция — replay (spawn)
        first = (await asyncio.wait_for(resp.content.read(8192), timeout=5.0)).decode("utf-8")
        self.assertIn("event: spawn", first)

        # live-событие после step_once. Внимание: step_once может эмитить
        # 'attention' РАНЬШЕ 'status' (attention-on-output, supervisor
        # ~line 899) — ищем status-событие среди всех кадров чанка.
        term.handle.emit_osc("working")
        self.supervisor.step_once()
        second = (await asyncio.wait_for(resp.content.read(8192), timeout=5.0)).decode("utf-8")
        self.assertIn("event: status", second)
        events = []
        for block in second.split("\n\n"):
            if "data: " in block:
                try:
                    events.append(json.loads(block.split("data: ", 1)[1].strip()))
                except json.JSONDecodeError:
                    pass
        status_ev = [e for e in events
                     if e.get("type") == "status" and e.get("state") == "working"]
        self.assertTrue(status_ev, f"no status/working event in: {events}")
        await resp.release()

    @unittest_run_loop
    async def test_events_stream_replays_history(self):
        await self.run_terminal("t1")
        resp = await self.client.get("/api/core/events")
        text = (await asyncio.wait_for(resp.content.read(8192), timeout=5.0)).decode("utf-8")
        self.assertIn("event: spawn", text)
        await resp.release()


class TestDocApi(CoreApiTestCase):
    @unittest_run_loop
    async def test_doc_put_and_get(self):
        resp = await self.client.put("/api/core/doc", json={"content": "v1 body"})
        data = await resp.json()
        self.assertEqual(data["version"], 1)

        resp = await self.client.get("/api/core/doc")
        doc = await resp.json()
        self.assertEqual(doc["version"], 1)
        self.assertEqual(doc["content"], "v1 body")

    @unittest_run_loop
    async def test_doc_versions_monotonic(self):
        await self.client.post("/api/core/doc", json={"content": "one"})
        await self.client.post("/api/core/doc", json={"content": "two"})
        resp = await self.client.get("/api/core/doc")
        doc = await resp.json()
        self.assertEqual(doc["version"], 2)
        self.assertEqual(doc["content"], "two")
        # версия 1 доступна
        resp = await self.client.get("/api/core/doc?version=1")
        doc = await resp.json()
        self.assertEqual(doc["content"], "one")
        # latest alias
        resp = await self.client.get("/api/core/doc/latest")
        doc = await resp.json()
        self.assertEqual(doc["version"], 2)

    @unittest_run_loop
    async def test_doc_missing_version_404(self):
        resp = await self.client.get("/api/core/doc?version=42")
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_doc_invalid_version_400(self):
        resp = await self.client.get("/api/core/doc?version=abc")
        self.assertEqual(resp.status, 400)


class TestTemplatesApi(CoreApiTestCase):
    def _write_template(self, name="coder", command="claude", body="Be a coder."):
        d = self.tmp / "templates"
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{name}.md").write_text(
            f"---\ncommand: {command}\n---\n{body}\n",
            encoding="utf-8",
        )

    @unittest_run_loop
    async def test_templates_list(self):
        self._write_template()
        resp = await self.client.get("/api/core/templates")
        data = await resp.json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["templates"][0]["name"], "coder")
        self.assertEqual(data["templates"][0]["command"], ["claude"])

    @unittest_run_loop
    async def test_template_run(self):
        self._write_template()
        resp = await self.client.post("/api/core/templates/coder/run", json={
            "args": ["--task", "X"],
            "term": "tpl-coder",
        })
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["address"], "local/tpl-coder")
        self.assertEqual(data["labels"]["template"], "coder")
        handle = self.backend.terminals[list(self.backend.terminals)[0]]
        self.assertEqual(handle.spec.command, ["claude"])
        stdin = handle.stdin_data().decode("utf-8")
        self.assertIn("Be a coder.", stdin)
        self.assertIn("--task X", stdin)

    @unittest_run_loop
    async def test_template_missing_404(self):
        resp = await self.client.post("/api/core/templates/nobody/run", json={"args": []})
        self.assertEqual(resp.status, 404)


class PumpTestCase(CoreApiTestCase):
    """Фоновый pump: сервер сам крутит step_once — экран/статусы живут
    без ручного шага (иначе screen-эндпоинт для живых PTY всегда пуст)."""

    def get_app(self):
        return create_app(base=self.tmp, supervisor=self.supervisor,
                          templates_dir=self.tmp / "templates", pump=True)

    @unittest_run_loop
    async def test_pump_fills_screen_without_manual_step(self):
        await self.run_terminal("t1")
        handle = self.backend.terminals[list(self.backend.terminals)[0]]
        handle.emit_raw(b"pumped output\n")
        # pump шагает сам — ждём, пока recent_output наполнится
        for _ in range(40):
            resp = await self.client.get("/api/core/screen/t1")
            data = await resp.json()
            if "pumped output" in data["screen"]:
                break
            await asyncio.sleep(0.05)
        self.assertIn("pumped output", data["screen"])

    @unittest_run_loop
    async def test_pump_applies_osc_status(self):
        await self.run_terminal("t1")
        handle = self.backend.terminals[list(self.backend.terminals)[0]]
        handle.emit_osc("working")
        for _ in range(40):
            resp = await self.client.get("/api/core/terminals")
            data = await resp.json()
            if data["terminals"][0]["state"] == "working":
                break
            await asyncio.sleep(0.05)
        self.assertEqual(data["terminals"][0]["state"], "working")


class GateAuditTrailTests(unittest.IsolatedAsyncioTestCase):
    async def test_gate_allow_and_deny_are_persisted_without_payload(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            state = SimpleNamespace(
                base=Path(temp_dir),
                audit_trail=core_api.GateAuditTrail(Path(temp_dir) / "audit.jsonl"),
                gate=SimpleNamespace(policy_hash="aegis-policy"))
            state.gate.consume_permit = Mock(return_value=None)
            state.gate.evaluate = Mock(side_effect=[
                SimpleNamespace(outcome="permit", reason="", rule_id="allow",
                                policy_hash="policy"),
                SimpleNamespace(outcome="deny", reason="blocked by policy",
                                rule_id="deny", policy_hash="policy"),
            ])
            payload = {
                "action": "send", "term": "local/safe-name",
                "text": "SENSITIVE-BODY-MUST-NOT-APPEAR",
            }

            self.assertIsNone(await core_api._gate_check(
                state, "core.terminal_mutation", payload))
            denied = await core_api._gate_check(
                state, "core.terminal_mutation",
                {"action": "kill", "term": "local/other"})

            self.assertEqual(denied.status, 403)
            entries, total = state.audit_trail.query()
            self.assertEqual(total, 2)
            self.assertEqual([e["decision"] for e in entries], ["deny", "allow"])
            self.assertEqual(entries[0]["action"], "kill")
            self.assertEqual(entries[0]["subject"], "other")
            self.assertEqual(entries[0]["detail"]["reason"], "blocked by policy")
            self.assertEqual(entries[1]["action"], "send")
            self.assertEqual(entries[1]["subject"], "safe-name")
            persisted = (Path(temp_dir) / "audit.jsonl").read_text(encoding="utf-8")
            self.assertEqual(len(persisted.splitlines()), 2)
            self.assertNotIn("SENSITIVE-BODY-MUST-NOT-APPEAR", persisted)

    def test_limit_action_filter_and_reload_preserve_newest_first(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "audit.jsonl"
            trail = core_api.GateAuditTrail(path)
            self.assertEqual(trail.maxlen, 2000)
            trail.append({"v": 1, "ts": 1, "action": "run", "subject": "one",
                          "decision": "allow", "detail": None})
            trail.append({"v": 1, "ts": 2, "action": "kill", "subject": "two",
                          "decision": "deny", "detail": {"reason": "blocked"}})
            trail.append({"v": 1, "ts": 3, "action": "run", "subject": "three",
                          "decision": "allow", "detail": None})

            entries, total = trail.query(limit=1, action="run")
            self.assertEqual(total, 2)
            self.assertEqual([entry["subject"] for entry in entries], ["three"])

            reloaded = core_api.GateAuditTrail(path)
            entries, total = reloaded.query(limit=10)
            self.assertEqual(total, 3)
            self.assertEqual([entry["ts"] for entry in entries], [3, 2, 1])
            self.assertEqual(len(path.read_text(encoding="utf-8").splitlines()), 3)

    def test_hmac_chain_uses_persistent_key_and_continues_after_reload(self):
        import hashlib
        import hmac
        import os

        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "audit.jsonl"
            trail = core_api.GateAuditTrail(path)
            trail.append({"v": 1, "ts": 1, "action": "run", "subject": "one",
                          "decision": "allow", "detail": None})
            trail.append({"v": 1, "ts": 2, "action": "kill", "subject": "two",
                          "decision": "deny", "detail": {"reason": "blocked"}})

            key_path = Path(temp_dir) / "audit.key"
            key = key_path.read_bytes()
            self.assertEqual(len(key), 32)
            if os.name == "posix":
                self.assertEqual(key_path.stat().st_mode & 0o777, 0o600)
            entries, total = trail.query(limit=10)
            oldest_first = list(reversed(entries))
            self.assertEqual(total, 2)
            self.assertEqual([entry["seq"] for entry in oldest_first], [1, 2])
            self.assertIsNone(oldest_first[0]["prev_hash"])
            self.assertEqual(oldest_first[1]["prev_hash"], oldest_first[0]["hash"])
            for entry in oldest_first:
                body = {name: value for name, value in entry.items() if name != "hash"}
                expected = hmac.new(
                    key, core_api.GateAuditTrail._canonical(body), hashlib.sha256
                ).hexdigest()
                self.assertTrue(hmac.compare_digest(entry["hash"], expected))

            reloaded = core_api.GateAuditTrail(path)
            reloaded.append({"v": 1, "ts": 3, "action": "rename", "subject": "three",
                             "decision": "allow", "detail": None})
            entries, total = reloaded.query(limit=10)
            self.assertEqual(total, 3)
            self.assertEqual([entry["seq"] for entry in entries], [3, 2, 1])
            self.assertEqual(entries[0]["prev_hash"], entries[1]["hash"])
            self.assertEqual(reloaded.verify(), {
                "ok": True, "verified": 3, "broken_at": None, "detail": None,
            })

            rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
            rows[1]["detail"] = {"reason": "tampered"}
            path.write_text(
                "".join(
                    core_api.GateAuditTrail._canonical(row).decode("utf-8") + "\n"
                    for row in rows
                ),
                encoding="utf-8",
            )
            tampered = core_api.GateAuditTrail(path)
            self.assertEqual(tampered.verify(), {
                "ok": False, "verified": 1, "broken_at": 2,
                "detail": "gate audit hash-chain mismatch",
            })


class GatePolicyFileTests(unittest.IsolatedAsyncioTestCase):
    def make_state(self, base: Path, outcomes=None):
        gate = SimpleNamespace()
        if outcomes is None:
            outcomes = [SimpleNamespace(
                outcome="permit", reason="", rule_id=None,
                policy_hash="aegis-policy",
            )]
        gate.evaluate = Mock(side_effect=outcomes)
        gate.policy_hash = "aegis-policy"
        gate.consume_permit = Mock(return_value=None)
        return SimpleNamespace(
            base=base,
            audit_trail=core_api.GateAuditTrail(base / "audit.jsonl"),
            gate=gate,
        )

    async def test_policy_uses_first_match_and_hot_reads_file(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            policy_path = base / "gate-policy.json"
            policy_path.write_text(json.dumps([
                {"match": {"action": "kill", "subject": "worker-1"},
                 "decision": "deny"},
                {"match": {"action": "*", "subject": "*"},
                 "decision": "allow"},
            ]), encoding="utf-8")
            state = self.make_state(base, [
                SimpleNamespace(outcome="permit", reason="", rule_id=None,
                                policy_hash="aegis-policy"),
            ])
            payload = {"action": "kill", "term": "local/worker-1"}

            denied = await core_api._gate_check(
                state, "core.terminal_mutation", payload)
            self.assertEqual(denied.status, 403)
            state.gate.evaluate.assert_not_called()
            entry, total = state.audit_trail.query(action="kill")
            self.assertEqual(total, 1)
            self.assertEqual(entry[0]["decision"], "deny")
            self.assertEqual(entry[0]["detail"]["rule_id"], "POLICY-1")

            policy_path.write_text(json.dumps([
                {"match": {"action": "*", "subject": "*"},
                 "decision": "allow"},
            ]), encoding="utf-8")
            allowed = await core_api._gate_check(
                state, "core.terminal_mutation", payload)
            self.assertIsNone(allowed)
            state.gate.evaluate.assert_called_once()
            entries, total = state.audit_trail.query(action="kill")
            self.assertEqual(total, 2)
            self.assertEqual(entries[0]["decision"], "allow")
            self.assertEqual(entries[0]["detail"]["rule_id"], "POLICY-1")

    async def test_policy_allow_does_not_override_aegis_deny(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            (base / "gate-policy.json").write_text(json.dumps([
                {"match": {"action": "*", "subject": "*"},
                 "decision": "allow"},
            ]), encoding="utf-8")
            state = self.make_state(base, [SimpleNamespace(
                outcome="deny", reason="AEGIS blocked", rule_id="A-1",
                policy_hash="aegis-policy",
            )])

            denied = await core_api._gate_check(
                state, "core.terminal_mutation", {"action": "run", "name": "x"})

            self.assertEqual(denied.status, 403)
            body = json.loads(denied.body)
            self.assertEqual(body["reason"], "AEGIS blocked")
            state.gate.evaluate.assert_called_once()

    async def test_dual_control_policy_defers_with_dual_flag(self):
        """W6: {"dual":true} нормализуется в require_approval+dual_control
        и уходит в approvals-очередь; без admin-окружения и request-
        контекста defer fail-closed → 503 (мутация не исполняется)."""
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            (base / "gate-policy.json").write_text(json.dumps([
                {"match": {"action": "*", "subject": "*"},
                 "decision": {"dual": True}},
            ]), encoding="utf-8")
            state = self.make_state(base)

            # нормализация: dual → require_approval + dual_control
            matched = core_api._gate_policy_match(
                state, "core.terminal_mutation",
                {"action": "run", "name": "x"})
            self.assertEqual(matched["decision"], "require_approval")
            self.assertTrue(matched["dual_control"])

            response = await core_api._gate_check(
                state, "core.terminal_mutation",
                {"action": "run", "name": "x"})

            # approval route unavailable (нет AEGIS admin env/контекста)
            # → fail-closed 503, evaluate не вызывается, deny-аудита нет
            self.assertEqual(response.status, 503)
            state.gate.evaluate.assert_not_called()
            entries, total = state.audit_trail.query()
            self.assertEqual(total, 0)

    async def test_invalid_policy_fails_closed_and_is_audited(self):
        invalid_documents = (
            "{not-json",
            json.dumps({"rules": []}),
            json.dumps([{"match": {"action": "kill"}, "decision": "maybe"}]),
            '{"match":{"action":"kill"},"match":{"action":"*"},"decision":"deny"}',
            json.dumps([
                {"match": {"action": "*"}, "decision": "deny"},
                {"match": {"action": "kill"}, "decision": "maybe"},
            ]),
        )
        for raw_policy in invalid_documents:
            with self.subTest(raw_policy=raw_policy), tempfile.TemporaryDirectory() as temp_dir:
                base = Path(temp_dir)
                (base / "gate-policy.json").write_text(raw_policy, encoding="utf-8")
                state = self.make_state(base)

                response = await core_api._gate_check(
                    state, "core.terminal_mutation",
                    {"action": "kill", "term": "local/worker"})

                self.assertEqual(response.status, 403)
                body = json.loads(response.body)
                self.assertIn("invalid gate policy", body["reason"].lower())
                self.assertNotIn(raw_policy, body["reason"])
                state.gate.evaluate.assert_not_called()
                entries, total = state.audit_trail.query()
                self.assertEqual(total, 1)
                self.assertEqual(entries[0]["decision"], "deny")
                self.assertEqual(entries[0]["detail"]["rule_id"], "POLICY")

    async def test_missing_or_unmatched_policy_preserves_aegis_default_path(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            state = self.make_state(base, [
                SimpleNamespace(outcome="permit", reason="", rule_id=None,
                                policy_hash="aegis-policy"),
                SimpleNamespace(outcome="permit", reason="", rule_id=None,
                                policy_hash="aegis-policy"),
            ])
            result = await core_api._gate_check(
                state, "core.terminal_mutation",
                {"action": "run", "name": "x"})
            self.assertIsNone(result)

            (base / "gate-policy.json").write_text(json.dumps([
                {"match": {"action": "kill", "subject": "*"},
                 "decision": "deny"},
            ]), encoding="utf-8")
            result = await core_api._gate_check(
                state, "core.terminal_mutation",
                {"action": "run", "name": "x"})
            self.assertIsNone(result)
            self.assertEqual(state.gate.evaluate.call_count, 2)


class PolicyApprovalApiTestCase(CoreApiTestCase):
    def _enable_approval_admin(self):
        return patch.dict(os.environ, {
            "AEGIS_ADMIN_TOKEN": "approval-test-token",
            "AEGIS_TOKEN_NAMES": json.dumps({"approval-test-token": "reviewer"}),
            "NEXUS_CORE_TOKEN": "",
            "NEXUS_CORE_READ_TOKEN": "",
        })

    def _require_approval_for_run(self, name):
        (self.tmp / "gate-policy.json").write_text(json.dumps([
            {"match": {"action": "run", "subject": name},
             "decision": "require_approval"},
        ]), encoding="utf-8")

    @unittest_run_loop
    async def test_require_approval_defers_run_until_approved(self):
        self._require_approval_for_run("approved-run")
        with self._enable_approval_admin():
            response = await self.client.post("/api/core/run", json={
                "name": "approved-run", "command": ["sh", "-i"],
            })
            self.assertEqual(response.status, 202)
            pending = await response.json()
            self.assertEqual(pending["status"], "pending")
            approval_id = pending["approval_id"]
            self.assertEqual(self.supervisor.list_terminals(), [])

            listed = await self.client.get("/api/core/approvals?status=pending")
            self.assertEqual(listed.status, 200)
            listing = await listed.json()
            self.assertEqual(len(listing["mutations"]), 1)
            self.assertEqual(listing["mutations"][0]["approval_id"], approval_id)
            self.assertEqual(listing["mutations"][0]["subject"], "approved-run")
            self.assertNotIn("command", json.dumps(listing))

            approved = await self.client.post(
                f"/api/core/approvals/{approval_id}",
                json={"approved": True},
                headers={"X-AEGIS-Key": "approval-test-token"},
            )
            self.assertEqual(approved.status, 200)
            result = await approved.json()
            self.assertEqual(result["status"], "executed")
            self.assertEqual(result["result"]["address"], "local/approved-run")
            self.assertEqual(len(self.supervisor.list_terminals()), 1)

            repeated = await self.client.post(
                f"/api/core/approvals/{approval_id}",
                json={"approved": True},
                headers={"X-AEGIS-Key": "approval-test-token"},
            )
            self.assertEqual(repeated.status, 409)

            audit = await self.client.get("/api/core/audit?action=approval_requested")
            self.assertEqual((await audit.json())["total"], 1)
            audit = await self.client.get("/api/core/audit?action=approval_approved")
            self.assertEqual((await audit.json())["total"], 1)

    @unittest_run_loop
    async def test_deny_discards_deferred_mutation(self):
        self._require_approval_for_run("denied-run")
        with self._enable_approval_admin():
            response = await self.client.post("/api/core/run", json={
                "name": "denied-run", "command": ["sh", "-i"],
            })
            self.assertEqual(response.status, 202)
            approval_id = (await response.json())["approval_id"]

            denied = await self.client.post(
                f"/api/core/approvals/{approval_id}",
                json={"approved": False},
                headers={"X-AEGIS-Key": "approval-test-token"},
            )
            self.assertEqual(denied.status, 200)
            self.assertEqual((await denied.json())["status"], "denied")
            self.assertEqual(self.supervisor.list_terminals(), [])

            audit = await self.client.get("/api/core/audit?action=approval_denied")
            self.assertEqual((await audit.json())["total"], 1)

    @unittest_run_loop
    async def test_expired_mutation_is_removed_and_approval_returns_gone(self):
        self._require_approval_for_run("expired-run")
        with self._enable_approval_admin():
            response = await self.client.post("/api/core/run", json={
                "name": "expired-run", "command": ["sh", "-i"],
            })
            self.assertEqual(response.status, 202)
            approval_id = (await response.json())["approval_id"]
            state = self.client.app["state"]
            state.mutation_approvals[approval_id]["expires_at"] = time.time() - 1

            listing = await self.client.get("/api/core/approvals?status=pending")
            self.assertEqual((await listing.json())["mutations"], [])
            expired = await self.client.post(
                f"/api/core/approvals/{approval_id}",
                json={"approved": True},
                headers={"X-AEGIS-Key": "approval-test-token"},
            )
            self.assertEqual(expired.status, 410)
            self.assertEqual(self.supervisor.list_terminals(), [])

            audit = await self.client.get("/api/core/audit?action=approval_expired")
            self.assertEqual((await audit.json())["total"], 1)

    @unittest_run_loop
    async def test_policy_change_invalidates_pending_mutation(self):
        self._require_approval_for_run("stale-run")
        with self._enable_approval_admin():
            response = await self.client.post("/api/core/run", json={
                "name": "stale-run", "command": ["sh", "-i"],
            })
            self.assertEqual(response.status, 202)
            approval_id = (await response.json())["approval_id"]
            (self.tmp / "gate-policy.json").write_text(json.dumps([
                {"match": {"action": "run", "subject": "stale-run"},
                 "decision": "deny"},
            ]), encoding="utf-8")

            response = await self.client.post(
                f"/api/core/approvals/{approval_id}",
                json={"approved": True},
                headers={"X-AEGIS-Key": "approval-test-token"},
            )
            self.assertEqual(response.status, 409)
            self.assertEqual(self.supervisor.list_terminals(), [])

    @unittest_run_loop
    async def test_policy_approval_fails_closed_without_admin_route(self):
        self._require_approval_for_run("no-admin-run")
        with patch.dict(os.environ, {
            "AEGIS_ADMIN_TOKEN": "", "AEGIS_ADMIN_KEYS": "",
            "NEXUS_CORE_TOKEN": "", "NEXUS_CORE_READ_TOKEN": "",
        }):
            response = await self.client.post("/api/core/run", json={
                "name": "no-admin-run", "command": ["sh", "-i"],
            })
            self.assertEqual(response.status, 503)
            self.assertEqual(self.supervisor.list_terminals(), [])
            self.assertEqual(
                self.client.app["state"].mutation_approvals, {})

    @unittest_run_loop
    async def test_existing_aegis_approval_route_still_uses_gate(self):
        state = self.client.app["state"]
        decision = SimpleNamespace(
            outcome="permit", reason="approved", approval_id="legacy-id",
            escalate_to=None,
        )
        with self._enable_approval_admin(), patch.object(
                state.gate, "approve", return_value=decision) as approve:
            response = await self.client.post(
                "/api/core/approvals/legacy-id", json={"approved": True},
                headers={"X-AEGIS-Key": "approval-test-token"},
            )
            self.assertEqual(response.status, 200)
            self.assertEqual((await response.json())["outcome"], "permit")
            approve.assert_called_once_with(
                "legacy-id", True, by="reviewer", roles=[])

    @unittest_run_loop
    async def test_clear_delete_paths_wait_for_policy_approval(self):
        created = await self.client.post(
            "/api/core/space", json={"name": "ops"})
        self.assertIn(created.status, (200, 201))
        await self.run_terminal("clear-q")
        queued = await self.client.post("/api/core/send", json={
            "term": "clear-q", "text": "hold", "queue": True})
        self.assertEqual(queued.status, 200)
        scheduled = await self.client.post("/api/core/send-schedule", json={
            "terms": ["clear-q"], "text": "later",
            "at_ts": time.time() + 3600})
        self.assertEqual(scheduled.status, 200)
        schedule_id = (await scheduled.json())["id"]
        state = self.client.app["state"]
        cases = [
            ("/api/core/space/ops", "space-delete", "ops",
             lambda: any(s.get("id") == "ops" for s in
                         core_api._load_custom_spaces(state)["spaces"])),
            ("/api/core/send-queue/clear-q", "sendqueue-clear", "clear-q",
             lambda: self.supervisor.send_queue_depths().get(
                 "local/clear-q") == 1),
            (f"/api/core/send-schedule/{schedule_id}", "schedule-clear",
             schedule_id, lambda: any(
                 item["id"] == schedule_id
                 for item in self.supervisor.list_scheduled())),
        ]
        for path, action, subject, still_present in cases:
            (self.tmp / "gate-policy.json").write_text(json.dumps([
                {"match": {"action": action, "subject": subject},
                 "decision": "require_approval"},
            ]), encoding="utf-8")
            with patch.dict(os.environ, {
                "AEGIS_ADMIN_TOKEN": "",
                "AEGIS_ADMIN_KEYS": json.dumps({
                    "approval-test-token": {"name": "reviewer-1", "roles": []},
                    "approval-test-token-2": {"name": "reviewer-2", "roles": []},
                }),
                "NEXUS_CORE_TOKEN": "",
                "NEXUS_CORE_READ_TOKEN": "",
            }):
                pending = await self.client.delete(path)
                self.assertEqual(pending.status, 202, action)
                approval_id = (await pending.json())["approval_id"]
                self.assertTrue(still_present(), action)
                approved = await self.client.post(
                    f"/api/core/approvals/{approval_id}",
                    json={"approved": True},
                    headers={"X-AEGIS-Key": "approval-test-token"},
                )
                if approved.status == 202:
                    self.assertTrue(still_present(), action)
                    approved = await self.client.post(
                        f"/api/core/approvals/{approval_id}",
                        json={"approved": True},
                        headers={"X-AEGIS-Key": "approval-test-token-2"},
                    )
                self.assertEqual(approved.status, 200, action)
                self.assertEqual((await approved.json())["status"], "executed")
                self.assertFalse(still_present(), action)

    @unittest_run_loop
    async def test_w5f_core_mutations_are_denied_before_side_effects(self):
        term = await self.run_terminal("w5f-term")
        terminal = self.supervisor.get_terminal(term["address"])
        terminal.lifecycle_webhooks = [{"events": ["webhook_test"],
                                        "url": "https://example.invalid"}]
        rename_space = {"id": "w5f-rename", "name": "w5f-rename",
                        "machine": "w5f-rename", "state": "connected"}
        (self.tmp / "spaces.json").write_text(json.dumps({
            "spaces": [rename_space], "idle_ttl": {},
        }), encoding="utf-8")
        (self.tmp / "workspace-templates.json").write_text(json.dumps({
            "templates": [{"name": "w5f-template", "terms": [{
                "name": "w5f-spawned", "command": ["sh", "-i"],
            }]}],
        }), encoding="utf-8")

        record_id = "w5f-record-stop"
        record_task = asyncio.get_running_loop().create_future()
        record_task.set_result(None)
        core_api._RECORDINGS[record_id] = {
            "id": record_id, "term": term["address"], "started": time.time(),
            "path": self.tmp / "recording.cast", "state": self.client.app["state"],
            "task": record_task, "stop": False, "prev_len": 0,
        }

        actions = [
            ("record-start", "w5f-term"),
            ("record-stop", "w5f-term"),
            ("on-event-test", "w5f-term"),
            ("workspace-template", "w5f-template"),
            ("workspace-spawn", "w5f-template"),
            ("space-create", "w5f-create"),
            ("space-rename", "w5f-rename"),
            ("space-idle-policy", "w5f-idle"),
            ("batch", "*"),
            ("terminal-lock", "w5f-term"),
            ("terminal-note", "w5f-term"),
            ("terminal-env", "w5f-term"),
            ("terminal-watch", "w5f-term"),
        ]
        (self.tmp / "gate-policy.json").write_text(json.dumps([
            {"match": {"action": action, "subject": subject},
             "decision": "deny"}
            for action, subject in actions
        ]), encoding="utf-8")

        before_terminals = {item.address for item in self.supervisor.list_terminals()}
        before_state = terminal.state
        before_webhooks = len(self.supervisor.pending_webhooks)
        before_idle_ttl = dict(self.supervisor.space_idle_ttl)
        requests = [
            self.client.post("/api/core/record/start", json={"term": term["address"]}),
            self.client.post(f"/api/core/record/stop/{record_id}"),
            self.client.post(f"/api/core/terminal/{term['address']}/on-event/test"),
            self.client.post("/api/core/workspace/template", json={
                "name": "w5f-template", "terms": [],
            }),
            self.client.post("/api/core/workspace/spawn", json={
                "name": "w5f-template",
            }),
            self.client.post("/api/core/space", json={"name": "w5f-create"}),
            self.client.post("/api/core/space/w5f-rename/rename", json={
                "new_name": "w5f-renamed",
            }),
            self.client.put("/api/core/space/w5f-idle/idle-policy", json={
                "ttl_seconds": 15,
            }),
            self.client.post("/api/core/batch", json={
                "action": "kill", "terms": [term["address"]],
            }),
            self.client.post(f"/api/core/terminal/{term['address']}/lock", json={
                "locked": True,
            }),
            self.client.post(f"/api/core/terminal/{term['address']}/note", json={
                "text": "must-not-write",
            }),
            self.client.post(f"/api/core/terminal/{term['address']}/env", json={
                "env": {"W5F_SENTINEL": "must-not-write"},
            }),
            self.client.post(f"/api/core/terminal/{term['address']}/watch", json={
                "pattern": "must-not-write",
            }),
        ]
        try:
            responses = await asyncio.gather(*requests)
            self.assertEqual([response.status for response in responses], [403] * 13)
            self.assertEqual(
                {item.address for item in self.supervisor.list_terminals()},
                before_terminals,
            )
            self.assertEqual(terminal.state, before_state)
            self.assertEqual(len(self.supervisor.pending_webhooks), before_webhooks)
            self.assertFalse(core_api._RECORDINGS[record_id]["stop"])
            self.assertEqual(
                [key for key, value in core_api._RECORDINGS.items()
                 if value.get("term") == term["address"]],
                [record_id],
            )
            self.assertFalse(terminal.locked)
            self.assertNotIn("note", terminal.labels)
            self.assertNotIn("W5F_SENTINEL", terminal.env)
            self.assertNotIn("_watch", terminal.labels)
            self.assertEqual(
                json.loads((self.tmp / "workspace-templates.json").read_text(
                    encoding="utf-8"))["templates"][0]["terms"][0]["name"],
                "w5f-spawned",
            )
            self.assertEqual(core_api._load_custom_spaces(
                self.client.app["state"])["spaces"], [rename_space])
            self.assertEqual(self.supervisor.space_idle_ttl, before_idle_ttl)
            self.assertEqual(core_api._load_custom_spaces(
                self.client.app["state"])["idle_ttl"], {})
        finally:
            record_task.cancel()
            core_api._RECORDINGS.pop(record_id, None)


class GateAuditApiTestCase(CoreApiTestCase):
    @unittest_run_loop
    async def test_audit_endpoint_exposes_action_filter_and_legacy_records(self):
        await self.run_terminal("audit-subject")
        response = await self.client.get("/api/core/audit?limit=10&action=run")
        self.assertEqual(response.status, 200)
        body = await response.json()
        self.assertEqual(body["total"], 1)
        self.assertEqual(len(body["entries"]), 1)
        self.assertEqual(body["entries"][0]["action"], "run")
        self.assertEqual(body["entries"][0]["subject"], "audit-subject")
        # Preserve the pre-existing AEGIS audit response field.
        self.assertIn("records", body)

    @unittest_run_loop
    async def test_audit_export_limit_is_canonical_gate_jsonl_attachment(self):
        await self.run_terminal("export-first")
        await self.run_terminal("export-second")

        response = await self.client.get("/api/core/audit/export?limit=2")
        self.assertEqual(response.status, 200)
        self.assertEqual(response.content_type, "application/x-ndjson")
        self.assertEqual(
            response.headers.get("Content-Disposition"),
            "attachment; filename=audit.jsonl",
        )
        lines = (await response.text()).splitlines()
        entries = [json.loads(line) for line in lines]
        self.assertEqual([entry["subject"] for entry in entries],
                         ["export-first", "export-second"])
        self.assertEqual([entry["seq"] for entry in entries],
                         sorted(entry["seq"] for entry in entries))
        self.assertEqual(
            lines,
            [core_api.GateAuditTrail._canonical(entry).decode("utf-8")
             for entry in entries],
        )

        bad_limit = await self.client.get("/api/core/audit/export?limit=bad")
        self.assertEqual(bad_limit.status, 400)

    @unittest_run_loop
    async def test_audit_verify_endpoint_reports_gate_trail_chain(self):
        await self.run_terminal("verify-subject")
        response = await self.client.get("/api/core/audit/verify")
        self.assertEqual(response.status, 200)
        body = await response.json()
        self.assertIn("aegis", body)
        self.assertEqual(body["gate_trail"]["ok"], True)
        self.assertGreaterEqual(body["gate_trail"]["verified"], 1)
        self.assertIsNone(body["gate_trail"]["broken_at"])


if __name__ == "__main__":
    unittest.main()
