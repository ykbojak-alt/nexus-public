#!/usr/bin/env python3
"""
tools/nexus_core/test_n8_newf_readonly.py — контракты read-only роутов NEWF-моста (#478).

Режим: CORE_MOCK=1. Покрывают ровно три GET-пути и ничего не mutating:
  GET /api/core/file/list (+ алиас GET /api/core/files) — песочница FileOps;
  GET /api/core/changes  — git status --porcelain (fail-closed, --no-optional-locks);
  GET /api/core/machines — форма ответа НЕ меняется (read-only), мутации не тронуты.

Контракты взяты из reports/QODER-newf-backend-475.md §2.1/§2.3/§2.5/§2.6
(§2.5: маршрут-отсутствует ⇒ plain-text 404; ресурса-нет ⇒ JSON error;
пусто ⇒ 200 count 0; право-не-выдано ⇒ 401/503).

Запуск: PYTHONPATH=. python -m pytest tools/nexus_core/test_n8_newf_readonly.py
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("CORE_MOCK", "1")

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop  # noqa: E402

from tools.nexus_core.api import create_app  # noqa: E402
from tools.nexus_core.machine_registry import HOST_RE, TRANSPORTS, VALID_NAME_RE  # noqa: E402
from tools.nexus_core.mock_pty import MockPTYBackend  # noqa: E402
from tools.nexus_core.supervisor_v1 import SupervisorV1  # noqa: E402


def make_temp_base() -> Path:
    return Path(tempfile.mkdtemp(prefix="nexus-core-n8-test-"))


def git(cwd: Path, *args: str) -> str:
    out = subprocess.run(
        ["git", *args], cwd=str(cwd), capture_output=True, text=True,
    )
    assert out.returncode == 0, f"git {' '.join(args)} failed: {out.stderr}"
    return out.stdout


def make_repo(cwd: Path) -> None:
    """Инициализирует репозиторий с одним коммитом (только для тестов)."""
    cwd.mkdir(parents=True, exist_ok=True)
    git(cwd, "init", "-q", "-b", "main")
    git(cwd, "config", "user.email", "n8-test@local")
    git(cwd, "config", "user.name", "n8-test")
    git(cwd, "config", "core.autocrlf", "false")
    (cwd / "tracked.txt").write_text("one\n", encoding="utf-8", newline="\n")
    git(cwd, "add", "-A")
    git(cwd, "commit", "-q", "-m", "fixture")


class _FakeSubprocess:
    """Подмена ONLY для git_ops.subprocess: реальный модуль subprocess не патчится."""

    def __init__(self, run) -> None:
        self._run = run
        self._real = subprocess

    def run(self, *args, **kwargs):
        return self._run(*args, **kwargs)

    def __getattr__(self, name):
        return getattr(self._real, name)


class NewfReadOnlyTestCase(AioHTTPTestCase):
    """Общий каркас: base — это песочница FileOps и возможный git-repo."""

    def make_base(self, root: Path) -> Path:
        """Песочница по умолчанию = сам корень mkdtemp."""
        return root

    def setUp(self):
        self.cleanup_root = make_temp_base()
        self.tmp = self.make_base(self.cleanup_root)
        self.backend = MockPTYBackend()
        self.supervisor = SupervisorV1(backend=self.backend)
        super().setUp()

    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.cleanup_root, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.tmp, supervisor=self.supervisor,
                          templates_dir=self.tmp / "templates")

    # -- helpers --------------------------------------------------------

    def write(self, rel: str, text: str = "x\n") -> Path:
        p = self.tmp / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8", newline="\n")
        return p

    async def get_json(self, url: str):
        resp = await self.client.get(url)
        body = await resp.text()
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            data = None
        return resp.status, data, body

    @staticmethod
    def _fake_status(real, cmd, seen, args, kwargs):
        """Шпионит argv и передаёт команду настоящему git."""
        seen.append(list(cmd))
        return real.run(cmd, *args, **kwargs)


class TestFileListContract(NewfReadOnlyTestCase):

    @unittest_run_loop
    async def test_list_root_shape(self):
        """§2.1: entries[{path,kind,bytes}], count, truncated; dir bytes=null."""
        self.write("alpha.txt", "12345\n")
        (self.tmp / "sub").mkdir()

        status, data, _ = await self.get_json("/api/core/file/list?path=.")
        self.assertEqual(status, 200)
        self.assertEqual(set(data), {"path", "entries", "count", "truncated"})
        self.assertEqual(data["truncated"], False)
        by_name = {Path(e["path"]).name: e for e in data["entries"]}
        self.assertIn("alpha.txt", by_name)
        self.assertIn("sub", by_name)
        self.assertEqual(by_name["alpha.txt"]["kind"], "file")
        self.assertEqual(by_name["alpha.txt"]["bytes"], 6)
        self.assertEqual(by_name["sub"]["kind"], "dir")
        self.assertIsNone(by_name["sub"]["bytes"])
        self.assertEqual(data["count"], len(data["entries"]))

    @unittest_run_loop
    async def test_default_path_is_root(self):
        self.write("a.txt")
        status, with_param, _ = await self.get_json("/api/core/file/list?path=.")
        status2, bare, _ = await self.get_json("/api/core/file/list")
        self.assertEqual((status, status2), (200, 200))
        self.assertEqual(bare["entries"], with_param["entries"])

    @unittest_run_loop
    async def test_depth_one_vs_zero(self):
        """depth=1 — только дети; depth=0 — рекурсивно."""
        self.write("top.txt")
        self.write("sub/inner.txt")

        # NOTE: base не пуст — create_app сам кладёт machines.json/.lck,
        # поэтому проверяем свойство глубины, а не точный набор имён.
        _s, shallow, _b = await self.get_json("/api/core/file/list?path=.&depth=1")
        names1 = {Path(e["path"]).name for e in shallow["entries"]}
        self.assertIn("top.txt", names1)
        self.assertIn("sub", names1)
        self.assertNotIn("inner.txt", names1)
        self.assertFalse([e["path"] for e in shallow["entries"]
                          if "/" in e["path"] or "\\" in e["path"]],
                         "depth=1 must not emit nested paths")

        _s, deep, _b = await self.get_json("/api/core/file/list?path=.&depth=0")
        paths0 = {Path(e["path"]).as_posix() for e in deep["entries"]}
        self.assertIn("sub", paths0)
        self.assertTrue(any(p.endswith("inner.txt") for p in paths0), paths0)

    @unittest_run_loop
    async def test_empty_directory_is_200_count_zero(self):
        """§2.6: пусто — это ответ, а не 404."""
        (self.tmp / "empty").mkdir()
        status, data, body = await self.get_json("/api/core/file/list?path=empty")
        self.assertEqual(status, 200)
        self.assertEqual(data["entries"], [])
        self.assertEqual(data["count"], 0)
        self.assertEqual(data["truncated"], False)

    @unittest_run_loop
    async def test_missing_path_is_json_404_not_plain_text(self):
        """§2.5: ресурса нет ⇒ JSON {"error": …}, а не plain-text 404."""
        status, data, body = await self.get_json("/api/core/file/list?path=nope")
        self.assertEqual(status, 404)
        self.assertIsNotNone(data, f"expected JSON error, got {body!r}")
        self.assertIn("error", data)

    @unittest_run_loop
    async def test_absolute_path_rejected_400(self):
        status, data, _ = await self.get_json(
            "/api/core/file/list?path=" + Path("C:/Windows").as_posix())
        self.assertEqual(status, 400)
        self.assertIn("absolute", (data or {}).get("error", "").lower())

    @unittest_run_loop
    async def test_sandbox_escape_rejected_400(self):
        status, data, _ = await self.get_json("/api/core/file/list?path=../../etc")
        self.assertEqual(status, 400)
        self.assertIn("escapes sandbox", (data or {}).get("error", ""))

    @unittest_run_loop
    async def test_negative_depth_rejected_400(self):
        status, data, _ = await self.get_json("/api/core/file/list?depth=-1")
        self.assertEqual(status, 400)
        self.assertIn("depth", (data or {}).get("error", ""))

    @unittest_run_loop
    async def test_non_integer_depth_rejected_400(self):
        status, _data, _ = await self.get_json("/api/core/file/list?depth=abc")
        self.assertEqual(status, 400)

    @unittest_run_loop
    async def test_limit_truncates_and_reports(self):
        for i in range(3):
            self.write(f"f{i}.txt")
        status, data, _ = await self.get_json("/api/core/file/list?limit=2")
        self.assertEqual(status, 200)
        self.assertEqual(data["count"], 2)
        self.assertEqual(data["truncated"], True)

    @unittest_run_loop
    async def test_files_alias_returns_same_body(self):
        """Директива #478 называет путь /api/core/files — алиас того же хендлера."""
        self.write("a.txt", "hello\n")
        s1, d1, _ = await self.get_json("/api/core/file/list?path=.")
        s2, d2, _ = await self.get_json("/api/core/files")
        self.assertEqual((s1, s2), (200, 200))
        self.assertEqual(d1, d2)

    @unittest_run_loop
    async def test_remote_machine_is_501_not_silent(self):
        """§2 конвенции: remote-ветка объявляется 501 до N4."""
        self.write("a.txt")
        self.supervisor  # exists for parity with other suites
        status, data, _ = await self.get_json(
            "/api/core/file/list?machine=vm1&path=.")
        self.assertEqual(status, 501)
        self.assertIn("error", data or {})

    @unittest_run_loop
    async def test_depth_ceiling_is_enforced_and_reported(self):
        """§2.1: у рекурсии есть жёсткий потолок константой — и он честен."""
        from tools.nexus_core import file_ops

        deep = "/".join(f"L{i}" for i in range(file_ops.MAX_LIST_DEPTH + 3))
        self.write(deep + "/bottom.txt", "x\n")
        status, data, _ = await self.get_json("/api/core/file/list?path=.&depth=0")
        self.assertEqual(status, 200)
        paths = [e["path"] for e in data["entries"]]
        self.assertFalse(any(p.endswith("bottom.txt") for p in paths),
                         "walk went past MAX_LIST_DEPTH")
        self.assertEqual(data["truncated"], True)

    @unittest_run_loop
    async def test_depth_above_ceiling_is_400(self):
        from tools.nexus_core import file_ops

        status, data, _ = await self.get_json(
            "/api/core/file/list?depth=" + str(file_ops.MAX_LIST_DEPTH + 1))
        self.assertEqual(status, 400)
        self.assertIn("depth", (data or {}).get("error", ""))

    @unittest_run_loop
    async def test_list_of_a_file_returns_that_entry(self):
        self.write("only.txt", "abc\n")
        status, data, _ = await self.get_json("/api/core/file/list?path=only.txt")
        self.assertEqual(status, 200)
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["entries"][0]["kind"], "file")
        self.assertEqual(data["entries"][0]["bytes"], 4)

    @unittest_run_loop
    async def test_symlink_escape_does_not_leak_outside(self):
        """§2.1: walk остаётся внутри root (защита того же семейства, что #419)."""
        outside = Path(tempfile.mkdtemp(prefix="nexus-core-n8-outside-"))
        self.addCleanup(shutil.rmtree, outside, True)
        (outside / "secret.txt").write_text("do not list\n", encoding="utf-8", newline="\n")
        link = self.tmp / "joint"
        made = False
        try:
            os.symlink(str(outside), str(link), target_is_directory=True)
            made = True
        except OSError:
            if os.name == "nt":
                res = subprocess.run(
                    ["cmd", "/c", "mklink", "/J", str(link), str(outside)])
                made = res.returncode == 0 and link.exists()
        if not made:
            raise unittest.SkipTest("no unprivileged directory-link on this host")
        self.write("in.txt")

        status, data, _ = await self.get_json("/api/core/file/list?path=.&depth=0")
        self.assertEqual(status, 200)
        paths = [e["path"] for e in data["entries"]]
        self.assertFalse(
            any("secret" in p for p in paths),
            f"sandbox escape leaked entries: {paths}")


