"""
tools/nexus_core/test_n5_observer.py — тесты волны #318 (RFC-001).

ПУНКТ-6 (M, §11.1 K2-1): done (закончил без наблюдателя) → idle при
    наблюдении клиентом (screen-read или листинг агентов).
ПУНКТ-7 (M, §18 :177): тик-модель — ≥2 пропущенных тика → lost;
    keep-respawn после lost; отсутствие lost при живом тике.

Режим: CORE_MOCK=1 (mock-PTY).

Запуск: pytest tools/nexus_core/test_n5_observer.py
        python -m tools.nexus_core.test_n5_observer
"""

from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


def make_supervisor(**kwargs) -> SupervisorV1:
    backend = kwargs.pop("backend", MockPTYBackend())
    return SupervisorV1(backend=backend, **kwargs)


def event_types(sup: SupervisorV1) -> list[str]:
    return [e["type"] for e in sup.events]


class TestObserverTransitions(unittest.TestCase):
    def test_done_to_idle_on_mark_observed(self):
        sup = make_supervisor()
        term = sup.create_terminal("t1")
        term.handle.emit_osc("done")
        sup.step_once()
        self.assertEqual(term.state, "done")
        self.assertTrue(sup.mark_observed(term.address))
        self.assertEqual(term.state, "idle")
        self.assertFalse(term.attention)
        statuses = [e for e in sup.events
                    if e["type"] == "status" and e.get("address") == term.address]
        self.assertTrue(any(e.get("state") == "idle" and e.get("prev") == "done"
                            for e in statuses))

    def test_mark_observed_noop_for_non_done(self):
        sup = make_supervisor()
        term = sup.create_terminal("t1")
        term.handle.emit_osc("working")
        sup.step_once()
        self.assertEqual(term.state, "working")
        self.assertFalse(sup.mark_observed(term.address))
        self.assertEqual(term.state, "working")

    def test_mark_observed_unknown_terminal_false(self):
        sup = make_supervisor()
        self.assertFalse(sup.mark_observed("local/nope"))


class TestTickLost(unittest.TestCase):
    def test_lost_after_two_missed_ticks(self):
        sup = make_supervisor()
        term = sup.create_terminal("t1", keep=False)
        old = term.handle
        old.kill()
        self.assertFalse(old.alive())
        # 1-й пропущенный тик — ещё НЕ lost
        sup.step_once()
        self.assertEqual(term.missed_ticks, 1)
        self.assertNotIn("lost", event_types(sup))
        # 2-й пропущенный тик → lost, но без keep-respawn
        sup.step_once()
        self.assertEqual(term.missed_ticks, 2)
        self.assertEqual(event_types(sup).count("lost"), 1)
        self.assertTrue(term.lost_reported)
        self.assertEqual(term.respawn_count, 0)

    def test_lost_not_repeated_on_subsequent_ticks(self):
        sup = make_supervisor()
        term = sup.create_terminal("t1", keep=False)
        term.handle.kill()
        for _ in range(4):
            sup.step_once()
        self.assertEqual(event_types(sup).count("lost"), 1)

    def test_keep_respawn_after_two_missed_ticks(self):
        sup = make_supervisor()
        term = sup.create_terminal("t1")
        old = term.handle
        old.kill()
        sup.step_once()
        sup.step_once()
        self.assertIsNotNone(term.handle)
        self.assertIsNot(term.handle, old)
        self.assertTrue(term.handle.alive())
        self.assertEqual(term.respawn_count, 1)
        self.assertEqual(term.state, "idle")
        types = event_types(sup)
        self.assertIn("lost", types)
        self.assertIn("respawn", types)

    def test_no_lost_when_alive_tick(self):
        sup = make_supervisor()
        term = sup.create_terminal("t1", keep=False)
        for _ in range(5):
            sup.step_once()
        self.assertNotIn("lost", event_types(sup))
        self.assertEqual(term.missed_ticks, 0)

class ObserverApiTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="nexus-core-observer-test-"))
        self.backend = MockPTYBackend()
        self.supervisor = SupervisorV1(backend=self.backend)
        super().setUp()

    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.tmp, supervisor=self.supervisor,
                          templates_dir=self.tmp / "templates")

    def make_done_terminal(self, name: str):
        """Создаёт терминал и приводит его в состояние done через OSC."""
        term = self.supervisor.create_terminal(name)
        term.handle.emit_osc("done")
        self.supervisor.step_once()
        self.assertEqual(term.state, "done")
        return term


class TestScreenObserve(ObserverApiTestCase):
    @unittest_run_loop
    async def test_screen_read_observes_done_to_idle(self):
        term = self.make_done_terminal("t1")
        resp = await self.client.get("/api/core/screen/t1")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["term"], "local/t1")
        # чтение экрана = наблюдение → done → idle
        self.assertEqual(term.state, "idle")

    @unittest_run_loop
    async def test_screen_unknown_404(self):
        resp = await self.client.get("/api/core/screen/nope")
        self.assertEqual(resp.status, 404)


class TestAgentsObserve(ObserverApiTestCase):
    @unittest_run_loop
    async def test_agents_listing_observes_done_to_idle(self):
        self.make_done_terminal("t1")
        resp = await self.client.get("/api/core/agents")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["agents"][0]["state"], "idle")
        self.assertFalse(data["agents"][0]["attention"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
