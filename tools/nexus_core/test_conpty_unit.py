#!/usr/bin/env python3
"""
tools/nexus_core/test_conpty_unit.py — юнит-тесты Windows-половины
pty_backend (ConPTY): чистые части без реального спавна.

Реальный ConPTY-спавн из-под ConTTY-сессии невозможен (вложенность —
атрибут молча игнорируется, §N3.5), поэтому здесь покрывается то, что
можно проверить без дочернего процесса:

- _build_cmdline — экранирование по правилам CommandLineToArgvW;
- _build_env_block — KEY=VAL\\0...\\0\\0, merge поверх os.environ;
- константы WinAPI (ERROR_INSUFFICIENT_BUFFER=122 — исторический баг,
  был 87; PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE; флаги CreateProcess);
- ConPTYHandle.escalate_kill — контракт ступеней (MERC #298/#306);
- ConPTYHandle.close — порядок закрытия PC → out → in → proc;
- _ConPTYReader — реальный анонимный пайп: данные доходят, поток
  выходит по EOF (латентная находка MERC #306: reader не должен висеть).

Запуск: pytest tools/nexus_core/test_conpty_unit.py
"""

from __future__ import annotations

import ctypes
import os
import sys
import unittest
from unittest import mock

from tools.nexus_core import pty_backend as pb

WIN = sys.platform == "win32"


def _fake_handle(pc: int = 0, proc: int = 0) -> "pb.ConPTYHandle":
    """ConPTYHandle без __init__-спавна: все хендлы — нули/фейки."""
    h = pb.ConPTYHandle.__new__(pb.ConPTYHandle)
    pb.PTYHandle.__init__(h)
    h._pc = pc
    h._in_write = 0
    h._out_read = 0
    h._sig_write = 0
    h._proc = proc
    h.pid = 0
    reader = mock.Mock()
    reader.queue = __import__("queue").Queue()
    reader.is_alive.return_value = False
    h._reader = reader
    h._queue = reader.queue
    return h


@unittest.skipUnless(WIN, "ConPTY — Windows-only")
class TestBuildCmdline(unittest.TestCase):
    def test_plain_argv(self):
        self.assertEqual(pb._build_cmdline(["cmd.exe", "/c", "dir"]), "cmd.exe /c dir")

    def test_empty_and_spaces_quoted(self):
        self.assertEqual(pb._build_cmdline([""]), '""')
        self.assertEqual(pb._build_cmdline(["a b"]), '"a b"')
        self.assertEqual(pb._build_cmdline(["C:\\prog dir\\x.exe", "-y"]), '"C:\\prog dir\\x.exe" -y')

    def test_quotes_escaped(self):
        # Внутренняя кавычка → \"; предшествующие \ удваиваются.
        self.assertEqual(pb._build_cmdline(['say "hi"']), '"say \\"hi\\""')
        self.assertEqual(pb._build_cmdline(['a\\"b']), '"a\\\\\\"b"')

    def test_trailing_backslash_doubled(self):
        # \ перед закрывающей кавычкой удваивается, иначе съест её.
        self.assertEqual(pb._build_cmdline(["C:\\path with space\\"]), '"C:\\path with space\\\\"')

    def test_backslash_without_space_not_quoted(self):
        self.assertEqual(pb._build_cmdline(["a\\b"]), "a\\b")


@unittest.skipUnless(WIN, "ConPTY — Windows-only")
class TestBuildEnvBlock(unittest.TestCase):
    def _block_str(self, block) -> str:
        # c_wchar_p.value обрезает на первом \0 — env-блок состоит из
        # KEY=VAL\0-пар, читаем wchar за wchar до двойного терминатора.
        addr = ctypes.cast(block, ctypes.c_void_p).value
        wsz = ctypes.sizeof(ctypes.c_wchar)
        chars, i = [], 0
        while True:
            ch = ctypes.wstring_at(addr + i * wsz, 1)
            chars.append(ch)
            i += 1
            if ch == "\0" and len(chars) >= 2 and chars[-2] == "\0":
                break
            self.assertLess(i, 1 << 20, "нет двойного \0-терминатора")
        return "".join(chars)

    def _parse(self, block: str) -> dict:
        out = {}
        for entry in block.split("\0"):
            if "=" in entry:
                k, _, v = entry.partition("=")
                out[k] = v
        return out

    def test_merges_and_overrides(self):
        raw = self._block_str(pb._build_env_block({"NX_TEST_FLAG": "yes", "PATH": "X:\\custom"}))
        env = self._parse(raw)
        self.assertEqual(env["NX_TEST_FLAG"], "yes")
        self.assertEqual(env["PATH"], "X:\\custom")  # extra бьёт os.environ

    def test_sorted_and_double_nul(self):
        raw = self._block_str(pb._build_env_block(None))
        keys = [e.split("=", 1)[0] for e in raw.split("\0") if "=" in e]
        self.assertEqual(keys, sorted(keys))
        self.assertTrue(raw.endswith("\0\0"))


