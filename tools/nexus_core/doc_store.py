#!/usr/bin/env python3
"""
tools/nexus_core/doc_store.py — версионируемый документ ядра (N2, doc API).

Контракт (NEXUS_CORE_SPEC.md §0a.3): layout-док машины живёт в ядре,
версии монотонно инкрементятся. Хранилище — json-файл `doc.json`:
    {
      "latest": 3,
      "versions": {
        "1": {"content": "...", "created_at": 123.0},
        ...
      }
    }

Доступ синхронный (используется и API-слоем, и CLI). Запись атомарная
(tmp → replace), чтобы не портить файл при обрыве.
"""

from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Optional

DOC_FILE_NAME = "doc.json"


class DocConflictError(Exception):
    """CAS-конфликт: base_version не совпадает с текущей latest (RFC §16)."""


class DocStore:
    """Версионируемый документ: put() → новая версия, get()/latest()."""

    def __init__(self, base: Path) -> None:
        self.path = Path(base) / DOC_FILE_NAME
        self._data: dict = {"latest": 0, "versions": {}}
        self._load()

    # ------------------------------------------------------------------
    # Внутреннее состояние
    # ------------------------------------------------------------------

    def _load(self) -> None:
        if not self.path.exists():
            return
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            raw = None
        if not isinstance(raw, dict):
            return
        latest = raw.get("latest", 0)
        versions = raw.get("versions", {})
        if not isinstance(latest, int) or not isinstance(versions, dict):
            return
        self._data = {"latest": latest, "versions": versions}

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        text = json.dumps(self._data, ensure_ascii=False, indent=2)
        fd, tmp = tempfile.mkstemp(
            dir=str(self.path.parent), prefix="doc-", suffix=".tmp"
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(text)
            os.replace(tmp, self.path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

    # ------------------------------------------------------------------
    # API
    # ------------------------------------------------------------------

    def put(self, content: str, base_version: Optional[int] = None) -> int:
        """Сохраняет новую версию; возвращает монотонный version.

        CAS: при заданном base_version, отличном от текущей latest,
        кидает DocConflictError (запись отклоняется, RFC §16).
        """
        if base_version is not None:
            if (
                isinstance(base_version, bool)
                or not isinstance(base_version, int)
                or base_version != self._data["latest"]
            ):
                raise DocConflictError(
                    f"version conflict: expected {base_version}, current {self._data['latest']}"
                )
        self._data["latest"] += 1
        version = self._data["latest"]
        self._data["versions"][str(version)] = {
            "content": content,
            "created_at": time.time(),
        }
        self._save()
        return version

    def get(self, version: Optional[int] = None) -> Optional[dict]:
        """Возвращает {version, content, created_at} или None."""
        if version is None:
            version = self._data["latest"]
        entry = self._data["versions"].get(str(version))
        if entry is None:
            return None
        return {
            "version": version,
            "content": entry.get("content", ""),
            "created_at": entry.get("created_at"),
        }

    def latest(self) -> Optional[dict]:
        if self._data["latest"] == 0:
            return None
        return self.get(self._data["latest"])

    @property
    def version(self) -> int:
        return self._data["latest"]

    def versions(self) -> list[int]:
        return sorted(int(v) for v in self._data["versions"])
