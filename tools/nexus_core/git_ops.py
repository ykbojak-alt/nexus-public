#!/usr/bin/env python3
"""
tools/nexus_core/git_ops.py — git-статус рабочей копии для /api/core/changes.

Контракт: reports/QODER-newf-backend-475.md §2.3 (#478).

Дисциплину взяли из tools/bus2/worktrees.py:127-140, но НЕ импортируем bus2 —
это другой продукт (нарушение слоёв). Здесь тот же смысл и те же флаги:
    git --no-optional-locks status --porcelain --ignore-submodules=none
и то же fail-closed: rc != 0 ⇒ «dirty», а не «чисто» (демо не должно
успокаивать клиента, когда git просто не смог прочитать tree).

Что честно различается:
    clean / dirty            — наблюдаемый факт из porcelain;
    not_a_repository         — тоже факт, не ошибка (200);
    out_of_scope             — репозиторий ВЫШЕ песочницы: его статус наружу
                               не отдаём (иначе /changes читает чужое дерево);
    git_unavailable          — git не запустился вовсе ⇒ 503 (200 «чисто»
                               было бы враньём).
ahead/behind всегда None: их нельзя взять без network-вызова.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Optional

GIT_TIMEOUT_S = 10                # обязательный: большой repo не вешает /api/core
DEFAULT_CHANGE_LIMIT = 2000       # записей в ответе; сверх ⇒ truncated: true
NO_OPTIONAL_LOCKS = "--no-optional-locks"  # не трогает index.lock чужого процесса

NOT_A_REPO_MARK = "not a git repository"

# Стабильная человекочитаемая подпись из фиксированной таблицы (§2.3).
# Никаких формулировок про «содержимое дифа», которого мы не читали.
NOTES: dict[str, str] = {
    "M": "modified",
    "A": "added",
    "D": "deleted",
    "R": "renamed",
    "C": "copied",
    "T": "type changed",
    "U": "unmerged",
    "?": "untracked",
    "!": "ignored",
}


class GitUnavailable(Exception):
    """git не запускается (нет бинарника/прав). Не путать с «репозиторий чист»."""


class _Done:
    """Унифицированная обёртка над CompletedProcess (тесты подсовывают свою)."""

    __slots__ = ("rc", "out", "err")

    def __init__(self, proc: "subprocess.CompletedProcess[str]") -> None:
        self.rc = proc.returncode
        self.out = proc.stdout or ""
        self.err = proc.stderr or ""


def _argv(args: list[str], cwd: Path) -> list[str]:
    """--no-optional-locks ОБЯЗАН стоять до подкоманды, иначе он не про него."""
    return ["git", NO_OPTIONAL_LOCKS,
            "-c", "core.quotepath=false",
            "-C", str(cwd), *args]


def _run(args: list[str], cwd: Path) -> _Done:
    proc = subprocess.run(
        _argv(args, cwd),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=GIT_TIMEOUT_S,
    )
    return _Done(proc)


def _shape(cwd: str, state: str, **extra) -> dict:
    result = {
        "cwd": cwd,
        "state": state,
        "branch": None,
        "ahead": None,
        "behind": None,
        "changes": [],
        "count": 0,
        "truncated": False,
    }
    result.update(extra)
    return result


def _status_of(xy: str) -> str:
    if xy == "??":
        return "?"
    if xy == "!!":
        return "!"
    return xy.strip() or "?"


def _note_of(status: str) -> str:
    if status in NOTES:
        return NOTES[status]
    return NOTES.get(status[:1], "changed")


def _parse_porcelain(text: str) -> list[dict]:
    rows: list[dict] = []
    for line in text.split("\n"):
        if not line.strip():
            continue
        xy = line[:2]
        raw = line[3:]
        # переименование/копия: "R  old -> new" — наружу отдаём новое имя
        if " -> " in raw:
            raw = raw.split(" -> ", 1)[1]
        rows.append({
            "path": Path(raw).as_posix(),
            "status": _status_of(xy),
            "note": _note_of(_status_of(xy)),
        })
    return rows


def _parse_numstat(text: str) -> list[dict]:
    rows: list[dict] = []
    for line in text.split("\n"):
        if not line.strip():
            continue
        parts = line.split("\t", 2)
        if len(parts) != 3:
            continue
        added, deleted, path = parts

        def _num(value: str) -> Optional[int]:
            return None if value == "-" else int(value)

        rows.append({
            "path": Path(path).as_posix(),
            "insertions": _num(added),
            "deletions": _num(deleted),
        })
    return rows


def changes(
    root: Path,
    target: Path,
    cwd: str = ".",
    limit: int = DEFAULT_CHANGE_LIMIT,
    stat: bool = False,
) -> dict:
    """Статус рабочей копии `target`, ограниченный песочницей `root`.

    Бросает GitUnavailable, если git не запустился вовсе (handler ⇒ 503).
    """
    root = Path(root).resolve()
    target = Path(target).resolve()
    if limit < 1:
        raise ValueError("limit must be >= 1")

    try:
        probe = _run(["rev-parse", "--show-toplevel"], target)
    except FileNotFoundError as exc:
        raise GitUnavailable(str(exc)) from exc
    except (PermissionError, OSError) as exc:
        raise GitUnavailable(str(exc)) from exc

    if probe.rc != 0:
        if NOT_A_REPO_MARK in (probe.err + probe.out):
            return _shape(cwd, "not_a_repository")
        # fail-closed (worktrees.py:138): не смогли спросить — считаем dirty
        return _shape(cwd, "dirty", fail_closed=True)

    toplevel = Path(probe.out.strip())
    try:
        toplevel = toplevel.resolve()
    except OSError:
        return _shape(cwd, "dirty", fail_closed=True)
    if not toplevel.is_relative_to(root):
        return _shape(cwd, "out_of_scope")

    try:
        status = _run(["status", "--porcelain",
                       "--ignore-submodules=none"], toplevel)
    except (FileNotFoundError, PermissionError, OSError) as exc:
        raise GitUnavailable(str(exc)) from exc
    if status.rc != 0:
        return _shape(cwd, "dirty", fail_closed=True)

    branch: Optional[str] = None
    try:
        head = _run(["rev-parse", "--abbrev-ref", "HEAD"], toplevel)
    except (FileNotFoundError, PermissionError, OSError) as exc:
        raise GitUnavailable(str(exc)) from exc
    if head.rc == 0 and head.out.strip():
        branch = head.out.strip()

    rows = _parse_porcelain(status.out)
    truncated = len(rows) > limit
    result = _shape(cwd, "clean" if not rows else "dirty",
                    branch=branch, changes=rows[:limit],
                    count=min(len(rows), limit), truncated=truncated)

    if stat:
        diff = _run(["diff", "--numstat"], toplevel)
        result["diff_stat"] = [] if diff.rc != 0 else _parse_numstat(diff.out)
    return result


# =============================================================================
# Worktrees (#549) — git worktree add/list/remove для /api/core/worktree*
#
# Целевой каталог детерминирован: <repo>-wt/<name> рядом с репозиторием
# (D:\\nexus → D:\\nexus-wt\\<name>). Имя валидируется под dir+branch сразу —
# `git worktree add <path>` сам создаёт ветку по basename(path).
# Любой rc != 0 от git → GitError со stderr как есть → API отдаёт 409:
# dirty-worktree на remove, занятая ветка, не-git repo — всё текстом git.
# =============================================================================

WORKTREE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$")


class GitError(Exception):
    """git вернул rc != 0 — текст ошибки наружу как есть (handler ⇒ 409)."""


class WorktreeNotFound(LookupError):
    """worktree с таким именем не найден в `git worktree list` (handler ⇒ 404)."""


def _git(repo: Path, args: list[str]) -> _Done:
    """_run + нормализация сбоев запуска в GitError/GitUnavailable."""
    try:
        return _run(args, repo)
    except FileNotFoundError as exc:
        raise GitError(f"repo path not found: {repo}") from exc
    except subprocess.TimeoutExpired as exc:
        raise GitError(f"git timed out after {GIT_TIMEOUT_S}s") from exc


def _require_git_repo(repo: Path) -> None:
    """repo обязан быть git-репозиторием — иначе GitError (409 с текстом git)."""
    if not repo.is_dir():
        raise GitError(f"repo not found: {repo}")
    done = _git(repo, ["rev-parse", "--git-dir"])
    if done.rc != 0:
        raise GitError(
            (done.err or done.out).strip() or f"not a git repository: {repo}"
        )


def worktree_root(repo: Path) -> Path:
    """Базовый каталог worktree'ев: sibling `<repo.name>-wt` у репозитория."""
    repo = Path(repo).resolve()
    return repo.parent / (repo.name + "-wt")


