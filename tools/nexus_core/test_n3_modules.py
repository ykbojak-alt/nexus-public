#!/usr/bin/env python3
"""
tools/nexus_core/test_n3_modules.py — юнит-тесты N3 (nexus-core):
file read/write/edit (sandbox), MachineRegistry (add/rm/rename/remap),
machine_exec (local/remote/timeout), API-ручки (exec, file, machines,
server), CLI nx (exec/file/machine/connect/server).

Запуск: pytest tools/nexus_core/test_n3_modules.py
        python -m tools.nexus_core.test_n3_modules
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from tools.nexus_core._core_testserver import core_test_server
from tools.nexus_core.api import create_app
from tools.nexus_core.cli import main as cli_main
from tools.nexus_core.file_ops import FileOps, FileOpsError, FileOpsNotFound
from tools.nexus_core.machine_registry import (
    MachineError,
    MachineRegistry,
    RemoteNotSupportedError,
    machine_exec,
    validate_host,
)
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.signed_json import (
    REGISTRY_KEY_ENV,
    REQUIRE_SIG_ENV,
)
from tools.nexus_core.supervisor_v1 import SupervisorV1


def make_temp_dir() -> Path:
    return Path(tempfile.mkdtemp(prefix="nexus-core-n3-test-"))


FAKE_PROBE_CONNECTED = lambda host: ("connected", None)  # noqa: E731


# =============================================================================
# FileOps
# =============================================================================

class TestFileOps(unittest.TestCase):
    def setUp(self):
        self.tmp = make_temp_dir()
        self.ops = FileOps(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _make(self, name="a.txt", content="l1\nl2\nl3\n"):
        (self.tmp / name).write_text(content, encoding="utf-8")
        return name

    def test_read_full(self):
        name = self._make()
        result = self.ops.read(name)
        self.assertEqual(result["content"], "l1\nl2\nl3")
        self.assertEqual(result["total_lines"], 3)
        self.assertEqual(result["lines"], 3)

    def test_read_offset_limit(self):
        name = self._make()
        result = self.ops.read(name, offset=2, limit=1)
        self.assertEqual(result["content"], "l2")
        self.assertEqual(result["lines"], 1)

    def test_read_missing_raises(self):
        with self.assertRaises(FileOpsNotFound):
            self.ops.read("nope.txt")

    def test_read_bad_offset(self):
        with self.assertRaises(FileOpsError):
            self.ops.read("a.txt", offset=0)

    def test_read_absolute_path_rejected(self):
        with self.assertRaises(FileOpsError):
            self.ops.read(str(self.tmp / "a.txt"))

    def test_read_escape_rejected(self):
        with self.assertRaises(FileOpsError):
            self.ops.read("../outside.txt")

    def test_read_nested_ok(self):
        (self.tmp / "sub").mkdir()
        (self.tmp / "sub" / "x.txt").write_text("hi", encoding="utf-8")
        result = self.ops.read("sub/x.txt")
        self.assertEqual(result["content"], "hi")

    def test_write_atomic_and_creates_dirs(self):
        result = self.ops.write("deep/dir/out.txt", "hello")
        self.assertEqual(Path(result["path"]), Path("deep/dir/out.txt"))
        self.assertEqual(result["bytes"], 5)
        self.assertEqual((self.tmp / "deep/dir/out.txt").read_text(), "hello")

    def test_write_overwrites(self):
        name = self._make()
        self.ops.write(name, "new")
        self.assertEqual((self.tmp / name).read_text(), "new")

    def test_write_escape_rejected(self):
        with self.assertRaises(FileOpsError):
            self.ops.write("../evil.txt", "x")

    def test_edit_exact_once(self):
        name = self._make(content="abc\nmiddle\nxyz\n")
        result = self.ops.edit(name, [("middle", "REPLACED")])
        self.assertEqual(result["replacements"], 1)
        self.assertEqual(
            (self.tmp / name).read_text(), "abc\nREPLACED\nxyz\n"
        )

    def test_edit_no_match_raises_and_unchanged(self):
        name = self._make(content="abc\n")
        with self.assertRaises(FileOpsError):
            self.ops.edit(name, [("zzz", "x")])
        self.assertEqual((self.tmp / name).read_text(), "abc\n")

    def test_edit_multiple_matches_raises(self):
        name = self._make(content="dup\ndup\n")
        with self.assertRaises(FileOpsError):
            self.ops.edit(name, [("dup", "x")])

    def test_edit_pairs_all_or_none(self):
        name = self._make(content="a\nb\nc\n")
        with self.assertRaises(FileOpsError):
            self.ops.edit(name, [("a", "A"), ("zzz", "Z")])
        # первая пара НЕ применилась (all-or-none)
        self.assertEqual((self.tmp / name).read_text(), "a\nb\nc\n")
        result = self.ops.edit(name, [("a", "A"), ("c", "C")])
        self.assertEqual(result["replacements"], 2)
        self.assertEqual((self.tmp / name).read_text(), "A\nb\nC\n")

    def test_edit_missing_file(self):
        with self.assertRaises(FileOpsNotFound):
            self.ops.edit("nope.txt", [("a", "b")])


# =============================================================================
# MachineRegistry
# =============================================================================

class TestMachineRegistry(unittest.TestCase):
    def setUp(self):
        self.tmp = make_temp_dir()
        self.backend = MockPTYBackend()
        self.supervisor = SupervisorV1(backend=self.backend)
        self.reg = MachineRegistry(self.tmp, supervisor=self.supervisor,
                                   probe_fn=FAKE_PROBE_CONNECTED)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_seed_local(self):
        local = self.reg.get("local")
        self.assertIsNotNone(local)
        self.assertEqual(local.transport, "local")
        self.assertEqual(local.state, "connected")

    def test_add_ssh(self):
        m = self.reg.add("vps", "user@host", transport="ssh")
        self.assertEqual(m.transport, "ssh")
        self.assertEqual(m.state, "connecting")
        self.assertIn("vps", [x.name for x in self.reg.list_all()])

    def test_add_duplicate_raises(self):
        self.reg.add("vps", "h")
        with self.assertRaises(MachineError):
            self.reg.add("vps", "h2")

    def test_add_invalid_transport(self):
        with self.assertRaises(MachineError):
            self.reg.add("vps", "h", transport="ftp")

    def test_add_invalid_name(self):
        with self.assertRaises(MachineError):
            self.reg.add("BAD NAME", "h")

    def test_get_missing_none(self):
        self.assertIsNone(self.reg.get("nope"))

    def test_rm_does_not_touch_terminals(self):
        term = self.supervisor.create_terminal(name="t1", command=["sh", "-i"])
        self.assertEqual(term.machine, "local")
        self.reg.add("vps", "h", transport="ssh")
        self.reg.rm("vps")
        self.assertIsNone(self.reg.get("vps"))
        # терминал жив и не тронут
        self.assertIsNotNone(self.supervisor.get_terminal("local/t1"))

    def test_rename_remaps_terminals(self):
        self.supervisor.create_terminal(name="t1", command=["sh", "-i"])
        old_addr = "local/t1"
        self.assertTrue(old_addr in self.supervisor.terminals)
        self.reg.rename("local", "work")
        # адрес сменился, терминал перенацелен
        self.assertNotIn(old_addr, self.supervisor.terminals)
        term = self.supervisor.get_terminal("work/t1")
        self.assertIsNotNone(term)
        self.assertEqual(term.machine, "work")

    def test_persistence_across_reload(self):
        self.reg.add("vps", "user@host", transport="ssh")
        # ремап терминалов не теряется при перезагрузке реестра
        reg2 = MachineRegistry(self.tmp, supervisor=self.supervisor,
                               probe_fn=FAKE_PROBE_CONNECTED)
        vps = reg2.get("vps")
        self.assertIsNotNone(vps)
        self.assertEqual(vps.host, "user@host")

    def test_probe_updates_state(self):
        self.reg.add("vps", "h", transport="ssh")
        m = self.reg.probe("vps")
        self.assertEqual(m.state, "connected")
        self.assertIsNone(m.why)

    def test_host_validation_rejects_injection(self):
        # HERETIC #419: host → argv ssh; ведущий '-' = option injection
        for bad in ("-oProxyCommand=nc x", "-oBatchMode=no", "",
                    "  ", "host name", "host;rm -rf /", "host=$(id)",
                    "host`id`", 'host"x', "host\nx"):
            with self.assertRaises(MachineError, msg=bad):
                self.reg.add("vps", bad)
            with self.assertRaises(MachineError, msg=bad):
                validate_host(bad)

    def test_host_validation_accepts_forms(self):
        for good in ("user@host", "host", "192.168.1.1",
                     "host.example.com", "[::1]", "user@[2001:db8::1]",
                     "  spaced-host  "):
            self.assertEqual(validate_host(good), good.strip())


class TestMachinesIntegrity(unittest.TestCase):
    """HERETIC #419: machines.json — HMAC как registry.json."""

    KEY = "test-machines-secret"

    def setUp(self):
        self.tmp = make_temp_dir()
        self._env = {}
        for var in (REGISTRY_KEY_ENV, REQUIRE_SIG_ENV):
            self._env[var] = os.environ.get(var)

    def tearDown(self):
        for var, old in self._env.items():
            if old is None:
                os.environ.pop(var, None)
            else:
                os.environ[var] = old
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _reg(self):
        return MachineRegistry(self.tmp, probe_fn=FAKE_PROBE_CONNECTED)

    def _file(self):
        return self.tmp / "machines.json"

    def _write(self, payload):
        self._file().write_text(json.dumps(payload), encoding="utf-8")

    def test_signed_roundtrip(self):
        os.environ[REGISTRY_KEY_ENV] = self.KEY
        reg = self._reg()
        reg.add("vps", "user@host", transport="ssh")
        data = json.loads(self._file().read_text(encoding="utf-8"))
        self.assertEqual(data.get("v"), 1)
        self.assertTrue(data.get("sig"))
        reg2 = self._reg()
        self.assertEqual(reg2.get("vps").host, "user@host")

    def test_tampered_signature_refuses_and_quarantines(self):
        os.environ[REGISTRY_KEY_ENV] = self.KEY
        reg = self._reg()
        reg.add("vps", "user@host", transport="ssh")
        data = json.loads(self._file().read_text(encoding="utf-8"))
        vps_row = next(r for r in data["machines"]
                       if r["name"] == "vps")
        vps_row["host"] = "-oProxyCommand=evil"  # tamper post-sign
        self._write(data)
        reg2 = self._reg()
        self.assertIsNone(reg2.get("vps"))           # fail closed
        self.assertEqual(reg2.integrity_error, "signature_mismatch")
        # poisoned → .poisoned; seed_local пересоздаёт ЧИСТЫЙ файл (local only)
        self.assertTrue((self.tmp / "machines.json.poisoned").exists())
        fresh = json.loads(self._file().read_text(encoding="utf-8"))
        self.assertEqual([m["name"] for m in fresh["machines"]], ["local"])
        self.assertIsNotNone(reg2.get("local"))       # local seed жив

    def test_wrong_key_refuses(self):
        os.environ[REGISTRY_KEY_ENV] = self.KEY
        reg = self._reg()
        reg.add("vps", "h", transport="ssh")
        os.environ[REGISTRY_KEY_ENV] = "other-key"
        reg2 = self._reg()
        self.assertIsNone(reg2.get("vps"))
        self.assertEqual(reg2.integrity_error, "signature_mismatch")

    def test_unsigned_legacy_migrates(self):
        os.environ[REGISTRY_KEY_ENV] = self.KEY
        self._write({"machines": [
            {"name": "vps", "host": "user@host", "transport": "ssh"}]})
        reg = self._reg()
        self.assertEqual(reg.get("vps").host, "user@host")
        reg.add("x", "h2", transport="ssh")   # save → signed
        data = json.loads(self._file().read_text(encoding="utf-8"))
        self.assertTrue(data.get("sig"))

    def test_require_sig_without_key_refuses(self):
        os.environ.pop(REGISTRY_KEY_ENV, None)
        os.environ[REQUIRE_SIG_ENV] = "1"
        self._write({"machines": [
            {"name": "vps", "host": "user@host", "transport": "ssh"}]})
        reg = self._reg()
        self.assertIsNone(reg.get("vps"))
        self.assertEqual(reg.integrity_error, "require_sig_without_key")

    def test_corrupt_file_preserved_and_empty(self):
        self._file().write_text("{not json", encoding="utf-8")
        reg = self._reg()
        self.assertEqual(reg.integrity_error, "unreadable")
        self.assertTrue((self.tmp / "machines.json.corrupt").exists())
        self.assertIsNone(reg.get("vps"))
        self.assertIsNotNone(reg.get("local"))

    def test_invalid_host_row_skipped_on_load(self):
        self._write({"machines": [
            {"name": "bad", "host": "-oProxyCommand=x",
             "transport": "ssh"},
            {"name": "ok", "host": "user@host", "transport": "ssh"}]})
        reg = self._reg()
        self.assertIsNone(reg.get("bad"))
        self.assertEqual(reg.get("ok").host, "user@host")


