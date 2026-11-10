#!/usr/bin/env python3
"""Registry-trust (P-1 #398): poisoned registry.json не должен давать
arbitrary command/env/cwd при restore/respawn.

Покрытие:
- env: опасные ключи (LD_PRELOAD/PATH/COMSPEC/BASH_ENV/…) срезаются,
  легальные сохраняются; не-dict → None
- cwd: несуществующий/не-каталог → None + warn; валидный → сохраняется
- command: basename вне respawn-allowlist → терминал НЕ респавнится
  (exited) + registry_untrusted warn-аудит; allowlist/env-переопределение
- HMAC: NEXUS_REGISTRY_KEY — валидная подпись restore, битая → отказ
  целиком, legacy unsigned → принятие + миграция в signed-формат
- _respawn (runtime): те же санитайзеры применяются к spec.env/cwd
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import (
    REGISTRY_KEY_ENV,
    REQUIRE_SIG_ENV,
    RESPAWN_ALLOWLIST_ENV,
    SAFE_ROOTS_ENV,
    SupervisorV1,
    _command_allowed,
    _respawn_allowlist,
    _sanitize_cwd,
    _sanitize_env,
    _registry_sig,
    _safe_exec_roots,
)


def _row(name="t1", **kw):
    row = {
        "name": name, "machine": "local", "state": "lost", "keep": True,
        "command": ["sh", "-i"], "cwd": None, "env": None,
        "labels": {}, "attention": False, "respawn_count": 0,
        "cols": 120, "rows": 30,
    }
    row.update(kw)
    return row


def _write_registry(path: Path, rows):
    path.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")


def _sup_with_registry(rows, **kw):
    tmp = tempfile.mkdtemp(prefix="nexus-regtrust-")
    reg = Path(tmp) / "registry.json"
    _write_registry(reg, rows)
    backend = kw.pop("backend", MockPTYBackend())
    return SupervisorV1(backend=backend, registry_path=reg, **kw), backend


class TestSanitizers(unittest.TestCase):
    def test_env_strips_dangerous(self):
        env = {"LD_PRELOAD": "/evil.so", "PATH": "C:\\evil",
               "PYTHONPATH": "/x", "BASH_ENV": "/e.sh",
               "COMSPEC": "evil.exe", "MY_FLAG": "1",
               "ld_custom": "x", "DYLD_INSERT_LIBRARIES": "/y.dylib",
               "NEXUS_FOO": "ok"}
        clean, stripped = _sanitize_env(env)
        self.assertEqual(stripped, 7)
        self.assertEqual(clean, {"MY_FLAG": "1", "NEXUS_FOO": "ok"})

    def test_env_case_insensitive(self):
        clean, stripped = _sanitize_env({"path": "/x", "Path": "/y"})
        self.assertIsNone(clean)   # всё срезано → None
        self.assertEqual(stripped, 2)

    def test_env_non_dict_and_bad_keys(self):
        self.assertEqual(_sanitize_env("nope"), (None, 0))
        self.assertEqual(_sanitize_env(None), (None, 0))
        clean, stripped = _sanitize_env({"A=B": "1", 5: "x", "": "y",
                                         "GOOD": "v"})
        self.assertEqual(clean, {"GOOD": "v"})
        self.assertEqual(stripped, 3)

    def test_env_values_coerced(self):
        clean, _ = _sanitize_env({"NUM": 42, "NIL": None})
        self.assertEqual(clean, {"NUM": "42"})

    def test_env_strips_shell_rc_and_locators(self):
        # HERETIC #404: ZDOTDIR/HOME/XDG_*/SSH_AUTH_SOCK — обходы blacklist'а
        env = {"ZDOTDIR": "/evil/zsh", "HOME": "/evil/home",
               "XDG_CONFIG_HOME": "/evil/xdg",
               "XDG_DATA_DIRS": "/evil/data",
               "SSH_AUTH_SOCK": "/evil/agent.sock",
               "KEEP": "1"}
        clean, stripped = _sanitize_env(env)
        self.assertEqual(clean, {"KEEP": "1"})
        self.assertEqual(stripped, 5)

    def test_cwd_sanitize(self):
        self.assertIsNone(_sanitize_cwd(None))
        self.assertIsNone(_sanitize_cwd(123))
        self.assertIsNone(_sanitize_cwd("/nonexistent/definitely/not/here"))
        self.assertIsNone(_sanitize_cwd(__file__))  # файл, не каталог
        self.assertEqual(_sanitize_cwd(tempfile.gettempdir()),
                         tempfile.gettempdir())

    def test_command_allowed(self):
        al = _respawn_allowlist()
        self.assertTrue(_command_allowed(["python", "x.py"], al))
        self.assertTrue(_command_allowed([sys.executable], al))
        self.assertTrue(_command_allowed([], al))
        self.assertFalse(_command_allowed(["evil.exe"], al))
        self.assertFalse(_command_allowed(["/tmp/evil.sh"], al))
        self.assertTrue(_command_allowed(["anything"], None))  # '*'

    def test_command_path_evasion_denied(self):
        # HERETIC #404 MED: '/evil/bash' проходил по basename 'bash'
        al = _respawn_allowlist()
        roots = _safe_exec_roots()
        self.assertFalse(_command_allowed(["/evil/bash"], al, roots))
        self.assertFalse(_command_allowed(["/tmp/evil/python"], al, roots))
        evil = os.path.join(tempfile.gettempdir(), "evilbin", "bash")
        self.assertFalse(_command_allowed([evil], al, roots))
        # bare-имя 'bash' — ок (PATH-lookup, не registry-путь)
        self.assertTrue(_command_allowed(["bash", "-lc", "x"], al, roots))

    def test_command_path_under_safe_root_allowed(self):
        al = _respawn_allowlist()
        roots = _safe_exec_roots()
        # sys.executable — реальный путь под своим же root
        self.assertTrue(_command_allowed([sys.executable], al, roots))

    def test_command_absolute_allowlist_entry(self):
        # absolute-запись в NEXUS_RESPAWN_ALLOWLIST — точное совпадение
        tmp = tempfile.mkdtemp(prefix="nexus-regal-")
        tool = os.path.join(tmp, "mytool")
        old_al = os.environ.get(RESPAWN_ALLOWLIST_ENV)
        old_sr = os.environ.get(SAFE_ROOTS_ENV)
        try:
            os.environ[RESPAWN_ALLOWLIST_ENV] = tool
            os.environ.pop(SAFE_ROOTS_ENV, None)
            al = _respawn_allowlist()
            self.assertTrue(_command_allowed([tool], al))
            # другой путь с тем же basename — всё ещё denied
            other = os.path.join(tmp, "otherdir", "mytool")
            self.assertFalse(_command_allowed([other], al))
        finally:
            for var, old in ((RESPAWN_ALLOWLIST_ENV, old_al),
                             (SAFE_ROOTS_ENV, old_sr)):
                if old is None:
                    os.environ.pop(var, None)
                else:
                    os.environ[var] = old

    def test_allowlist_env_override(self):
        old = os.environ.get(RESPAWN_ALLOWLIST_ENV)
        try:
            os.environ[RESPAWN_ALLOWLIST_ENV] = "myagent,runme"
            al = _respawn_allowlist()
            self.assertIn("myagent", al)
            self.assertNotIn("python", al)
            os.environ[RESPAWN_ALLOWLIST_ENV] = "*"
            self.assertIsNone(_respawn_allowlist())
        finally:
            if old is None:
                os.environ.pop(RESPAWN_ALLOWLIST_ENV, None)
            else:
                os.environ[RESPAWN_ALLOWLIST_ENV] = old


class TestRegistryRestore(unittest.TestCase):
    def test_poisoned_env_stripped_on_restore(self):
        sup, backend = _sup_with_registry([_row(env={
            "LD_PRELOAD": "/evil.so", "PATH": "C:\\evil",
            "AGENT_TOKEN": "keep-me"})])
        term = sup.get_terminal("local/t1")
        self.assertIsNotNone(term)
        # #515: NX_TERMINAL_ID — инжекция ядра (hc parity), не sanitize
        self.assertEqual(term.env, {"AGENT_TOKEN": "keep-me",
                                    "NX_TERMINAL_ID": "local/t1"})
        # spawn-spec тоже чистый (shell-restore с sanitized env)
        handle = term.handle
        self.assertIsNotNone(handle)
        self.assertEqual(handle.spec.env, {"AGENT_TOKEN": "keep-me",
                                           "NX_TERMINAL_ID": "local/t1"})
        warns = [e for e in sup.events if e["type"] == "registry_untrusted"]
        self.assertTrue(any("env stripped" in str(w.get("warnings"))
                            for w in warns))

    def test_poisoned_cwd_rejected(self):
        sup, _ = _sup_with_registry([_row(cwd="Z:\\no\\such\\dir\\ever")])
        term = sup.get_terminal("local/t1")
        self.assertIsNone(term.cwd)
        self.assertIsNotNone(term.handle)  # respawn всё равно (shell)
        warns = [e for e in sup.events if e["type"] == "registry_untrusted"]
        self.assertTrue(any("cwd rejected" in str(w.get("warnings"))
                            for w in warns))

    def test_legit_cwd_env_preserved(self):
        sup, _ = _sup_with_registry([_row(
            cwd=tempfile.gettempdir(), env={"MY_FLAG": "1"})])
        term = sup.get_terminal("local/t1")
        self.assertEqual(term.cwd, tempfile.gettempdir())
        # #515: adopted-терминал получает NX_TERMINAL_ID (hc $HC_TERMINAL_ID
        # parity) поверх сохранённого env — это инжекция ядра, не sanitize.
        self.assertEqual(term.env, {"MY_FLAG": "1",
                                    "NX_TERMINAL_ID": "local/t1"})
        self.assertFalse([e for e in sup.events
                          if e["type"] == "registry_untrusted"
                          and e.get("address") == "local/t1"
                          and "warnings" in e])

    def test_non_allowlist_command_no_respawn(self):
        sup, backend = _sup_with_registry([_row(
            command=["evil_payload.exe", "--pwn"])])
        term = sup.get_terminal("local/t1")
        self.assertIsNotNone(term)          # виден в реестре
        self.assertEqual(term.state, "exited")
        self.assertIsNone(term.handle)      # НЕТ spawn
        self.assertEqual(len(backend.terminals), 0)
        warns = [e for e in sup.events if e["type"] == "registry_untrusted"]
        self.assertTrue(any(e.get("command0") == "evil_payload.exe"
                            for e in warns))

    def test_allowlist_command_respawns(self):
        sup, backend = _sup_with_registry([_row(command=["python", "x.py"])])
        term = sup.get_terminal("local/t1")
        self.assertEqual(term.state, "idle")
        self.assertIsNotNone(term.handle)
        self.assertEqual(len(backend.terminals), 1)
        # респавнится shell (RFC §10), не registry-команда
        self.assertNotEqual(term.command, ["python", "x.py"])

    def test_empty_command_respawns(self):
        sup, _ = _sup_with_registry([_row(command=[])])
        self.assertEqual(sup.get_terminal("local/t1").state, "idle")

    def test_exited_row_never_spawns_regardless(self):
        sup, backend = _sup_with_registry([_row(
            state="exited", command=["evil.exe"])])
        self.assertEqual(len(backend.terminals), 0)


class TestRegistryHmac(unittest.TestCase):
    def setUp(self):
        self.old_key = os.environ.get(REGISTRY_KEY_ENV)
        os.environ[REGISTRY_KEY_ENV] = "test-registry-secret"

    def tearDown(self):
        if self.old_key is None:
            os.environ.pop(REGISTRY_KEY_ENV, None)
        else:
            os.environ[REGISTRY_KEY_ENV] = self.old_key

    def _signed_file(self, tmp, rows):
        path = Path(tmp) / "registry.json"
        path.write_text(json.dumps(
            {"v": 1, "rows": rows,
             "sig": _registry_sig(rows, "test-registry-secret")},
            ensure_ascii=False), encoding="utf-8")
        return path

    def test_valid_signature_restores(self):
        tmp = tempfile.mkdtemp(prefix="nexus-regsig-")
        reg = self._signed_file(tmp, [_row()])
        sup = SupervisorV1(backend=MockPTYBackend(), registry_path=reg)
        self.assertEqual(sup.get_terminal("local/t1").state, "idle")
        # save переписывает signed-формат
        saved = json.loads(reg.read_text(encoding="utf-8"))
        self.assertIsInstance(saved, dict)
        self.assertIn("sig", saved)

    def test_tampered_signature_refuses_all(self):
        tmp = tempfile.mkdtemp(prefix="nexus-regsig-")
        reg = self._signed_file(tmp, [_row()])
        data = json.loads(reg.read_text(encoding="utf-8"))
        data["rows"][0]["env"] = {"LD_PRELOAD": "/evil.so"}  # tamper post-sign
        reg.write_text(json.dumps(data), encoding="utf-8")
        sup = SupervisorV1(backend=MockPTYBackend(), registry_path=reg)
        self.assertIsNone(sup.get_terminal("local/t1"))
        warns = [e for e in sup.events if e["type"] == "registry_untrusted"]
        self.assertTrue(any("signature mismatch" in e.get("reason", "")
                            for e in warns))

    def test_wrong_key_refuses(self):
        tmp = tempfile.mkdtemp(prefix="nexus-regsig-")
        reg = self._signed_file(tmp, [_row()])
        os.environ[REGISTRY_KEY_ENV] = "different-key"
        sup = SupervisorV1(backend=MockPTYBackend(), registry_path=reg)
        self.assertIsNone(sup.get_terminal("local/t1"))

    def test_legacy_unsigned_migrates(self):
        tmp = tempfile.mkdtemp(prefix="nexus-regsig-")
        reg = Path(tmp) / "registry.json"
        _write_registry(reg, [_row()])          # legacy list, no sig
        sup = SupervisorV1(backend=MockPTYBackend(), registry_path=reg)
        self.assertEqual(sup.get_terminal("local/t1").state, "idle")
        saved = json.loads(reg.read_text(encoding="utf-8"))
        self.assertIsInstance(saved, dict)
        self.assertTrue(saved.get("sig"))

    def test_signed_file_without_key_sanitized_accept(self):
        tmp = tempfile.mkdtemp(prefix="nexus-regsig-")
        reg = self._signed_file(tmp, [_row()])
        old = os.environ.pop(REGISTRY_KEY_ENV)
        try:
            sup = SupervisorV1(backend=MockPTYBackend(), registry_path=reg)
            # integrity off → restore sanitized, warn зафиксирован
            self.assertEqual(sup.get_terminal("local/t1").state, "idle")
            warns = [e for e in sup.events
                     if e["type"] == "registry_untrusted"]
            self.assertTrue(any("NEXUS_REGISTRY_KEY unset" in e.get("reason", "")
                                for e in warns))
        finally:
            os.environ[REGISTRY_KEY_ENV] = old

    def test_require_sig_without_key_refuses_all(self):
        # HERETIC #404: opt-in fail-closed — REQUIRE_SIG=1 + нет ключа
        tmp = tempfile.mkdtemp(prefix="nexus-regsig-")
        reg = self._signed_file(tmp, [_row()])
        old_key = os.environ.pop(REGISTRY_KEY_ENV)
        old_req = os.environ.get(REQUIRE_SIG_ENV)
        os.environ[REQUIRE_SIG_ENV] = "1"
        try:
            sup = SupervisorV1(backend=MockPTYBackend(), registry_path=reg)
            self.assertIsNone(sup.get_terminal("local/t1"))
            warns = [e for e in sup.events
                     if e["type"] == "registry_untrusted"]
            self.assertTrue(any("REQUIRE_SIG" in e.get("reason", "")
                                or "integrity required" in e.get("reason", "")
                                for e in warns))
        finally:
            os.environ[REGISTRY_KEY_ENV] = old_key
            if old_req is None:
                os.environ.pop(REQUIRE_SIG_ENV, None)
            else:
                os.environ[REQUIRE_SIG_ENV] = old_req

    def test_require_sig_unsigned_also_refused(self):
        tmp = tempfile.mkdtemp(prefix="nexus-regsig-")
        reg = Path(tmp) / "registry.json"
        _write_registry(reg, [_row()])   # legacy unsigned
        old_key = os.environ.pop(REGISTRY_KEY_ENV)
        old_req = os.environ.get(REQUIRE_SIG_ENV)
        os.environ[REQUIRE_SIG_ENV] = "true"
        try:
            sup = SupervisorV1(backend=MockPTYBackend(), registry_path=reg)
            self.assertIsNone(sup.get_terminal("local/t1"))
        finally:
            os.environ[REGISTRY_KEY_ENV] = old_key
            if old_req is None:
                os.environ.pop(REQUIRE_SIG_ENV, None)
            else:
                os.environ[REQUIRE_SIG_ENV] = old_req

    def test_sig_mismatch_quarantines_file(self):
        # HERETIC #404: poisoned registry → .poisoned, не ретрай каждый рестарт
        tmp = tempfile.mkdtemp(prefix="nexus-regsig-")
        reg = self._signed_file(tmp, [_row()])
        data = json.loads(reg.read_text(encoding="utf-8"))
        data["rows"][0]["env"] = {"LD_PRELOAD": "/evil.so"}
        reg.write_text(json.dumps(data), encoding="utf-8")
        sup = SupervisorV1(backend=MockPTYBackend(), registry_path=reg)
        self.assertIsNone(sup.get_terminal("local/t1"))
        self.assertFalse(reg.exists())
        self.assertTrue((Path(tmp) / "registry.json.poisoned").exists())
        q = [e for e in sup.events if e["type"] == "registry_quarantined"]
        self.assertTrue(q)


class TestRespawnSanitize(unittest.TestCase):
    def test_runtime_respawn_strips_dangerous_env(self):
        # #424: sanitize на ПЕРВОМ спавне — env чист уже при create;
        # respawn получает чистый env (defense-in-depth сохраняется).
        sup = SupervisorV1(backend=MockPTYBackend())
        term = sup.create_terminal(
            "t1", env={"LD_PRELOAD": "/evil.so", "KEEP": "1"})
        self.assertEqual(term.env, {"KEEP": "1",
                                    "NX_TERMINAL_ID": "local/t1"})
        spawn_warns = [e for e in sup.events
                       if e["type"] == "spawn_sanitized"]
        self.assertTrue(spawn_warns)
        term.handle.kill()
        sup.step_once()
        sup.step_once()   # missed_tick_threshold=2 → respawn
        self.assertEqual(term.env, {"KEEP": "1",
                                    "NX_TERMINAL_ID": "local/t1"})


class TestCreateSanitize(unittest.TestCase):
    """HERETIC #424: первый спавн — env/cwd из API-клиента фильтруются
    так же, как registry при respawn/load."""

    def test_create_strips_dangerous_env(self):
        sup = SupervisorV1(backend=MockPTYBackend())
        term = sup.create_terminal(
            "t1", env={"LD_PRELOAD": "/evil.so", "PYTHONPATH": "/x",
                       "KEEP": "1", "BAD=KEY": "v", "NIL": None})
        self.assertEqual(term.env, {"KEEP": "1",
                                    "NX_TERMINAL_ID": "local/t1"})
        warns = [e for e in sup.events if e["type"] == "spawn_sanitized"]
        self.assertEqual(len(warns), 1)
        self.assertEqual(warns[0]["env_stripped"], 4)

    def test_create_clean_env_no_event(self):
        sup = SupervisorV1(backend=MockPTYBackend())
        sup.create_terminal("t1", env={"KEEP": "1"})
        self.assertFalse([e for e in sup.events
                          if e["type"] == "spawn_sanitized"])

    def test_create_bad_cwd_falls_back(self):
        sup = SupervisorV1(backend=MockPTYBackend())
        term = sup.create_terminal("t1", cwd="/no/such/dir/xyz")
        self.assertIsNone(term.cwd)
        warns = [e for e in sup.events if e["type"] == "spawn_sanitized"]
        self.assertTrue(warns and warns[0]["cwd_fixed"])

    def test_create_valid_cwd_kept(self):
        sup = SupervisorV1(backend=MockPTYBackend())
        term = sup.create_terminal("t1", cwd=tempfile.gettempdir())
        self.assertEqual(term.cwd, tempfile.gettempdir())


if __name__ == "__main__":
    unittest.main()