def _parse_worktree_porcelain(text: str) -> list[dict]:
    """`git worktree list --porcelain` → [{path, head, branch, flags, main}]."""
    entries: list[dict] = []
    cur: Optional[dict] = None
    for line in text.splitlines():
        if not line.strip():
            if cur is not None:
                entries.append(cur)
                cur = None
            continue
        if cur is None:
            cur = {"path": "", "head": "", "branch": None,
                   "detached": False, "bare": False,
                   "locked": False, "prunable": False}
        key, _, val = line.partition(" ")
        if key == "worktree":
            cur["path"] = val
        elif key == "HEAD":
            cur["head"] = val
        elif key == "branch":
            cur["branch"] = (val[len("refs/heads/"):]
                             if val.startswith("refs/heads/") else val)
        elif key in ("detached", "bare", "locked", "prunable"):
            cur[key] = True
    if cur is not None:
        entries.append(cur)
    for i, entry in enumerate(entries):
        entry["main"] = (i == 0)
        entry["name"] = Path(entry["path"]).name if entry["path"] else ""
    return entries


def list_worktrees(repo: Path) -> list[dict]:
    """Все worktree'и репозитория (включая основной, main=true)."""
    repo = Path(repo).expanduser()
    _require_git_repo(repo)
    done = _git(repo, ["worktree", "list", "--porcelain"])
    if done.rc != 0:
        raise GitError(
            (done.err or done.out).strip() or "git worktree list failed"
        )
    return _parse_worktree_porcelain(done.out)


