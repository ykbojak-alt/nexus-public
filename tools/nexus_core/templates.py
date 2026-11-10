#!/usr/bin/env python3
"""
tools/nexus_core/templates.py — .md-персоны (N2, templates).

Контракт (NEXUS_CORE_SPEC.md §0a.4): `.md`-файлы в каталоге шаблонов
(по умолчанию `~/.config/nexus-core/templates`, переопределяется
`NX_TEMPLATES_DIR`). Каждый файл — персона: шапка (front-matter) задаёт
команду запуска и флаги адаптера, тело файла — инструкция агенту.

Ожидаемый формат (парсится лениво, без строгих требований):

    ---
    command: claude
    model: sonnet
    thinking: high
    ---
    <тело: инструкция персоны>

`nx templates` перечисляет шаблоны; `argv[0]=template` запускает команду
шаблона и шлёт тело + остаток argv как первое сообщение агенту.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

DEFAULT_TEMPLATES_DIR_NAME = "templates"
DEFAULT_CONFIG_DIR_NAME = "nexus-core"


def default_templates_dir() -> Path:
    """Каталог шаблонов по умолчанию (~/.config/nexus-core/templates)."""
    env = os.environ.get("NX_TEMPLATES_DIR")
    if env:
        return Path(env).expanduser()
    xdg = os.environ.get("XDG_CONFIG_HOME")
    if xdg:
        base = Path(xdg)
    else:
        base = Path.home() / ".config"
    return base / DEFAULT_CONFIG_DIR_NAME / DEFAULT_TEMPLATES_DIR_NAME


_FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.DOTALL)


_VAR_RE = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")


@dataclass
class Template:
    """Шаблон-персона: метаданные + тело инструкции."""

    name: str
    path: Path
    command: list[str] = field(default_factory=list)
    body: str = ""
    meta: dict = field(default_factory=dict)

    @property
    def exists(self) -> bool:
        return self.path.exists()

    @property
    def params(self) -> list[str]:
        """W59: объявленные плейсхолдеры из front-matter
        `params: a, b, c` (csv). Пусто — шаблон без параметров."""
        raw = self.meta.get("params", "")
        return [p.strip() for p in str(raw).split(",")
                if p.strip()]

    def placeholders(self, text: str) -> set[str]:
        """W59: имена {var} в тексте."""
        return set(_VAR_RE.findall(text or ""))

    def render(self, variables: Optional[dict] = None) -> tuple[list[str], str]:
        """W59: подстановка {var} в command и body.

        vars: {имя: скаляр}. Отсутствующий плейсхолдер остаётся
        литералом `{name}` — шаблон сам решает, что с ним делать.
        """
        vars_ = {str(k): str(v) for k, v in (variables or {}).items()}

        def sub(text: str) -> str:
            return _VAR_RE.sub(
                lambda m: vars_.get(m.group(1), m.group(0)), text)

        return ([sub(c) for c in self.command], sub(self.body))

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "path": str(self.path),
            "command": list(self.command),
            "body": self.body,
            "meta": dict(self.meta),
            "params": self.params,
        }


def _parse_frontmatter(text: str) -> tuple[dict, str]:
    """Разбирает YAML-подобную шапку (lazy: key: value строки)."""
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    meta: dict = {}
    for line in m.group(1).splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip().lower()
        value = value.strip().strip('"').strip("'")
        if key:
            meta[key] = value
    return meta, text[m.end():]


class TemplateStore:
    """Каталог шаблонов .md."""

    def __init__(self, directory: Optional[Path] = None) -> None:
        self.directory = Path(directory) if directory is not None else default_templates_dir()

    def list_templates(self) -> list[Template]:
        if not self.directory.is_dir():
            return []
        out = []
        for path in sorted(self.directory.glob("*.md")):
            out.append(self._load(path))
        return out

    def get(self, name: str) -> Optional[Template]:
        path = (self.directory / name).with_suffix(".md")
        if not path.is_file():
            path = self.directory / f"{name}.md"
            if not path.is_file():
                return None
        return self._load(path)

    def _load(self, path: Path) -> Template:
        try:
            text = path.read_text(encoding="utf-8")
        except Exception:
            text = ""
        meta, body = _parse_frontmatter(text)
        command = []
        if meta.get("command"):
            command = meta["command"].split()
        return Template(
            name=path.stem,
            path=path,
            command=command,
            body=body.rstrip("\n"),
            meta=meta,
        )
