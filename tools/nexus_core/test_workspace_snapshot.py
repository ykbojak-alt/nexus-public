#!/usr/bin/env python3
"""test_workspace_snapshot.py — W64 workspace snapshot v2."""
from __future__ import annotations
import json, shutil, tempfile, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class WorkspaceSnapshotTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="ws-"))
        self.sup = SupervisorV1(backend=MockPTYBackend())
        super().setUp()
    def tearDown(self):
        super().tearDown(); shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.tmp / "state",
                          supervisor=self.sup,
                          templates_dir=self.tmp / "tpl")
    async def run_terminal(self, name, **kw):
        r = await self.client.post("/api/core/run",
                                   json={"name": name,
                                         "command": ["sh", "-i"],
                                         **kw})
        self.assertEqual(r.status, 200)

    @unittest_run_loop
    async def test_snapshot_restore_cycle(self):
        await self.run_terminal("w-a", labels={"role": "dev"},
                                cols=100, rows=40)
        await self.run_terminal("w-b")
        # space membership
        await self.client.post("/api/core/space",
                               json={"name": "ops"})
        await self.client.post("/api/core/terminal/w-b/migrate",
                               json={"space": "ops"})
        # scrollback в w-a
        t = self.sup.get_terminal("local/w-a")
        t.scrollback.extend(["old-1", "old-2"])
        # snapshot со scrollback
        r = await self.client.post("/api/core/workspace/snapshot",
                                   json={"name": "ws1",
                                         "scrollback": True})
        d = await r.json()
        self.assertEqual(d["terminals"], 2)
        self.assertTrue((self.tmp / "state" / "workspaces"
                         / "ws1.json").exists())
        # kill w-a → restore
        self.sup.get_terminal("local/w-a").handle.close()
        self.sup.step_once()
        r = await self.client.post("/api/core/workspace/restore",
                                   json={"name": "ws1"})
        d = await r.json()
        self.assertIn("local/w-a", d["created"])
        self.assertIn("local/w-b", d["skipped"])  # уже жив
        t2 = self.sup.get_terminal("local/w-a")
        self.assertEqual(t2.cols, 100)
        self.assertEqual(t2.rows, 40)
        self.assertEqual(t2.labels.get("role"), "dev")
        self.assertIn("old-1", list(t2.scrollback))
        self.assertEqual(t2.space, None)  # w-a была без space
        # w-b space сохранился? w-b skipped — не пересоздан
        # restore ещё раз → всё skipped
        r = await self.client.post("/api/core/workspace/restore",
                                   json={"name": "ws1"})
        d = await r.json()
        self.assertEqual(len(d["created"]), 0)
        self.assertEqual(len(d["skipped"]), 2)

    @unittest_run_loop
    async def test_list_and_validation(self):
        await self.run_terminal("l1")
        await self.client.post("/api/core/workspace/snapshot",
                               json={"name": "snap-a"})
        d = await (await self.client.get(
            "/api/core/workspace/snapshots")).json()
        self.assertEqual(d["count"], 1)
        self.assertEqual(d["snapshots"][0]["name"], "snap-a")
        # bad name
        r = await self.client.post("/api/core/workspace/snapshot",
                                   json={"name": "bad name!"})
        self.assertEqual(r.status, 400)
        # restore unknown → 404, traversal → 400
        self.assertEqual((await self.client.post(
            "/api/core/workspace/restore",
            json={"name": "ghost"})).status, 404)
        self.assertEqual((await self.client.post(
            "/api/core/workspace/restore",
            json={"name": "../etc/passwd"})).status, 400)
        # v-mismatch → 400
        (self.tmp / "state" / "workspaces"
         / "old.json").write_text('{"v":1,"terminals":[]}',
                                  encoding="utf-8")
        self.assertEqual((await self.client.post(
            "/api/core/workspace/restore",
            json={"name": "old"})).status, 400)


if __name__ == "__main__":
    unittest.main()
