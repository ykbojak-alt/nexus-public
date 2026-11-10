#!/usr/bin/env python3
"""
tools/nexus_core/test_cli_http.py — тесты nx thin-client (#515, P0.1).

Покрытие, которого не было в переписанных TestCli*: core_client
(env/URL/auth/offline/SSE), hc-позиционные формы аргументов,
put file-drop (hc-семантика files/<machine>/<term>/) vs --text,
NX_TERMINAL_ID-инжекция, registry_path-wiring create_app.

Все тесты — против real core (CoreTestServer, CORE_MOCK=1).
"""

from __future__ import annotations

import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

from tools.nexus_core import core_client as cc
from tools.nexus_core._core_testserver import core_test_server
from tools.nexus_core.cli import main as cli_main


def make_temp_dir() -> Path:
    return Path(tempfile.mkdtemp(prefix="nexus-core-clihttp-test-"))


class _CliHttpBase(unittest.TestCase):
    """Общий fixture: env + real core server (mock-PTY, registry)."""

    def setUp(self):
        self._env = os.environ.copy()
        os.environ["CORE_MOCK"] = "1"
        self.tmp = make_temp_dir()
        os.environ["NX_STATE_DIR"] = str(self.tmp)
        os.environ["NEXUS_CORE_TOKEN"] = "test-token"
        self._srv_ctx = core_test_server(self.tmp)
        self.server = self._srv_ctx.__enter__()
        os.environ["NEXUS_CORE_URL"] = self.server.url

    def tearDown(self):
        self._srv_ctx.__exit__(None, None, None)
        os.environ.clear()
        os.environ.update(self._env)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_cli(self, argv: list[str], stdin: str = "") -> int:
        out, err = io.StringIO(), io.StringIO()
        old_stdin = sys.stdin
        sys.stdin = io.StringIO(stdin)
        try:
            with redirect_stdout(out), redirect_stderr(err):
                code = cli_main(argv)
        finally:
            sys.stdin = old_stdin
        self._out, self._err = out.getvalue(), err.getvalue()
        return code

    def term(self, address: str = "local/t1"):
        return self.server.state.supervisor.get_terminal(address)


class TestCoreClientEnv(unittest.TestCase):
    """core_client: env-дефолты, offline-ошибка, auth-заголовок."""

    def setUp(self):
        self._env = os.environ.copy()
        for var in ("NEXUS_CORE_URL", "NEXUS_CORE_TOKEN",
                    "NEXUS_CORE_READ_TOKEN"):
            os.environ.pop(var, None)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._env)

    def test_default_url_is_5684(self):
        self.assertEqual(cc.base_url(), "http://127.0.0.1:5684")

    def test_env_url_override(self):
        os.environ["NEXUS_CORE_URL"] = "http://127.0.0.1:9999/"
        self.assertEqual(cc.base_url(), "http://127.0.0.1:9999")

    def test_offline_error_message(self):
        os.environ["NEXUS_CORE_URL"] = "http://127.0.0.1:1"
        with self.assertRaises(cc.CoreOffline) as ctx:
            cc.api_get("/api/core/server")
        self.assertIn("core not running: nx serve", str(ctx.exception))

    def test_cli_offline_exit1_and_message(self):
        os.environ["NEXUS_CORE_URL"] = "http://127.0.0.1:1"
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            rc = cli_main(["ls"])
        self.assertEqual(rc, 1)
        self.assertIn("core not running: nx serve", err.getvalue())

    def test_api_key_prefers_core_token(self):
        os.environ["NEXUS_CORE_TOKEN"] = "core-tok"
        os.environ["NEXUS_CORE_READ_TOKEN"] = "read-tok"
        self.assertEqual(cc.api_key(), "core-tok")
        os.environ.pop("NEXUS_CORE_TOKEN")
        self.assertEqual(cc.api_key(), "read-tok")


