#!/usr/bin/env python3
"""tools/nexus_core/alert_rules.py — W26 alert rules.

rules.json hot-edit: файл перечитывается при изменении mtime
(stat на каждый вызов — дёшево; read только при смене).

Формат rules.json:
    {"rules": [
        {"id": "...", "pattern": "regex", "action": "notify|label|kill",
         "enabled": true,
         "once": false,               # сработать 1 раз на term+rule
         "label_key": "...",          # для action=label
         "label_value": "...",
         "url": "http://..."}         # для action=notify → webhook
    ]}

Битые записи пропускаются (нет pattern/action, bad regex, bad action).
Отсутствующий/битый файл → [] (не 500).
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Optional

DEFAULT_RULES_PATH = Path(__file__).with_name("alert_rules.json")

VALID_ACTIONS = frozenset({"notify", "label", "kill"})
_CACHE: dict = {"mtime": None, "rules": [], "errors": []}


def _normalize_err(raw, idx: int) -> tuple[Optional[dict], Optional[dict]]:
    """W46: normalize + причина отказа → (rule|None, error|None)."""
    if not isinstance(raw, dict):
        return None, {"index": idx, "reason": "not an object"}
    pattern = raw.get("pattern")
    action = raw.get("action", "notify")
    if not isinstance(pattern, str) or not pattern:
        return None, {"index": idx,
                      "reason": "pattern missing/not string"}
    if action not in VALID_ACTIONS:
        return None, {"index": idx,
                      "reason": f"bad action {action!r} "
                                f"(valid: {sorted(VALID_ACTIONS)})"}
    try:
        re.compile(pattern)
    except re.error as exc:
        return None, {"index": idx,
                      "reason": f"bad regex: {exc}"}
    rid = raw.get("id")
    if not isinstance(rid, str) or not rid:
        rid = f"rule-{abs(hash(pattern)) % 10**8}"
    rule = {
        "id": rid,
        "pattern": pattern,
        "action": action,
        "enabled": bool(raw.get("enabled", True)),
        "once": bool(raw.get("once", False)),
    }
    if action == "label":
        lk = raw.get("label_key")
        if not isinstance(lk, str) or not lk:
            return None, {"index": idx,
                          "reason": "label action needs label_key"}
        rule["label_key"] = lk
        lv = raw.get("label_value", "1")
        rule["label_value"] = str(lv)
    if action == "notify":
        url = raw.get("url")
        if isinstance(url, str) and url.strip():
            rule["url"] = url.strip()
    return rule, None


def _normalize(raw: dict) -> Optional[dict]:
    return _normalize_err(raw, 0)[0]


def load_rules(path: Optional[os.PathLike] = None) -> list[dict]:
    """Возвращает нормализованные правила; кэш по mtime файла."""
    p = Path(path) if path is not None else DEFAULT_RULES_PATH
    try:
        mtime = p.stat().st_mtime
    except OSError:
        _CACHE["mtime"] = None
        _CACHE["rules"] = []
        _CACHE["errors"] = []
        return []
    if _CACHE["mtime"] == mtime and _CACHE.get("_path") == str(p):
        return list(_CACHE["rules"])
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        data = None
    rules_raw = data.get("rules") if isinstance(data, dict) else None
    if not isinstance(rules_raw, list):
        rules_raw = []
    pairs = [_normalize_err(x, i) for i, x in enumerate(rules_raw)]
    rules = [r for r, _ in pairs if r]
    errors = [e for _, e in pairs if e]
    _CACHE.update({"mtime": mtime, "rules": rules,
                   "errors": errors, "_path": str(p)})
    return list(rules)


def load_rules_detailed(
        path: Optional[os.PathLike] = None) -> dict:
    """W46: {rules, errors, count} — ошибки парсинга видны,
    а не молча проглочены. Кэш общий с load_rules."""
    rules = load_rules(path)
    return {"rules": rules, "count": len(rules),
            "errors": list(_CACHE.get("errors", []))}


def reset_cache() -> None:
    """Для тестов: сброс кэша."""
    _CACHE.update({"mtime": None, "rules": [], "errors": [],
                   "_path": None})
