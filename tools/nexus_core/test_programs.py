#!/usr/bin/env python3
"""
tools/nexus_core/test_programs.py — #551b programs-реестр.

Unit: load_programs — нормализация, detect (exe/where), битые записи,
hot-edit (файл перечитывается). API: GET /api/core/programs — форма
ответа и available-флаги на реальном programs.json репо.

Запуск: pytest tools/nexus_core/test_programs.py
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from tools.nexus_core import programs as pm
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class TestLoadPrograms(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="prog-"))

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _write(self, payload) -> Path:
        p = self.tmp / "programs.json"
        if isinstance(payload, str):
            p.write_text(payload, encoding="utf-8")
        else:
            p.write_text(json.dumps(payload), encoding="utf-8")
        return p

    def test_missing_file_empty(self):
        self.assertEqual(pm.load_programs(self.tmp / "nope.json"), [])

    def test_broken_json_empty(self):
        self.assertEqual(pm.load_programs(self._write("{not json")), [])

    def test_normalize_fields(self):
        p = self._write({"programs": [
            {"id": "my-tool", "title": "My Tool", "cmd": ["mytool", "-x"],
             "cwd": "D:/work", "detect": {"exe": "definitely-not-here-xyz"}},
        ]})
        out = pm.load_programs(p)
        self.assertEqual(len(out), 1)
        e = out[0]
        self.assertEqual(e["id"], "my-tool")
        self.assertEqual(e["title"], "My Tool")
        self.assertEqual(e["cmd"], ["mytool", "-x"])
        self.assertEqual(e["cwd"], "D:/work")
        self.assertFalse(e["available"])
        self.assertIsNone(e["resolved"])

    def test_detect_exe_available(self):
        # python.exe гарантированно в PATH на любой dev-машине с pytest
        exe = "python.exe" if sys.platform == "win32" else "python3"
        p = self._write({"programs": [
            {"id": "py", "cmd": [exe], "detect": {"exe": exe}},
        ]})
        out = pm.load_programs(p)
        self.assertTrue(out[0]["available"])
        self.assertTrue(out[0]["resolved"])

    def test_detect_where_path(self):
        target = self.tmp / "tool.bin"
        target.write_text("x")
        p = self._write({"programs": [
            {"id": "t", "cmd": ["t"], "detect": {"where": str(target)}},
            {"id": "t2", "cmd": ["t"], "detect": {"where": str(self.tmp / "gone")}},
        ]})
        out = {e["id"]: e for e in pm.load_programs(p)}
        self.assertTrue(out["t"]["available"])
        self.assertFalse(out["t2"]["available"])

    def test_no_detect_available_true(self):
        p = self._write({"programs": [{"id": "x", "cmd": ["whatever"]}]})
        out = pm.load_programs(p)
        self.assertTrue(out[0]["available"])
        self.assertIsNone(out[0]["resolved"])
        self.assertNotIn("detect", out[0])
        self.assertNotIn("cwd", out[0])

    def test_bad_entries_skipped(self):
        p = self._write({"programs": [
            {"id": "ok", "cmd": ["ok"]},
            {"id": "", "cmd": ["x"]},                    # пустой id
            {"id": "BAD ID", "cmd": ["x"]},              # пробел в id
            {"id": "nocmd"},                             # нет cmd
            {"id": "badcmd", "cmd": "notalist"},         # cmd не список
            {"id": "emptycmd", "cmd": []},              # пустой cmd
            {"id": "numid", "cmd": [1, 2]},              # не-строки в cmd
            "just-a-string",                             # не dict
            {"id": "badcwd", "cmd": ["x"], "cwd": 5},   # cwd не строка
        ]})
        out = pm.load_programs(p)
        self.assertEqual([e["id"] for e in out], ["ok"])

    def test_hot_edit_rereads(self):
        p = self._write({"programs": [{"id": "v1", "cmd": ["a"]}]})
        self.assertEqual(pm.load_programs(p)[0]["id"], "v1")
        self._write({"programs": [{"id": "v2", "cmd": ["b"]}]})
        self.assertEqual(pm.load_programs(p)[0]["id"], "v2")

    def test_default_file_loads(self):
        """Реальный programs.json репо — валиден и содержит дефолты."""
        out = pm.load_programs()
        ids = {e["id"] for e in out}
        for want in ("cmd", "pwsh", "powershell", "claude", "codex"):
            self.assertIn(want, ids)
        for e in out:
            self.assertIsInstance(e["cmd"], list)
            self.assertTrue(e["cmd"])
            self.assertIsInstance(e["available"], bool)


class ProgramsApiTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="prog-api-"))
        self.sup = SupervisorV1(backend=MockPTYBackend())
        super().setUp()

    def tearDown(self):
        super().tearDown()
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.tmp / "state",
                          supervisor=self.sup,
                          templates_dir=self.tmp / "templates")

    @unittest_run_loop
    async def test_get_programs_shape(self):
        resp = await self.client.get("/api/core/programs")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertIn("programs", data)
        self.assertEqual(data["count"], len(data["programs"]))
        for e in data["programs"]:
            self.assertIn("id", e)
            self.assertIn("title", e)
            self.assertIsInstance(e["cmd"], list)
            self.assertIn("available", e)
        # cmd.exe точно есть на Windows-хосте тестов
        cmd = next((e for e in data["programs"] if e["id"] == "cmd"), None)
        if cmd is not None:
            self.assertTrue(cmd["available"])


if __name__ == "__main__":
    unittest.main()
