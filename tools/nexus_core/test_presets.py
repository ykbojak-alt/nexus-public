#!/usr/bin/env python3
"""
tools/nexus_core/test_presets.py — W11 spawn-presets.

presets.py: normalize (command/cwd/env/labels/detect), hot-edit,
битые записи. API: GET /presets (env masked), POST /spawn-preset
(command+args, cwd/env/labels merge, auto-name, unknown→400,
unavailable→409, bad fields→400).

Запуск: pytest tools/nexus_core/test_presets.py
"""

from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from tools.nexus_core import presets as presets_mod
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class PresetsUnitTests(unittest.TestCase):
    def test_normalize_full_entry(self):
        p = presets_mod._normalize({
            "id": "t1", "title": "T", "command": ["python", "-m"],
            "cwd": "D:/x", "env": {"A": "1"}, "labels": {"k": "v"},
            "detect": {"exe": "python"},
        })
        self.assertIsNotNone(p)
        self.assertEqual(p["command"], ["python", "-m"])
        self.assertEqual(p["env"], {"A": "1"})
        self.assertEqual(p["labels"], {"k": "v"})
        self.assertIn("available", p)

    def test_normalize_accepts_cmd_alias_and_skips_bad(self):
        p = presets_mod._normalize({"id": "a", "cmd": ["x"]})
        self.assertEqual(p["command"], ["x"])
        for bad in (None, "x", {}, {"id": "a"}, {"id": "a", "command": []},
                    {"id": "a", "command": ["x", 5]},
                    {"id": "a", "command": ["x"], "env": "bad"},
                    {"id": "a", "command": ["x"], "labels": {"k": 1}},
                    {"id": "Bad ID!", "command": ["x"]}):
            self.assertIsNone(presets_mod._normalize(bad), msg=str(bad))

    def test_load_missing_and_broken_file(self):
        self.assertEqual(presets_mod.load_presets(
            Path(tempfile.mkdtemp()) / "nope.json"), [])
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "presets.json"
            p.write_text("{not json", encoding="utf-8")
            self.assertEqual(presets_mod.load_presets(p), [])
            p.write_text(json.dumps({"presets": [
                {"id": "ok", "command": ["cmd.exe"]},
                {"id": "bad"},
            ]}), encoding="utf-8")
            out = presets_mod.load_presets(p)
            self.assertEqual([x["id"] for x in out], ["ok"])


class SpawnPresetApiTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="preset-"))
        self.state_dir = self.tmp / "state"
        self.presets_file = self.tmp / "presets.json"
        self.presets_file.write_text(json.dumps({"presets": [
            {"id": "sh", "title": "Shell", "command": ["cmd.exe"],
             "cwd": "D:/Temp", "env": {"BASE": "1", "API_KEY": "sekret"},
             "labels": {"kind": "shell"}},
            {"id": "nope-prog", "command": ["definitely-not-a-real-bin-xyz"],
             "detect": {"exe": "definitely-not-a-real-bin-xyz"}},
        ]}), encoding="utf-8")
        self.backend = MockPTYBackend()
        self.sup = SupervisorV1(backend=self.backend)
        super().setUp()

    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        # подменяем путь к presets.json через env-free monkey-patch:
        # DEFAULT_PRESETS_PATH читается в load_presets(path=None) —
        # патчим модульную константу на время теста.
        old = presets_mod.DEFAULT_PRESETS_PATH
        presets_mod.DEFAULT_PRESETS_PATH = self.presets_file
        self.addCleanup(setattr, presets_mod, "DEFAULT_PRESETS_PATH", old)
        return create_app(base=self.state_dir,
                          supervisor=self.sup,
                          templates_dir=self.tmp / "templates")

    async def spawn(self, **body):
        return await self.client.post("/api/core/spawn-preset", json=body)

    @unittest_run_loop
    async def test_get_presets_shape_and_env_masked(self):
        resp = await self.client.get("/api/core/presets")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["count"], 2)
        sh = next(p for p in data["presets"] if p["id"] == "sh")
        self.assertEqual(sh["env"]["BASE"], "1")
        self.assertEqual(sh["env"]["API_KEY"], "***")  # маска W6
        self.assertEqual(sh["labels"], {"kind": "shell"})
        self.assertTrue(sh["available"])
        un = next(p for p in data["presets"] if p["id"] == "nope-prog")
        self.assertFalse(un["available"])

    @unittest_run_loop
    async def test_spawn_preset_full_merge(self):
        resp = await self.spawn(
            preset="sh", name="p1", args=["/q"],
            env={"EXTRA": "e", "BASE": "override"},
            labels={"extra": "l"}, cwd="<REPO_ROOT>")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["preset"], "sh")
        self.assertEqual(data["address"], "local/p1")
        self.assertEqual(data["command"], ["cmd.exe", "/q"])
        self.assertEqual(data["cwd"], "D:/nexus")  # arg.cwd > preset.cwd
        self.assertEqual(data["labels"]["kind"], "shell")
        self.assertEqual(data["labels"]["extra"], "l")
        t = self.sup.get_terminal("local/p1")
        self.assertEqual(t.env["BASE"], "override")
        self.assertEqual(t.env["EXTRA"], "e")
        self.assertEqual(t.env["API_KEY"], "sekret")  # env пресета доехал

    @unittest_run_loop
    async def test_spawn_preset_defaults(self):
        resp = await self.spawn(preset="sh")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertTrue(data["name"].startswith("sh-"))
        self.assertEqual(data["cwd"], "D:/Temp")  # preset.cwd
        t = self.sup.get_terminal(data["address"])
        self.assertEqual(t.env["BASE"], "1")

    @unittest_run_loop
    async def test_spawn_unknown_400_unavailable_409(self):
        resp = await self.spawn(preset="ghost")
        self.assertEqual(resp.status, 400)
        resp = await self.spawn(preset="nope-prog")
        self.assertEqual(resp.status, 409)
        data = await resp.json()
        self.assertEqual(data["error"], "preset unavailable")

    @unittest_run_loop
    async def test_spawn_bad_fields_400(self):
        for bad in ({}, {"preset": ""}, {"preset": "sh", "args": "x"},
                    {"preset": "sh", "args": [1]},
                    {"preset": "sh", "env": "x"},
                    {"preset": "sh", "labels": {"k": 1}},
                    {"preset": "sh", "name": "Bad Name!"},
                    {"preset": "sh", "cwd": 5}):
            resp = await self.spawn(**bad)
            self.assertEqual(resp.status, 400, msg=str(bad))

    @unittest_run_loop
    async def test_spawn_dup_name_409(self):
        await self.spawn(preset="sh", name="dup1")
        resp = await self.spawn(preset="sh", name="dup1")
        self.assertEqual(resp.status, 409)

    @unittest_run_loop
    async def test_hot_edit_preset_file(self):
        self.presets_file.write_text(json.dumps({"presets": [
            {"id": "newone", "command": ["cmd.exe"]},
        ]}), encoding="utf-8")
        resp = await self.spawn(preset="newone", name="hot1")
        self.assertEqual(resp.status, 200)
        resp = await self.client.get("/api/core/presets")
        data = await resp.json()
        self.assertEqual(data["count"], 1)


if __name__ == "__main__":
    unittest.main()
