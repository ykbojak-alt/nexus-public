#!/usr/bin/env python3
"""
tools/nexus_core/test_n4_modules.py — юнит-тесты N4 (nexus-core):
ssh_ops (mock-subprocess, БЕЗ реального ssh) + API-маршрутизация
machine:"local" vs remote для exec/file.read/write/edit.

ssh бинарь замокан: monkeypatch subprocess.run (ssh_ops.subprocess.run) —
фейковый runner с предсказуемыми stdout/stderr/exit. Кейсы: success /
exit!=0 / timeout / ssh_unreachable / unknown-machine / machine_not_ssh /
read/limit / write-атомарность / edit exact-once. Live-smoke на реальный
ssh — отдельно, не в pytest (см. отчёт FORGE-n4-1105.md).

Запуск: pytest tools/nexus_core/test_n4_modules.py
        python -m tools.nexus_core.test_n4_modules
"""

from __future__ import annotations

import asyncio
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from tools.nexus_core._core_testserver import core_test_server
from tools.nexus_core.api import create_app
from tools.nexus_core.cli import main as cli_main
from tools.nexus_core.machine_registry import MachineRegistry
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.ssh_ops import RemoteExecError, RemoteFileNotFound, SshOps
from tools.nexus_core.supervisor_v1 import SupervisorV1


def make_temp_dir() -> Path:
    return Path(tempfile.mkdtemp(prefix="nexus-core-n4-test-"))


# =============================================================================
# Фейковый subprocess.run для ssh_ops
# =============================================================================

class FakeCmd:
    """Запись одного фейкового вызова subprocess.run."""

    def __init__(self, argv, timeout):
        self.argv = argv
        self.timeout = timeout


def make_fake_run(scenario):
    """Строит фейковый subprocess.run по сценарию.

    scenario: callable(argv, timeout) -> subprocess.CompletedProcess-like
    (returncode, stdout, stderr) или raise subprocess.TimeoutExpired.
    Возвращает (fake_run, calls), где calls — список FakeCmd в порядке
    вызовов.
    """
    calls = []

    def fake_run(argv, **kwargs):
        calls.append(FakeCmd(list(argv), kwargs.get("timeout")))
        return scenario(list(argv), kwargs.get("timeout"))

    return fake_run, calls


def ok_result(stdout: str = "", stderr: str = "", rc: int = 0):
    return subprocess.CompletedProcess(
        args=[], returncode=rc, stdout=stdout.encode("utf-8"),
        stderr=stderr.encode("utf-8"),
    )


# Сценарии --------------------------------------------------------------

def _ssh_cmd(argv):
    """argv == ["ssh", "-o", ..., host, "<shlex.join command>"] → команда."""
    return shlex.split(argv[-1])


def scenario_exec_success(argv, timeout):
    cmd = _ssh_cmd(argv)
    if cmd[:1] in (["echo"],) or cmd[:2] == ["echo", "hi"]:
        return ok_result(stdout="hello from remote\n")
    raise AssertionError(f"unexpected ssh argv: {argv}")


def scenario_exec_nonzero(argv, timeout):
    return ok_result(stdout="", stderr="boom\n", rc=7)


def scenario_exec_unreachable(argv, timeout):
    return ok_result(
        stderr="ssh: connect to host 10.0.0.1 port 22: Connection timed out",
        rc=255,
    )


def scenario_exec_timeout(argv, timeout):
    raise subprocess.TimeoutExpired(cmd=argv, timeout=timeout, output=b"partial\n")


def scenario_file_read(argv, timeout):
    """wc -c → size; cat → content."""
    cmd = _ssh_cmd(argv)
    if cmd[:2] == ["wc", "-c"]:
        return ok_result(stdout="12\n")
    if cmd[:1] == ["cat"]:
        return ok_result(stdout="l1\nl2\nl3\n")
    raise AssertionError(f"unexpected ssh argv: {argv}")