class TestCliAgainstCore(_CliHttpBase):
    """e2e: cli_main → HTTP → real create_app."""

    def test_run_ls_get_read_flow(self):
        self.assertEqual(self.run_cli(["run", "t1", "sh", "-i"]), 0)
        self.assertEqual(self.run_cli(["ls"]), 0)
        self.assertIn("local/t1", self._out)
        self.assertEqual(self.run_cli(["get", "t1"]), 0)
        data = json.loads(self._out)
        self.assertEqual(data["address"], "local/t1")
        # read: кладём вывод в mock-PTY и прогоняем step_once
        term = self.term()
        term.handle.emit_raw(b"hello-screen\n")
        self.server.state.supervisor.step_once()
        self.assertEqual(self.run_cli(["read", "t1"]), 0)
        self.assertIn("hello-screen", self._out)

    def test_server_status_json(self):
        self.assertEqual(self.run_cli(["server", "status"]), 0)
        data = json.loads(self._out)
        self.assertEqual(data["state"], "running")
        self.assertIn("uptime_s", data)

    def test_system_metrics_json(self):
        """nx system → GET /api/core/system (#537) — живой ответ core."""
        self.assertEqual(self.run_cli(["system"]), 0)
        data = json.loads(self._out)
        for key in ("cpu_pct", "mem_used", "mem_total", "disks",
                    "net", "gpu", "uptime_s"):
            self.assertIn(key, data)
        self.assertIsInstance(data["disks"], list)
        self.assertIn("rx_bps", data["net"])

    def test_hc_positional_send(self):
        self.run_cli(["run", "t1", "sh", "-i"])
        # hc-форма: send <TERM> <TEXT>
        self.assertEqual(self.run_cli(["send", "t1", "echo hi"]), 0)
        stdin = self.term().handle.stdin_data()
        self.assertIn(b"echo hi\r", stdin)

    def test_send_flag_form_still_works(self):
        self.run_cli(["run", "t1", "sh", "-i"])
        self.assertEqual(self.run_cli(["send", "echo yo", "--term", "t1"]), 0)
        self.assertIn(b"echo yo\r", self.term().handle.stdin_data())

    def test_keys_positional(self):
        self.run_cli(["run", "t1", "sh", "-i"])
        self.assertEqual(self.run_cli(["keys", "t1", "ctrl+c"]), 0)

    def test_label_positional(self):
        self.run_cli(["run", "t1", "sh", "-i"])
        self.assertEqual(self.run_cli(["label", "t1", "role=coder"]), 0)
        self.assertEqual(self.term().labels.get("role"), "coder")

    def test_wait_timeout_exit124(self):
        self.run_cli(["run", "t1", "sh", "-i"])
        rc = self.run_cli(["wait", "t1", "--timeout", "0.3"])
        self.assertEqual(rc, 124)
        self.assertIn("timed_out", self._out)

    def test_wait_exited_ok(self):
        self.run_cli(["run", "t1", "sh", "-i"])
        self.term().handle.kill()
        self.server.state.supervisor.step_once()
        rc = self.run_cli(["wait", "t1", "--timeout", "2"])
        self.assertEqual(rc, 0)

    def test_kill_positional_and_get_404(self):
        self.run_cli(["run", "t1", "sh", "-i"])
        self.assertEqual(self.run_cli(["kill", "t1"]), 0)
        rc = self.run_cli(["get", "nope"])
        self.assertEqual(rc, 3)
        self.assertIn("not found", self._err)

    def test_nx_terminal_id_env_injection(self):
        """hc $HC_TERMINAL_ID parity: ядро инжектит NX_TERMINAL_ID в env."""
        self.run_cli(["run", "t1", "sh", "-i"])
        self.assertEqual(self.term().env.get("NX_TERMINAL_ID"), "local/t1")
        # spawn spec тоже несёт (реальный backend получил бы то же)
        self.assertEqual(
            self.term().handle.spec.env.get("NX_TERMINAL_ID"), "local/t1")

    def test_registry_path_wired_in_create_app(self):
        """P0.2: supervisor демона персистит registry.json в base."""
        sup = self.server.state.supervisor
        self.assertEqual(Path(sup._registry_path).name, "registry.json")
        self.assertEqual(Path(sup._registry_path).parent, self.tmp)

    def test_events_sse_limit(self):
        self.run_cli(["run", "t1", "sh", "-i"])
        rc = self.run_cli(["events", "--limit", "2"])
        self.assertEqual(rc, 0)
        lines = [l for l in self._out.splitlines() if l.strip()]
        self.assertGreaterEqual(len(lines), 2)
        for line in lines:
            json.loads(line)  # валидный JSON на строку

    def test_wrong_token_401(self):
        self.run_cli(["run", "t1", "sh", "-i"])
        with mock.patch("tools.nexus_core.core_client.api_key",
                        return_value="wrong-key"):
            rc = self.run_cli(["send", "t1", "hi"])
        self.assertEqual(rc, 1)
        self.assertIn("X-Nexus-Key", self._err)