# =============================================================================
# machine_exec
# =============================================================================

class TestMachineExec(unittest.TestCase):
    def test_local_captures_stdout_and_exit(self):
        result = machine_exec("local", [sys.executable, "-c", "print(123)"])
        self.assertEqual(result["stdout"].strip(), "123")
        self.assertEqual(result["exit_code"], 0)
        self.assertFalse(result["timed_out"])
        self.assertIsInstance(result["duration_ms"], int)

    def test_local_captures_stderr(self):
        result = machine_exec("local", [
            sys.executable, "-c", "import sys; sys.stderr.write('boom'); sys.exit(0)"
        ])
        self.assertIn("boom", result["stderr"])

    def test_local_nonzero_exit_is_result(self):
        result = machine_exec("local", [
            sys.executable, "-c", "import sys; sys.exit(3)"
        ])
        self.assertEqual(result["exit_code"], 3)
        self.assertFalse(result["timed_out"])

    def test_local_timeout_is_result(self):
        result = machine_exec("local", [
            sys.executable, "-c", "import time; time.sleep(10)"
        ], timeout=0.1)
        self.assertTrue(result["timed_out"])
        self.assertIsNone(result["exit_code"])
        self.assertLess(result["duration_ms"], 10000)

    def test_remote_not_supported(self):
        with self.assertRaises(RemoteNotSupportedError):
            machine_exec("vps", ["echo", "hi"])

    def test_invalid_argv(self):
        with self.assertRaises(ValueError):
            machine_exec("local", [])
        with self.assertRaises(ValueError):
            machine_exec("local", ["echo", 42])

    def test_invalid_timeout(self):
        with self.assertRaises(ValueError):
            machine_exec("local", ["echo"], timeout=0)