def scenario_file_missing(argv, timeout):
    cmd = _ssh_cmd(argv)
    if cmd[:2] == ["wc", "-c"]:
        return ok_result(stderr="wc: /nope: No such file or directory", rc=1)
    raise AssertionError(f"unexpected ssh argv: {argv}")


def scenario_file_too_big(argv, timeout):
    cmd = _ssh_cmd(argv)
    if cmd[:2] == ["wc", "-c"]:
        return ok_result(stdout="99999999\n")
    raise AssertionError(f"unexpected ssh argv: {argv}")


def scenario_write_ok(argv, timeout):
    """scp → ok; ssh mkdir → ok; ssh mv → ok."""
    if argv[0] == "scp":
        return ok_result()
    cmd = _ssh_cmd(argv)
    if cmd[:2] == ["mkdir", "-p"]:
        return ok_result()
    if cmd[:1] == ["mv"]:
        return ok_result()
    raise AssertionError(f"unexpected argv: {argv}")


# =============================================================================
# SshOps (unit)
# =============================================================================

class SshOpsTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = make_temp_dir()
        self.registry = MachineRegistry(self.tmp)
        self.registry.add("vps", "user@host", transport="ssh")
        self.log: list[str] = []
        self.ops = SshOps(self.registry, log_fn=self.log.append)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