@unittest.skipUnless(WIN, "ConPTY — Windows-only")
class TestWinConstants(unittest.TestCase):
    def test_error_insufficient_buffer_is_122(self):
        # Было 87 (ERROR_INVALID_PARAMETER) — probe attribute-list падал.
        self.assertEqual(pb.ERROR_INSUFFICIENT_BUFFER, 122)

    def test_pseudoconsole_attribute_id(self):
        self.assertEqual(pb.PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, 0x00020016)

    def test_creation_flags(self):
        self.assertEqual(pb.EXTENDED_STARTUPINFO_PRESENT, 0x00080000)
        self.assertEqual(pb.CREATE_UNICODE_ENVIRONMENT, 0x00000400)


@unittest.skipUnless(WIN, "ConPTY — Windows-only")
class TestEscalateKill(unittest.TestCase):
    def test_unknown_stage(self):
        self.assertEqual(_fake_handle().escalate_kill("bogus"), "error: unknown stage")

    def test_terminate_without_process(self):
        self.assertEqual(_fake_handle(proc=0).escalate_kill("terminate"), "not_running")
        self.assertEqual(_fake_handle(proc=0).escalate_kill("kill"), "not_running")

    def test_hangup_closes_pc_and_reports_dead(self):
        h = _fake_handle(pc=1234, proc=0)
        with mock.patch.object(pb, "_ClosePseudoConsole") as close_pc:
            self.assertEqual(h.escalate_kill("hangup"), "hangup")
        close_pc.assert_called_once_with(1234)
        self.assertEqual(h._pc, 0)

    def test_hangup_ignored_when_alive(self):
        h = _fake_handle(pc=1, proc=7)
        with mock.patch.object(pb, "_ClosePseudoConsole"), \
             mock.patch.object(h, "alive", return_value=True):
            self.assertEqual(h.escalate_kill("hangup"), "hangup_ignored")

    def test_terminate_calls_terminate_process(self):
        h = _fake_handle(proc=42)
        with mock.patch.object(pb, "_TerminateProcess") as term, \
             mock.patch.object(h, "alive", return_value=False):
            self.assertEqual(h.escalate_kill("terminate"), "terminate")
        term.assert_called_once_with(42, 1)

    def test_terminate_ignored_when_alive(self):
        h = _fake_handle(proc=42)
        with mock.patch.object(pb, "_TerminateProcess"), \
             mock.patch.object(h, "alive", return_value=True):
            self.assertEqual(h.escalate_kill("kill"), "kill_ignored")

    def test_session_ended_true_when_process_exited(self):
        # процесс умер (exit code != STILL_ACTIVE) → сессия завершилась
        h = _fake_handle(proc=42)
        with mock.patch.object(pb.wintypes, "DWORD", lambda: mock.Mock(value=0)), \
             mock.patch.object(pb, "_GetExitCodeProcess", return_value=True), \
             mock.patch.object(pb.ctypes, "byref", return_value=object()):
            self.assertTrue(h.session_ended)

    def test_session_ended_false_when_alive(self):
        h = _fake_handle(proc=42)
        with mock.patch.object(pb.wintypes, "DWORD", lambda: mock.Mock(value=pb.STILL_ACTIVE)), \
             mock.patch.object(pb, "_GetExitCodeProcess", return_value=True), \
             mock.patch.object(pb.ctypes, "byref", return_value=object()):
            self.assertFalse(h.session_ended)

    def test_session_ended_false_when_no_proc(self):
        h = _fake_handle(proc=0)
        self.assertFalse(h.session_ended)


