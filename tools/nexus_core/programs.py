#!/usr/bin/env python3
"""
tools/nexus_core/programs.py — programs-реестр launcher'ов (#551b).

Herdr programs.json-аналог: JSON-файл с описанием «программ», которые
UI может спавнить одной кнопкой через POST /api/core/run {command: cmd}.

Формат tools/nexus_core/programs.json:
    {"version": 1, "programs": [
        {"id": "claude", "title": "Claude Code",
         "cmd": ["claude"], "cwd": "<REPO_ROOT>",          # cwd опционален
         "detect": {"exe": "claude", "where": "..."}}   # detect опционален
    ]}

- Файл читается на КАЖДЫЙ GET (hot-edit): правки подхватываются без
  рестарта демона.
- `detect.exe` — shutil.which(name); `detect.where` — путь существует
  (абсолютный) или which-резолв (если не путь). `available` = все
  заданные проверки прошли; без detect → available=true + resolved=null
  (запускаемость не проверить — не наша забота).
- Битые записи (нет id/cmd, плохие типы) пропускаются — реестр не
  должен ронять весь список из-за одной строки.
"""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from typing import Optional

DEFAULT_PROGRAMS_PATH = Path(__file__).resolve().parent / "programs.json"

# id — как у терминалов/машин, но с точкой разрешена (git-bash и т.п.)
_ID_CHARS = set("abcdefghijklmnopqrstuvwxyz0123456789._-")


def _valid_id(value) -> bool:
    return (isinstance(value, str) and 1 <= len(value) <= 40
            and value[0] not in ".-" and set(value) <= _ID_CHARS)


def _detect_one(detect: dict) -> tuple[bool, Optional[str]]:
    """(ok, resolved). exe→which; where→exists/which. Пустой detect→(True,None)."""
    if not isinstance(detect, dict) or not detect:
        return True, None
    resolved = None
    exe = detect.get("exe")
    if isinstance(exe, str) and exe.strip():
        found = shutil.which(exe.strip())
        if not found:
            return False, None
        resolved = found
    where = detect.get("where")
    if isinstance(where, str) and where.strip():
        w = where.strip()
        if os.path.isabs(w) or os.sep in w or "/" in w or "\\" in w:
            ok = Path(os.path.expandvars(w)).exists()
            if not ok:
                return False, None
            resolved = resolved or w
        else:
            found = shutil.which(w)
            if not found:
                return False, None
            resolved = resolved or found
    return True, resolved


def _normalize(entry) -> Optional[dict]:
    """entry → контракт API или None (битая запись пропускается)."""
    if not isinstance(entry, dict):
        return None
    pid = entry.get("id")
    cmd = entry.get("cmd")
    if not _valid_id(pid):
        return None
    if (not isinstance(cmd, list) or not cmd
            or not all(isinstance(c, str) and c for c in cmd)):
        return None
    title = entry.get("title")
    if title is not None and not isinstance(title, str):
        return None
    cwd = entry.get("cwd")
    if cwd is not None and not isinstance(cwd, str):
        return None
    detect = entry.get("detect")
    if detect is not None and not isinstance(detect, dict):
        return None
    available, resolved = _detect_one(detect or {})
    out = {
        "id": pid,
        "title": title if isinstance(title, str) and title else pid,
        "cmd": [str(c) for c in cmd],
        "available": available,
        "resolved": resolved,
    }
    if isinstance(cwd, str) and cwd:
        out["cwd"] = cwd
    if isinstance(detect, dict) and detect:
        out["detect"] = dict(detect)
    return out


def load_programs(path: Optional[Path] = None) -> list[dict]:
    """Читает programs.json и отдаёт нормализованный список.

    Файл отсутствует/битый → [] (GET отдаст пустой список, не 500 —
    programs опциональная фича, её отсутствие не должно ломать API).
    """
    p = Path(path) if path is not None else DEFAULT_PROGRAMS_PATH
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return []
    rows = data.get("programs") if isinstance(data, dict) else data
    if not isinstance(rows, list):
        return []
    out = []
    for entry in rows:
        norm = _normalize(entry)
        if norm is not None:
            out.append(norm)
    return out
