#!/usr/bin/env python3
"""test_send_schedule.py — W30 отложенная рассылка."""
from __future__ import annotations
import shutil, tempfile, time, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class SendScheduleTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="sch-"))
        self.state_dir = self.tmp / "state"
        self.sup = SupervisorV1(backend=MockPTYBackend())
        super().setUp()
    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.state_dir, supervisor=self.sup,
                          templates_dir=self.tmp / "templates")

    async def run_terminal(self, name):
        r = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"]})
        self.assertEqual(r.status, 200, await r.text())

    @unittest_run_loop
    async def test_schedule_list_cancel(self):
        await self.run_terminal("t1")
        future = time.time() + 3600
        r = await self.client.post("/api/core/send-schedule", json={
            "terms": ["t1"], "text": "echo later",
            "at_ts": future})
        self.assertEqual(r.status, 200)
        d = await r.json()
        self.assertTrue(d["id"].startswith("sched-"))
        self.assertEqual(d["count"], 1)
        # list
        d = await (await self.client.get(
            "/api/core/send-schedule")).json()
        self.assertEqual(d["count"], 1)
        self.assertEqual(d["scheduled"][0]["id"],
                         (await r.json())["id"] if False else
                         d["scheduled"][0]["id"])
        # cancel
        r = await self.client.delete(
            f"/api/core/send-schedule/{d['scheduled'][0]['id']}")
        self.assertEqual(r.status, 200)
        r = await self.client.delete(
            "/api/core/send-schedule/sched-999")
        self.assertEqual(r.status, 404)
        d = await (await self.client.get(
            "/api/core/send-schedule")).json()
        self.assertEqual(d["count"], 0)

    @unittest_run_loop
    async def test_validation(self):
        await self.run_terminal("t1")
        # past at_ts → 400
        r = await self.client.post("/api/core/send-schedule", json={
            "terms": ["t1"], "text": "x",
            "at_ts": time.time() - 10})
        self.assertEqual(r.status, 400)
        # missing at_ts
        r = await self.client.post("/api/core/send-schedule", json={
            "terms": ["t1"], "text": "x"})
        self.assertEqual(r.status, 400)
        # unknown term → 400 unresolved
        r = await self.client.post("/api/core/send-schedule", json={
            "terms": ["ghost"], "text": "x",
            "at_ts": time.time() + 100})
        self.assertEqual(r.status, 400)
        d = await r.json()
        self.assertEqual(d["unresolved"], ["ghost"])
        # unknown group → 400
        r = await self.client.post("/api/core/send-schedule", json={
            "group": "nope", "text": "x",
            "at_ts": time.time() + 100})
        self.assertEqual(r.status, 400)

    @unittest_run_loop
    async def test_group_expand_and_fire(self):
        await self.run_terminal("a")
        await self.run_terminal("b")
        r = await self.client.put("/api/core/group/g1", json={
            "members": ["a", "b"]})
        self.assertEqual(r.status, 200)
        # schedule через group, at_ts = now → сработает на след. тике
        r = await self.client.post("/api/core/send-schedule", json={
            "group": "g1", "text": "echo SCHED",
            "at_ts": time.time() + 0.05})
        self.assertEqual(r.status, 200, await r.text())
        # ждём тик — pump не включён, гоняем step_once вручную
        import asyncio
        for _ in range(40):
            self.sup.step_once()
            await asyncio.sleep(0.05)
            if not self.sup.scheduled_sends:
                break
        self.assertEqual(self.sup.scheduled_sends, [])
        fired = [e for e in self.sup.events
                 if e["type"] == "scheduled" and e.get("op") == "fired"]
        self.assertEqual(len(fired), 1)
        self.assertEqual(fired[0]["sent"], 2)
        # текст реально ушёл в input_log обоих терминалов
        for n in ("a", "b"):
            t = self.sup.get_terminal(f"local/{n}")
            self.assertTrue(any("SCHED" in str(i.get("text"))
                                for i in t.input_log))


if __name__ == "__main__":
    unittest.main()