@unittest.skipUnless(WIN, "ConPTY — Windows-only")
class TestCloseOrder(unittest.TestCase):
    def test_close_order_pc_out_in_proc(self):
        h = _fake_handle(pc=11, proc=44)
        h._out_read = 22
        h._in_write = 33
        calls = []
        with mock.patch.object(pb, "_ClosePseudoConsole", side_effect=lambda p: calls.append(("pc", p))), \
             mock.patch.object(pb, "_CloseHandle", side_effect=lambda x: calls.append(("h", x))):
            h.close()
        self.assertEqual(calls, [("pc", 11), ("h", 22), ("h", 33), ("h", 44)])
        self.assertTrue(h.closed)

    def test_close_skips_closed_pc(self):
        # После escalate hangup pc=0 — close не должен закрывать его повторно.
        h = _fake_handle(pc=0, proc=9)
        h._out_read = 1
        h._in_write = 2
        with mock.patch.object(pb, "_ClosePseudoConsole") as close_pc, \
             mock.patch.object(pb, "_CloseHandle"):
            h.close()
        close_pc.assert_not_called()


@unittest.skipUnless(WIN, "ConPTY — Windows-only")
class TestResizeSignal(unittest.TestCase):
    """#542: ResizeWindow-пакет в --signal-pipe (PtySignal=8, <HHH)."""

    def _handle_with_sig(self):
        h = _fake_handle()
        h._sig_write = 77
        return h

    def test_packet_layout(self):
        import struct
        h = self._handle_with_sig()
        with mock.patch.object(pb, "_WriteFile") as wf:
            wf.side_effect = lambda *a: True  # written/out-params не читаем
            h.resize(160, 50)
        wf.assert_called_once()
        args = wf.call_args[0]
        self.assertEqual(args[0], 77)          # sig_write handle
        self.assertEqual(args[2], 6)           # 3 × uint16
        pkt = ctypes.string_at(args[1], 6)
        self.assertEqual(pkt, struct.pack("<HHH", 8, 160, 50))

    def test_no_sig_write_is_noop(self):
        h = _fake_handle()  # _sig_write = 0
        with mock.patch.object(pb, "_WriteFile") as wf:
            h.resize(160, 50)  # не должно ни писать, ни падать
        wf.assert_not_called()

    def test_invalid_dims_rejected(self):
        h = self._handle_with_sig()
        for cols, rows in ((0, 24), (80, 0), (-1, 24), (80, -5),
                           (70000, 24), (80, 70000)):
            with self.assertRaises(ValueError, msg=f"{cols}x{rows}"):
                h.resize(cols, rows)
        # границы uint16 — валидны
        with mock.patch.object(pb, "_WriteFile") as wf:
            wf.side_effect = lambda *a: True
            h.resize(1, 1)
            h.resize(65535, 65535)
        self.assertEqual(wf.call_count, 2)

    def test_close_closes_sig_write(self):
        h = self._handle_with_sig()
        h._out_read = 22
        h._in_write = 33
        h._proc = 44
        calls = []
        with mock.patch.object(pb, "_ClosePseudoConsole"), \
             mock.patch.object(pb, "_CloseHandle",
                               side_effect=lambda x: calls.append(x)):
            h.close()
        self.assertIn(77, calls)
        self.assertEqual(h._sig_write, 0)


@unittest.skipUnless(WIN, "ConPTY — Windows-only")
class TestConPTYReaderRealPipe(unittest.TestCase):
    def test_reader_delivers_data_and_exits_on_eof(self):
        read_h, write_h = pb._make_pipe()
        reader = pb._ConPTYReader(read_h)
        reader.start()
        buf = ctypes.create_string_buffer(b"hello-pty")
        written = pb.wintypes.DWORD()
        pb._WriteFile(write_h, buf, 9, ctypes.byref(written), None)
        pb._CloseHandle(write_h)  # EOF → читатель должен выйти сам
        reader.join(timeout=3.0)
        self.assertFalse(reader.is_alive(), "reader не вышел по EOF — поток-призрак")
        self.assertEqual(reader.queue.get_nowait(), b"hello-pty")
        pb._CloseHandle(read_h)

    def test_reader_multiple_chunks(self):
        read_h, write_h = pb._make_pipe()
        reader = pb._ConPTYReader(read_h)
        reader.start()
        for chunk in (b"one", b"two", b"three"):
            buf = ctypes.create_string_buffer(chunk)
            written = pb.wintypes.DWORD()
            pb._WriteFile(write_h, buf, len(chunk), ctypes.byref(written), None)
        pb._CloseHandle(write_h)
        reader.join(timeout=3.0)
        got = b"".join(reader.queue.get_nowait() for _ in range(reader.queue.qsize()))
        self.assertEqual(got, b"onetwothree")
        pb._CloseHandle(read_h)


if __name__ == "__main__":
    unittest.main()
