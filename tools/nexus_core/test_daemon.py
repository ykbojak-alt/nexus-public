#!/usr/bin/env python3
"""
tools/nexus_core/test_daemon.py — юнит-тесты daemon-режима (N3.5):
state-файл, pid_alive, реальный detached-цикл serve → status → run →
screen (обе формы адреса) → stop, CLI-проводка nx serve.

Реальный цикл идёт под CORE_MOCK=1 (pythonw.exe detached) — это
проверяет сам механизм detached-спавна без ConPTY. Живой ConPTY-цикл —
вручную (см. отчёт FORGE-n3.5-1105.md).

Запуск: pytest tools/nexus_core/test_daemon.py
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path
from unittest import mock

from tools.nexus_core.cli import main as cli_main
from tools.nexus_core.daemon import (
    http_probe,
    pid_alive,
    read_daemon_state,
    start_daemon,
    status_daemon,
    stop_daemon,
    write_daemon_state,
)


def make_temp_base() -> Path:
    return Path(tempfile.mkdtemp(prefix="nexus-core-daemon-test-"))


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _http(method: str, url: str, body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8") if exc.fp else "{}"
        try:
            parsed = json.loads(body)
        except Exception:
            parsed = {"error": body}
        return exc.code, parsed


class TestDaemonState(unittest.TestCase):
    def setUp(self):
        self.tmp = make_temp_base()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_write_read_roundtrip(self):
        write_daemon_state(self.tmp, {"pid": 42, "port": 5681, "base": str(self.tmp)})
        state = read_daemon_state(self.tmp)
        self.assertEqual(state["pid"], 42)
        self.assertEqual(state["port"], 5681)
        self.assertTrue((self.tmp / "daemon.json").exists())

    def test_read_missing_none(self):
        self.assertIsNone(read_daemon_state(self.tmp))

    def test_read_corrupt_none(self):
        (self.tmp / "daemon.json").write_text("not-json{", encoding="utf-8")
        self.assertIsNone(read_daemon_state(self.tmp))

    def test_write_creates_parents(self):
        base = self.tmp / "deep" / "state"
        write_daemon_state(base, {"pid": 1})
        self.assertTrue((base / "daemon.json").exists())


class TestPidAlive(unittest.TestCase):
    def test_own_pid_alive(self):
        self.assertTrue(pid_alive(os.getpid()))

    def test_zero_and_negative_dead(self):
        self.assertFalse(pid_alive(0))
        self.assertFalse(pid_alive(-1))

    def test_fake_large_pid_dead(self):
        self.assertFalse(pid_alive(999999999))


class TestDaemonServeLoop(unittest.TestCase):
    """Реальный detached-цикл: serve → status → run → screen (обе формы) → stop."""

    def setUp(self):
        self.tmp = make_temp_base()
        self.port = free_port()
        self._old_mock = os.environ.get("CORE_MOCK")
        os.environ["CORE_MOCK"] = "1"

    def tearDown(self):
        stop_daemon(self.tmp)  # идемпотентно: если уже остановлен — stale-ветка
        if self._old_mock is None:
            os.environ.pop("CORE_MOCK", None)
        else:
            os.environ["CORE_MOCK"] = self._old_mock
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_serve_status_run_screen_stop(self):
        # -- serve (detached, pythonw) ------------------------------------
        rc = start_daemon(self.tmp, port=self.port)
        self.assertEqual(rc, 0)
        state = read_daemon_state(self.tmp)
        self.assertIsNotNone(state)
        self.assertEqual(state["port"], self.port)
        self.assertTrue(pid_alive(state["pid"]))

        # -- status ---------------------------------------------------------
        self.assertEqual(status_daemon(self.tmp), 0)

        # -- run терминал через HTTP ---------------------------------------
        status, data = _http("POST", f"http://127.0.0.1:{self.port}/api/core/run",
                             {"name": "t1", "command": ["sh", "-i"]})
        self.assertEqual(status, 200)
        self.assertEqual(data["address"], "local/t1")
        self.assertEqual(data["state"], "idle")

        # -- screen: обе формы адреса ---------------------------------------
        status, screen = _http("GET", f"http://127.0.0.1:{self.port}/api/core/screen/t1")
        self.assertEqual(status, 200)
        self.assertEqual(screen["term"], "local/t1")
        status, screen_full = _http(
            "GET", f"http://127.0.0.1:{self.port}/api/core/screen/local/t1"
        )
        self.assertEqual(status, 200)
        self.assertEqual(screen_full["term"], "local/t1")
        status, _ = _http("GET", f"http://127.0.0.1:{self.port}/api/core/screen/nope")
        self.assertEqual(status, 404)

        # -- stop -----------------------------------------------------------
        self.assertEqual(stop_daemon(self.tmp), 0)
        self.assertFalse(pid_alive(state["pid"]))
        self.assertEqual(status_daemon(self.tmp), 1)

    def test_start_twice_second_fails(self):
        self.assertEqual(start_daemon(self.tmp, port=self.port), 0)
        self.assertNotEqual(start_daemon(self.tmp, port=self.port), 0)
        self.assertEqual(stop_daemon(self.tmp), 0)


class TestCliServe(unittest.TestCase):
    def setUp(self):
        self.tmp = make_temp_base()
        self._old_state = os.environ.get("NX_STATE_DIR")
        os.environ["NX_STATE_DIR"] = str(self.tmp)

    def tearDown(self):
        if self._old_state is None:
            os.environ.pop("NX_STATE_DIR", None)
        else:
            os.environ["NX_STATE_DIR"] = self._old_state
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_serve_status_when_not_running_rc1(self):
        rc = cli_main(["serve", "--status"])
        self.assertEqual(rc, 1)

    def test_serve_stop_when_no_daemon_rc1(self):
        rc = cli_main(["serve", "--stop"])
        self.assertEqual(rc, 1)

    def test_serve_forwards_port(self):
        with mock.patch("tools.nexus_core.cli.start_daemon", return_value=0) as m:
            rc = cli_main(["serve", "--port", "5999"])
        self.assertEqual(rc, 0)
        m.assert_called_once_with(self.tmp, host="127.0.0.1", port=5999)


if __name__ == "__main__":
    unittest.main()
