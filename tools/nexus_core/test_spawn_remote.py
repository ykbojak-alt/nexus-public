#!/usr/bin/env python3
"""test_spawn_remote.py — W65 multi-machine spawn stub (relay)."""
from __future__ import annotations
import shutil, tempfile, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class SpawnRemoteTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="sr-"))
        self.state_dir = self.tmp / "state"
        self.sup = SupervisorV1(backend=MockPTYBackend())
        super().setUp()
    def tearDown(self):
        super().tearDown(); shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        self._app = create_app(base=self.state_dir,
                               supervisor=self.sup,
                               templates_dir=self.tmp / "tpl")
        return self._app
    def _add_machine(self, name="vps1"):
        self._app["state"].machines.add(
            name, host=f"user@{name}", transport="ssh")

    @unittest_run_loop
    async def test_spawn_remote_stub(self):
        self._add_machine()
        r = await self.client.post("/api/core/spawn-remote", json={
            "machine": "vps1",
            "command": ["python", "-m", "http.server"],
            "name": "relay-test"})
        self.assertEqual(r.status, 201)
        d = await r.json()
        self.assertTrue(d["relay"])
        self.assertEqual(d["stub"], "N4")
        self.assertEqual(d["machine"], "vps1")
        # терминал жив локально с relay-лейблами
        t = self.sup.get_terminal("local/relay-test")
        self.assertIsNotNone(t)
        self.assertEqual(t.labels.get("_relay_machine"), "vps1")
        self.assertIn("http.server",
                      t.labels.get("_remote_command", ""))
        # send → input_log (outbox-точка для N4)
        await self.client.post("/api/core/send", json={
            "term": "relay-test", "text": "ping"})
        self.assertIn("ping",
                      [e["text"] for e in t.input_log])
        # auto-name
        r = await self.client.post("/api/core/spawn-remote", json={
            "machine": "vps1", "command": ["ls"]})
        d = await r.json()
        self.assertTrue(d["name"].startswith("relay-vps1-"))
        # relay-status
        d = await (await self.client.get(
            "/api/core/relay-status")).json()
        self.assertEqual(d["machines"]["vps1"]["count"], 2)
        self.assertEqual(d["relay_total"], 2)
        self.assertIn("local/relay-test",
                      d["machines"]["vps1"]["terms"])

    @unittest_run_loop
    async def test_validation(self):
        self._add_machine()
        r = await self.client.post("/api/core/spawn-remote", json={
            "machine": "local", "command": ["x"]})
        self.assertEqual(r.status, 400)
        r = await self.client.post("/api/core/spawn-remote", json={
            "machine": "ghost-box", "command": ["x"]})
        self.assertEqual(r.status, 404)
        r = await self.client.post("/api/core/spawn-remote", json={
            "machine": "vps1", "command": []})
        self.assertEqual(r.status, 400)
        # dup name → 409
        await self.client.post("/api/core/spawn-remote", json={
            "machine": "vps1", "command": ["x"], "name": "dup"})
        r = await self.client.post("/api/core/spawn-remote", json={
            "machine": "vps1", "command": ["x"], "name": "dup"})
        self.assertEqual(r.status, 409)


if __name__ == "__main__":
    unittest.main()