class TestChangesContract(NewfReadOnlyTestCase):

    @unittest_run_loop
    async def test_dirty_repo_reports_porcelain_xy(self):
        make_repo(self.tmp)
        (self.tmp / "tracked.txt").write_text("one\ntwo\n", encoding="utf-8", newline="\n")
        self.write("fresh.txt", "new\n")

        status, data, _ = await self.get_json("/api/core/changes?cwd=.")
        self.assertEqual(status, 200)
        self.assertEqual(data["state"], "dirty")
        by_path = {Path(c["path"]).as_posix(): c for c in data["changes"]}
        self.assertEqual(by_path["tracked.txt"]["status"], "M")
        self.assertEqual(by_path["tracked.txt"]["note"], "modified")
        self.assertEqual(by_path["fresh.txt"]["status"], "?")
        self.assertEqual(by_path["fresh.txt"]["note"], "untracked")
        self.assertEqual(data["count"], len(data["changes"]))
        self.assertEqual(data["truncated"], False)
        self.assertIsNone(data["ahead"])
        self.assertIsNone(data["behind"])
        self.assertEqual(data["branch"], "main")

    @unittest_run_loop
    async def test_clean_repo_is_200_empty(self):
        make_repo(self.tmp)
        status, data, _ = await self.get_json("/api/core/changes?cwd=.")
        self.assertEqual(status, 200)
        self.assertEqual(data["state"], "clean")
        self.assertEqual(data["changes"], [])
        self.assertEqual(data["count"], 0)
        self.assertEqual(data["truncated"], False)

    @unittest_run_loop
    async def test_not_a_repository_is_200_observed_fact(self):
        self.write("plain.txt")
        status, data, _ = await self.get_json("/api/core/changes?cwd=.")
        self.assertEqual(status, 200)
        self.assertEqual(data["state"], "not_a_repository")
        self.assertEqual(data["changes"], [])

    @unittest_run_loop
    async def test_missing_cwd_is_400(self):
        """§2.3: ядро не знает, какой репозиторий показывать."""
        status, data, _ = await self.get_json("/api/core/changes")
        self.assertEqual(status, 400)
        self.assertIn("cwd required", (data or {}).get("error", ""))

    @unittest_run_loop
    async def test_cwd_absolute_and_escape_rejected(self):
        s1, d1, _ = await self.get_json("/api/core/changes?cwd=C:/")
        self.assertEqual(s1, 400)
        self.assertIn("absolute", (d1 or {}).get("error", "").lower())
        s2, d2, _ = await self.get_json("/api/core/changes?cwd=../../somewhere")
        self.assertEqual(s2, 400)
        self.assertIn("escapes sandbox", (d2 or {}).get("error", ""))

    @unittest_run_loop
    async def test_git_unavailable_is_503(self):
        make_repo(self.tmp)
        from tools.nexus_core import git_ops

        real = git_ops.subprocess

        def boom(*a, **k):
            raise FileNotFoundError(2, "git: not found")

        git_ops.subprocess = _FakeSubprocess(boom)
        try:
            status, data, _ = await self.get_json("/api/core/changes?cwd=.")
        finally:
            git_ops.subprocess = real
        self.assertEqual(status, 503)
        self.assertEqual(data["state"], "git_unavailable")

    @unittest_run_loop
    async def test_fail_closed_on_nonzero_exit(self):
        """worktrees.py:127-140: rc != 0 ⇒ dirty (fail-closed), а не «чисто»."""
        make_repo(self.tmp)
        from tools.nexus_core import git_ops

        real = git_ops.subprocess

        class FakeDone:
            returncode = 128
            stdout = ""
            stderr = "fatal: unable to read tree"

        git_ops.subprocess = _FakeSubprocess(lambda *a, **k: FakeDone())
        try:
            status, data, _ = await self.get_json("/api/core/changes?cwd=.")
        finally:
            git_ops.subprocess = real
        self.assertEqual(status, 200)
        self.assertEqual(data["state"], "dirty")
        self.assertEqual(data.get("fail_closed"), True)

    @unittest_run_loop
    async def test_every_git_call_uses_no_optional_locks(self):
        make_repo(self.tmp)
        from tools.nexus_core import git_ops

        seen: list[list[str]] = []
        real = git_ops.subprocess
        git_ops.subprocess = _FakeSubprocess(
            lambda cmd, *a, **k: self._fake_status(real, cmd, seen, a, k))
        try:
            status, _data, _ = await self.get_json(
                "/api/core/changes?cwd=.&stat=1")
        finally:
            git_ops.subprocess = real
        self.assertEqual(status, 200)
        self.assertGreaterEqual(len(seen), 2)
        for argv in seen:
            self.assertIn("git", argv[0])
            self.assertIn("--no-optional-locks", argv, argv)
            self.assertTrue(argv[1] == "--no-optional-locks",
                            f"--no-optional-locks must precede the subcommand: {argv}")

    @unittest_run_loop
    async def test_stat_is_opt_in(self):
        """По умолчанию форма §2.3; ?stat=1 добавляет diff_stat (директива #478)."""
        make_repo(self.tmp)
        (self.tmp / "tracked.txt").write_text("one\ntwo\nthree\n", encoding="utf-8", newline="\n")

        _s, plain, _b = await self.get_json("/api/core/changes?cwd=.")
        self.assertNotIn("diff_stat", plain)

        _s, st, _b = await self.get_json("/api/core/changes?cwd=.&stat=1")
        self.assertIn("diff_stat", st)
        rows = {Path(r["path"]).as_posix(): r for r in st["diff_stat"]}
        self.assertIn("tracked.txt", rows)
        self.assertEqual(rows["tracked.txt"]["insertions"], 2)
        self.assertEqual(rows["tracked.txt"]["deletions"], 0)

    @unittest_run_loop
    async def test_limit_truncates_changes(self):
        make_repo(self.tmp)
        for i in range(3):
            self.write(f"n{i}.txt", "new\n")
        _s, data, _b = await self.get_json("/api/core/changes?cwd=.&limit=1")
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["truncated"], True)
        self.assertEqual(len(data["changes"]), 1)

    @unittest_run_loop
    async def test_changes_shape_keys_exact(self):
        make_repo(self.tmp)
        _s, data, _b = await self.get_json("/api/core/changes?cwd=.")
        self.assertEqual(
            set(data),
            {"cwd", "state", "branch", "ahead", "behind", "changes",
             "count", "truncated"})


