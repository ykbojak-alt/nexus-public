#!/usr/bin/env python3
"""
tools/nexus_core/test_cors.py — CORS-политика ядра (#403).

Покрывает: дефолтный allow-list (localhost/127.0.0.1 любой порт),
env-переопределение NEXUS_CORE_ALLOWED_ORIGINS, preflight OPTIONS,
отсутствие ACAO для чужих/пустых Origin, неизменность базовых маршрутов.

Запуск: pytest tools/nexus_core/test_cors.py
        python -m tools.nexus_core.test_cors
"""

from __future__ import annotations

import os
import shutil
import tempfile
import unittest
from pathlib import Path

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1

_CORS_ENV = "NEXUS_CORE_ALLOWED_ORIGINS"


class CorsApiTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="nexus-core-cors-test-"))
        self.backend = MockPTYBackend()
        self.supervisor = SupervisorV1(backend=self.backend)
        self._saved_env = os.environ.get(_CORS_ENV)
        super().setUp()

    def tearDown(self):
        super().tearDown()
        if self._saved_env is None:
            os.environ.pop(_CORS_ENV, None)
        else:
            os.environ[_CORS_ENV] = self._saved_env
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.tmp, supervisor=self.supervisor,
                          templates_dir=self.tmp / "templates")


class TestCorsDefaultAllowList(CorsApiTestCase):
    @unittest_run_loop
    async def test_loopback_origin_gets_acao_echo(self):
        resp = await self.client.get("/api/core/server", headers={
            "Origin": "http://localhost:3322"})
        self.assertEqual(resp.status, 200)
        self.assertEqual(resp.headers.get("Access-Control-Allow-Origin"),
                         "http://localhost:3322")
        self.assertEqual(resp.headers.get("Vary"), "Origin")

    @unittest_run_loop
    async def test_127_origin_gets_acao(self):
        resp = await self.client.get("/api/core/server", headers={
            "Origin": "http://127.0.0.1:3322"})
        self.assertEqual(resp.status, 200)
        self.assertEqual(resp.headers.get("Access-Control-Allow-Origin"),
                         "http://127.0.0.1:3322")

    @unittest_run_loop
    async def test_foreign_origin_gets_no_acao(self):
        resp = await self.client.get("/api/core/server", headers={
            "Origin": "https://evil.example"})
        self.assertEqual(resp.status, 200)
        self.assertNotIn("Access-Control-Allow-Origin", resp.headers)

    @unittest_run_loop
    async def test_no_origin_gets_no_acao(self):
        resp = await self.client.get("/api/core/server")
        self.assertEqual(resp.status, 200)
        self.assertNotIn("Access-Control-Allow-Origin", resp.headers)

    @unittest_run_loop
    async def test_origin_with_port_mismatch_denied(self):
        # "http://localhost:*" разрешает любой порт, но не другой scheme/хост
        resp = await self.client.get("/api/core/server", headers={
            "Origin": "http://localhost"})
        self.assertEqual(resp.status, 200)
        self.assertNotIn("Access-Control-Allow-Origin", resp.headers)


class TestCorsPreflight(CorsApiTestCase):
    @unittest_run_loop
    async def test_preflight_options_allowed_origin(self):
        resp = await self.client.options("/api/core/run", headers={
            "Origin": "http://localhost:3322",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type"})
        self.assertEqual(resp.status, 204)
        self.assertEqual(resp.headers.get("Access-Control-Allow-Origin"),
                         "http://localhost:3322")
        self.assertIn("POST", resp.headers.get("Access-Control-Allow-Methods", ""))
        self.assertIn("content-type",
                      resp.headers.get("Access-Control-Allow-Headers", ""))
        self.assertIn("Access-Control-Max-Age", resp.headers)

    @unittest_run_loop
    async def test_preflight_options_foreign_origin_no_acao(self):
        resp = await self.client.options("/api/core/run", headers={
            "Origin": "https://evil.example"})
        self.assertNotIn("Access-Control-Allow-Origin", resp.headers)


class TestCorsEnvOverride(CorsApiTestCase):
    @unittest_run_loop
    async def test_env_override_wins_over_default(self):
        os.environ[_CORS_ENV] = "https://app.example"
        resp = await self.client.get("/api/core/server", headers={
            "Origin": "https://app.example"})
        self.assertEqual(resp.status, 200)
        self.assertEqual(resp.headers.get("Access-Control-Allow-Origin"),
                         "https://app.example")

        # дефолтный localhost больше НЕ разрешён
        resp = await self.client.get("/api/core/server", headers={
            "Origin": "http://localhost:3322"})
        self.assertEqual(resp.status, 200)
        self.assertNotIn("Access-Control-Allow-Origin", resp.headers)

    @unittest_run_loop
    async def test_env_exact_origin_without_port(self):
        os.environ[_CORS_ENV] = "http://example.com"
        resp = await self.client.get("/api/core/server", headers={
            "Origin": "http://example.com"})
        self.assertEqual(resp.status, 200)
        self.assertEqual(resp.headers.get("Access-Control-Allow-Origin"),
                         "http://example.com")
        # другой порт — не совпадает (нет суффикса :*)
        resp = await self.client.get("/api/core/server", headers={
            "Origin": "http://example.com:8080"})
        self.assertEqual(resp.status, 200)
        self.assertNotIn("Access-Control-Allow-Origin", resp.headers)


class TestCorsDoesNotBreakApi(CorsApiTestCase):
    @unittest_run_loop
    async def test_existing_routes_unaffected(self):
        resp = await self.client.get("/api/core/server")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["version"], "N3")
        resp = await self.client.get("/api/core/terminals")
        self.assertEqual(resp.status, 200)

    @unittest_run_loop
    async def test_cors_headers_on_error_responses(self):
        # CORS-заголовки должны присутствовать и на 4xx (для браузера)
        resp = await self.client.post("/api/core/run", headers={
            "Origin": "http://localhost:3322"}, json={})
        self.assertIn("Access-Control-Allow-Origin", resp.headers)
        self.assertEqual(resp.headers["Access-Control-Allow-Origin"],
                         "http://localhost:3322")

    @unittest_run_loop
    async def test_sse_events_gets_acao(self):
        # SSE-стрим: заголовки добавляются в on_response_prepare ДО старта
        # потока — иначе браузер блокирует /api/core/events CORS'ом.
        resp = await self.client.get("/api/core/events", headers={
            "Origin": "http://localhost:3322"})
        self.assertEqual(resp.status, 200)
        self.assertEqual(resp.headers.get("Access-Control-Allow-Origin"),
                         "http://localhost:3322")
        self.assertEqual(resp.headers.get("Vary"), "Origin")
        await resp.release()

    @unittest_run_loop
    async def test_sse_events_foreign_origin_no_acao(self):
        resp = await self.client.get("/api/core/events", headers={
            "Origin": "https://evil.example"})
        self.assertEqual(resp.status, 200)
        self.assertNotIn("Access-Control-Allow-Origin", resp.headers)
        await resp.release()


if __name__ == "__main__":
    unittest.main()
