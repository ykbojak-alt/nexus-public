#!/usr/bin/env python3
"""
tools/nexus_core/test_worktree_endpoint.py — #549 worktrees API.

Покрытие:
- git_ops: валидация имени, porcelain-парсер, dup/not-found/git-error
  (реальный git на tmp-репозитории — не моки там, где можно);
- API: POST /api/core/worktree (create+spawn), GET /api/core/worktrees,
  DELETE /api/core/worktree (kill term + remove), 400/404/409-маппинг.

Запуск: pytest tools/nexus_core/test_worktree_endpoint.py
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from tools.nexus_core import git_ops
from tools.nexus_core.api import create_app
from tools.nexus_core.git_ops import (
    GitError,
    WorktreeNotFound,
    _parse_worktree_porcelain,
)
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1

WIN = sys.platform == "win32"


def git(cwd: Path, *args: str) -> str:
    out = subprocess.run(
        ["git", *args], cwd=str(cwd), capture_output=True, text=True,
    )
    assert out.returncode == 0, f"git {' '.join(args)} failed: {out.stderr}"
    return out.stdout


def make_repo(cwd: Path) -> Path:
    """Репозиторий с одним коммитом внутри `cwd/repo`."""
    repo = cwd / "repo"
    repo.mkdir(parents=True, exist_ok=True)
    git(repo, "init", "-q", "-b", "main")
    git(repo, "config", "user.email", "wt-test@local")
    git(repo, "config", "user.name", "wt-test")
    git(repo, "config", "core.autocrlf", "false")
    (repo / "tracked.txt").write_text("one\n", encoding="utf-8", newline="\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "fixture")
    return repo


# ---------------------------------------------------------------------------
# Unit: git_ops worktree-слой (реальный git, tmp-репо)
# ---------------------------------------------------------------------------


@unittest.skipUnless(shutil.which("git"), "git required")
class TestGitOpsWorktrees(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="wt-ops-"))
        self.repo = make_repo(self.tmp)
        self.wt_root = git_ops.worktree_root(self.repo)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_worktree_root_sibling(self):
        self.assertEqual(self.wt_root, self.tmp / "repo-wt")

    def test_list_main_only(self):
        entries = git_ops.list_worktrees(self.repo)
        self.assertEqual(len(entries), 1)
        self.assertTrue(entries[0]["main"])
        self.assertEqual(entries[0]["branch"], "main")
        self.assertTrue(entries[0]["head"])

    def test_add_and_list(self):
        info = git_ops.add_worktree(self.repo, "feat-a")
        self.assertEqual(info["name"], "feat-a")
        self.assertTrue(Path(info["path"]).is_dir())
        self.assertTrue((Path(info["path"]) / "tracked.txt").is_file())
        entries = git_ops.list_worktrees(self.repo)
        self.assertEqual(len(entries), 2)
        wt = [e for e in entries if not e["main"]][0]
        self.assertEqual(wt["name"], "feat-a")
        self.assertEqual(wt["branch"], "feat-a")

    def test_add_dup_raises_git_error(self):
        git_ops.add_worktree(self.repo, "feat-a")
        with self.assertRaises(GitError) as ctx:
            git_ops.add_worktree(self.repo, "feat-a")
        self.assertIn("already exists", str(ctx.exception))

    def test_add_bad_name_valueerror(self):
        for bad in ("", "a b", "../x", "-lead", ".dot", "a" * 64, "a/b"):
            with self.assertRaises(ValueError, msg=bad):
                git_ops.add_worktree(self.repo, bad)

    def test_add_non_repo_git_error(self):
        plain = self.tmp / "plain"
        plain.mkdir()
        with self.assertRaises(GitError):
            git_ops.add_worktree(plain, "x")

    def test_remove_roundtrip(self):
        git_ops.add_worktree(self.repo, "feat-a")
        info = git_ops.remove_worktree(self.repo, "feat-a")
        self.assertTrue(info["removed"])
        self.assertFalse(Path(info["path"]).exists())
        self.assertEqual(len(git_ops.list_worktrees(self.repo)), 1)

    def test_remove_not_found(self):
        with self.assertRaises(WorktreeNotFound):
            git_ops.remove_worktree(self.repo, "nope")

    def test_remove_dirty_conflict_then_force(self):
        git_ops.add_worktree(self.repo, "feat-a")
        wt = git_ops.worktree_path(self.repo, "feat-a")
        (wt / "dirty.txt").write_text("x", encoding="utf-8")
        with self.assertRaises(GitError) as ctx:
            git_ops.remove_worktree(self.repo, "feat-a")
        self.assertTrue(str(ctx.exception).strip())  # текст git наружу
        info = git_ops.remove_worktree(self.repo, "feat-a", force=True)
        self.assertTrue(info["removed"])

    def test_porcelain_parser(self):
        text = (
            "worktree D:/repo\n"
            "HEAD abc123\n"
            "branch refs/heads/main\n"
            "\n"
            "worktree D:/repo-wt/feat\n"
            "HEAD def456\n"
            "branch refs/heads/feat\n"
            "locked reason here\n"
            "\n"
            "worktree D:/other\n"
            "HEAD 999\n"
            "detached\n"
        )
        entries = _parse_worktree_porcelain(text)
        self.assertEqual(len(entries), 3)
        self.assertTrue(entries[0]["main"])
        self.assertEqual(entries[0]["branch"], "main")
        self.assertEqual(entries[1]["name"], "feat")
        self.assertTrue(entries[1]["locked"])
        self.assertTrue(entries[2]["detached"])
        self.assertIsNone(entries[2]["branch"])

    # -- W5: worktree_status ----------------------------------------------

    def _status(self, name="feat-a", base="main"):
        entries = git_ops.list_worktrees(self.repo)
        wt = next(e for e in entries if e.get("name") == name)
        return git_ops.worktree_status(self.repo, wt, base)

    def test_status_clean_fresh_worktree(self):
        git_ops.add_worktree(self.repo, "feat-a")
        st = self._status()
        self.assertEqual(st["branch"], "feat-a")
        self.assertEqual(st["ahead"], 0)
        self.assertEqual(st["behind"], 0)
        self.assertFalse(st["dirty"])

    def test_status_dirty_after_touch(self):
        git_ops.add_worktree(self.repo, "feat-a")
        wt = git_ops.worktree_path(self.repo, "feat-a")
        (wt / "dirty.txt").write_text("x", encoding="utf-8")
        st = self._status()
        self.assertTrue(st["dirty"])

    def test_status_ahead_after_commit(self):
        git_ops.add_worktree(self.repo, "feat-a")
        wt = git_ops.worktree_path(self.repo, "feat-a")
        (wt / "new.txt").write_text("n\n", encoding="utf-8", newline="\n")
        git(wt, "add", "-A")
        git(wt, "commit", "-q", "-m", "feat work")
        st = self._status()
        self.assertEqual(st["ahead"], 1)
        self.assertEqual(st["behind"], 0)
        self.assertFalse(st["dirty"])

    def test_status_main_worktree_zero_divergence(self):
        entries = git_ops.list_worktrees(self.repo)
        main = next(e for e in entries if e.get("main"))
        st = git_ops.worktree_status(self.repo, main, "main")
        self.assertEqual(st["branch"], "main")
        self.assertEqual(st["ahead"], 0)
        self.assertEqual(st["behind"], 0)
        self.assertFalse(st["dirty"])


# ---------------------------------------------------------------------------
# API: endpoints поверх реального git + MockPTYBackend
# ---------------------------------------------------------------------------


class WorktreeApiTestCase(AioHTTPTestCase):
    def setUp(self):
        self.cleanup_root = Path(tempfile.mkdtemp(prefix="wt-api-"))
        self.repo = make_repo(self.cleanup_root)
        self.backend = MockPTYBackend()
        self.supervisor = SupervisorV1(backend=self.backend)
        super().setUp()

    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.cleanup_root, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.cleanup_root / "state",
                          supervisor=self.supervisor,
                          templates_dir=self.cleanup_root / "templates")

    async def _json(self, method: str, url: str, payload=None):
        if method == "GET":
            resp = await self.client.get(url)
        elif method == "DELETE":
            resp = await self.client.delete(url)
        else:
            resp = await self.client.request(
                method, url, json=payload)
        body = await resp.text()
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            data = None
        return resp.status, data, body

    @unittest_run_loop
    async def test_list_worktrees(self):
        status, data, _ = await self._json(
            "GET", f"/api/core/worktrees?repo={self.repo}")
        self.assertEqual(status, 200)
        self.assertEqual(len(data["worktrees"]), 1)
        self.assertTrue(data["worktrees"][0]["main"])

    @unittest_run_loop
    async def test_list_worktrees_status_w5(self):
        s, _, _ = await self._json(
            "POST", "/api/core/worktree",
            {"repo": str(self.repo), "name": "feat-s"})
        self.assertEqual(s, 201)
        _, lst, _ = await self._json(
            "GET", f"/api/core/worktrees?repo={self.repo}")
        by_name = {w["name"]: w for w in lst["worktrees"]}
        wt = by_name["feat-s"]
        st = wt["status"]
        self.assertEqual(st["branch"], "feat-s")
        self.assertEqual(st["ahead"], 0)
        self.assertEqual(st["behind"], 0)
        self.assertFalse(st["dirty"])
        # main-worktree тоже несёт status
        main = next(w for w in lst["worktrees"] if w.get("main"))
        self.assertIn("status", main)
        self.assertEqual(main["status"]["branch"], "main")
        # dirty после touch файла в worktree
        wt_path = Path(wt["path"])
        (wt_path / "dirty.txt").write_text("x", encoding="utf-8")
        _, lst, _ = await self._json(
            "GET", f"/api/core/worktrees?repo={self.repo}")
        wt = next(w for w in lst["worktrees"] if w["name"] == "feat-s")
        self.assertTrue(wt["status"]["dirty"])

    @unittest_run_loop
    async def test_list_non_repo_409(self):
        plain = self.cleanup_root / "plain"
        plain.mkdir()
        status, data, _ = await self._json(
            "GET", f"/api/core/worktrees?repo={plain}")
        self.assertEqual(status, 409)
        self.assertTrue(data["error"].strip())

    @unittest_run_loop
    async def test_create_spawns_terminal(self):
        status, data, _ = await self._json(
            "POST", "/api/core/worktree",
            {"repo": str(self.repo), "name": "feat-x"})
        self.assertEqual(status, 201, data)
        wt = data["worktree"]
        self.assertTrue(Path(wt["path"]).is_dir())
        self.assertEqual(
            Path(wt["path"]),
            git_ops.worktree_root(self.repo) / "feat-x")
        term = data["terminal"]
        self.assertEqual(term["labels"].get("wt"), "feat-x")
        self.assertEqual(term["cwd"], wt["path"])
        self.assertTrue(term["name"].startswith("wt-"))
        # терминал реально в supervisor
        self.assertIn(f"local/{term['name']}", self.supervisor.terminals)

    @unittest_run_loop
    async def test_create_dup_409(self):
        payload = {"repo": str(self.repo), "name": "feat-x"}
        s1, _, _ = await self._json("POST", "/api/core/worktree", payload)
        self.assertEqual(s1, 201)
        s2, data, _ = await self._json("POST", "/api/core/worktree", payload)
        self.assertEqual(s2, 409)
        self.assertIn("already exists", data["error"])

    @unittest_run_loop
    async def test_create_bad_name_400(self):
        for bad in ("../evil", "a b", "-x"):
            status, data, _ = await self._json(
                "POST", "/api/core/worktree",
                {"repo": str(self.repo), "name": bad})
            self.assertEqual(status, 400, (bad, data))

    @unittest_run_loop
    async def test_delete_kills_terminal_and_removes(self):
        s, data, _ = await self._json(
            "POST", "/api/core/worktree",
            {"repo": str(self.repo), "name": "feat-x"})
        self.assertEqual(s, 201)
        term_addr = data["terminal"]["address"]
        wt_path = data["worktree"]["path"]

        status, data, _ = await self._json(
            "DELETE",
            f"/api/core/worktree?name=feat-x&repo={self.repo}")
        self.assertEqual(status, 200, data)
        self.assertIn(term_addr, data["killed"])
        self.assertFalse(Path(wt_path).exists())
        # worktree ушёл из списка
        _, lst, _ = await self._json(
            "GET", f"/api/core/worktrees?repo={self.repo}")
        self.assertEqual(len(lst["worktrees"]), 1)  # только main

    @unittest_run_loop
    async def test_delete_dirty_409_then_force(self):
        s, data, _ = await self._json(
            "POST", "/api/core/worktree",
            {"repo": str(self.repo), "name": "feat-x"})
        self.assertEqual(s, 201)
        wt_path = Path(data["worktree"]["path"])
        (wt_path / "dirty.txt").write_text("x", encoding="utf-8")

        status, data, _ = await self._json(
            "DELETE",
            f"/api/core/worktree?name=feat-x&repo={self.repo}")
        self.assertEqual(status, 409, data)
        self.assertTrue(data["error"].strip())  # текст git
        self.assertTrue(wt_path.exists())      # не удалили

        status, data, _ = await self._json(
            "DELETE",
            f"/api/core/worktree?name=feat-x&repo={self.repo}&force=1")
        self.assertEqual(status, 200, data)
        self.assertFalse(wt_path.exists())

    @unittest_run_loop
    async def test_delete_not_found_404(self):
        status, data, _ = await self._json(
            "DELETE",
            f"/api/core/worktree?name=nope&repo={self.repo}")
        self.assertEqual(status, 404)

    @unittest_run_loop
    async def test_delete_without_name_400(self):
        status, _, _ = await self._json(
            "DELETE", f"/api/core/worktree?repo={self.repo}")
        self.assertEqual(status, 400)


if __name__ == "__main__":
    unittest.main()