class TestSshExec(SshOpsTestCase):
    def test_success_same_contract_as_local(self):
        fake_run, calls = make_fake_run(scenario_exec_success)
        with mock.patch("tools.nexus_core.ssh_ops.subprocess.run", fake_run):
            result = self.ops.exec("vps", ["echo", "hi"])
        self.assertEqual(result["machine"], "vps")
        self.assertEqual(result["argv"], ["echo", "hi"])
        self.assertEqual(result["stdout"], "hello from remote\n")
        self.assertEqual(result["exit_code"], 0)
        self.assertFalse(result["timed_out"])
        self.assertIsInstance(result["duration_ms"], int)
        # ssh-обёртка: BatchMode + ConnectTimeout=5
        self.assertEqual(calls[0].argv[1:5], ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5"])
        self.assertIn("ssh exec vps", self.log[0])

    def test_nonzero_exit_is_result(self):
        fake_run, _ = make_fake_run(scenario_exec_nonzero)
        with mock.patch("tools.nexus_core.ssh_ops.subprocess.run", fake_run):
            result = self.ops.exec("vps", ["false"])
        self.assertEqual(result["exit_code"], 7)
        self.assertIn("boom", result["stderr"])
        self.assertFalse(result["timed_out"])

    def test_timeout_is_result(self):
        fake_run, calls = make_fake_run(scenario_exec_timeout)
        with mock.patch("tools.nexus_core.ssh_ops.subprocess.run", fake_run):
            result = self.ops.exec("vps", ["sleep", "10"], timeout=0.1)
        self.assertTrue(result["timed_out"])
        self.assertIsNone(result["exit_code"])
        self.assertEqual(result["stdout"], "partial\n")

    def test_ssh_unreachable_raises_honest_error(self):
        fake_run, _ = make_fake_run(scenario_exec_unreachable)
        with mock.patch("tools.nexus_core.ssh_ops.subprocess.run", fake_run):
            with self.assertRaises(RemoteExecError) as ctx:
                self.ops.exec("vps", ["true"])
        self.assertEqual(ctx.exception.kind, "ssh_unreachable")

    def test_unknown_machine_raises(self):
        with self.assertRaises(RemoteExecError) as ctx:
            self.ops.exec("nope", ["echo"])
        self.assertEqual(ctx.exception.kind, "machine_not_found")

    def test_unknown_machine_does_not_touch_subprocess(self):
        fake_run, calls = make_fake_run(scenario_exec_success)
        with mock.patch("tools.nexus_core.ssh_ops.subprocess.run", fake_run):
            with self.assertRaises(RemoteExecError):
                self.ops.exec("nope", ["echo"])
        self.assertEqual(calls, [])

    def test_local_transport_name_rejected(self):
        self.registry.add("loc2", "localhost", transport="local")
        with self.assertRaises(RemoteExecError) as ctx:
            self.ops.exec("loc2", ["echo"])
        self.assertEqual(ctx.exception.kind, "machine_not_ssh")

    def test_invalid_argv(self):
        with self.assertRaises(RemoteExecError) as ctx:
            self.ops.exec("vps", [])
        self.assertEqual(ctx.exception.kind, "invalid_args")

    def test_invalid_timeout(self):
        with self.assertRaises(RemoteExecError) as ctx:
            self.ops.exec("vps", ["echo"], timeout=0)
        self.assertEqual(ctx.exception.kind, "invalid_args")

    def test_timeout_capped_at_max(self):
        fake_run, calls = make_fake_run(
            lambda argv, timeout: ok_result(stdout="ok\n")
        )
        with mock.patch("tools.nexus_core.ssh_ops.subprocess.run", fake_run):
            self.ops.exec("vps", ["echo"], timeout=9999)
        self.assertEqual(calls[0].timeout, 600.0)


class TestSshFileOps(SshOpsTestCase):
    def test_read_full_lines(self):
        fake_run, calls = make_fake_run(scenario_file_read)
        with mock.patch("tools.nexus_core.ssh_ops.subprocess.run", fake_run):
            result = self.ops.read("vps", "/tmp/x.txt")
        self.assertEqual(result["content"], "l1\nl2\nl3")
        self.assertEqual(result["total_lines"], 3)
        self.assertEqual(result["lines"], 3)
        self.assertEqual(result["machine"], "vps")
        # wc -c сначала, cat потом
        self.assertEqual(_ssh_cmd(calls[0].argv)[:3], ["wc", "-c", "/tmp/x.txt"])
        self.assertEqual(_ssh_cmd(calls[1].argv)[:2], ["cat", "/tmp/x.txt"])
        self.assertIn("ssh read vps", self.log[0])

    def test_read_offset_limit(self):
        fake_run, _ = make_fake_run(scenario_file_read)
        with mock.patch("tools.nexus_core.ssh_ops.subprocess.run", fake_run):
            result = self.ops.read("vps", "/tmp/x.txt", offset=2, limit=1)
        self.assertEqual(result["content"], "l2")
        self.assertEqual(result["lines"], 1)

    def test_read_missing_raises_remote_file_not_found(self):
        fake_run, _ = make_fake_run(scenario_file_missing)
        with mock.patch("tools.nexus_core.ssh_ops.subprocess.run", fake_run):
            with self.assertRaises(RemoteFileNotFound):
                self.ops.read("vps", "/nope")

    def test_read_over_limit_raises(self):
        fake_run, _ = make_fake_run(scenario_file_too_big)
        with mock.patch("tools.nexus_core.ssh_ops.subprocess.run", fake_run):
            with self.assertRaises(RemoteExecError) as ctx:
                self.ops.read("vps", "/big")
        self.assertEqual(ctx.exception.kind, "remote_limit_exceeded")

    def test_read_bad_offset(self):
        with self.assertRaises(RemoteExecError) as ctx:
            self.ops.read("vps", "/tmp/x.txt", offset=0)
        self.assertEqual(ctx.exception.kind, "invalid_args")

    def test_write_atomic_scp_then_mv(self):
        fake_run, calls = make_fake_run(scenario_write_ok)
        with mock.patch("tools.nexus_core.ssh_ops.subprocess.run", fake_run):
            result = self.ops.write("vps", "/tmp/x.txt", "hello")
        self.assertEqual(result["path"], "/tmp/x.txt")
        self.assertEqual(result["bytes"], 5)
        # scp во временный файл remote → mkdir -p → mv tmp path
        self.assertEqual(calls[0].argv[0], "scp")
        self.assertIn("user@host:/tmp/", calls[0].argv[-1])
        self.assertEqual(_ssh_cmd(calls[1].argv)[:3], ["mkdir", "-p", "/tmp"])
        mv_cmd = _ssh_cmd(calls[2].argv)
        self.assertEqual(mv_cmd[0], "mv")
        self.assertTrue(mv_cmd[1].startswith("/tmp/"))
        self.assertEqual(mv_cmd[2], "/tmp/x.txt")
        self.assertIn("ssh write vps", self.log[0])

    def test_write_scp_failure_unreachable(self):
        def scenario(argv, timeout):
            if argv[0] == "scp":
                return ok_result(
                    stderr="scp: Connection refused", rc=255
                )
            raise AssertionError(f"unexpected argv: {argv}")

        fake_run, _ = make_fake_run(scenario)
        with mock.patch("tools.nexus_core.ssh_ops.subprocess.run", fake_run):
            with self.assertRaises(RemoteExecError) as ctx:
                self.ops.write("vps", "/tmp/x.txt", "hello")
        self.assertEqual(ctx.exception.kind, "ssh_unreachable")

    def test_edit_read_modify_write_back(self):
        def scenario(argv, timeout):
            cmd = _ssh_cmd(argv)
            if cmd[:2] == ["wc", "-c"]:
                return ok_result(stdout="11\n")
            if cmd[:1] == ["cat"]:
                return ok_result(stdout="hello world\n")
            return scenario_write_ok(argv, timeout)

        fake_run, calls = make_fake_run(scenario)
        with mock.patch("tools.nexus_core.ssh_ops.subprocess.run", fake_run):
            result = self.ops.edit("vps", "/tmp/x.txt", [("world", "N4")])
        self.assertEqual(result["replacements"], 1)
        # запись: scp (3-й вызов) — mv с новым содержимым
        self.assertGreaterEqual(len(calls), 5)
        self.assertEqual(calls[2].argv[0], "scp")
        self.assertIn("ssh edit vps", self.log[0])

    def test_edit_no_match_all_or_none_no_write(self):
        fake_run, calls = make_fake_run(scenario_file_read)
        with mock.patch("tools.nexus_core.ssh_ops.subprocess.run", fake_run):
            with self.assertRaises(RemoteExecError) as ctx:
                self.ops.edit("vps", "/tmp/x.txt", [("zzz", "x")])
        self.assertEqual(ctx.exception.kind, "edit_invalid")
        # только wc + cat, БЕЗ права (scp/mv не звались)
        self.assertEqual(len(calls), 2)


# =============================================================================
# API: маршрутизация machine:"local" vs remote
# =============================================================================

class CoreApiN4TestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = make_temp_dir()
        self.backend = MockPTYBackend()
        self.supervisor = SupervisorV1(backend=self.backend)
        super().setUp()

    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        app = create_app(base=self.tmp, supervisor=self.supervisor,
                         templates_dir=self.tmp / "templates")
        app["state"].machines.add("vps", "user@host", transport="ssh")
        return app


class TestExecApiN4(CoreApiN4TestCase):
    @unittest_run_loop
    async def test_exec_machine_local_untouched(self):
        resp = await self.client.post("/api/core/exec", json={
            "machine": "local",
            "argv": [sys.executable, "-c", "print(123)"],
        })
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["stdout"].strip(), "123")
        self.assertEqual(data["exit_code"], 0)

    @unittest_run_loop
    async def test_exec_remote_success_routes_to_ssh_ops(self):
        fake_run, calls = make_fake_run(scenario_exec_success)
        state = self.app["state"]
        with mock.patch("tools.nexus_core.ssh_ops.subprocess.run", fake_run):
            resp = await self.client.post("/api/core/exec", json={
                "machine": "vps",
                "argv": ["echo", "hi"],
            })
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["machine"], "vps")
        self.assertEqual(data["stdout"], "hello from remote\n")
        self.assertNotEqual(calls, [])
        # пути remote-операций логируются в ssh_log
        self.assertTrue(any("ssh exec vps" in line for line in state.ssh_log))

    @unittest_run_loop
    async def test_exec_remote_unreachable_502_not_500(self):
        fake_run, _ = make_fake_run(scenario_exec_unreachable)
        with mock.patch("tools.nexus_core.ssh_ops.subprocess.run", fake_run):
            resp = await self.client.post("/api/core/exec", json={
                "machine": "vps",
                "argv": ["true"],
            })
        self.assertEqual(resp.status, 502)
        data = await resp.json()
        self.assertEqual(data["error"], "ssh_unreachable")
        self.assertIn("message", data)

    @unittest_run_loop
    async def test_exec_remote_timeout_is_result_200(self):
        fake_run, _ = make_fake_run(scenario_exec_timeout)
        with mock.patch("tools.nexus_core.ssh_ops.subprocess.run", fake_run):
            resp = await self.client.post("/api/core/exec", json={
                "machine": "vps",
                "argv": ["sleep", "10"],
                "timeout": 0.1,
            })
        # timeout — результат, а не ошибка (контракт К2/К6)
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertTrue(data["timed_out"])
        self.assertIsNone(data["exit_code"])

    @unittest_run_loop
    async def test_exec_unknown_machine_404(self):
        resp = await self.client.post("/api/core/exec", json={
            "machine": "nope",
            "argv": ["echo"],
        })
        self.assertEqual(resp.status, 404)
        data = await resp.json()
        self.assertEqual(data["error"], "machine_not_found")


