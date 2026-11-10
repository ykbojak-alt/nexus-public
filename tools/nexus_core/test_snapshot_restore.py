#!/usr/bin/env python3
"""
tools/nexus_core/test_snapshot_restore.py — W7 snapshot/restore.

API (AioHTTPTestCase + MockPTYBackend): snapshot пишет
snapshots/<name>-<ms>.json {spec, scrollback} в state-base;
restore создаёт терминал по спеке + scrollback→recent_output,
restored:true в ответе. Ошибки: unknown→404, dup→409,
bad name→400, missing file→404, bad payload→400.

Запуск: pytest tools/nexus_core/test_snapshot_restore.py
"""

from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class SnapshotRestoreApiTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="snap-"))
        self.state_dir = self.tmp / "state"
        self.backend = MockPTYBackend()
        self.sup = SupervisorV1(backend=self.backend)
        super().setUp()

    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.state_dir,
                          supervisor=self.sup,
                          templates_dir=self.tmp / "templates")

    async def run_terminal(self, name="t1", **kwargs):
        resp = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"], **kwargs})
        self.assertEqual(resp.status, 200)
        return await resp.json()

    def term_obj(self, name="t1"):
        return self.sup.get_terminal(f"local/{name}")

    def snapshots_dir(self):
        return self.state_dir / "snapshots"

    # -- snapshot ---------------------------------------------------------

    @unittest_run_loop
    async def test_snapshot_writes_file_with_spec_and_scrollback(self):
        term = await self.run_terminal(
            "snap1", env={"FOO": "bar"}, labels={"role": "demo"},
            cols=100, rows=40)
        t = self.term_obj("snap1")
        t.scrollback.extend(["line1", "line2", "line3"])
        resp = await self.client.post(
            "/api/core/terminal/snap1/snapshot", data=b"")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["term"], "local/snap1")
        self.assertTrue(data["path"].startswith("snapshots/snap1-"))
        self.assertTrue(data["path"].endswith(".json"))
        self.assertEqual(data["scrollback_lines"], 3)
        self.assertEqual(data["status"], "snapshotted")
        # файл реально лежит в state-base/snapshots/
        fpath = self.state_dir / data["path"]
        self.assertTrue(fpath.is_file())
        payload = json.loads(fpath.read_text(encoding="utf-8"))
        self.assertEqual(payload["v"], 1)
        self.assertEqual(payload["scrollback"], ["line1", "line2", "line3"])
        spec = payload["spec"]
        self.assertEqual(spec["name"], "snap1")
        self.assertEqual(spec["command"], ["sh", "-i"])
        self.assertEqual(spec["env"]["FOO"], "bar")
        self.assertEqual(spec["labels"]["role"], "demo")
        self.assertEqual(spec["cols"], 100)
        self.assertEqual(spec["rows"], 40)
        self.assertIn("keep", spec)
        self.assertIn("machine", spec)

    @unittest_run_loop
    async def test_snapshot_falls_back_to_recent_output(self):
        await self.run_terminal("snap2")
        t = self.term_obj("snap2")
        # deque пуст → берём recent_output.splitlines()
        t.scrollback.clear()
        t.recent_output = "alpha\nbeta"
        resp = await self.client.post(
            "/api/core/terminal/snap2/snapshot")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["scrollback_lines"], 2)
        payload = json.loads(
            (self.state_dir / data["path"]).read_text(encoding="utf-8"))
        self.assertEqual(payload["scrollback"], ["alpha", "beta"])

    @unittest_run_loop
    async def test_snapshot_unknown_terminal_404(self):
        resp = await self.client.post(
            "/api/core/terminal/ghost/snapshot")
        self.assertEqual(resp.status, 404)

    # -- restore ----------------------------------------------------------

    async def _snapshot_of(self, name="src"):
        await self.run_terminal(name, env={"K": "v"},
                                labels={"a": "b"}, cols=90, rows=35)
        t = self.term_obj(name)
        t.scrollback.extend(["old-line-1", "old-line-2"])
        resp = await self.client.post(
            f"/api/core/terminal/{name}/snapshot")
        self.assertEqual(resp.status, 200)
        return (await resp.json())["path"]

    @unittest_run_loop
    async def test_restore_roundtrip(self):
        snap = await self._snapshot_of("src")
        resp = await self.client.post(
            "/api/core/terminal/restored1/restore-snapshot",
            json={"file": snap})
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertTrue(data["restored"])
        self.assertEqual(data["snapshot"], snap)
        self.assertEqual(data["name"], "restored1")
        self.assertEqual(data["address"], "local/restored1")
        # спека из снапшота (env в to_dict нет — как в registry)
        self.assertEqual(data["command"], ["sh", "-i"])
        t = self.term_obj("restored1")
        self.assertEqual(t.env.get("K"), "v")
        self.assertEqual(data["labels"]["a"], "b")
        self.assertEqual(data["cols"], 90)
        self.assertEqual(data["rows"], 35)
        # scrollback → recent_output + deque
        self.assertEqual(t.recent_output, "old-line-1\nold-line-2")
        self.assertEqual(list(t.scrollback), ["old-line-1", "old-line-2"])

    @unittest_run_loop
    async def test_restore_dup_name_409(self):
        snap = await self._snapshot_of("src")
        await self.run_terminal("dup")
        resp = await self.client.post(
            "/api/core/terminal/dup/restore-snapshot",
            json={"file": snap})
        self.assertEqual(resp.status, 409)

    @unittest_run_loop
    async def test_restore_missing_file_404(self):
        resp = await self.client.post(
            "/api/core/terminal/new1/restore-snapshot",
            json={"file": "snapshots/nope.json"})
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_restore_missing_file_param_400(self):
        resp = await self.client.post(
            "/api/core/terminal/new1/restore-snapshot", json={})
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_restore_bad_name_400(self):
        snap = await self._snapshot_of("src")
        resp = await self.client.post(
            "/api/core/terminal/Bad Name!/restore-snapshot",
            json={"file": snap})
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_restore_invalid_json_400(self):
        bad = self.state_dir / "snapshots" / "bad.json"
        bad.parent.mkdir(parents=True, exist_ok=True)
        bad.write_text("{not json", encoding="utf-8")
        resp = await self.client.post(
            "/api/core/terminal/new1/restore-snapshot",
            json={"file": "snapshots/bad.json"})
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_restore_missing_spec_400(self):
        f = self.state_dir / "snapshots" / "nospec.json"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps({"scrollback": []}), encoding="utf-8")
        resp = await self.client.post(
            "/api/core/terminal/new1/restore-snapshot",
            json={"file": "snapshots/nospec.json"})
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_restore_remote_machine_400(self):
        f = self.state_dir / "snapshots" / "remote.json"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps({
            "spec": {"machine": "other-host", "command": ["sh"]},
            "scrollback": [],
        }), encoding="utf-8")
        resp = await self.client.post(
            "/api/core/terminal/new1/restore-snapshot",
            json={"file": "snapshots/remote.json"})
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_restore_path_escape_rejected(self):
        resp = await self.client.post(
            "/api/core/terminal/new1/restore-snapshot",
            json={"file": "../outside.json"})
        self.assertIn(resp.status, (400, 404))


if __name__ == "__main__":
    unittest.main()