# =============================================================================
# API
# =============================================================================

class CoreApiN3TestCase(AioHTTPTestCase):
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
        app["state"].machines.probe_fn = FAKE_PROBE_CONNECTED
        return app


class TestExecApi(CoreApiN3TestCase):
    @unittest_run_loop
    async def test_exec_happy(self):
        resp = await self.client.post("/api/core/exec", json={
            "argv": [sys.executable, "-c", "print(123)"],
        })
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["stdout"].strip(), "123")
        self.assertEqual(data["exit_code"], 0)

    @unittest_run_loop
    async def test_exec_remote_unknown_machine_404(self):
        # N4-контракт: non-local машина → SshOps → registry lookup →
        # "vps" не зарегистрирован → machine_not_found → 404.
        resp = await self.client.post("/api/core/exec", json={
            "machine": "vps",
            "argv": ["echo", "hi"],
        })
        self.assertEqual(resp.status, 404)
        data = await resp.json()
        self.assertEqual(data["error"], "machine_not_found")

    @unittest_run_loop
    async def test_exec_bad_argv_400(self):
        resp = await self.client.post("/api/core/exec", json={"argv": []})
        self.assertEqual(resp.status, 400)


class TestFileApi(CoreApiN3TestCase):
    @unittest_run_loop
    async def test_file_write_read_roundtrip(self):
        resp = await self.client.post("/api/core/file/write", json={
            "path": "dir/x.txt", "content": "hello\nworld\n",
        })
        self.assertEqual(resp.status, 200)
        resp = await self.client.get("/api/core/file/read?path=dir/x.txt")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["content"], "hello\nworld")

    @unittest_run_loop
    async def test_file_read_missing_404(self):
        resp = await self.client.get("/api/core/file/read?path=nope.txt")
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_file_read_escape_400(self):
        resp = await self.client.get("/api/core/file/read?path=../evil")
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_file_edit_exact_once(self):
        await self.client.post("/api/core/file/write", json={
            "path": "a.txt", "content": "one\ntwo\n",
        })
        resp = await self.client.post("/api/core/file/edit", json={
            "path": "a.txt", "pairs": [["two", "TWO"]],
        })
        self.assertEqual(resp.status, 200)
        resp = await self.client.get("/api/core/file/read?path=a.txt")
        data = await resp.json()
        self.assertEqual(data["content"], "one\nTWO")

    @unittest_run_loop
    async def test_file_edit_mismatch_400(self):
        await self.client.post("/api/core/file/write", json={
            "path": "a.txt", "content": "one\n",
        })
        resp = await self.client.post("/api/core/file/edit", json={
            "path": "a.txt", "pairs": [["zzz", "x"]],
        })
        self.assertEqual(resp.status, 400)