class TestFileApiN4(CoreApiN4TestCase):
    @unittest_run_loop
    async def test_file_remote_roundtrip_via_ssh(self):
        state = self.app["state"]

        def scenario(argv, timeout):
            cmd = _ssh_cmd(argv)
            if cmd[:2] == ["wc", "-c"]:
                return ok_result(stdout="11\n")
            if cmd[:1] == ["cat"]:
                return ok_result(stdout="hello world\n")
            return scenario_write_ok(argv, timeout)

        fake_run, calls = make_fake_run(scenario)

        with mock.patch("tools.nexus_core.ssh_ops.subprocess.run", fake_run):
            resp = await self.client.post("/api/core/file/write", json={
                "machine": "vps", "path": "/tmp/x.txt", "content": "hello world",
            })
            self.assertEqual(resp.status, 200)
            self.assertEqual((await resp.json())["bytes"], 11)
            resp = await self.client.get(
                "/api/core/file/read?path=/tmp/x.txt&machine=vps"
            )
            self.assertEqual(resp.status, 200)
            data = await resp.json()
            self.assertEqual(data["content"], "hello world")
            self.assertEqual(data["machine"], "vps")
            resp = await self.client.post("/api/core/file/edit", json={
                "machine": "vps", "path": "/tmp/x.txt",
                "pairs": [["world", "N4"]],
            })
            self.assertEqual(resp.status, 200)
            self.assertEqual((await resp.json())["replacements"], 1)
        self.assertNotEqual(calls, [])
        # пути логируются
        self.assertTrue(any("ssh read vps" in line for line in state.ssh_log))

    @unittest_run_loop
    async def test_file_remote_missing_404(self):
        fake_run, _ = make_fake_run(scenario_file_missing)
        with mock.patch("tools.nexus_core.ssh_ops.subprocess.run", fake_run):
            resp = await self.client.get(
                "/api/core/file/read?path=/nope&machine=vps"
            )
        self.assertEqual(resp.status, 404)
        data = await resp.json()
        self.assertEqual(data["error"], "remote_file_not_found")

    @unittest_run_loop
    async def test_file_remote_unreachable_502(self):
        fake_run, _ = make_fake_run(scenario_exec_unreachable)
        with mock.patch("tools.nexus_core.ssh_ops.subprocess.run", fake_run):
            resp = await self.client.post("/api/core/file/write", json={
                "machine": "vps", "path": "/tmp/x.txt", "content": "x",
            })
        self.assertEqual(resp.status, 502)
        data = await resp.json()
        self.assertEqual(data["error"], "ssh_unreachable")

    @unittest_run_loop
    async def test_file_local_untouched(self):
        resp = await self.client.post("/api/core/file/write", json={
            "machine": "local", "path": "a.txt", "content": "hi\n",
        })
        self.assertEqual(resp.status, 200)
        resp = await self.client.get("/api/core/file/read?path=a.txt&machine=local")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["content"], "hi")