class TestPutFileDrop(_CliHttpBase):
    """hc `put <TERM> <FILE>` — files/<machine>/<term>/ песочницы."""

    def test_put_delivers_file_bytes(self):
        self.run_cli(["run", "t1", "sh", "-i"])
        blob = b"\x89PNG\r\n\x1a\n" + bytes(range(256)) + b"\x00\xff"
        src = self.tmp / "pixel.bin"
        src.write_bytes(blob)
        rc = self.run_cli(["put", "t1", str(src)])
        self.assertEqual(rc, 0)
        data = json.loads(self._out)
        self.assertEqual(data["status"], "delivered")
        self.assertEqual(data["path"], "files/local/t1/pixel.bin")
        landed = self.tmp / "files" / "local" / "t1" / "pixel.bin"
        self.assertEqual(landed.read_bytes(), blob)

    def test_put_flag_form(self):
        self.run_cli(["run", "t1", "sh", "-i"])
        src = self.tmp / "note.txt"
        src.write_text("hello", encoding="utf-8")
        rc = self.run_cli(["put", str(src), "--term", "t1"])
        self.assertEqual(rc, 0)
        self.assertTrue(
            (self.tmp / "files" / "local" / "t1" / "note.txt").exists())

    def test_put_text_mode_no_enter(self):
        """--text — paste БЕЗ Enter (stdin не получает \\r)."""
        self.run_cli(["run", "t1", "sh", "-i"])
        rc = self.run_cli(["put", "t1", "--text", "partial"])
        self.assertEqual(rc, 0)
        self.assertEqual(self.term().handle.stdin_data(), b"partial")
        # контроль: обычный send добавляет \r
        self.run_cli(["send", "t1", "full"])
        self.assertIn(b"full\r", self.term().handle.stdin_data())

    def test_put_missing_file_fails(self):
        self.run_cli(["run", "t1", "sh", "-i"])
        rc = self.run_cli(["put", "t1", str(self.tmp / "nope.bin")])
        self.assertEqual(rc, 1)
        self.assertIn("file not found", self._err)

    def test_put_unknown_terminal_404(self):
        src = self.tmp / "x.bin"
        src.write_bytes(b"x")
        rc = self.run_cli(["put", "ghost", str(src)])
        self.assertEqual(rc, 3)

    def test_putfile_api_rejects_bad_name(self):
        self.run_cli(["run", "t1", "sh", "-i"])
        self.assertEqual(self._post_putfile_status({
            "term": "t1", "name": "../evil", "data_b64": "eA=="}), 400)
        self.assertEqual(self._post_putfile_status({
            "term": "t1", "name": "ok.bin", "data_b64": "!!!"}), 400)

    def _post_putfile_status(self, payload: dict) -> int:
        import urllib.error
        import urllib.request
        req = urllib.request.Request(
            f"{self.server.url}/api/core/putfile",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json",
                     "X-Nexus-Key": "test-token"},
            method="POST")
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status
        except urllib.error.HTTPError as exc:
            return exc.code


if __name__ == "__main__":
    unittest.main()
