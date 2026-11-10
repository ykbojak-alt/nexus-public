#!/usr/bin/env python3
"""test_freeze_resume.py — W21 POST /terminal/<n>/freeze|resume."""
from __future__ import annotations
import shutil, tempfile, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class FreezeResumeTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="frz-"))
        self.state_dir = self.tmp / "state"
        self.sup = SupervisorV1(backend=MockPTYBackend())
        super().setUp()
    def tearDown(self):
        super().tearDown(); shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.state_dir, supervisor=self.sup,
                          templates_dir=self.tmp / "templates")
    async def run_terminal(self, name="f1"):
        r = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"]})
        self.assertEqual(r.status, 200)

    @unittest_run_loop
    async def test_freeze_suspends_pump(self):
        await self.run_terminal()
        t = self.sup.get_terminal("local/f1")
        # freeze → inject output → step_once → recent_output НЕ растёт
        r = await self.client.post("/api/core/terminal/f1/freeze")
        self.assertEqual(r.status, 200)
        d = await r.json()
        self.assertTrue(d["frozen"])
        self.assertTrue(t.frozen)
        before = t.recent_output
        t.handle.stdout.extend(b"FROZEN-OUTPUT")
        self.sup.step_once()
        self.assertEqual(t.recent_output, before)
        # события frozen
        self.assertTrue(any(e["type"] == "frozen"
                            for e in self.sup.events))
        # to_dict несёт frozen
        terms = await (await self.client.get(
            "/api/core/terminals")).json()
        tl = terms.get("terminals", terms if isinstance(terms, list)
                       else [])
        f1 = next(x for x in tl if x.get("name") == "f1")
        self.assertTrue(f1["frozen"])

    @unittest_run_loop
    async def test_resume_reads_backlog(self):
        await self.run_terminal()
        t = self.sup.get_terminal("local/f1")
        await self.client.post("/api/core/terminal/f1/freeze")
        t.handle.stdout.extend(b"BACKLOG-DATA")
        self.sup.step_once()
        self.assertNotIn("BACKLOG-DATA", t.recent_output)
        r = await self.client.post("/api/core/terminal/f1/resume")
        d = await r.json()
        self.assertFalse(d["frozen"])
        self.sup.step_once()
        self.assertIn("BACKLOG-DATA", t.recent_output)
        self.assertTrue(any(e["type"] == "resumed"
                            for e in self.sup.events))

    @unittest_run_loop
    async def test_idempotent_404_and_others_unaffected(self):
        await self.run_terminal("f1"); await self.run_terminal("f2")
        t2 = self.sup.get_terminal("local/f2")
        # повторный freeze — ок, идемпотентно
        await self.client.post("/api/core/terminal/f1/freeze")
        r = await self.client.post("/api/core/terminal/f1/freeze")
        self.assertEqual(r.status, 200)
        # f2 не заморожен — pump работает
        t2.handle.stdout.extend(b"LIVE-DATA")
        self.sup.step_once()
        self.assertIn("LIVE-DATA", t2.recent_output)
        # resume на незамороженном — тоже ок
        r2 = await self.client.post("/api/core/terminal/f2/resume")
        self.assertEqual(r2.status, 200)
        # 404
        self.assertEqual((await self.client.post(
            "/api/core/terminal/ghost/freeze")).status, 404)
        self.assertEqual((await self.client.post(
            "/api/core/terminal/ghost/resume")).status, 404)


    def test_frozen_persists_registry(self):
        """W41: frozen переживает restart через registry.json."""
        import json as _json
        reg = self.tmp / "state" / "registry.json"
        sup1 = SupervisorV1(backend=MockPTYBackend(),
                            registry_path=reg)
        t = sup1.create_terminal(name="frz", command=["sh", "-i"])
        t.frozen = True
        sup1._save_registry()
        row = _json.loads(reg.read_text(encoding="utf-8"))
        rows = row["rows"] if isinstance(row, dict) else row  # v0 list / v1+
        self.assertTrue(rows[0]["frozen"])
        # «restart» — adopt с restore
        sup2 = SupervisorV1(backend=MockPTYBackend(),
                            registry_path=reg, restore=True)
        t2 = sup2.get_terminal("local/frz")
        self.assertIsNotNone(t2)
        self.assertTrue(t2.frozen)
        # и обратно — resume пишется
        t2.frozen = False
        sup2._save_registry()
        sup3 = SupervisorV1(backend=MockPTYBackend(),
                            registry_path=reg, restore=True)
        self.assertFalse(sup3.get_terminal("local/frz").frozen)


if __name__ == "__main__":
    unittest.main()
