#!/usr/bin/env python3
"""Regenerate dated, read-only repository inventory manifests."""

from __future__ import annotations

import csv
import hashlib
import html
import os
import re
import subprocess
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs/verification/inventory"
STAMP = date.today().isoformat()
OUT_REL = "docs/verification/inventory/"
DOC_EXT = {".md", ".mdx", ".rst", ".adoc", ".asciidoc", ".txt", ".html", ".htm", ".pdf", ".docx", ".pptx", ".xlsx"}
TEXT_EXT = {".md", ".mdx", ".rst", ".adoc", ".asciidoc", ".txt", ".html", ".htm"}
SKIP_NAMES = {".git", "node_modules", ".next", "out", "dist", ".nx", ".pytest_cache", "__pycache__", ".playwright-diag", "test-results", ".venv", "venv", "target"}
SKIP_PYTHON = {"Python", "tui/Python", "tui/nexus_tui/Python"}


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", *args], cwd=ROOT)


def write_csv(name: str, header: list[str], rows: list[list[object]]) -> None:
    with (OUT / f"{name}-{STAMP}.csv").open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(rows)


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (UnicodeError, OSError):
        return ""


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    tracked = {p.decode("utf-8", "surrogateescape") for p in git("ls-files", "-z").split(b"\0") if p}
    status = git("status", "--porcelain=v1", "-z", "--untracked-files=all").split(b"\0")
    states: dict[str, str] = {}
    i = 0
    while i < len(status):
        item = status[i]
        i += 1
        if not item:
            continue
        code, raw = item[:2].decode("ascii", "replace"), item[3:]
        path = raw.decode("utf-8", "surrogateescape")
        if "R" in code or "C" in code:
            i += 1
        if path.startswith(OUT_REL):
            continue
        states[path] = "untracked" if code == "??" else ("staged" if code[0] != " " and code[1] == " " else "modified")

    git_paths = sorted((tracked | states.keys()) - {p for p in tracked | states.keys() if p.startswith(OUT_REL)})
    git_rows: list[list[object]] = []
    docs: list[tuple[str, str, int, str]] = []
    for p in git_paths:
        path = ROOT / p
        try:
            size = path.stat().st_size
        except OSError:
            size = 0
        state = states.get(p, "tracked")
        git_rows.append([p, p.split("/")[0], path.suffix.lower() or "[none]", size, state])
        if path.suffix.lower() in DOC_EXT and path.is_file():
            first = ""
            if path.suffix.lower() in TEXT_EXT:
                first = next((line.strip() for line in read_text(path).splitlines() if line.strip()), "")[:240]
            docs.append((p, state, size, first))
    write_csv("git-visible-files", ["path", "top_level_area", "extension", "size_bytes", "git_state"], git_rows)
    write_csv("documentation-files", ["path", "git_state", "format", "size_bytes", "first_nonempty_line"], [[p, s, Path(p).suffix.lower(), n, first] for p, s, n, first in docs])

    # Link audit over text documents, omitting fenced and inline code examples.
    unresolved: list[list[object]] = []
    local_count = external_count = text_count = 0
    markdown_link = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)|<((?:https?://)[^>]+)>", re.I)
    html_link = re.compile(r"\b(?:href|src)\s*=\s*['\"]([^'\"]+)['\"]", re.I)
    for p, _, _, _ in docs:
        path = ROOT / p
        if path.suffix.lower() not in TEXT_EXT:
            continue
        text = read_text(path)
        if not text:
            continue
        text_count += 1
        text = re.sub(r"(?ms)^\s*(```|~~~).*?^\s*\1\s*$", "", text)
        text = re.sub(r"`[^`]*`", "", text)
        targets = [m.group(1) or m.group(2) for m in markdown_link.finditer(text)] + [m.group(1) for m in html_link.finditer(text)]
        for target in targets:
            target = html.unescape(target.strip().split()[0].strip("<>").split("#", 1)[0])
            if not target or target.startswith(("#", "mailto:", "tel:", "data:", "javascript:")):
                continue
            if re.match(r"^[a-z][a-z0-9+.-]*://", target, re.I):
                external_count += 1
                continue
            if re.match(r"^[a-z]:[/\\]", target, re.I) or "${" in target or "{{" in target or "[!" in target:
                continue
            local_count += 1
            decoded = unquote(target).replace("\\", "/")
            candidate = (ROOT / decoded.lstrip("/")) if decoded.startswith("/") else (path.parent / decoded)
            if not (candidate.exists() or candidate.with_suffix(".md").exists() or (candidate / "README.md").exists()):
                unresolved.append([p, "", target])
    write_csv("unresolved-local-links", ["document", "line", "target"], unresolved)

    # Physical inventory, omitting known generated/runtime/vendor areas.
    physical: list[list[object]] = []
    area_counts: Counter[str] = Counter()
    area_bytes: Counter[str] = Counter()
    excluded: list[list[object]] = []
    empty_dirs: list[list[object]] = []
    scan_errors: list[str] = []
    for base, dirs, files in os.walk(ROOT, topdown=True, followlinks=False):
        folder = Path(base)
        if not dirs and not files and folder != ROOT:
            empty_dirs.append([rel(folder), "empty on disk; retained pending owner/purpose confirmation"])
        kept: list[str] = []
        for name in dirs:
            child = folder / name
            child_rel = rel(child)
            reason = ""
            if child_rel == OUT_REL.rstrip("/") or child_rel.startswith(OUT_REL):
                reason = "generated inventory output; prevents recursive manifests"
            elif name in SKIP_NAMES:
                reason = "vendor, runtime, build, or cache directory"
            elif name == "Python" and child_rel in SKIP_PYTHON:
                reason = "embedded Python runtime"
            if reason:
                excluded.append([child_rel, reason])
            else:
                kept.append(name)
        dirs[:] = kept
        for name in files:
            path = folder / name
            p = rel(path)
            try:
                size = path.stat().st_size
            except OSError as exc:
                scan_errors.append(f"{p}: {exc}")
                continue
            state = "tracked" if p in tracked else states.get(p, "ignored-or-local")
            physical.append([p, state, p.split("/")[0], path.suffix.lower() or "[none]", size])
            area = p.split("/")[0]
            area_counts[area] += 1
            area_bytes[area] += size
    write_csv("physical-project-files", ["path", "git_state", "top_level_area", "extension", "size_bytes"], physical)
    write_csv("physical-files-by-area", ["area", "files", "bytes"], [[a, area_counts[a], area_bytes[a]] for a in sorted(area_counts)])
    write_csv("excluded-generated-areas", ["path", "reason"], excluded + [[e, "scan error: " + e] for e in scan_errors])
    write_csv("empty-directories", ["path", "handling"], empty_dirs)

    hashes: dict[str, list[str]] = defaultdict(list)
    basenames: dict[str, list[str]] = defaultdict(list)
    for p, _, _, _ in docs:
        path = ROOT / p
        try:
            hashes[hashlib.sha256(path.read_bytes()).hexdigest()].append(p)
            basenames[path.name.casefold()].append(p)
        except OSError:
            pass
    duplicate_rows = [["exact_sha256", digest, " | ".join(paths)] for digest, paths in hashes.items() if len(paths) > 1]
    duplicate_rows += [["same_basename", name, " | ".join(paths)] for name, paths in basenames.items() if len(paths) > 1]
    write_csv("document-duplicate-candidates", ["kind", "identity", "paths"], duplicate_rows)

    branch = git("branch", "--show-current").decode().strip()
    head = git("rev-parse", "HEAD").decode().strip()
    states_count = Counter(states.get(p, "tracked") for p in git_paths)
    ext_counts = Counter(Path(p).suffix.lower() or "[none]" for p, _, _, _ in docs)
    exact_groups = sum(1 for ps in hashes.values() if len(ps) > 1)
    report = [f"# Полная инвентаризация — срез {STAMP}", "", f"Git: `{branch}` / `{head}`.", "",
              f"**Git-видимые файлы:** {len(git_paths)}; clean tracked {states_count['tracked']}; modified tracked {sum(1 for p in git_paths if p in tracked and states.get(p) == 'modified')}; staged {sum(1 for p in git_paths if states.get(p) == 'staged')}; untracked {states_count['untracked']}; общий размер {sum(int(r[3]) for r in git_rows)} bytes.", "",
              f"**Документные форматы:** {len(docs)}; текстовые документы, включённые в проверку ссылок: {text_count}.", "",
              f"**Физические файлы вне исключённых служебных зон:** {len(physical)}; общий размер {sum(int(r[4]) for r in physical)} bytes; ошибок обхода {len(scan_errors)}.", "",
              f"**Пустые каталоги:** {len(empty_dirs)}; все перечислены отдельно и сохранены без изменений.", "",
              f"**Ссылки:** {local_count} локальных путей, {external_count} внешних URL, {len(unresolved)} неразрешённых кандидатов после исключения inline code и примеров.", "",
              f"**Точные дубликаты:** {exact_groups} групп SHA-256 среди документов; удаление не выполнялось.", "",
              "## Файлы отчёта", "",
              *[f"- [`{name}-{STAMP}.csv`]({name}-{STAMP}.csv)" for name in ("git-visible-files", "documentation-files", "physical-project-files", "physical-files-by-area", "excluded-generated-areas", "empty-directories", "unresolved-local-links", "document-duplicate-candidates")], "",
              *(["Дополнительный [`local-project-files-by-area-2026-10-21.csv`](local-project-files-by-area-2026-10-21.csv) — сохранённая сводка прошлого прохода; она не создаётся этим генератором и не входит в счётчики текущего среза.", ""] if (OUT / "local-project-files-by-area-2026-10-21.csv").exists() else []),
              "Сканер не запускает тесты, сборки и продуктовую диагностику. Из manifest исключена только эта папка результатов; причины исключения служебных зон указаны в CSV. Дубликаты — кандидаты на ручное разбирательство, не разрешение на удаление.", ""]
    (OUT / "README.md").write_text("\n".join(report), encoding="utf-8")
    print(f"git={len(git_paths)} docs={len(docs)} text_docs={text_count} physical={len(physical)} empty_dirs={len(empty_dirs)} links={local_count}+{external_count} unresolved={len(unresolved)} exact_duplicate_groups={exact_groups} scan_errors={len(scan_errors)}")


if __name__ == "__main__":
    main()
