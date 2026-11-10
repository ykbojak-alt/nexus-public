#!/usr/bin/env python3
"""test_idle_kick.py — W17 auto-exit idle terminals по TTL."""
from __future__ import annotations
import os, shutil, tempfile, time, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class IdleKickTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="idle-"))
        self.state_dir = self.tmp / "state"
        self.sup = SupervisorV1(backend=MockPTYBackend())
        super().setUp()
    def tearDown(self):
        super().tearDown(); shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.state_dir, supervisor=self.sup,
                          templates_dir=self.tmp / "templates")
    async def run_terminal(self, name, labels=None):
        body = {"name": name, "command": ["sh", "-i"]}
        if labels:
            body["labels"] = labels
        r = await self.client.post("/api/core/run", json=body)
        self.assertEqual(r.status, 200)
    def term(self, name):
        return self.sup.get_terminal(f"local/{name}")

    @unittest_run_loop
    async def test_kick_after_ttl(self):
        await self.run_terminal("i1")
        t = self.term("i1")
        self.sup.idle_ttl = 60
        # свежий вывод → не кикаем
        now = time.time()
        t.last_output_at = now - 10
        self.assertEqual(self.sup._idle_kick_scan(now), [])
        # протух → kick: handle закрыт, событие idle_kick
        t.last_output_at = now - 120
        kicked = self.sup._idle_kick_scan(now)
        self.assertEqual(kicked, ["local/i1"])
        self.assertTrue(t.handle.closed)
        ev = [e for e in self.sup.events if e["type"] == "idle_kick"]
        self.assertEqual(ev[-1]["address"], "local/i1")
        # следующий тик → штатный exited
        self.sup.step_once()
        self.assertEqual(t.state, "exited")

    @unittest_run_loop
    async def test_label_overrides_and_optout(self):
        await self.run_terminal("i2", labels={"_idle_ttl": "5"})
        await self.run_terminal("i3", labels={"_idle_ttl": "0"})
        t2, t3 = self.term("i2"), self.term("i3")
        self.sup.idle_ttl = 100
        now = time.time()
        t2.last_output_at = now - 10   # >5 label-TTL → kick
        t3.last_output_at = now - 500  # label 0 → opt-out
        kicked = self.sup._idle_kick_scan(now)
        self.assertIn("local/i2", kicked)
        self.assertNotIn("local/i3", kicked)
        self.assertFalse(t3.handle.closed)
        # невалидный label → fallback global
        t3.labels["_idle_ttl"] = "junk"
        t3.last_output_at = now - 500
        kicked2 = self.sup._idle_kick_scan(now)
        self.assertIn("local/i3", kicked2)

    @unittest_run_loop
    async def test_states_and_disabled(self):
        await self.run_terminal("i4")
        t = self.term("i4")
        now = time.time()
        t.last_output_at = now - 9999
        # global выключен (default 0)
        self.assertEqual(self.sup.idle_ttl, 0.0)
        self.assertEqual(self.sup._idle_kick_scan(now), [])
        # не-idle state не кикается
        self.sup.idle_ttl = 1
        t.state = "running"
        self.assertEqual(self.sup._idle_kick_scan(now), [])
        t.state = "idle"
        t.locked = True
        self.assertEqual(self.sup._idle_kick_scan(now), [])
        t.locked = False
        self.assertEqual(self.sup._idle_kick_scan(now), ["local/i4"])


    @unittest_run_loop
    async def test_space_idle_policy(self):
        """W37: per-space TTL через PUT idle-policy."""
        await self.run_terminal("sp1")
        t = self.term("sp1")
        self.assertEqual(t.machine, "local")
        self.sup.idle_ttl = 1000  # global большой
        # space policy ttl=5 → kick при 10с idle
        r = await self.client.put(
            "/api/core/space/local/idle-policy",
            json={"ttl_seconds": 5})
        self.assertEqual(r.status, 200, await r.text())
        d = await r.json()
        self.assertEqual(d["machine"], "local")
        self.assertEqual(d["idle_ttl"], 5.0)
        now = time.time()
        t.last_output_at = now - 10
        kicked = self.sup._idle_kick_scan(now)
        self.assertIn("local/sp1", kicked)
        # null → снять политику → наследует global 1000 → не кикаем
        r = await self.client.put(
            "/api/core/space/local/idle-policy",
            json={"ttl_seconds": None})
        self.assertEqual(r.status, 200)
        t.handle = None  # handle закрыт kick'ом — пересоздадим состояние
        # проще: новый терминал без kick'а
        await self.run_terminal("sp2")
        t2 = self.term("sp2")
        t2.last_output_at = now - 500  # < global 1000
        kicked2 = self.sup._idle_kick_scan(now)
        self.assertNotIn("local/sp2", kicked2)
        # persist: spaces.json содержит idle_ttl
        import json as _j
        sp = self.state_dir / "spaces.json"
        # state_dir — base; _spaces_path = base/spaces.json
        data = _j.loads(sp.read_text(encoding="utf-8")) \
            if sp.exists() else {}
        # ttl был null → ключ удалён
        self.assertNotIn("local", data.get("idle_ttl", {}))


if __name__ == "__main__":
    unittest.main()