class TestCliBridgeN4(unittest.TestCase):
    """nx exec --on <machine> / nx file … --on <machine> → SshOps (#305).

    #515: cli — thin client; тесты поднимают real core (CoreTestServer),
    "vps" регистрируется в серверном machines.json ДО старта. Патчи
    ssh_ops.subprocess.run действуют на сервер (тот же процесс).
    """

    def setUp(self):
        self.tmp = make_temp_dir()
        self._env = os.environ.copy()
        os.environ["CORE_MOCK"] = "1"
        os.environ["NX_STATE_DIR"] = str(self.tmp)
        registry = MachineRegistry(self.tmp)
        registry.add("vps", "user@host", transport="ssh")
        os.environ["NEXUS_CORE_TOKEN"] = "test-token"
        self._srv_ctx = core_test_server(self.tmp)
        self.server = self._srv_ctx.__enter__()
        os.environ["NEXUS_CORE_URL"] = self.server.url
        self.log: list[str] = []
        self.ssh = SshOps(registry, log_fn=self.log.append)

    def tearDown(self):
        self._srv_ctx.__exit__(None, None, None)
        os.environ.clear()
        os.environ.update(self._env)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_cli(self, argv: list[str], stdin: str = "") -> int:
        import io
        from contextlib import redirect_stdout, redirect_stderr
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

    def ssh_patch(self, scenario):
        """Патч ssh_ops.subprocess.run, адаптирующий kwargs к сценарию."""
        def fake_run(argv, **kwargs):
            return scenario(list(argv), kwargs.get("timeout"))
        return mock.patch("tools.nexus_core.ssh_ops.subprocess.run", side_effect=fake_run)

    def test_exec_remote_success(self):
        with self.ssh_patch(scenario_exec_success):
            code = self.run_cli(["exec", "--on", "vps", "echo", "hi"])
        self.assertEqual(code, 0)
        self.assertEqual(self._out, "hello from remote\n")

    def test_exec_remote_nonzero_exit(self):
        with self.ssh_patch(scenario_exec_nonzero):
            code = self.run_cli(["exec", "--on", "vps", "false"])
        self.assertEqual(code, 7)
        self.assertIn("boom", self._err)

    def test_exec_remote_unreachable_error_not_exit2(self):
        with self.ssh_patch(scenario_exec_unreachable):
            code = self.run_cli(["exec", "--on", "vps", "true"])
        self.assertEqual(code, 1)  # EXIT_ERROR, не unimplemented
        self.assertIn("error:", self._err)

    def test_exec_unknown_machine_error(self):
        code = self.run_cli(["exec", "--on", "nope", "true"])
        self.assertEqual(code, 3)  # 404 → EXIT_NOT_FOUND
        self.assertIn("machine not found", self._err)

    def test_exec_local_untouched(self):
        # патч ssh_ops.subprocess.run глобален для модуля subprocess — не
        # накладываем его на локальный путь: проверяем реальный spawn.
        code = self.run_cli(["exec", sys.executable, "-c", "print(123)"])
        self.assertEqual(code, 0)
        self.assertEqual(self._out.strip(), "123")

    def test_file_write_read_edit_remote(self):
        def scenario(argv, timeout):
            cmd = _ssh_cmd(argv)
            if cmd[:2] == ["wc", "-c"]:
                return ok_result(stdout="11\n")
            if cmd[:1] == ["cat"]:
                return ok_result(stdout="hello world\n")
            return scenario_write_ok(argv, timeout)

        with self.ssh_patch(scenario):
            code = self.run_cli(["file", "write", "/tmp/x.txt", "--on", "vps", "--content", "hello world"])
            self.assertEqual(code, 0)
            self.assertIn('"bytes": 11', self._out)

            code = self.run_cli(["file", "read", "/tmp/x.txt", "--on", "vps"])
            self.assertEqual(code, 0)
            self.assertEqual(self._out, "hello world\n")

            code = self.run_cli(["file", "edit", "/tmp/x.txt", "--on", "vps", "--old", "world", "--new", "N4"])
            self.assertEqual(code, 0)
            self.assertIn('"replacements": 1', self._out)

    def test_file_read_remote_missing(self):
        with self.ssh_patch(scenario_file_missing):
            code = self.run_cli(["file", "read", "/nope", "--on", "vps"])
        self.assertEqual(code, 3)  # 404 → EXIT_NOT_FOUND
        self.assertIn("file not found", self._err)


