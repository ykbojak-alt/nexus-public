#!/usr/bin/env python3
"""
tools/nexus_core/presets.py — spawn-пресеты (W11).

Тоньше HERETIC templates и шире programs.json (#551b): preset =
именованная спека запуска {command, cwd?, env?, labels?, detect?}
для POST /api/core/spawn-preset. programs — голые launcher'ы;
presets — готовые рабочие места (cwd+env+labels+argv).

Формат tools/nexus_core/presets.json:
    {"version": 1, "presets": [
        {"id": "nexus-tests", "title": "NEXUS core tests",
         "command": ["python", "-m", "pytest", "tools/nexus_core", "-x"],
         "cwd": "<REPO_ROOT>", "env": {"PYTHONUTF8": "1"},
         "labels": {"kind": "test"},
         "detect": {"exe": "python"}}
    ]}

- Файл читается на КАЖДЫЙ GET/spawn (hot-edit).
- detect — та же семантика, что у programs (exe→which, where→
  exists/which); available=false → spawn-preset отвечает 409.
- Битые записи пропускаются; битый файл → [] (не 500).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from tools.nexus_core.programs import _detect_one, _valid_id

DEFAULT_PRESETS_PATH = Path(__file__).resolve().parent / "presets.json"


def _str_dict(value) -> Optional[dict]:
    """dict[str,str] или None если не строковая карта."""
    if value is None:
        return None
    if not isinstance(value, dict):
        return {}
    out = {}
    for k, v in value.items():
        if isinstance(k, str) and isinstance(v, str):
            out[k] = v
    return out


def _normalize(entry) -> Optional[dict]:
    """entry → контракт API или None (битая запись пропускается)."""
    if not isinstance(entry, dict):
        return None
    pid = entry.get("id")
    command = entry.get("command", entry.get("cmd"))
    if not _valid_id(pid):
        return None
    if (not isinstance(command, list) or not command
            or not all(isinstance(c, str) and c for c in command)):
        return None
    title = entry.get("title")
    if title is not None and not isinstance(title, str):
        return None
    cwd = entry.get("cwd")
    if cwd is not None and not isinstance(cwd, str):
        return None
    env = _str_dict(entry.get("env"))
    if env == {} and entry.get("env") is not None:
        return None  # env задан, но не строковая карта → битая запись
    labels = _str_dict(entry.get("labels"))
    if labels == {} and entry.get("labels") is not None:
        return None
    detect = entry.get("detect")
    if detect is not None and not isinstance(detect, dict):
        return None
    available, resolved = _detect_one(detect or {})
    out = {
        "id": pid,
        "title": title if isinstance(title, str) and title else pid,
        "command": [str(c) for c in command],
        "available": available,
        "resolved": resolved,
    }
    if isinstance(cwd, str) and cwd:
        out["cwd"] = cwd
    if env:
        out["env"] = env
    if labels:
        out["labels"] = labels
    if isinstance(detect, dict) and detect:
        out["detect"] = dict(detect)
    return out


def load_presets(path: Optional[Path] = None) -> list[dict]:
    """Читает presets.json → нормализованный список (hot-edit).

    Файл отсутствует/битый → [] — пресеты опциональны, отсутствие
    не должно ломать API."""
    p = Path(path) if path is not None else DEFAULT_PRESETS_PATH
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return []
    rows = data.get("presets") if isinstance(data, dict) else data
    if not isinstance(rows, list):
        return []
    out = []
    for entry in rows:
        norm = _normalize(entry)
        if norm is not None:
            out.append(norm)
    return out