class TestChangesOutOfScope(NewfReadOnlyTestCase):
    """git-дерево ABOVE песочницы: статус наружу не отдаём (§2.3 out_of_scope)."""

    def make_base(self, root: Path) -> Path:
        make_repo(root)
        nested = root / "sandbox"
        nested.mkdir()
        (nested / "loose.txt").write_text("x\n", encoding="utf-8", newline="\n")
        git(root, "add", "-A")           # sandbox/loose.txt попадает в индекс
        git(root, "commit", "-q", "-m", "nested")
        (root / "outside.txt").write_text("secret\n", encoding="utf-8", newline="\n")
        return nested

    @unittest_run_loop
    async def test_repo_above_sandbox_is_out_of_scope(self):
        status, data, body = await self.get_json("/api/core/changes?cwd=.")
        self.assertEqual(status, 200)
        self.assertEqual(data["state"], "out_of_scope")
        self.assertEqual(data["changes"], [])
        self.assertEqual(data["count"], 0)
        self.assertIsNone(data["branch"])
        self.assertNotIn("outside.txt", body)


class TestMachinesReadOnly(NewfReadOnlyTestCase):
    """#478 п.3: machine_mutation не тронут; read-форма не меняется молча."""

    async def _register(self, name: str, labels: dict[str, str]) -> None:
        self.supervisor  # no-op: registry lives on app state
        state = self.client.app["state"]
        state.machines.add(name, host=name + ".example")
        state.machines.update(name, labels=labels)

    @unittest_run_loop
    async def test_schema_matches_registry_and_precedes_name_route(self):
        status, data, _ = await self.get_json("/api/core/machines/schema")
        self.assertEqual(status, 200)
        self.assertEqual(data, {
            "name_pattern": VALID_NAME_RE.pattern,
            "host_pattern": HOST_RE.pattern,
            "transports": list(TRANSPORTS),
            "host_default_to_name": True,
        })

    @unittest_run_loop
    async def test_list_shape_unchanged_labels_still_absent(self):
        """HERETIC #482: merged-список не отдаёт labels — оставили как есть честно."""
        await self._register("vm1", {"role": "gpu"})
        _s, data, _b = await self.get_json("/api/core/machines")
        self.assertIn("vm1", data["machines"])
        entry = data["machines"]["vm1"]
        self.assertEqual(
            set(entry),
            {"terminals", "state", "host", "transport", "since_ms", "why"})
        self.assertNotIn("labels", entry)

    @unittest_run_loop
    async def test_detail_emits_labels(self):
        await self._register("vm2", {"role": "gpu"})
        _s, data, _b = await self.get_json("/api/core/machines/vm2")
        self.assertEqual(data["labels"], {"role": "gpu"})
        self.assertEqual(data["name"], "vm2")

    @unittest_run_loop
    async def test_missing_machine_detail_is_json_404(self):
        status, data, _ = await self.get_json("/api/core/machines/nope")
        self.assertEqual(status, 404)
        self.assertIn("machine not found", data["error"])

    @unittest_run_loop
    async def test_mutations_still_gated_without_token_503(self):
        """П.3 директивы: ничего не ослабляем — PUT/connect по-прежнему 503."""
        os.environ.pop("NEXUS_CORE_TOKEN", None)
        resp = await self.client.put("/api/core/machines/vm9",
                                     json={"host": "vm9.example"})
        self.assertEqual(resp.status, 503)
        body = await resp.json()
        self.assertIn("NEXUS_CORE_TOKEN", body["error"])

        resp = await self.client.post("/api/core/machines/vm9/connect")
        self.assertEqual(resp.status, 503)

    @unittest_run_loop
    async def test_new_get_routes_need_read_token_when_set(self):
        """§2.5: «право не выдано» — 401/503, а не unavailable."""
        os.environ["NEXUS_CORE_READ_TOKEN"] = "sekret-read"
        self.addCleanup(os.environ.pop, "NEXUS_CORE_READ_TOKEN", None)
        for url in ("/api/core/file/list", "/api/core/files",
                    "/api/core/changes?cwd=."):
            resp = await self.client.get(url)
            self.assertEqual(resp.status, 401, url)
            resp_ok = await self.client.get(url, headers={"X-Nexus-Key": "sekret-read"})
            self.assertEqual(resp_ok.status, 200, url)

    @unittest_run_loop
    async def test_get_routes_open_without_any_token(self):
        """Маршруты зарегистрированы и без токенов отдают данные (не plain-404)."""
        self.write("a.txt")
        for url in ("/api/core/file/list", "/api/core/files"):
            resp = await self.client.get(url)
            self.assertEqual(resp.status, 200, url)
            self.assertIn("entries", await resp.json())
        resp = await self.client.get("/api/core/changes?cwd=.")
        self.assertEqual(resp.status, 200)
        self.assertIn("state", await resp.json())


class TestResponseTooLarge(NewfReadOnlyTestCase):

    @unittest_run_loop
    async def test_413_when_entry_budget_exceeded(self):
        """§2.1: 413 при превышении размера ответа (проверяем логику на малом бюджете)."""
        from tools.nexus_core import file_ops

        for i in range(5):
            self.write(f"b{i}.txt", "x\n")
        real = file_ops.MAX_LIST_BYTES
        file_ops.MAX_LIST_BYTES = 60
        try:
            status, data, _ = await self.get_json("/api/core/file/list?path=.")
        finally:
            file_ops.MAX_LIST_BYTES = real
        self.assertEqual(status, 413)
        self.assertIn("error", data or {})


if __name__ == "__main__":
    unittest.main()
