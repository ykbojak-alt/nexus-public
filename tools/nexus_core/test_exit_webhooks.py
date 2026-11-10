#!/usr/bin/env python3
"""test_exit_webhooks.py — W15 POST /terminal/<n>/on-exit."""
from __future__ import annotations
import asyncio, shutil, tempfile, unittest
from pathlib import Path
from aiohttp import ClientSession, web
from aiohttp.test_utils import AioHTTPTestCase, TestServer, unittest_run_loop
from tools.nexus_core.api import (
    create_app, drain_pending_webhooks)
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class ExitWebhookApiTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="wh-"))
        self.state_dir = self.tmp / "state"
        self.sup = SupervisorV1(backend=MockPTYBackend())
        super().setUp()
    def tearDown(self):
        super().tearDown(); shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.state_dir, supervisor=self.sup,
                          templates_dir=self.tmp / "templates")
    async def run_terminal(self, name="w1"):
        r = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"]})
        self.assertEqual(r.status, 200)
    async def arm(self, name="w1", url="http://127.0.0.1:9/hook", **kw):
        return await self.client.post(
            f"/api/core/terminal/{name}/on-exit", json={"url": url, **kw})

    @unittest_run_loop
    async def test_arm_clear_and_validation(self):
        await self.run_terminal()
        r = await self.arm()
        self.assertEqual(r.status, 200)
        d = await r.json()
        self.assertEqual(d["status"], "armed")
        self.assertEqual(d["webhook"], "http://127.0.0.1:9/hook")
        t = self.sup.get_terminal("local/w1")
        self.assertEqual(t.exit_webhook, "http://127.0.0.1:9/hook")
        # clear
        r2 = await self.arm(url=None)
        self.assertEqual((await r2.json())["status"], "cleared")
        self.assertIsNone(t.exit_webhook)
        # bad urls → 400
        for bad in ("ftp://x", "notaurl", "http://", 42):
            rr = await self.arm(url=bad) if not isinstance(bad, int) \
                else await self.client.post(
                    "/api/core/terminal/w1/on-exit", json={"url": bad})
            self.assertEqual(rr.status, 400, msg=str(bad))
        # 404
        self.assertEqual(
            (await self.arm(name="ghost")).status, 404)

    @unittest_run_loop
    async def test_exited_enqueues_and_drains(self):
        # приёмник webhook'ов
        received = []
        async def hook(request):
            received.append(await request.json())
            return web.Response(text="ok")
        recv_app = web.Application()
        recv_app.router.add_post("/hook", hook)
        runner = TestServer(recv_app)
        await runner.start_server()
        try:
            port = runner.port
            await self.run_terminal()
            url = f"http://127.0.0.1:{port}/hook"
            await self.arm(url=url)
            # emit exited → pending_webhooks
            self.sup._emit("exited", {"address": "local/w1",
                                      "exit_code": 0})
            self.assertEqual(len(self.sup.pending_webhooks), 1)
            hook_rec = self.sup.pending_webhooks[0]
            self.assertEqual(hook_rec["url"], url)
            self.assertEqual(hook_rec["payload"]["event"], "exited")
            self.assertEqual(hook_rec["payload"]["term"], "local/w1")
            # drain → реальный POST
            async with ClientSession() as sess:
                sent = await drain_pending_webhooks(self.sup, sess)
            self.assertEqual(sent, 1)
            self.assertEqual(len(received), 1)
            self.assertEqual(received[0]["term"], "local/w1")
            self.assertEqual(received[0]["exit_code"], 0)
            self.assertEqual(len(self.sup.pending_webhooks), 0)
        finally:
            await runner.close()

    @unittest_run_loop
    async def test_no_webhook_no_enqueue(self):
        await self.run_terminal()
        self.sup._emit("exited", {"address": "local/w1",
                                  "exit_code": 0})
        self.assertEqual(len(self.sup.pending_webhooks), 0)


    @unittest_run_loop
    async def test_retry_backoff_and_drop(self):
        """W35: failed webhook → attempts+1, next_retry_at backoff;
        после max attempts — drop."""
        self.sup.pending_webhooks.append({
            "url": "http://127.0.0.1:9/dead", "ts": 0.0,
            "payload": {"event": "exited", "term": "local/x"}})
        async with ClientSession() as sess:
            sent = await drain_pending_webhooks(self.sup, sess)
        self.assertEqual(sent, 0)
        self.assertEqual(len(self.sup.pending_webhooks), 1)
        hook = self.sup.pending_webhooks[0]
        self.assertEqual(hook["attempts"], 1)
        self.assertGreater(hook["next_retry_at"], 0)
        # не-due → пропускается, остаётся в очереди
        async with ClientSession() as sess:
            sent2 = await drain_pending_webhooks(self.sup, sess)
        self.assertEqual(sent2, 0)
        self.assertEqual(len(self.sup.pending_webhooks), 1)
        # форсируем due + имитируем исчерпание попыток
        hook["next_retry_at"] = 0.0
        hook["attempts"] = 3  # следующий fail → 4 <5 → retry
        async with ClientSession() as sess:
            await drain_pending_webhooks(self.sup, sess)
        self.assertEqual(len(self.sup.pending_webhooks), 1)
        self.assertEqual(self.sup.pending_webhooks[0]["attempts"], 4)
        # attempts=4 → fail → 5 >= MAX → drop
        self.sup.pending_webhooks[0]["next_retry_at"] = 0.0
        async with ClientSession() as sess:
            await drain_pending_webhooks(self.sup, sess)
        self.assertEqual(len(self.sup.pending_webhooks), 0)


if __name__ == "__main__":
    unittest.main()
