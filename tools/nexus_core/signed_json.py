#!/usr/bin/env python3
"""
tools/nexus_core/signed_json.py — общий HMAC-помощник для подписанных
JSON-реестров (HERETIC #419: machines.json был без integrity, пока
registry.json уже подписывался).

Схема идентична supervisor_v1 registry: HMAC-SHA256(hex) от canonical
JSON списка строк (sort_keys, separators=(",",":"), ensure_ascii=False,
utf-8) по ключу NEXUS_REGISTRY_KEY. env NEXUS_REGISTRY_REQUIRE_SIG=1 —
fail-closed opt-in: подписанное/legacy состояние без ключа не грузится.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os

REGISTRY_KEY_ENV = "NEXUS_REGISTRY_KEY"
REQUIRE_SIG_ENV = "NEXUS_REGISTRY_REQUIRE_SIG"

_REQUIRE_SIG_VALUES = ("1", "true", "yes", "on")


def canonical_rows(rows) -> bytes:
    """Каноническая сериализация списка записей для подписи."""
    return json.dumps(rows, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":")).encode("utf-8")


def sign_rows(rows, key: str) -> str:
    """HMAC-SHA256 hex подпись canonical(rows) ключом key."""
    return hmac.new(key.encode("utf-8"), canonical_rows(rows),
                    hashlib.sha256).hexdigest()


def signature_valid(rows, sig, key: str) -> bool:
    """timing-safe проверка подписи."""
    return hmac.compare_digest(str(sig), sign_rows(rows, key))


def registry_key() -> str | None:
    return os.environ.get(REGISTRY_KEY_ENV) or None


def require_sig() -> bool:
    """NEXUS_REGISTRY_REQUIRE_SIG truthy → integrity обязательна."""
    return os.environ.get(REQUIRE_SIG_ENV, "").strip().lower() in (
        _REQUIRE_SIG_VALUES)
