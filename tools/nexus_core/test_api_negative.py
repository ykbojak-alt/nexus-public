#!/usr/bin/env python3
"""
tools/nexus_core/test_api_negative.py — adversarial-прогон REST API (N1-N3.5).

Негативные кейсы под CORE_MOCK=1. Каждый кейс → ожидание: либо 4xx с
внятным error, либо безопасный дефолт. Если обнаруживается 500/стектрейс/
успех там, где должна быть ошибка — фиксируем как НАХОДКУ (в отчёте и здесь
через @expectedFailure).

Запуск: CORE_MOCK=1 pytest tools/nexus_core/test_api_negative.py
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("CORE_MOCK", "1")

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop  # noqa: E402

from tools.nexus_core.api import create_app  # noqa: E402
from tools.nexus_core.mock_pty import MockPTYBackend  # noqa: E402
from tools.nexus_core.supervisor_v1 import SupervisorV1  # noqa: E402


def make_temp_base() -> Path:
    return Path(tempfile.mkdtemp(prefix="nexus-api-negative-"))


class NegativeApiTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = make_temp_base()
        self.backend = MockPTYBackend()
        self.supervisor = SupervisorV1(backend=self.backend)
        super().setUp()

    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.tmp, supervisor=self.supervisor,
                          templates_dir=self.tmp / "templates")

    async def run_terminal(self, name="t1", **kwargs):
        resp = await self.client.post("/api/core/run", json={
            "name": name,
            "command": ["sh", "-i"],
            **kwargs,
        })
        self.assertEqual(resp.status, 200)
        return await resp.json()


# ---------------------------------------------------------------------------
# 1. malformed JSON / отсутствующие обязательные поля
# ---------------------------------------------------------------------------
class TestMalformedAndMissing(NegativeApiTestCase):
    @unittest_run_loop
    async def test_malformed_json_body_send(self):
        # не-JSON тело
        resp = await self.client.post(
            "/api/core/send", data="{not json", headers={"Content-Type": "application/json"}
        )
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_json_array_body_rejected(self):
        # JSON-массив вместо объекта
        resp = await self.client.post("/api/core/send", json=["a", "b"])
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_run_without_name(self):
        resp = await self.client.post("/api/core/run", json={"command": ["sh"]})
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_run_without_command_field(self):
        # run без command — допустим? (command=None разрешён в api)
        resp = await self.client.post("/api/core/run", json={"name": "t9"})
        self.assertIn(resp.status, (200, 400, 409))

    @unittest_run_loop
    async def test_send_without_text(self):
        resp = await self.client.post("/api/core/send", json={"term": "t1"})
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_send_without_term(self):
        resp = await self.client.post("/api/core/send", json={"text": "x"})
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_kill_without_term(self):
        resp = await self.client.post("/api/core/kill", json={})
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_keys_empty_list(self):
        resp = await self.client.post("/api/core/keys", json={"term": "t1", "keys": []})
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_label_missing_labels(self):
        resp = await self.client.post("/api/core/label", json={"term": "t1"})
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_label_non_object(self):
        resp = await self.client.post("/api/core/label", json={"term": "t1", "labels": "x"})
        self.assertEqual(resp.status, 400)


# ---------------------------------------------------------------------------
# 2. несуществующие терминалы/машины/пути
# ---------------------------------------------------------------------------
class TestNonexistent(NegativeApiTestCase):
    @unittest_run_loop
    async def test_send_unknown_term(self):
        resp = await self.client.post("/api/core/send", json={"term": "nope", "text": "x"})
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_kill_unknown_term(self):
        resp = await self.client.post("/api/core/kill", json={"term": "nope"})
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_interrupt_unknown_term(self):
        resp = await self.client.post("/api/core/interrupt", json={"term": "nope"})
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_label_unknown_term(self):
        resp = await self.client.post("/api/core/label", json={
            "term": "nope", "labels": {"a": "b"},
        })
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_keep_unknown_term(self):
        resp = await self.client.post("/api/core/keep", json={"term": "nope", "keep": True})
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_screen_unknown_term(self):
        resp = await self.client.get("/api/core/screen/nope")
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_machine_get_unknown(self):
        resp = await self.client.get("/api/core/machines/ghost")
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_machine_delete_unknown(self):
        # #438: machines-мутации требуют токен всегда — ставим и ключ,
        # чтобы дойти до handler'а (404 unknown machine).
        old = os.environ.get("NEXUS_CORE_TOKEN")
        os.environ["NEXUS_CORE_TOKEN"] = "neg-token"
        try:
            resp = await self.client.delete(
                "/api/core/machines/ghost",
                headers={"X-Nexus-Key": "neg-token"})
        finally:
            if old is None:
                os.environ.pop("NEXUS_CORE_TOKEN", None)
            else:
                os.environ["NEXUS_CORE_TOKEN"] = old
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_file_read_missing(self):
        resp = await self.client.get("/api/core/file/read?path=no_such_file.txt")
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_template_run_missing(self):
        resp = await self.client.post("/api/core/templates/nobody/run", json={"args": []})
        self.assertEqual(resp.status, 404)


# ---------------------------------------------------------------------------
# 3. file.read: отрицательные offset/limit + path-traversal
# ---------------------------------------------------------------------------
class TestFileReadNegative(NegativeApiTestCase):
    @unittest_run_loop
    async def test_read_negative_offset(self):
        # создадим файл, чтобы ошибка касалась именно offset
        await self.client.post("/api/core/file/write", json={
            "path": "a.txt", "content": "1\n2\n3\n",
        })
        resp = await self.client.get("/api/core/file/read?path=a.txt&offset=0")
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_read_negative_limit(self):
        await self.client.post("/api/core/file/write", json={
            "path": "a.txt", "content": "1\n2\n3\n",
        })
        resp = await self.client.get("/api/core/file/read?path=a.txt&limit=0")
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_read_non_integer_offset(self):
        resp = await self.client.get("/api/core/file/read?path=a.txt&offset=abc")
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_read_traversal_dotdot(self):
        resp = await self.client.get("/api/core/file/read?path=../../etc/passwd")
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_read_traversal_encoded(self):
        # %2e%2e = ..
        resp = await self.client.get("/api/core/file/read?path=%2e%2e%2f%2e%2e%2fetc%2fpasswd")
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_read_absolute_windows(self):
        resp = await self.client.get("/api/core/file/read?path=C%3A%5CWindows%5Cwin.ini")
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_read_absolute_unix(self):
        resp = await self.client.get("/api/core/file/read?path=%2Fetc%2Fpasswd")
        self.assertEqual(resp.status, 400)


# ---------------------------------------------------------------------------
# 4. file.write/edit вне sandbox
# ---------------------------------------------------------------------------
class TestFileWriteEditSandbox(NegativeApiTestCase):
    @unittest_run_loop
    async def test_write_traversal(self):
        resp = await self.client.post("/api/core/file/write", json={
            "path": "../outside.txt", "content": "x",
        })
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_write_absolute(self):
        resp = await self.client.post("/api/core/file/write", json={
            "path": "/tmp/evil.txt", "content": "x",
        })
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_write_non_string_content(self):
        resp = await self.client.post("/api/core/file/write", json={
            "path": "a.txt", "content": 42,
        })
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_write_missing_content(self):
        resp = await self.client.post("/api/core/file/write", json={"path": "a.txt"})
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_edit_traversal(self):
        resp = await self.client.post("/api/core/file/edit", json={
            "path": "../x.txt", "pairs": [["a", "b"]],
        })
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_edit_bad_pairs(self):
        resp = await self.client.post("/api/core/file/edit", json={
            "path": "a.txt", "pairs": [["only_old"]],
        })
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_edit_empty_pairs(self):
        resp = await self.client.post("/api/core/file/edit", json={
            "path": "a.txt", "pairs": [],
        })
        self.assertEqual(resp.status, 400)


# ---------------------------------------------------------------------------
# 5. exec: пустая команда, timeout<=0, несписок argv
# ---------------------------------------------------------------------------
class TestExecNegative(NegativeApiTestCase):
    @unittest_run_loop
    async def test_exec_empty_argv(self):
        resp = await self.client.post("/api/core/exec", json={"argv": [], "machine": "local"})
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_exec_missing_argv(self):
        resp = await self.client.post("/api/core/exec", json={"machine": "local"})
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_exec_non_string_argv(self):
        resp = await self.client.post("/api/core/exec", json={
            "argv": [1, 2], "machine": "local",
        })
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_exec_timeout_zero(self):
        resp = await self.client.post("/api/core/exec", json={
            "argv": ["sh", "-c", "true"], "machine": "local", "timeout": 0,
        })
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_exec_timeout_negative(self):
        resp = await self.client.post("/api/core/exec", json={
            "argv": ["sh", "-c", "true"], "machine": "local", "timeout": -1,
        })
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_exec_remote_not_found(self):
        # N4: non-local машина идёт в SshOps → registry lookup →
        # machine_not_found → 404 {"error": "machine_not_found"}.
        resp = await self.client.post("/api/core/exec", json={
            "argv": ["true"], "machine": "some-remote",
        })
        self.assertEqual(resp.status, 404)
        data = await resp.json()
        self.assertEqual(data["error"], "machine_not_found")


# ---------------------------------------------------------------------------
# 6. kill/interrupt на мёртвом (exited) терминале
# ---------------------------------------------------------------------------
class TestDeadTerminal(NegativeApiTestCase):
    @unittest_run_loop
    async def test_interrupt_dead_terminal(self):
        await self.run_terminal("dead")
        term = self.supervisor.get_terminal("local/dead")
        term.handle.close()  # терминал exited
        resp = await self.client.post("/api/core/interrupt", json={"term": "dead"})
        # ожидание: безопасный дефолт (4xx) — исключаем 500
        self.assertLess(resp.status, 500)

    @unittest_run_loop
    async def test_kill_dead_terminal(self):
        await self.run_terminal("dead2")
        term = self.supervisor.get_terminal("local/dead2")
        term.handle.close()
        resp = await self.client.post("/api/core/kill", json={"term": "dead2"})
        # ожидание: безопасный дефолт либо 4xx — исключаем 500
        self.assertLess(resp.status, 500)


# ---------------------------------------------------------------------------
# 7. screen по имени со слэшами/юникодом
# ---------------------------------------------------------------------------
class TestScreenWeirdNames(NegativeApiTestCase):
    @unittest_run_loop
    async def test_screen_slash_name(self):
        resp = await self.client.get("/api/core/screen/a/b")
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_screen_unicode_name(self):
        resp = await self.client.get("/api/core/screen/t%F0%9F%98%80")
        self.assertEqual(resp.status, 404)


# ---------------------------------------------------------------------------
# 8. run: пустой argv / служебные символы
# ---------------------------------------------------------------------------
class TestRunWeirdCommand(NegativeApiTestCase):
    @unittest_run_loop
    async def test_run_empty_command(self):
        resp = await self.client.post("/api/core/run", json={"name": "empty", "command": []})
        # ожидание: 409/400 (не 500)
        self.assertLess(resp.status, 500)

    @unittest_run_loop
    async def test_run_command_non_list(self):
        resp = await self.client.post("/api/core/run", json={"name": "nl", "command": "sh"})
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_run_control_chars(self):
        # argv со служебными символами не должен давать 500
        resp = await self.client.post("/api/core/run", json={
            "name": "ctl", "command": ["sh", "-c", "echo hi; exit 0"],
        })
        self.assertLess(resp.status, 500)


# ---------------------------------------------------------------------------
# 9. метод-путаница GET-vs-POST
# ---------------------------------------------------------------------------
class TestMethodMismatch(NegativeApiTestCase):
    @unittest_run_loop
    async def test_get_on_post_run(self):
        resp = await self.client.get("/api/core/run")
        self.assertEqual(resp.status, 405)

    @unittest_run_loop
    async def test_post_on_get_terminals(self):
        resp = await self.client.post("/api/core/terminals")
        self.assertEqual(resp.status, 405)

    @unittest_run_loop
    async def test_delete_on_get_screen(self):
        resp = await self.client.delete("/api/core/screen/t1")
        self.assertEqual(resp.status, 405)

    @unittest_run_loop
    async def test_post_on_get_machines(self):
        resp = await self.client.post("/api/core/machines")
        self.assertEqual(resp.status, 405)


# ---------------------------------------------------------------------------
# 10. N4: file.* с remote-машиной, exec argv-типы, run parent, label,
#      screen cross-machine, kill remote, daemon-роуты
# ---------------------------------------------------------------------------
class TestN4Negative(NegativeApiTestCase):
    @unittest_run_loop
    async def test_file_read_remote_unknown_machine(self):
        resp = await self.client.get(
            "/api/core/file/read?path=f.txt&machine=ghost-remote"
        )
        self.assertEqual(resp.status, 404)
        data = await resp.json()
        self.assertIn("error", data)

    @unittest_run_loop
    async def test_file_write_remote_unknown_machine(self):
        # N4: machine != local → SshOps → "ghost-remote" нет в реестре →
        # machine_not_found → 404 (silent-ignore machine устранён).
        resp = await self.client.post("/api/core/file/write", json={
            "path": "f.txt", "content": "x", "machine": "ghost-remote",
        })
        self.assertEqual(resp.status, 404)
        data = await resp.json()
        self.assertEqual(data["error"], "machine_not_found")

    @unittest_run_loop
    async def test_file_edit_remote_unknown_machine(self):
        resp = await self.client.post("/api/core/file/edit", json={
            "path": "f.txt", "pairs": [["a", "b"]], "machine": "ghost-remote",
        })
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_file_read_machine_case_sensitive(self):
        # "LOCAL" (верхний регистр) != "local" → не попадает в sandbox
        resp = await self.client.get("/api/core/file/read?path=f.txt&machine=LOCAL")
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_exec_argv_mixed_types(self):
        resp = await self.client.post("/api/core/exec", json={
            "argv": ["echo", 123], "machine": "local",
        })
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_exec_argv_all_numbers(self):
        resp = await self.client.post("/api/core/exec", json={
            "argv": [123, 456], "machine": "local",
        })
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_exec_argv_remote_mixed(self):
        resp = await self.client.post("/api/core/exec", json={
            "argv": ["echo", 1], "machine": "ghost-remote",
        })
        # валидация argv идет до _resolve → 400 (не 404/500)
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_run_parent_nonexistent(self):
        resp = await self.client.post("/api/core/run", json={
            "name": "child", "command": ["sh"], "parent": "local/ghost",
        })
        self.assertLess(resp.status, 500)

    @unittest_run_loop
    async def test_run_parent_self(self):
        resp = await self.client.post("/api/core/run", json={
            "name": "selfp", "command": ["sh"], "parent": "local/selfp",
        })
        self.assertLess(resp.status, 500)

    @unittest_run_loop
    async def test_label_non_string_values(self):
        await self.run_terminal("t1")
        resp = await self.client.post("/api/core/label", json={
            "term": "t1", "labels": {"k": 123},
        })
        # не-строковые значения → либо 400, либо 200 с нормализацией — не 500
        self.assertLess(resp.status, 500)

    @unittest_run_loop
    async def test_screen_cross_machine(self):
        # адрес "other/t1" — другой машины, которой нет → 404/не-500
        resp = await self.client.get("/api/core/screen/other/t1")
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_kill_remote_unknown(self):
        # remote-терминал / машина неизвестна → честная ошибка, не 500
        resp = await self.client.post("/api/core/kill", json={"term": "ghost/t1"})
        self.assertLess(resp.status, 500)

    @unittest_run_loop
    async def test_daemon_status_http_404(self):
        # HTTP-роут daemon status не зарегистрирован → 404
        resp = await self.client.get("/api/core/daemon/status")
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_daemon_stop_http_404(self):
        resp = await self.client.post("/api/core/daemon/stop")
        self.assertEqual(resp.status, 404)


class TestDaemonCLINegative(unittest.TestCase):
    """CLI-функции daemon при неподнятом демоне (без daemon.json) — безопасно."""

    def test_status_not_running(self):
        from tools.nexus_core.daemon import status_daemon
        base = Path(tempfile.mkdtemp(prefix="daemon-neg-"))
        try:
            self.assertEqual(status_daemon(base), 1)
        finally:
            shutil.rmtree(base, ignore_errors=True)

    def test_stop_not_running(self):
        from tools.nexus_core.daemon import stop_daemon
        base = Path(tempfile.mkdtemp(prefix="daemon-neg-"))
        try:
            self.assertEqual(stop_daemon(base), 1)
        finally:
            shutil.rmtree(base, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
