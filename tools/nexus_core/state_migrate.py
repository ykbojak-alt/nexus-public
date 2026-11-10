#!/usr/bin/env python3
"""tools/nexus_core/state_migrate.py — W68 state-dir migration tool.

Апгрейд старого state-dir в текущую схему БЕЗ запуска core:

- registry.json: v0 bare-list / v1 dict / v2 → читается, прогоняется
  через REGISTRY_MIGRATIONS до REGISTRY_SCHEMA_VERSION, пишется
  {"v":2,"rows":…} (+sig если задан NEXUS_REGISTRY_KEY — ре- подписываем).
- machines.json / spaces.json / pipes.json — копируются как есть
  (свои загрузчики толерантны; битые → warning, не fatal).
- scripts/, workspaces/ — каталоги копируются рекурсивно.
- files/ — только с copy_files=True (может быть большим).

Использование:
    python -m tools.nexus_core.state_migrate <src_dir> <dst_dir>
        [--copy-files]

Или из api: POST /api/core/state/migrate {src, dst?, copy_files?}
(dst по умолчанию <src>-migrated).
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

from tools.nexus_core.signed_json import REGISTRY_KEY_ENV  # noqa: F401
from tools.nexus_core.supervisor_v1 import (
    REGISTRY_MIGRATIONS, REGISTRY_SCHEMA_VERSION, _registry_sig)

_COPY_FILES = ("machines.json", "spaces.json", "pipes.json",
               "alert_rules.json", "gate-policy.json")
_COPY_DIRS = ("scripts", "workspaces")


def _read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def migrate_registry(src: Path, dst: Path) -> dict:
    """registry.json src → dst в текущей схеме. Возвращает info."""
    src_path = src / "registry.json"
    dst_path = dst / "registry.json"
    if not src_path.is_file():
        return {"file": "registry.json", "action": "absent"}
    data = _read_json(src_path)
    if data is None:
        return {"file": "registry.json", "action": "skipped",
                "warning": "unreadable/corrupt — not copied"}
    rows = None
    sig = None
    schema_v = 0
    if isinstance(data, dict):
        rows = data.get("rows")
        sig = data.get("sig")
        schema_v = data.get("v")
        if not isinstance(rows, list):
            return {"file": "registry.json", "action": "skipped",
                    "warning": "dict without rows list"}
        if not isinstance(schema_v, int):
            schema_v = 1
    elif isinstance(data, list):
        rows = data
    else:
        return {"file": "registry.json", "action": "skipped",
                "warning": "unexpected top-level type"}
    if schema_v > REGISTRY_SCHEMA_VERSION:
        return {"file": "registry.json", "action": "refused",
                "warning": f"schema v{schema_v} > supported "
                           f"v{REGISTRY_SCHEMA_VERSION}"}
    for target in sorted(REGISTRY_MIGRATIONS):
        if schema_v < target <= REGISTRY_SCHEMA_VERSION:
            rows = REGISTRY_MIGRATIONS[target](rows)
    key = os.environ.get(REGISTRY_KEY_ENV) or None
    payload = {"v": REGISTRY_SCHEMA_VERSION, "rows": rows}
    if key is not None:
        payload["sig"] = _registry_sig(rows, key)
    elif sig is not None:
        # исходник был подписан, ключа нет → sig теряется,
        # фиксируем в отчёте (не подделываем)
        payload["_note"] = "source was signed; NEXUS_REGISTRY_KEY " \
                           "unset — signature dropped"
    dst_path.write_text(json.dumps(payload, ensure_ascii=False,
                                   indent=2), encoding="utf-8")
    return {"file": "registry.json",
            "action": "migrated" if schema_v <
            REGISTRY_SCHEMA_VERSION else "copied",
            "from_v": schema_v, "to_v": REGISTRY_SCHEMA_VERSION,
            "rows": len(rows), "signed": key is not None}


def migrate_state(src: str | Path, dst: str | Path,
                  copy_files: bool = False) -> dict:
    """Полная миграция state-dir src → dst (создаёт dst)."""
    src, dst = Path(src), Path(dst)
    if not src.is_dir():
        raise FileNotFoundError(f"src not a directory: {src}")
    dst.mkdir(parents=True, exist_ok=True)
    report = {"src": str(src), "dst": str(dst), "files": [],
              "warnings": []}
    info = migrate_registry(src, dst)
    report["files"].append(info)
    if info.get("warning"):
        report["warnings"].append(info["warning"])
    for name in _COPY_FILES:
        s = src / name
        if s.is_file():
            shutil.copy2(s, dst / name)
            report["files"].append({"file": name, "action": "copied"})
    for dname in _COPY_DIRS:
        s = src / dname
        if s.is_dir():
            shutil.copytree(s, dst / dname, dirs_exist_ok=True)
            report["files"].append({"file": dname + "/",
                                    "action": "copied"})
    if copy_files:
        s = src / "files"
        if s.is_dir():
            shutil.copytree(s, dst / "files", dirs_exist_ok=True)
            report["files"].append({"file": "files/",
                                    "action": "copied"})
    report["ok"] = not any(f.get("action") == "refused"
                           for f in report["files"])
    return report


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="state_migrate",
        description="NEXUS core state-dir schema migration (W68)")
    ap.add_argument("src", help="source state dir")
    ap.add_argument("dst", help="destination state dir")
    ap.add_argument("--copy-files", action="store_true",
                    help="also copy files/ payload dir")
    args = ap.parse_args(argv)
    try:
        report = migrate_state(args.src, args.dst,
                               copy_files=args.copy_files)
    except FileNotFoundError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