def _find_worktree(repo: Path, name: str) -> dict:
    """Worktree по basename(path) или имени ветки; нет → WorktreeNotFound."""
    entries = list_worktrees(repo)
    target = (worktree_root(repo) / name).resolve()
    for entry in entries:
        if entry.get("main"):
            continue
        ep = entry.get("path") or ""
        if (entry.get("name") == name or entry.get("branch") == name
                or (ep and Path(ep).resolve() == target)):
            return entry
    raise WorktreeNotFound(f"worktree not found: {name}")


def worktree_path(repo: Path, name: str) -> Path:
    """Путь существующего worktree по имени (для kill-matching в API)."""
    return Path(_find_worktree(Path(repo).expanduser(), name)["path"])


def _check_name(name: str) -> str:
    name = (name or "").strip()
    if not WORKTREE_NAME_RE.fullmatch(name):
        raise ValueError(
            "invalid worktree name "
            f"{name!r} (1-63 of A-Z a-z 0-9 . _ -, no leading . or -)"
        )
    return name


def add_worktree(repo: Path, name: str) -> dict:
    """`git worktree add <repo>-wt/<name>`; ветка создаётся по basename.

    Duplicate (существующий worktree/путь) → GitError → 409.
    """
    name = _check_name(name)
    repo = Path(repo).expanduser()
    _require_git_repo(repo)
    target = worktree_root(repo) / name
    target_res = target.resolve()
    for entry in list_worktrees(repo):
        ep = entry.get("path") or ""
        if (Path(ep).name == name or entry.get("branch") == name
                or (ep and Path(ep).resolve() == target_res)):
            raise GitError(
                f"worktree {name!r} already exists: {ep or entry.get('branch')}"
            )
    if target.exists():
        raise GitError(f"path already exists: {target}")
    target.parent.mkdir(parents=True, exist_ok=True)
    done = _git(repo, ["worktree", "add", str(target)])
    if done.rc != 0:
        raise GitError(
            (done.err or done.out).strip() or "git worktree add failed"
        )
    return {"name": name, "path": str(target), "repo": str(repo.resolve())}


def remove_worktree(repo: Path, name: str, force: bool = False) -> dict:
    """`git worktree remove [--force] <path>`; dirty ⇒ rc!=0 ⇒ GitError→409."""
    name = _check_name(name)
    repo = Path(repo).expanduser()
    _require_git_repo(repo)
    entry = _find_worktree(repo, name)
    path = Path(entry["path"])
    args = ["worktree", "remove"] + (["--force"] if force else []) + [str(path)]
    done = _git(repo, args)
    if done.rc != 0:
        raise GitError(
            (done.err or done.out).strip() or "git worktree remove failed"
        )
    return {"name": name, "path": str(path), "removed": True}


def worktree_status(repo: Path, wt: dict,
                    base_ref: Optional[str] = None) -> dict:
    """Статус worktree'я для /api/core/worktrees (W5).

    {"ahead", "behind", "dirty", "branch"}:
      branch — ветка из porcelain-записи (detached → None);
      dirty  — `git status --porcelain` непустой; путь не-каталог или
               сбой git → True (fail-closed, конвенция repo_status);
      ahead/behind — `git rev-list --left-right --count <base>...HEAD`:
               right (HEAD-only) → ahead, left (base-only) → behind.
               base_ref — ветка main-worktree (её передаёт handler);
               detached/unborn HEAD/сбой → None.
    """
    status = {"ahead": None, "behind": None,
              "dirty": None, "branch": wt.get("branch")}
    path = Path(wt.get("path") or "")
    if not path.is_dir():
        status["dirty"] = True
        return status
    try:
        st = _git(path, ["status", "--porcelain",
                         "--ignore-submodules=none"])
    except GitError:
        st = None
    status["dirty"] = (True if st is None or st.rc != 0
                       else bool(st.out.strip()))
    if base_ref:
        try:
            rl = _git(path, ["rev-list", "--left-right", "--count",
                             f"{base_ref}...HEAD"])
        except GitError:
            rl = None
        if rl is not None and rl.rc == 0:
            parts = rl.out.strip().split()
            if len(parts) == 2:
                try:
                    status["behind"], status["ahead"] = (
                        int(parts[0]), int(parts[1]))
                except ValueError:
                    pass
    return status
