#!/usr/bin/env python3
"""
tools/nexus_core/test_n7_core_authz.py — core authz + SSE hardening (HERETIC
#406→#407, #414, #411-fold).

Матрица:
- dev-режим (нет токенов): mutating открыты на loopback-bind.
- NEXUS_CORE_TOKEN: non-GET под /api/core/* требует X-Nexus-Key;
  reads открыты; /api/core/events — sensitive read (core token принимается).
- NEXUS_CORE_READ_TOKEN: GET под /api/core/* требует read-key.
- AEGIS-семейство (proposals/approvals/policy/ratings-score) exempt —
  собственный authZ (503 admin-disabled доказывает проход middleware).
- non-loopback bind без токена: middleware → 503; run_server → SystemExit.
- SSE: etype sanitize (CRLF-инъекция), subscriber cap → 503.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

os.environ.setdefault("CORE_MOCK", "1")

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop  # noqa: E402

from tools.nexus_core import events as events_mod  # noqa: E402
from tools.nexus_core.api import create_app, run_server  # noqa: E402
from tools.nexus_core.events import SupervisorEventStream  # noqa: E402
from tools.nexus_core.mock_pty import MockPTYBackend  # noqa: E402
from tools.nexus_core.supervisor_v1 import SupervisorV1  # noqa: E402

_ENV_VARS = ("NEXUS_CORE_TOKEN", "NEXUS_CORE_READ_TOKEN")


def _clean_env():
    return {k: os.environ.pop(k, None) for k in _ENV_VARS}


def _restore_env(saved):
    for k, v in saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


def make_temp_base() -> Path:
    return Path(tempfile.mkdtemp(prefix="nexus-authz-"))


class AuthzCase(AioHTTPTestCase):
    bind_host = "127.0.0.1"

    def setUp(self):
        self._saved_env = _clean_env()
        self.tmp = make_temp_base()
        self.backend = MockPTYBackend()
        self.supervisor = SupervisorV1(backend=self.backend)
        super().setUp()

    def tearDown(self):
        super().tearDown()
        _restore_env(self._saved_env)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.tmp, supervisor=self.supervisor,
                          host=self.bind_host)

    async def post_kill(self, key=None):
        headers = {"X-Nexus-Key": key} if key is not None else {}
        return await self.client.post(
            "/api/core/kill", json={"term": "ghost-term"}, headers=headers)


# ---------------------------------------------------------------------------
# dev-режим: без токенов mutating открыты на loopback
# ---------------------------------------------------------------------------
class DevModeOpenTest(AuthzCase):
    @unittest_run_loop
    async def test_mutating_open_without_token(self):
        resp = await self.post_kill()
        # middleware пропустил → handler ответил 404 (term не найден),
        # а не 401/503 от authz.
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_reads_open_without_token(self):
        resp = await self.client.get("/api/core/terminals")
        self.assertEqual(resp.status, 200)


# ---------------------------------------------------------------------------
# NEXUS_CORE_TOKEN: mutating gated, reads открыты
# ---------------------------------------------------------------------------
class CoreTokenTest(AuthzCase):
    def setUp(self):
        super().setUp()
        os.environ["NEXUS_CORE_TOKEN"] = "tok-core-1"

    @unittest_run_loop
    async def test_mutating_no_key_401(self):
        resp = await self.post_kill()
        self.assertEqual(resp.status, 401)

    @unittest_run_loop
    async def test_mutating_wrong_key_401(self):
        resp = await self.post_kill(key="wrong")
        self.assertEqual(resp.status, 401)

    @unittest_run_loop
    async def test_mutating_right_key_reaches_handler(self):
        resp = await self.post_kill(key="tok-core-1")
        self.assertEqual(resp.status, 404)  # handler: term not found

    @unittest_run_loop
    async def test_reads_stay_open(self):
        resp = await self.client.get("/api/core/terminals")
        self.assertEqual(resp.status, 200)

    @unittest_run_loop
    async def test_events_gated_by_core_token(self):
        # sensitive read: core token задан → events требует ключ
        resp = await self.client.get("/api/core/events")
        self.assertEqual(resp.status, 401)
        resp = await self.client.get(
            "/api/core/events", headers={"X-Nexus-Key": "tok-core-1"})
        self.assertEqual(resp.status, 200)
        await resp.release()


# ---------------------------------------------------------------------------
# NEXUS_CORE_READ_TOKEN: reads gated, mutating по core token
# ---------------------------------------------------------------------------
class ReadTokenTest(AuthzCase):
    def setUp(self):
        super().setUp()
        os.environ["NEXUS_CORE_TOKEN"] = "tok-core-1"
        os.environ["NEXUS_CORE_READ_TOKEN"] = "tok-read-1"

    @unittest_run_loop
    async def test_reads_no_key_401(self):
        resp = await self.client.get("/api/core/terminals")
        self.assertEqual(resp.status, 401)

    @unittest_run_loop
    async def test_reads_wrong_key_401(self):
        resp = await self.client.get(
            "/api/core/terminals", headers={"X-Nexus-Key": "tok-core-1"})
        # core token НЕ принимается для обычных reads — только read token
        self.assertEqual(resp.status, 401)

    @unittest_run_loop
    async def test_reads_read_key_200(self):
        resp = await self.client.get(
            "/api/core/terminals", headers={"X-Nexus-Key": "tok-read-1"})
        self.assertEqual(resp.status, 200)

    @unittest_run_loop
    async def test_events_accepts_either_token(self):
        resp = await self.client.get(
            "/api/core/events", headers={"X-Nexus-Key": "tok-read-1"})
        self.assertEqual(resp.status, 200)
        await resp.release()
        resp = await self.client.get(
            "/api/core/events", headers={"X-Nexus-Key": "tok-core-1"})
        self.assertEqual(resp.status, 200)
        await resp.release()

    @unittest_run_loop
    async def test_mutating_still_core_token(self):
        resp = await self.post_kill(key="tok-read-1")
        self.assertEqual(resp.status, 401)  # read token не открывает writes
        resp = await self.post_kill(key="tok-core-1")
        self.assertEqual(resp.status, 404)


# ---------------------------------------------------------------------------
# AEGIS-семейство exempt: собственный authZ (503 ≠ middleware 401)
# ---------------------------------------------------------------------------
class AegisExemptTest(AuthzCase):
    def setUp(self):
        super().setUp()
        os.environ["NEXUS_CORE_TOKEN"] = "tok-core-1"

    @unittest_run_loop
    async def test_policy_post_reaches_aegis_guard(self):
        # без AEGIS_ADMIN_TOKEN handler сам отвечает 503 disabled —
        # middleware (401 X-Nexus-Key) НЕ сработал.
        resp = await self.client.post("/api/core/policy", json={})
        self.assertEqual(resp.status, 503)
        body = await resp.json()
        self.assertNotIn("X-Nexus-Key", body.get("error", ""))

    @unittest_run_loop
    async def test_ratings_score_reaches_aegis_guard(self):
        resp = await self.client.post(
            "/api/core/ratings/some-agent/score", json={"score": 5})
        self.assertEqual(resp.status, 503)

    @unittest_run_loop
    async def test_proposals_reaches_handler(self):
        # AEGIS_ALLOW_UNATTESTED=1 → proposals без agent-key доходит до
        # handler'а (decision JSON), middleware не вмешался.
        os.environ["AEGIS_ALLOW_UNATTESTED"] = "1"
        self.addCleanup(os.environ.pop, "AEGIS_ALLOW_UNATTESTED", None)
        resp = await self.client.post("/api/core/proposals", json={
            "agent": "t", "operation": "op", "payload": {}})
        self.assertNotEqual(resp.status, 401)


# ---------------------------------------------------------------------------
# HERETIC #438: machines-мутации — token ВСЕГДА (даже loopback dev-mode)
# ---------------------------------------------------------------------------
class MachineMutationAuthzTest(AuthzCase):
    """PUT/DELETE/POST /api/core/machines/* — registry-write bypass
    file-HMAC → token обязателен на любом bind, без токена → 503."""

    @unittest_run_loop
    async def test_no_token_503_even_loopback(self):
        # dev-режим: обычный mutating открыт, machines — НЕТ
        resp = await self.post_kill()
        self.assertEqual(resp.status, 404)   # dev-open подтверждён
        resp = await self.client.put(
            "/api/core/machines/vps", json={"host": "h"})
        self.assertEqual(resp.status, 503)
        resp = await self.client.delete("/api/core/machines/vps")
        self.assertEqual(resp.status, 503)
        resp = await self.client.post(
            "/api/core/machines/vps/connect", json={})
        self.assertEqual(resp.status, 503)
        resp = await self.client.post(
            "/api/core/machines/local/rename", json={"name": "w"})
        self.assertEqual(resp.status, 503)

    @unittest_run_loop
    async def test_token_bad_key_401(self):
        os.environ["NEXUS_CORE_TOKEN"] = "tok-core-1"
        resp = await self.client.put(
            "/api/core/machines/vps", json={"host": "h"})
        self.assertEqual(resp.status, 401)
        resp = await self.client.put(
            "/api/core/machines/vps", json={"host": "h"},
            headers={"X-Nexus-Key": "wrong"})
        self.assertEqual(resp.status, 401)

    @unittest_run_loop
    async def test_token_right_key_reaches_handler(self):
        os.environ["NEXUS_CORE_TOKEN"] = "tok-core-1"
        resp = await self.client.put(
            "/api/core/machines/vps",
            json={"host": "user@host", "transport": "ssh"},
            headers={"X-Nexus-Key": "tok-core-1"})
        self.assertEqual(resp.status, 200)

    @unittest_run_loop
    async def test_read_token_does_not_open_machine_writes(self):
        os.environ["NEXUS_CORE_TOKEN"] = "tok-core-1"
        os.environ["NEXUS_CORE_READ_TOKEN"] = "tok-read-1"
        resp = await self.client.put(
            "/api/core/machines/vps", json={"host": "h"},
            headers={"X-Nexus-Key": "tok-read-1"})
        self.assertEqual(resp.status, 401)

    @unittest_run_loop
    async def test_machine_reads_stay_open(self):
        # GET machines — read-scope, dev-режим без токенов → 200
        resp = await self.client.get("/api/core/machines")
        self.assertEqual(resp.status, 200)


# ---------------------------------------------------------------------------
# non-loopback bind: defense-in-depth + run_server refusal
# ---------------------------------------------------------------------------
class NonLoopbackTest(AuthzCase):
    bind_host = "0.0.0.0"

    @unittest_run_loop
    async def test_mutating_denied_503_without_token(self):
        resp = await self.post_kill()
        self.assertEqual(resp.status, 503)

    @unittest_run_loop
    async def test_mutating_allowed_with_token(self):
        os.environ["NEXUS_CORE_TOKEN"] = "tok-core-1"
        resp = await self.post_kill(key="tok-core-1")
        self.assertEqual(resp.status, 404)

    def test_run_server_refuses_non_loopback(self):
        with self.assertRaises(SystemExit):
            run_server(host="0.0.0.0", port=0)

    def test_is_loopback_host(self):
        from tools.nexus_core.api import _is_loopback_host
        for h in ("127.0.0.1", "127.0.0.53", "localhost", "::1", " LOCALHOST "):
            self.assertTrue(_is_loopback_host(h), h)
        for h in ("0.0.0.0", "::", "192.168.1.5", "example.com", ""):
            self.assertFalse(_is_loopback_host(h), h)


# ---------------------------------------------------------------------------
# SSE: etype sanitize + subscriber cap (#414)
# ---------------------------------------------------------------------------
class SseHardeningTest(unittest.TestCase):
    def test_etype_sanitized(self):
        out = SupervisorEventStream._format(
            {"type": "bad\ntype: injected\r\nretry: 0"})
        # одна event-строка, управляющие символы вырезаны
        self.assertTrue(out.startswith("event: badtypeinjectedretry0\n"), out)
        self.assertNotIn("\n\nevent:", out.split("data:")[0])

    def test_etype_fallback_on_empty(self):
        out = SupervisorEventStream._format({"type": "!!!"})
        self.assertTrue(out.startswith("event: event\n"), out)

    def test_subscriber_cap(self):
        async def _go():
            ch = events_mod.EventChannel()
            with mock.patch.object(events_mod, "MAX_SUBSCRIBERS", 1):
                q1 = await ch.subscribe()
                with self.assertRaises(RuntimeError):
                    await ch.subscribe()
                await ch.unsubscribe(q1)
        asyncio.run(_go())

    def test_http_503_over_cap(self):
        # end-to-end: два подписчика при cap=1 → второй получает 503.
        async def _go():
            tmp = make_temp_base()
            self.addCleanup(shutil.rmtree, tmp, True)
            backend = MockPTYBackend()
            sup = SupervisorV1(backend=backend)
            app = create_app(base=tmp, supervisor=sup)
            saved = _clean_env()
            self.addCleanup(_restore_env, saved)

            from aiohttp.test_utils import TestClient, TestServer
            server = TestServer(app)
            client = TestClient(server)
            await client.start_server()
            try:
                with mock.patch.object(events_mod, "MAX_SUBSCRIBERS", 1), \
                     mock.patch("tools.nexus_core.api.MAX_SUBSCRIBERS", 1):
                    r1 = await client.get("/api/core/events")
                    self.assertEqual(r1.status, 200)
                    await asyncio.sleep(0.1)  # дать stream() подписаться
                    r2 = await client.get("/api/core/events")
                    self.assertEqual(r2.status, 503)
                    await r1.release()
            finally:
                await client.close()
        asyncio.run(_go())


if __name__ == "__main__":
    unittest.main()