class TestMachinesApi(CoreApiN3TestCase):
    # HERETIC #438: machines-мутации требуют NEXUS_CORE_TOKEN всегда —
    # включая loopback dev-mode.
    MH = {"X-Nexus-Key": "n3-machines-token"}

    def setUp(self):
        super().setUp()
        self._old_tok = os.environ.get("NEXUS_CORE_TOKEN")
        os.environ["NEXUS_CORE_TOKEN"] = "n3-machines-token"

    def tearDown(self):
        if self._old_tok is None:
            os.environ.pop("NEXUS_CORE_TOKEN", None)
        else:
            os.environ["NEXUS_CORE_TOKEN"] = self._old_tok
        super().tearDown()

    @unittest_run_loop
    async def test_machines_list_includes_local(self):
        resp = await self.client.get("/api/core/machines")
        data = await resp.json()
        self.assertIn("local", data["machines"])

    @unittest_run_loop
    async def test_machine_put_get_delete(self):
        resp = await self.client.put("/api/core/machines/vps", json={
            "host": "user@host", "transport": "ssh",
        }, headers=self.MH)
        self.assertEqual(resp.status, 200)
        resp = await self.client.get("/api/core/machines/vps")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["name"], "vps")
        self.assertEqual(data["transport"], "ssh")
        resp = await self.client.delete("/api/core/machines/vps",
                                        headers=self.MH)
        self.assertEqual(resp.status, 200)
        resp = await self.client.get("/api/core/machines/vps")
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_machine_connect_probe(self):
        resp = await self.client.post("/api/core/machines/vps/connect", json={
            "host": "user@host", "transport": "ssh",
        }, headers=self.MH)
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        # фейковый probe → connected
        self.assertEqual(data["state"], "connected")

    @unittest_run_loop
    async def test_machine_rename_remaps(self):
        await self.client.post("/api/core/run", json={"name": "t1"},
                               headers=self.MH)
        resp = await self.client.get("/api/core/terminals")
        data = await resp.json()
        self.assertEqual(data["terminals"][0]["address"], "local/t1")
        resp = await self.client.post("/api/core/machines/local/rename", json={
            "name": "work",
        }, headers=self.MH)
        self.assertEqual(resp.status, 200)
        resp = await self.client.get("/api/core/terminals")
        data = await resp.json()
        self.assertEqual(data["terminals"][0]["address"], "work/t1")


