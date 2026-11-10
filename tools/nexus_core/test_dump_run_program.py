#!/usr/bin/env python3
"""
tools/nexus_core/test_dump_run_program.py — #562 transcript dump + run-program.

Unit: _strip_ansi (CSI/OSC/DCS/C0). API: GET .../dump (scrollback,
lines-limit, recent_output fallback, 404, bad lines) и POST
/api/core/run-program (resolve, auto-name, dup-409, unknown-400,
unavailable-409) — programs.json мокается, PTY — MockPTYBackend.

Запуск: pytest tools/nexus_core/test_dump_run_program.py
"""

from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from tools.nexus_core import programs as programs_mod
from tools.nexus_core.api import _strip_ansi, create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class TestStripAnsi(unittest.TestCase):
    def test_csi_stripped(self):
        self.assertEqual(_strip_ansi("\x1b[31mred\x1b[0m plain"),
                         "red plain")

    def test_osc_bel_and_st_stripped(self):
        self.assertEqual(
            _strip_ansi("a\x1b]0;title\x07b\x1b]8;;http://x\x1b\\c"),
            "abc")

    def test_dcs_and_charset_stripped(self):
        self.assertEqual(_strip_ansi("x\x1bP1;2|payload\x1b\\y\x1b(Bz"),
                         "xyz")

    def test_c0_controls_stripped_keeps_tab(self):
        # \n и \t сохраняются, остальные C0/DEL уходят
        self.assertEqual(_strip_ansi("a\x07b\x08c\r\nd\x7fe\tf"),
                         "abc\nde\tf")

    def test_plain_text_untouched(self):
        self.assertEqual(_strip_ansi("hello world\nline2"),
                         "hello world\nline2")


class DumpRunProgramApiTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="dump-api-"))
        self.backend = MockPTYBackend()
        self.sup = SupervisorV1(backend=self.backend)
        super().setUp()

    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.tmp / "state",
                          supervisor=self.sup,
                          templates_dir=self.tmp / "templates")

    async def run_terminal(self, name="t1", **kwargs):
        resp = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"], **kwargs})
        self.assertEqual(resp.status, 200)
        return await resp.json()

    # -- dump ------------------------------------------------------------

    @unittest_run_loop
    async def test_dump_scrollback_clean_text(self):
        await self.run_terminal("t1")
        term = self.sup.get_terminal("local/t1")
        term.scrollback.extend([
            "\x1b[32mline-one\x1b[0m",
            "plain \x1b]0;win\x07two",
            "three"])
        resp = await self.client.get("/api/core/terminal/t1/dump")
        self.assertEqual(resp.status, 200)
        self.assertEqual(resp.content_type, "text/plain")
        cd = resp.headers.get("Content-Disposition", "")
        self.assertIn("attachment", cd)
        self.assertIn('filename="t1.txt"', cd)
        body = await resp.text()
        self.assertNotIn("\x1b", body)
        self.assertIn("line-one", body)
        self.assertIn("plain two", body)
        self.assertIn("three", body)

    @unittest_run_loop
    async def test_dump_lines_limit(self):
        await self.run_terminal("t1")
        term = self.sup.get_terminal("local/t1")
        term.scrollback.extend(f"L{i}" for i in range(10))
        resp = await self.client.get("/api/core/terminal/t1/dump?lines=3")
        self.assertEqual(resp.status, 200)
        body = (await resp.text()).splitlines()
        self.assertEqual(body, ["L7", "L8", "L9"])

    @unittest_run_loop
    async def test_dump_recent_output_fallback(self):
        await self.run_terminal("t1")
        term = self.sup.get_terminal("local/t1")
        self.assertFalse(term.scrollback)  # deque пуст
        term.recent_output = "\x1b[1mRO-ONE\x1b[0m\nRO-TWO"
        resp = await self.client.get("/api/core/terminal/t1/dump")
        self.assertEqual(resp.status, 200)
        body = await resp.text()
        self.assertNotIn("\x1b", body)
        self.assertIn("RO-ONE", body)
        self.assertIn("RO-TWO", body)

    @unittest_run_loop
    async def test_dump_full_address_and_404(self):
        await self.run_terminal("t1")
        resp = await self.client.get("/api/core/terminal/local/t1/dump")
        self.assertEqual(resp.status, 200)
        resp = await self.client.get("/api/core/terminal/ghost/dump")
        self.assertEqual(resp.status, 404)
        resp = await self.client.get("/api/core/terminal/t1/dump?lines=x")
        self.assertEqual(resp.status, 400)
        resp = await self.client.get("/api/core/terminal/t1/dump?lines=0")
        self.assertEqual(resp.status, 400)

    # -- run-program -----------------------------------------------------

    def _programs(self, *entries):
        return mock.patch.object(
            programs_mod, "load_programs", return_value=list(entries))

    @unittest_run_loop
    async def test_run_program_auto_name_and_command(self):
        prog = {"id": "demo", "title": "Demo", "cmd": ["demo", "--x"],
                "available": True, "resolved": None}
        with self._programs(prog):
            resp = await self.client.post(
                "/api/core/run-program", json={"program": "demo"})
            self.assertEqual(resp.status, 200)
            data = await resp.json()
            self.assertEqual(data["name"], "demo-1")
            self.assertEqual(data["address"], "local/demo-1")
            self.assertEqual(data["command"], ["demo", "--x"])
            self.assertEqual(data["program"], "demo")
            # второй запуск — авто-имя инкрементится
            resp = await self.client.post(
                "/api/core/run-program", json={"program": "demo"})
            data = await resp.json()
            self.assertEqual(data["name"], "demo-2")

    @unittest_run_loop
    async def test_run_program_explicit_name_and_cwd(self):
        # cwd санитизируется _sanitize_cwd (isdir) — берём реальные каталоги
        cfg_dir = self.tmp / "cfg"; cfg_dir.mkdir()
        arg_dir = self.tmp / "arg"; arg_dir.mkdir()
        prog = {"id": "demo", "title": "Demo", "cmd": ["demo"],
                "cwd": str(cfg_dir), "available": True,
                "resolved": None}
        with self._programs(prog):
            resp = await self.client.post("/api/core/run-program", json={
                "program": "demo", "name": "mine",
                "cwd": str(arg_dir)})
            self.assertEqual(resp.status, 200)
            data = await resp.json()
            self.assertEqual(data["name"], "mine")
            # спека #562: cwd = p.cwd ?? arg.cwd — конфиг приоритетнее
            self.assertEqual(data["cwd"], str(cfg_dir))

    @unittest_run_loop
    async def test_run_program_unknown_400(self):
        with self._programs({"id": "demo", "cmd": ["d"],
                             "available": True}):
            resp = await self.client.post(
                "/api/core/run-program", json={"program": "nope"})
            self.assertEqual(resp.status, 400)
            resp = await self.client.post(
                "/api/core/run-program", json={})
            self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_run_program_unavailable_409(self):
        prog = {"id": "gone", "cmd": ["gone"], "available": False,
                "resolved": None}
        with self._programs(prog):
            resp = await self.client.post(
                "/api/core/run-program", json={"program": "gone"})
            self.assertEqual(resp.status, 409)
            data = await resp.json()
            self.assertEqual(data["error"], "program unavailable")
            self.assertIsNone(data["resolved"])

    @unittest_run_loop
    async def test_run_program_dup_name_409(self):
        prog = {"id": "demo", "cmd": ["demo"], "available": True}
        with self._programs(prog):
            resp = await self.client.post("/api/core/run-program",
                                          json={"program": "demo",
                                                "name": "dup"})
            self.assertEqual(resp.status, 200)
            resp = await self.client.post("/api/core/run-program",
                                          json={"program": "demo",
                                                "name": "dup"})
            self.assertEqual(resp.status, 409)

    @unittest_run_loop
    async def test_run_program_invalid_name_400(self):
        prog = {"id": "demo", "cmd": ["demo"], "available": True}
        with self._programs(prog):
            resp = await self.client.post("/api/core/run-program",
                                          json={"program": "demo",
                                                "name": "BAD NAME"})
            self.assertEqual(resp.status, 400)


if __name__ == "__main__":
    unittest.main()
