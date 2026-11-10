#!/usr/bin/env python3
"""
tools/nexus_core/test_n35_modules.py — юнит-тесты N3.5 (nexus-core):
screen-роут с обеими формами адреса, kill-эскалация по RFC с хук-
бэкендом и close-фолбэком.

Запуск: pytest tools/nexus_core/test_n35_modules.py
"""

from __future__ import annotations

import shutil
import tempfile
import time
import unittest
from pathlib import Path

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.pty_backend import PTYBackend, PTYHandle, SpawnSpec
from tools.nexus_core.supervisor_v1 import SupervisorV1


def make_temp_base() -> Path:
    return Path(tempfile.mkdtemp(prefix="nexus-core-n35-test-"))


# =============================================================================
# Screen-роут: обе формы адреса ({term:.+})
# =============================================================================

class CoreApiN35TestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = make_temp_base()
        self.backend = MockPTYBackend()
        self.supervisor = SupervisorV1(backend=self.backend)
        super().setUp()

    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.tmp, supervisor=self.supervisor,
                          templates_dir=self.tmp / "templates")


class TestScreenRouteBothForms(CoreApiN35TestCase):
    @unittest_run_loop
    async def test_screen_bare_name(self):
        await self.client.post("/api/core/run", json={"name": "t1"})
        resp = await self.client.get("/api/core/screen/t1")
        self.assertEqual(resp.status, 200)

    @unittest_run_loop
    async def test_screen_full_address(self):
        await self.client.post("/api/core/run", json={"name": "t1"})
        # полный адрес local/t1 — слэш в сегменте, {term:.+}
        resp = await self.client.get("/api/core/screen/local/t1")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["term"], "local/t1")

    @unittest_run_loop
    async def test_screen_full_address_other_machine(self):
        await self.client.post("/api/core/run", json={"name": "t1", "machine": "vps"})
        resp = await self.client.get("/api/core/screen/vps/t1")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["term"], "vps/t1")

    @unittest_run_loop
    async def test_screen_unknown_full_address_404(self):
        resp = await self.client.get("/api/core/screen/vps/nope")
        self.assertEqual(resp.status, 404)


# =============================================================================
# Kill-эскалация по RFC (10s/5s): хук vs close-фолбэк
# =============================================================================

class _PlainHandle(PTYHandle):
    """PTYHandle БЕЗ escalate_kill (старый путь — close())."""

    def __init__(self) -> None:
        super().__init__()
        self._alive = True

    def read(self, timeout: float = 0.0) -> bytes:
        return b""

    def write(self, data: bytes) -> int:
        return len(data)

    def close(self) -> None:
        self._closed = True
        self._alive = False

    def alive(self) -> bool:
        return self._alive and not self._closed


class _AbortiveHandle(_PlainHandle):
    """Хук escalate_kill, который убивает на hangup (settle без ожиданий)."""

    def escalate_kill(self, stage: str) -> str:
        self._alive = False
        return stage


class _PlainBackend(PTYBackend):
    _handle_cls = _PlainHandle

    def __init__(self) -> None:
        self.terminals = {}

    def spawn(self, spec: SpawnSpec) -> PTYHandle:
        handle = self._handle_cls()
        self.terminals[handle] = handle
        return handle


class _AbortiveBackend(_PlainBackend):
    _handle_cls = _AbortiveHandle


class TestKillEscalationN35(unittest.TestCase):
    def test_kill_without_hook_falls_back_to_close(self):
        sup = SupervisorV1(backend=_PlainBackend())
        term = sup.create_terminal("t1")
        result = sup.escalate_kill("local/t1")
        self.assertEqual(result["final"], "closed")
        self.assertEqual(result["steps"], [])
        self.assertEqual(term.state, "exited")
        self.assertIsNone(term.handle)

    def test_kill_hook_settles_without_rfc_wait(self):
        sup = SupervisorV1(backend=_AbortiveBackend())
        sup.create_terminal("t1")
        t0 = time.monotonic()
        result = sup.escalate_kill("local/t1")
        dt = time.monotonic() - t0
        self.assertEqual(result["final"], "hangup")
        self.assertEqual([s["stage"] for s in result["steps"]], ["hangup"])
        self.assertEqual(result["steps"][0]["state"], "dead")
        self.assertLess(dt, 3.0)  # без 10s-окна: убит на hangup

    def test_kill_hook_unknown_stage_raises(self):
        sup = SupervisorV1(backend=_AbortiveBackend())
        sup.create_terminal("t1")
        with self.assertRaises(ValueError):
            sup.escalate_kill("local/t1", stage=123)

    def test_kill_not_running_state(self):
        sup = SupervisorV1(backend=_PlainBackend())
        term = sup.create_terminal("t1")
        term.handle.close()
        result = sup.escalate_kill("local/t1")
        self.assertEqual(result["final"], "not_running")
        self.assertEqual(term.state, "exited")


if __name__ == "__main__":
    unittest.main()