class TestServerApi(CoreApiN3TestCase):
    @unittest_run_loop
    async def test_server_status(self):
        await self.client.post("/api/core/run", json={"name": "t1"})
        resp = await self.client.get("/api/core/server")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["version"], "N3")
        self.assertEqual(data["terminals"], 1)
        self.assertEqual(data["machines"], 1)  # local
        self.assertGreaterEqual(data["events"], 1)  # spawn


# =============================================================================
# CLI
# =============================================================================

class TestCliN3(unittest.TestCase):
    """#515: nx — thin client → real core API (CoreTestServer).

    FileOps/MachineRegistry/DocStore теперь живут на СЕРВЕРЕ (единый
    авторитет state) — тесты бьют cli_main по HTTP, а не в локальные
    _supervisor/_registry.
    """

    def setUp(self):
        self._env = os.environ.copy()
        os.environ["CORE_MOCK"] = "1"
        self.tmp = make_temp_dir()
        os.environ["NX_STATE_DIR"] = str(self.tmp)
        # vps нужна серверному реестру ДО старта (AppState грузит
        # machines.json при create_app); token — для machines-мутаций.
        MachineRegistry(self.tmp).add("vps", "user@host", transport="ssh")
        os.environ["NEXUS_CORE_TOKEN"] = "test-token"
        self._srv_ctx = core_test_server(self.tmp)
        self.server = self._srv_ctx.__enter__()
        os.environ["NEXUS_CORE_URL"] = self.server.url

    def tearDown(self):
        self._srv_ctx.__exit__(None, None, None)
        os.environ.clear()
        os.environ.update(self._env)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_exec_live_python_prints_123(self):
        rc = cli_main(["exec", sys.executable, "-c", "print(123)"])
        self.assertEqual(rc, 0)

    def test_exec_remote_error_not_exit2(self):
        # N4: remote-ветка — рабочий путь через SshOps (exit 1 на ошибке
        # транспорта); mock ssh → unreachable.
        import subprocess as _sp
        from unittest import mock

        def fake_run(argv, **kwargs):
            return _sp.CompletedProcess(
                args=[], returncode=255, stdout=b"",
                stderr=b"ssh: connect to host ...: Connection timed out",
            )

        with mock.patch("tools.nexus_core.ssh_ops.subprocess.run", side_effect=fake_run):
            rc = cli_main(["exec", "--on", "vps", "echo", "hi"])
        self.assertEqual(rc, 1)

    def test_file_write_read_edit(self):
        rc = cli_main(["file", "write", "a.txt", "--content", "one\ntwo\n"])
        self.assertEqual(rc, 0)
        rc = cli_main(["file", "read", "a.txt", "--json"])
        self.assertEqual(rc, 0)
        rc = cli_main(["file", "edit", "a.txt", "--old", "two", "--new", "TWO"])
        self.assertEqual(rc, 0)
        rc = cli_main(["file", "edit", "a.txt", "--old", "zzz", "--new", "X"])
        self.assertEqual(rc, 1)

    def test_file_sandbox_escape_fails(self):
        rc = cli_main(["file", "read", "../evil.txt"])
        self.assertEqual(rc, 1)

    def test_machine_add_rm_ls_get(self):
        rc = cli_main(["machine", "add", "vps2", "user@host2"])
        self.assertEqual(rc, 0)
        rc = cli_main(["machine", "get", "vps2"])
        self.assertEqual(rc, 0)
        rc = cli_main(["machine", "ls"])
        self.assertEqual(rc, 0)
        rc = cli_main(["machine", "rm", "vps2"])
        self.assertEqual(rc, 0)
        rc = cli_main(["machine", "get", "vps2"])
        self.assertEqual(rc, 3)  # 404 → EXIT_NOT_FOUND (hc parity)

    def test_machine_rename_remaps_terminals(self):
        cli_main(["run", "t1", "sh", "-i"])
        rc = cli_main(["machine", "rename", "local", "work"])
        self.assertEqual(rc, 0)
        sup = SupervisorV1(registry_path=self.tmp / "registry.json")
        self.assertIsNotNone(sup.get_terminal("work/t1"))

    def test_connect_probes(self):
        # probe_fn привязан к серверному реестру при create_app —
        # патчим атрибут живого объекта, а не module-level default_probe.
        with mock.patch.object(
                self.server.state.machines, "probe_fn",
                return_value=("connected", None)):
            rc = cli_main(["connect", "user@host9"])
        self.assertEqual(rc, 0)

    def test_server_status(self):
        rc = cli_main(["server", "status"])
        self.assertEqual(rc, 0)

    def test_server_restart_honest_exit2(self):
        rc = cli_main(["server", "restart"])
        self.assertEqual(rc, 2)

    def test_update_honest_exit2(self):
        rc = cli_main(["update", "--version", "1.2"])
        self.assertEqual(rc, 2)


if __name__ == "__main__":
    unittest.main()
