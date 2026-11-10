#!/usr/bin/env python3
"""test_send_queue.py — W56 send-queue."""
from __future__ import annotations
import shutil, tempfile, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class SendQueueTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="sq-"))
        self.state_dir = self.tmp / "state"
        self.sup = SupervisorV1(backend=MockPTYBackend())
        super().setUp()
    def tearDown(self):
        super().tearDown(); shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.state_dir, supervisor=self.sup,
                          templates_dir=self.tmp / "templates")
    async def run_terminal(self, name="q1"):
        r = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"]})
        self.assertEqual(r.status, 200)
    async def send(self, text="x", queue=True, term="q1", **kw):
        return await self.client.post("/api/core/send", json={
            "term": term, "text": text, "queue": queue, **kw})

    @unittest_run_loop
    async def test_enqueue_and_drain(self):
        await self.run_terminal()
        # queue:true → queued, не sent
        r = await self.send("cmd1")
        d = await r.json()
        self.assertEqual(d["status"], "queued")
        self.assertEqual(d["depth"], 1)
        self.assertTrue(d["id"].startswith("sq-"))
        # второй → depth 2
        await self.send("cmd2")
        # depths endpoint
        d = await (await self.client.get(
            "/api/core/send-queues")).json()
        self.assertEqual(d["queues"]["local/q1"], 2)
        # step_once → drain до 4/тик: оба ушли в PTY
        self.sup.step_once()
        d = await (await self.client.get(
            "/api/core/send-queues")).json()
        self.assertEqual(d["queues"], {})
        # input_log записал оба (send() внутри drain)
        t = self.sup.get_terminal("local/q1")
        texts = [e["text"] for e in t.input_log]
        self.assertIn("cmd1", texts)
        self.assertIn("cmd2", texts)
        # событие enqueue
        self.assertTrue(any(e["type"] == "send_queue"
                            and e.get("action") == "enqueue"
                            for e in self.sup.events))

    @unittest_run_loop
    async def test_frozen_and_exited_drop(self):
        await self.run_terminal()
        await self.send("held")
        t = self.sup.get_terminal("local/q1")
        # frozen → drain пропускает, очередь жива
        t.frozen = True
        self.sup.step_once()
        self.assertEqual(
            self.sup.send_queue_depths().get("local/q1"), 1)
        # unfreeze → уходит
        t.frozen = False
        self.sup.step_once()
        self.assertEqual(self.sup.send_queue_depths(), {})
        # exited → очередь dropped
        await self.send("post-exit")
        t.handle.close()
        self.sup.step_once()  # exited
        self.sup.step_once()  # drain → dropped
        ev = [e for e in self.sup.events
              if e["type"] == "send_queue"
              and e.get("action") == "dropped"]
        self.assertTrue(ev)
        # queue на exited напрямую → 404
        r = await self.send("x", term="q1")
        self.assertEqual(r.status, 404)

    @unittest_run_loop
    async def test_priority_order(self):
        """W57: priority 0–9, выше раньше; равные — старейший."""
        await self.run_terminal()
        # low(1) → mid(5) → high(9) — все до drain
        await self.send("low", priority=1)
        await self.send("mid")           # default 5
        await self.send("high", priority=9)
        self.sup.step_once()             # drain до 4 → все 3
        t = self.sup.get_terminal("local/q1")
        texts = [e["text"] for e in t.input_log]
        self.assertEqual(texts[-3:], ["high", "mid", "low"])
        # clamp: 99→9, -5→0, мусор→5
        await self.send("c1", priority=99)
        await self.send("c0", priority=-5)
        await self.send("cx", priority="junk")
        self.sup.step_once()
        texts = [e["text"] for e in t.input_log]
        self.assertEqual(texts[-3:], ["c1", "cx", "c0"])
        # response несёт priority
        r = await self.send("px", priority=3)
        d = await r.json()
        self.assertEqual(d["priority"], 3)

    @unittest_run_loop
    async def test_clear_and_unknown(self):
        await self.run_terminal()
        await self.send("a"); await self.send("b")
        # clear → 2
        r = await self.client.delete(
            "/api/core/send-queue/q1")
        d = await r.json()
        self.assertEqual(d["cleared"], 2)
        self.assertEqual(self.sup.send_queue_depths(), {})
        # unknown term → 404
        self.assertEqual((await self.client.delete(
            "/api/core/send-queue/ghost")).status, 404)
        # GET пустой → {}
        d = await (await self.client.get(
            "/api/core/send-queues")).json()
        self.assertEqual(d["queues"], {})


if __name__ == "__main__":
    unittest.main()
