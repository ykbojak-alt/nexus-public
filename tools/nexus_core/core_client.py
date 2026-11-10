#!/usr/bin/env python3
"""
tools/nexus_core/core_client.py — thin HTTP/SSE-клиент nx CLI → core API.

Заменяет in-process SupervisorV1 в cli.py (#515, P0.1): nx — зеркало hc,
hc говорит с живым core по сокету; nx говорит с core по HTTP/SSE.

Env:
    NEXUS_CORE_URL       — базовый URL ядра (default http://127.0.0.1:5684;
                           ops-инстанс NEWF/AEGIS; spec-порт :5684 — для
                           чистого dev-демона).
    NEXUS_CORE_TOKEN     — mutating-токен → заголовок X-Nexus-Key.
    NEXUS_CORE_READ_TOKEN— read-токен (используется, если core-token не задан).

Ошибки:
    CoreOffline — core недоступен («core not running: nx serve»).
    CoreError   — HTTP-ошибка ядра (status + {"error": msg}).
    CoreTimeout — запрос превысил таймаут.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Iterator, Optional

ENV_URL = "NEXUS_CORE_URL"
ENV_TOKEN = "NEXUS_CORE_TOKEN"
ENV_READ_TOKEN = "NEXUS_CORE_READ_TOKEN"
DEFAULT_URL = "http://127.0.0.1:5684"

DEFAULT_TIMEOUT_S = 30.0
SSE_ACCEPT = "text/event-stream"


class CoreOffline(Exception):
    """Ядро не отвечает (connection refused и т.п.)."""


class CoreError(Exception):
    """HTTP-ошибка ядра: status + сообщение из {"error": ...}."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


class CoreTimeout(Exception):
    """Запрос превысил таймаут."""


def base_url() -> str:
    return (os.environ.get(ENV_URL) or DEFAULT_URL).rstrip("/")


def api_key() -> str:
    """X-Nexus-Key: core-token предпочтительнее (он проходит и read-gate)."""
    return (os.environ.get(ENV_TOKEN)
            or os.environ.get(ENV_READ_TOKEN) or "")


def _offline_hint() -> str:
    return (f"core not running: nx serve "
            f"(NEXUS_CORE_URL={base_url()})")


def _http_error_message(exc: urllib.error.HTTPError) -> str:
    """{"error": msg} → msg; {"error": kind, "message": msg} → message
    (remote-ошибки ssh_ops отдают kind в error — человеку нужно message)."""
    try:
        body = json.loads(exc.read().decode("utf-8"))
    except Exception:
        return str(exc)
    if isinstance(body, dict):
        return str(body.get("message") or body.get("error") or exc)
    return str(exc)


def _request(
    method: str,
    path: str,
    payload: Optional[dict] = None,
    params: Optional[dict] = None,
    timeout: float = DEFAULT_TIMEOUT_S,
) -> dict:
    """Один HTTP-запрос к core API → parsed JSON ({} для пустого тела)."""
    url = base_url() + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    headers = {}
    key = api_key()
    if key:
        headers["X-Nexus-Key"] = key
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers,
                                 method=method.upper())
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
    except urllib.error.HTTPError as exc:
        raise CoreError(exc.code, _http_error_message(exc))
    except TimeoutError as exc:
        raise CoreTimeout(f"{method} {path}: {exc}")
    except (urllib.error.URLError, ConnectionError, OSError) as exc:
        raise CoreOffline(f"{_offline_hint()} — {exc}")
    if not body:
        return {}
    try:
        return json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CoreError(0, f"invalid JSON from core: {exc}")


def api_get(path: str, params: Optional[dict] = None,
            timeout: float = DEFAULT_TIMEOUT_S) -> dict:
    return _request("GET", path, params=params, timeout=timeout)


def api_post(path: str, payload: Optional[dict] = None,
             timeout: float = DEFAULT_TIMEOUT_S) -> dict:
    return _request("POST", path, payload=payload or {}, timeout=timeout)


def api_put(path: str, payload: Optional[dict] = None,
            timeout: float = DEFAULT_TIMEOUT_S) -> dict:
    return _request("PUT", path, payload=payload or {}, timeout=timeout)


def api_delete(path: str, timeout: float = DEFAULT_TIMEOUT_S) -> dict:
    return _request("DELETE", path, timeout=timeout)


def sse_events(path: str = "/api/core/events",
               timeout: Optional[float] = None) -> Iterator[dict]:
    """Читает SSE-поток ядра → по одному event-dict на JSON-событие.

    Парсит `data:`-фреймы (ядро шлёт `event:`+`data:` без `id:` —
    resume по Last-Event-ID не поддерживается, как и у NEWF-клиента).
    Обрыв соединения завершает итератор — вызывающий решает про reconnect.
    """
    url = base_url() + path
    headers = {"Accept": SSE_ACCEPT}
    key = api_key()
    if key:
        headers["X-Nexus-Key"] = key
    req = urllib.request.Request(url, headers=headers)
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as exc:
        raise CoreError(exc.code, _http_error_message(exc))
    except TimeoutError as exc:
        raise CoreTimeout(f"GET {path}: {exc}")
    except (urllib.error.URLError, ConnectionError, OSError) as exc:
        raise CoreOffline(f"{_offline_hint()} — {exc}")
    data_lines: list[str] = []
    try:
        for raw in resp:
            line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
            if line == "":
                if data_lines:
                    payload = "\n".join(data_lines)
                    data_lines = []
                    try:
                        yield json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                continue
            if line.startswith(":"):
                continue  # heartbeat/comment
            if line.startswith("data:"):
                data_lines.append(line[5:].strip())
            # event:/id: — игнорируем (данные несёт data:)
    finally:
        try:
            resp.close()
        except Exception:
            pass