class TestMachineUpdateLoginConnectN4(unittest.TestCase):
    """machine update/login + connect --session (#306).

    #515: через core API — серверный MachineRegistry/SupervisorV1.
    """

    def setUp(self):
        self.tmp = make_temp_dir()
        self._env = os.environ.copy()
        os.environ["CORE_MOCK"] = "1"
        os.environ["NX_STATE_DIR"] = str(self.tmp)
        self._pre_registry = MachineRegistry(self.tmp)
        self._pre_registry.add("vps", "user@host", transport="ssh")
        os.environ["NEXUS_CORE_TOKEN"] = "test-token"
        self._srv_ctx = core_test_server(self.tmp)
        self.server = self._srv_ctx.__enter__()
        os.environ["NEXUS_CORE_URL"] = self.server.url

    def tearDown(self):
        self._srv_ctx.__exit__(None, None, None)
        os.environ.clear()
        os.environ.update(self._env)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_cli(self, argv: list[str]) -> int:
        import io
        from contextlib import redirect_stdout, redirect_stderr
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = cli_main(argv)
        self._out, self._err = out.getvalue(), err.getvalue()
        return code

    def test_machine_update_host_and_labels(self):
        code = self.run_cli(
            ["machine", "update", "vps", "--host", "new@host",
             "--labels", "env=prod", "--labels", "region=eu"]
        )
        self.assertEqual(code, 0)
        self.assertIn('"host": "new@host"', self._out)
        m = MachineRegistry(self.tmp).get("vps")
        self.assertEqual(m.host, "new@host")
        self.assertEqual(m.labels, {"env": "prod", "region": "eu"})

    def test_machine_login_reachable(self):
        # probe_fn привязан к серверному реестру при create_app
        with mock.patch.object(
                self.server.state.machines, "probe_fn",
                return_value=("connected", None)):
            code = self.run_cli(["machine", "login", "vps"])
        self.assertEqual(code, 0)
        self.assertIn("reachable", self._out)

    def test_machine_login_auth_needed(self):
        with mock.patch.object(
                self.server.state.machines, "probe_fn",
                return_value=("needs_login", "permission denied")):
            code = self.run_cli(["machine", "login", "vps"])
        self.assertEqual(code, 0)
        self.assertIn("auth-needed", self._out)

    def test_machine_login_unknown(self):
        code = self.run_cli(["machine", "login", "nope"])
        self.assertEqual(code, 3)  # 404 → EXIT_NOT_FOUND
        self.assertIn("machine not found", self._err)

    def test_connect_session_creates_terminal(self):
        code = self.run_cli(["connect", "user@host", "--name", "vps2", "--session"])
        self.assertEqual(code, 0)
        self.assertIn("session_started", self._out)
        self.assertIn("ssh-vps2", self._out)
        terms = self.server.state.supervisor.list_terminals()
        self.assertEqual(len(terms), 1)
        self.assertEqual(terms[0].machine, "vps2")
        self.assertEqual(terms[0].command[0], "ssh")

    def test_connect_session_duplicate_name(self):
        code = self.run_cli(["connect", "user@host", "--name", "vps", "--session"])
        self.assertEqual(code, 1)
        self.assertIn("already exists", self._err)


if __name__ == "__main__":
    unittest.main()
