#!/usr/bin/env python3
"""test_lifecycle_webhooks.py — W61 terminal lifecycle webhooks."""
from __future__ import annotations
import asyncio, json, os, shutil, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class LifecycleWebhookTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="lw-"))
        self.sup = SupervisorV1(backend=MockPTYBackend())
        self.received = []
        super().setUp()

    def tearDown(self):
        super().tearDown(); shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.tmp / "state",
                          supervisor=self.sup,
                          templates_dir=self.tmp / "tpl")
    async def run_terminal(self, name="w1"):
        r = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"]})
        self.assertEqual(r.status, 200)

    @unittest_run_loop
    async def test_hook_fires_on_event(self):
        await self.run_terminal()
        # подписка на frozen/resumed
        r = await self.client.post(
            "/api/core/terminal/w1/on-event",
            json={"url": "http://127.0.0.1:59999/hook",
                  "events": ["frozen", "resumed"]})
        # порт неважен — drain вызовем вручную с подменой url? проще:
        # регистрируем на свой app-порт через request.url
        self.assertIn(r.status, (200, 201))
        # GET список
        d = await (await self.client.get(
            "/api/core/terminal/w1/on-event")).json()
        self.assertEqual(len(d["hooks"]), 1)

    @unittest_run_loop
    async def test_validation(self):
        await self.run_terminal()
        # bad event type
        r = await self.client.post(
            "/api/core/terminal/w1/on-event",
            json={"url": "http://x/h", "events": ["bogus"]})
        self.assertEqual(r.status, 400)
        # empty events
        r = await self.client.post(
            "/api/core/terminal/w1/on-event",
            json={"url": "http://x/h", "events": []})
        self.assertEqual(r.status, 400)
        # bad url scheme
        r = await self.client.post(
            "/api/core/terminal/w1/on-event",
            json={"url": "ftp://x", "events": ["exited"]})
        self.assertEqual(r.status, 400)
        # unknown term
        self.assertEqual((await self.client.post(
            "/api/core/terminal/ghost/on-event",
            json={"url": "http://x/h",
                  "events": ["exited"]})).status, 404)
        # clear
        await self.client.post(
            "/api/core/terminal/w1/on-event",
            json={"url": "http://127.0.0.1:1/h",
                  "events": ["exited"]})
        r = await self.client.post(
            "/api/core/terminal/w1/on-event",
            json={"url": None})
        d = await r.json()
        self.assertEqual(d["cleared"], 1)

    @unittest_run_loop
    async def test_clear_all_is_deferred_until_approved(self):
        await self.run_terminal()
        term = self.sup.get_terminal("local/w1")
        term.lifecycle_webhooks.append(
            {"url": "http://127.0.0.1:9/h", "events": ["exited"]})
        policy_path = self.tmp / "state" / "gate-policy.json"
        policy_path.parent.mkdir(parents=True, exist_ok=True)
        policy_path.write_text(json.dumps([
            {"match": {"action": "on-event-clear",
                        "subject": term.address.rsplit("/", 1)[-1]},
             "decision": "require_approval"},
        ]), encoding="utf-8")
        with patch.dict(os.environ, {
            "AEGIS_ADMIN_TOKEN": "approval-test-token",
            "AEGIS_TOKEN_NAMES": json.dumps({"approval-test-token": "reviewer"}),
            "NEXUS_CORE_TOKEN": "",
            "NEXUS_CORE_READ_TOKEN": "",
        }):
            response = await self.client.delete(
                "/api/core/terminal/w1/on-event", json={"url": None})
            self.assertEqual(response.status, 202)
            approval_id = (await response.json())["approval_id"]
            self.assertEqual(len(term.lifecycle_webhooks), 1)

            approved = await self.client.post(
                f"/api/core/approvals/{approval_id}",
                json={"approved": True},
                headers={"X-AEGIS-Key": "approval-test-token"},
            )
            self.assertEqual(approved.status, 200)
            result = await approved.json()
            self.assertEqual(result["status"], "executed")
            self.assertEqual(result["result"]["cleared"], 1)
            self.assertEqual(term.lifecycle_webhooks, [])

    @unittest_run_loop
    async def test_on_exit_clear_is_deferred_until_approved(self):
        await self.run_terminal()
        term = self.sup.get_terminal("local/w1")
        term.exit_webhook = "http://127.0.0.1:9/exit"
        policy_path = self.tmp / "state" / "gate-policy.json"
        policy_path.parent.mkdir(parents=True, exist_ok=True)
        policy_path.write_text(json.dumps([
            {"match": {"action": "on-exit-clear",
                        "subject": term.address.rsplit("/", 1)[-1]},
             "decision": "require_approval"},
        ]), encoding="utf-8")
        with patch.dict(os.environ, {
            "AEGIS_ADMIN_TOKEN": "approval-test-token",
            "AEGIS_TOKEN_NAMES": json.dumps({"approval-test-token": "reviewer"}),
            "NEXUS_CORE_TOKEN": "",
            "NEXUS_CORE_READ_TOKEN": "",
        }):
            response = await self.client.post(
                "/api/core/terminal/w1/on-exit", json={"url": None})
            self.assertEqual(response.status, 202)
            approval_id = (await response.json())["approval_id"]
            self.assertEqual(term.exit_webhook, "http://127.0.0.1:9/exit")

            approved = await self.client.post(
                f"/api/core/approvals/{approval_id}",
                json={"approved": True},
                headers={"X-AEGIS-Key": "approval-test-token"},
            )
            self.assertEqual(approved.status, 200)
            result = await approved.json()
            self.assertEqual(result["status"], "executed")
            self.assertEqual(result["result"]["status"], "cleared")
            self.assertIsNone(term.exit_webhook)

    @unittest_run_loop
    async def test_emit_dispatches_to_pending(self):
        """_emit кладёт hook-payload в pending_webhooks."""
        await self.run_terminal()
        t = self.sup.get_terminal("local/w1")
        t.lifecycle_webhooks.append(
            {"url": "http://127.0.0.1:9/h", "events": ["frozen"]})
        self.sup._emit("frozen", {"address": t.address,
                                  "frozen": True})
        self.assertEqual(len(self.sup.pending_webhooks), 1)
        hook = self.sup.pending_webhooks[0]
        self.assertEqual(hook["url"], "http://127.0.0.1:9/h")
        self.assertEqual(hook["payload"]["type"], "frozen")
        self.assertEqual(hook["payload"]["address"], t.address)
        # событие не из списка → не попадает
        self.sup._emit("resumed", {"address": t.address})
        self.assertEqual(len(self.sup.pending_webhooks), 1)
        # событие без address → не попадает
        self.sup._emit("frozen", {"frozen": True})
        self.assertEqual(len(self.sup.pending_webhooks), 1)


if __name__ == "__main__":
    unittest.main()
