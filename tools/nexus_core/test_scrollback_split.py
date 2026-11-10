#!/usr/bin/env python3
"""W93: scrollback склейка строк между read()-чанками.

Баг: каждый чанк прогонялся через splitlines() порознь — токен,
разрезанный границей чанка (ReadFile до 4096Б, conhost пишет
как придётся), превращался в две scrollback-строки, а screen-endpoint
склеивает их "\n" → grep маркера по экрану промахивался. Флейк
 e2e 'screen' 44/45.

MockPTYHandle.read() сливает весь stdout за тик — управляем границами
чанков через поочерёдный extend + step_once().
"""
import threading
import time
import unittest

from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1, scrollback_all


class ScrollbackSplitTest(unittest.TestCase):
    def setUp(self):
        self.sup = SupervisorV1(backend=MockPTYBackend())
        self.term = self.sup.create_terminal("w93", command=["sh", "-i"])

    def feed(self, data: bytes):
        self.term.handle.stdout.extend(data)
        self.sup.step_once()

    def screen_text(self) -> str:
        return "\n".join(scrollback_all(self.term))

    def test_marker_split_across_chunks(self):
        # Токен режется посередине, перевода строки нет — до фикса
        # scrollback хранил "E2E-MA" и "RK-99" отдельными строками.
        self.feed(b"C:\\> echo E2E-MA")
        self.feed(b"RK-99\r\n")
        self.assertIn("E2E-MARK-99", self.screen_text())

    def test_crlf_split_across_chunks_no_phantom_line(self):
        # "\r" в конце чанка + "\n" в начале следующего — не должно
        # появляться лишней пустой строки.
        self.feed(b"line-one\r")
        self.feed(b"\nline-two\r\n")
        lines = scrollback_all(self.term)
        self.assertIn("line-one", lines)
        self.assertIn("line-two", lines)
        # фантомная "" от разорванного \r\n — регрессия, если есть
        empties = [i for i, l in enumerate(lines) if l == ""]
        self.assertEqual(empties, [])

    def test_partial_line_waits_for_terminator(self):
        # Недописанная строка не коммитится в deque, но видна на экране
        # через scrollback_all (pending-хвост) — /screen показывает
        # prompt/ввод до \n, как и раньше.
        self.feed(b"no-newline-yet")
        self.assertEqual(list(self.term.scrollback), [])
        self.assertIn("no-newline-yet", self.screen_text())
        self.assertEqual(self.term.scrollback_pending, "no-newline-yet")
        self.feed(b"-done\n")
        self.assertIn("no-newline-yet-done", self.screen_text())
        self.assertEqual(self.term.scrollback_pending, "")

    def test_lone_cr_progress_commits_on_next_output(self):
        # \r-прогресс: каждая перезапись — отдельная строка (как раньше),
        # pending не должен раздуваться.
        self.feed(b"dl 10%\r")
        self.feed(b"dl 60%\r")
        self.feed(b"dl 100%\n")
        text = self.screen_text()
        self.assertIn("dl 10%", text)
        self.assertIn("dl 60%", text)
        self.assertIn("dl 100%", text)

    def test_pending_reset_on_respawn(self):
        self.feed(b"partial-no-break")
        self.assertTrue(self.term.scrollback_pending)
        self.term.state = "exited"  # restart_terminal требует не-running
        self.sup.restart_terminal(self.term.address)
        self.assertEqual(self.term.scrollback_pending, "")


class ScrollbackW96Test(unittest.TestCase):
    """CODEX W5w: auto-respawn pending, pump↔handler race, limiter-drop,
    stale gzip при reset."""

    def setUp(self):
        self.sup = SupervisorV1(backend=MockPTYBackend())
        self.term = self.sup.create_terminal("w96", command=["sh", "-i"])

    def feed(self, data: bytes):
        self.term.handle.stdout.extend(data)
        self.sup.step_once()

    def test_w96_1_auto_respawn_resets_pending_keeps_history(self):
        # Живая строка-обрывок + история → kill → auto-respawn:
        # pending мёртвого процесса сброшен, deque-история сохранена.
        self.feed(b"history-line\npartial-tail")
        self.assertTrue(self.term.scrollback_pending)
        self.term.handle.kill()          # процесс «умер»
        # tick-модель: lost детектится после missed_tick_threshold тиков
        for _ in range(self.sup.missed_tick_threshold + 2):
            self.sup.step_once()
        self.assertEqual(self.term.scrollback_pending, "")
        self.assertIn("history-line", scrollback_all(self.term))
        self.assertNotIn("partial-tail", scrollback_all(self.term))

    def test_w96_2_pump_handler_race_smoke(self):
        # step_once в worker-потоке vs scrollback_clear/extend в
        # «loop»-потоке: лок не даёт гонки — ни исключений, ни потери
        # целостности deque/pending.
        stop = threading.Event()
        errors = []

        def pump():
            try:
                while not stop.is_set():
                    self.term.handle.stdout.extend(b"race-line\n")
                    self.sup.step_once()
            except Exception as e:  # pragma: no cover
                errors.append(e)

        th = threading.Thread(target=pump, daemon=True)
        th.start()
        try:
            for _ in range(60):
                self.sup.scrollback_extend(self.term, ["marker-x"])
                self.sup.scrollback_clear(self.term)
                scrollback_all(self.term)  # читатель без лока — не падает
        finally:
            stop.set()
            th.join(timeout=10)
        self.assertEqual(errors, [])
        self.assertIsInstance(self.term.scrollback_pending, str)

    def test_w96_3_limiter_drop_flushes_pending_fragment(self):
        # rate-limit дропает чанк → pending-фрагмент коммитится
        # отдельной строкой, следующий чанк НЕ склеивается с ним.
        self.term.labels["_out_rate"] = "5"
        self.feed(b"AAA")               # 3B kept → pending
        time.sleep(1.1)                 # окно rate-limit сброшено
        self.feed(b"BBBBBBBB\n")        # 9B > 5 → dropped + flush "AAA"
        self.feed(b"NEXT\n")            # kept → "NEXT" отдельной строкой
        lines = scrollback_all(self.term)
        self.assertIn("AAA", lines)
        self.assertIn("NEXT", lines)
        self.assertNotIn("AAANEXT", "\n".join(lines))
        self.assertNotIn("BBBBBBBB", "\n".join(lines))  # дроп честный

    def test_w96_4_restart_clears_stale_gzip(self):
        # compress → gz-архив со старыми строками → restart:
        # scrollback_all НЕ должен воскрешать архив (stale gzip).
        self.feed(b"old-life-line-1\nold-life-line-2\n")
        res = self.sup.compress_scrollback(self.term, force=True)
        self.assertTrue(res["compressed"])
        self.assertIsNotNone(self.term.scrollback_gz)
        self.term.state = "exited"
        self.sup.restart_terminal(self.term.address)
        self.assertIsNone(self.term.scrollback_gz)
        self.assertEqual(self.term.scrollback_gz_count, 0)
        self.assertNotIn("old-life-line-1", scrollback_all(self.term))


if __name__ == "__main__":
    unittest.main()
