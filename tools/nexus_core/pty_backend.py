#!/usr/bin/env python3
"""
tools/nexus_core/pty_backend.py — PTY-бэкенды для nexus-core N1.

Интерфейс (паттерн driver-абстракции, как tools/bus2/driver.py):
    PTYBackend.spawn(SpawnSpec) -> PTYHandle
    PTYHandle.read / write / close / alive

Реальные реализации:
    ConPTYBackend — Windows: OpenConsole.exe --headless трамплин
                    (vendored conpty/x64/, pipe std-хендлы, ctypes);
                    kernel32 CreatePseudoConsole+HPCON-атрибут на Windows
                    не работает (#521/#525 — см. reports/);
    ForkPTYBackend — POSIX: os.forkpty() + pty.

Выбор платформы: get_default_backend(). CORE_MOCK=1 выбирает mock
(см. mock_pty.py) — это делает супервизор.
"""

from __future__ import annotations

import os
import select
import signal
import sys
import threading
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from queue import Empty, Queue
from typing import Optional


# =============================================================================
# Общий интерфейс
# =============================================================================


@dataclass
class SpawnSpec:
    """Параметры спавна терминального процесса."""

    command: list[str]
    cwd: Optional[str] = None
    env: Optional[dict] = None
    cols: int = 120
    rows: int = 30


class PTYHandle(ABC):
    """Хендл PTY-процесса: поток байтов + жизненный цикл."""

    def __init__(self) -> None:
        self._closed = False

    @property
    def closed(self) -> bool:
        """True после осознанного close() (exited — рестарт не нужен)."""
        return self._closed

    @abstractmethod
    def read(self, timeout: float = 0.0) -> bytes:
        """Читает доступный вывод. При timeout>0 блокируется до появления данных."""

    @abstractmethod
    def write(self, data: bytes) -> int:
        """Пишет байты в PTY. Возвращает число записанных байтов."""

    @abstractmethod
    def close(self) -> None:
        """Закрывает PTY (процесс завершается/отключается)."""

    @abstractmethod
    def alive(self) -> bool:
        """True, пока процесс жив."""

    def resize(self, cols: int, rows: int) -> None:
        """Меняет размер PTY-грида (cols=ширина, rows=высота в ячейках).

        Бэкенды без поддержки resize — безопасный no-op (fixed-size,
        как было до #542). Реальные реализации: ForkPTY (TIOCSWINSZ),
        ConPTY (OpenConsole --signal ResizeWindow-пакет).
        """
        return None


class PTYBackend(ABC):
    """Абстракция транспорта спавна PTY."""

    @abstractmethod
    def spawn(self, spec: SpawnSpec) -> PTYHandle:
        """Спавнит терминальный процесс; возвращает хендл."""


def default_shell() -> list[str]:
    """Команда по умолчанию для интерактивного shell."""
    if sys.platform == "win32":
        return [os.environ.get("COMSPEC", "cmd.exe")]
    return [os.environ.get("SHELL", "/bin/sh")]


# =============================================================================
# POSIX: forkpty
# =============================================================================


def _set_winsize(master_fd: int, cols: int, rows: int) -> None:
    """TIOCSWINSZ на master-фд forkpty (общий код spawn/resize, POSIX)."""
    import fcntl
    import struct
    import termios

    fcntl.ioctl(
        master_fd,
        termios.TIOCSWINSZ,
        struct.pack("HHHH", int(rows), int(cols), 0, 0),
    )


class ForkPTYHandle(PTYHandle):
    """PTY-хендл поверх forkpty (POSIX)."""

    def __init__(self, pid: int, master_fd: int) -> None:
        super().__init__()
        self.pid = pid
        self._fd = master_fd
        self._reaped: Optional[int] = None

    def resize(self, cols: int, rows: int) -> None:
        if self._fd >= 0:
            _set_winsize(self._fd, cols, rows)

    def read(self, timeout: float = 0.0) -> bytes:
        if self._fd < 0:
            return b""
        readable, _, _ = select.select([self._fd], [], [], timeout)
        if not readable:
            return b""
        try:
            return os.read(self._fd, 65536)
        except OSError:
            return b""

    def write(self, data: bytes) -> int:
        if self._fd < 0:
            raise RuntimeError("ForkPTYHandle: write on closed PTY")
        return os.write(self._fd, data)

    _KILL_STAGE_TIMEOUT_S = 5.0
    # getattr: SIGHUP/SIGKILL на Windows не определены — класс импортируется
    # и там (POSIX-путь всё равно не вызывается → dict пустой → unknown stage).
    _STAGE_SIGNALS = {
        k: s
        for k, s in (
            ("hangup", getattr(signal, "SIGHUP", None)),
            ("terminate", getattr(signal, "SIGTERM", None)),
            ("kill", getattr(signal, "SIGKILL", None)),
        )
        if s is not None
    }

    def escalate_kill(self, stage: str) -> str:
        """Одна ступень RFC-эскалации: послать сигнал, ждать ≤5s смерти.

        Возвращает `stage` (процесс умер), `{stage}_ignored` (процесс жив по
        таймауту — игнорировал сигнал), `not_running`, `error: unknown stage`.
        """
        sig = self._STAGE_SIGNALS.get(stage)
        if sig is None:
            return "error: unknown stage"
        if not self.alive():
            return "not_running"
        try:
            os.kill(self.pid, sig)
        except ProcessLookupError:
            return "not_running"
        deadline = time.monotonic() + self._KILL_STAGE_TIMEOUT_S
        while time.monotonic() < deadline:
            if not self.alive():
                return stage
            time.sleep(0.05)
        return f"{stage}_ignored"

    def close(self) -> None:
        if self._fd >= 0:
            # RFC kill-эскалация: SIGHUP → SIGTERM → SIGKILL (≤5s/ступень).
            # Не блокируется на процессе, игнорирующем SIGHUP/SIGTERM
            # (раньше close() виснул в waitpid бесконечно).
            for stage in ("hangup", "terminate", "kill"):
                result = self.escalate_kill(stage)
                if result in (stage, "not_running"):
                    break
            self._reap()
            try:
                os.close(self._fd)
            except OSError:
                pass
            self._fd = -1
        self._closed = True

    def alive(self) -> bool:
        if self._reaped is not None or self._fd < 0:
            return False
        try:
            pid, status = os.waitpid(self.pid, os.WNOHANG)
        except ChildProcessError:
            self._reaped = 0
            return False
        if pid == 0:
            return True
        self._reaped = status
        return False

    def _reap(self) -> None:
        if self._reaped is None:
            try:
                os.waitpid(self.pid, 0)
            except ChildProcessError:
                pass


class ForkPTYBackend(PTYBackend):
    """POSIX-бэкенд: forkpty + exec."""

    def spawn(self, spec: SpawnSpec) -> ForkPTYHandle:
        if not spec.command or not spec.command[0]:
            raise ValueError("spawn: command required")
        env = dict(os.environ)
        if spec.env:
            env.update(spec.env)
        pid, master = os.forkpty()
        if pid == 0:  # ребёнок
            try:
                if spec.cwd:
                    os.chdir(spec.cwd)
                os.execvpe(spec.command[0], spec.command, env)
            except BaseException:
                os._exit(127)
        if spec.cols or spec.rows:
            try:
                _set_winsize(master, spec.cols, spec.rows)
            except Exception:
                pass
        return ForkPTYHandle(pid, master)


# =============================================================================
# Windows: ConPTY (WinAPI через ctypes)
# =============================================================================

# Импорт pty/select/signal только для POSIX-веток.
if sys.platform == "win32":
    import ctypes
    from ctypes import wintypes

    _K32 = ctypes.WinDLL("kernel32", use_last_error=True)

    INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value
    STILL_ACTIVE = 259
    HANDLE_FLAG_INHERIT = 0x00000001
    PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = 0x00020016
    EXTENDED_STARTUPINFO_PRESENT = 0x00080000
    CREATE_UNICODE_ENVIRONMENT = 0x00000400
    CREATE_NO_WINDOW = 0x08000000
    STARTF_USESTDHANDLES = 0x00000100
    ERROR_INSUFFICIENT_BUFFER = 122

    class COORD(ctypes.Structure):
        """COORD (console) — {X, Y} в символах; отсутствует в wintypes."""
        _fields_ = [("X", wintypes.SHORT), ("Y", wintypes.SHORT)]

    _CreatePipe = _K32.CreatePipe
    _CreatePipe.restype = wintypes.BOOL
    _CreatePipe.argtypes = [
        ctypes.POINTER(wintypes.HANDLE), ctypes.POINTER(wintypes.HANDLE),
        ctypes.c_void_p, wintypes.DWORD,
    ]

    _CreatePseudoConsole = _K32.CreatePseudoConsole
    _CreatePseudoConsole.restype = ctypes.c_long  # HRESULT
    _CreatePseudoConsole.argtypes = [
        COORD, wintypes.HANDLE, wintypes.HANDLE, wintypes.DWORD,
        ctypes.POINTER(wintypes.HANDLE),
    ]

    _ClosePseudoConsole = _K32.ClosePseudoConsole
    _ClosePseudoConsole.restype = None
    _ClosePseudoConsole.argtypes = [wintypes.HANDLE]

    _CloseHandle = _K32.CloseHandle
    _CloseHandle.restype = wintypes.BOOL
    _CloseHandle.argtypes = [wintypes.HANDLE]

    _SetHandleInformation = _K32.SetHandleInformation
    _SetHandleInformation.restype = wintypes.BOOL
    _SetHandleInformation.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD]

    _InitializeProcThreadAttributeList = _K32.InitializeProcThreadAttributeList
    _InitializeProcThreadAttributeList.restype = wintypes.BOOL
    _InitializeProcThreadAttributeList.argtypes = [
        ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD,
        ctypes.POINTER(ctypes.c_size_t),
    ]

    _UpdateProcThreadAttribute = _K32.UpdateProcThreadAttribute
    _UpdateProcThreadAttribute.restype = wintypes.BOOL
    _UpdateProcThreadAttribute.argtypes = [
        ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD,
        ctypes.c_void_p, ctypes.c_size_t,
        ctypes.c_void_p, ctypes.POINTER(ctypes.c_size_t),
    ]

    _DeleteProcThreadAttributeList = _K32.DeleteProcThreadAttributeList
    _DeleteProcThreadAttributeList.restype = None
    _DeleteProcThreadAttributeList.argtypes = [ctypes.c_void_p]

    _CreateProcessW = _K32.CreateProcessW
    _CreateProcessW.restype = wintypes.BOOL
    _CreateProcessW.argtypes = [
        wintypes.LPCWSTR, wintypes.LPWSTR,
        ctypes.c_void_p, ctypes.c_void_p,
        wintypes.BOOL, wintypes.DWORD,
        ctypes.c_void_p, wintypes.LPCWSTR,
        ctypes.c_void_p, ctypes.c_void_p,
    ]

    _WriteFile = _K32.WriteFile
    _WriteFile.restype = wintypes.BOOL
    _WriteFile.argtypes = [
        wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p,
    ]

    _ReadFile = _K32.ReadFile
    _ReadFile.restype = wintypes.BOOL
    _ReadFile.argtypes = [
        wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p,
    ]

    _GetExitCodeProcess = _K32.GetExitCodeProcess
    _GetExitCodeProcess.restype = wintypes.BOOL
    _GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]

    _TerminateProcess = _K32.TerminateProcess
    _TerminateProcess.restype = wintypes.BOOL
    _TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]

    class STARTUPINFOW(ctypes.Structure):
        """STARTUPINFOW (WinAPI) — в ctypes.wintypes отсутствует (3.15)."""
        _fields_ = [
            ("cb", wintypes.DWORD),
            ("lpReserved", ctypes.c_wchar_p),
            ("lpDesktop", ctypes.c_wchar_p),
            ("lpTitle", ctypes.c_wchar_p),
            ("dwX", wintypes.DWORD),
            ("dwY", wintypes.DWORD),
            ("dwXSize", wintypes.DWORD),
            ("dwYSize", wintypes.DWORD),
            ("dwXCountChars", wintypes.DWORD),
            ("dwYCountChars", wintypes.DWORD),
            ("dwFillAttribute", wintypes.DWORD),
            ("dwFlags", wintypes.DWORD),
            ("wShowWindow", wintypes.WORD),
            ("cbReserved2", wintypes.WORD),
            ("lpReserved2", ctypes.POINTER(wintypes.BYTE)),
            ("hStdInput", wintypes.HANDLE),
            ("hStdOutput", wintypes.HANDLE),
            ("hStdError", wintypes.HANDLE),
        ]

    class STARTUPINFOEXW(ctypes.Structure):
        _fields_ = [
            ("StartupInfo", STARTUPINFOW),
            ("lpAttributeList", ctypes.c_void_p),
        ]

    class PROCESS_INFORMATION(ctypes.Structure):
        """PROCESS_INFORMATION (WinAPI) — отсутствует в wintypes (3.15)."""
        _fields_ = [
            ("hProcess", wintypes.HANDLE),
            ("hThread", wintypes.HANDLE),
            ("dwProcessId", wintypes.DWORD),
            ("dwThreadId", wintypes.DWORD),
        ]

    def _win_check(ok: bool, what: str) -> None:
        if not ok:
            raise OSError(ctypes.get_last_error(), what)

    def _make_pipe(inherit: bool = False) -> tuple[int, int]:
        """Анонимный pipe. inherit=True → оба конца наследуемые (нужно,
        когда концы отдаём std-хендлами дочернему процессу)."""
        read_end = wintypes.HANDLE()
        write_end = wintypes.HANDLE()
        if inherit:
            class _SA(ctypes.Structure):
                _fields_ = [
                    ("nLength", wintypes.DWORD),
                    ("lpSecurityDescriptor", wintypes.LPVOID),
                    ("bInheritHandle", wintypes.BOOL),
                ]
            sa = _SA()
            sa.nLength = ctypes.sizeof(sa)
            sa.bInheritHandle = True
            _win_check(
                _CreatePipe(ctypes.byref(read_end), ctypes.byref(write_end),
                            ctypes.byref(sa), 0),
                "CreatePipe",
            )
        else:
            _win_check(
                _CreatePipe(ctypes.byref(read_end), ctypes.byref(write_end), None, 0),
                "CreatePipe",
            )
        return read_end.value, write_end.value

    def _build_cmdline(argv: list[str]) -> str:
        """cmdline по правилам CommandLineToArgvW: \\ и \" перед кавычкой
        удваиваются/экранируются, пустой аргумент — ""."""
        parts = []
        for arg in argv:
            if arg and not any(ch.isspace() for ch in arg) and '"' not in arg:
                parts.append(arg)
                continue
            out = []
            backslashes = 0
            for ch in arg:
                if ch == "\\":
                    backslashes += 1
                elif ch == '"':
                    out.append("\\" * (backslashes * 2 + 1))
                    out.append('"')
                    backslashes = 0
                else:
                    out.append("\\" * backslashes)
                    out.append(ch)
                    backslashes = 0
            out.append("\\" * (backslashes * 2))  # хвост перед закрывающей "
            parts.append('"' + "".join(out) + '"')
        return " ".join(parts)

    def _build_env_block(extra: Optional[dict]) -> ctypes.c_wchar_p:
        """Среда процесса: os.environ ∪ extra → KEY=VAL\\0...\\0\\0 (wide)."""
        env = dict(os.environ)
        if extra:
            env.update({str(k): str(v) for k, v in extra.items()})
        block = "".join(f"{k}={v}\0" for k, v in sorted(env.items())) + "\0"
        return ctypes.c_wchar_p(block)

    class _ConPTYReader(threading.Thread):
        """Читает вывод псевдоконсоли в очередь (безграничная — дропать
        вывод при переполнении нельзя: потеря кусков экрана)."""

        def __init__(self, h_out_read: int) -> None:
            super().__init__(daemon=True, name="conpty-reader")
            self._h = h_out_read
            self.queue: Queue[bytes] = Queue()

        def run(self) -> None:
            while True:
                buf = ctypes.create_string_buffer(4096)
                nread = wintypes.DWORD()
                ok = _ReadFile(self._h, buf, len(buf), ctypes.byref(nread), None)
                if not ok or nread.value == 0:
                    break
                self.queue.put(buf.raw[:nread.value])

    class ConPTYHandle(PTYHandle):
        """PTY-хендл поверх ConPTY (Windows)."""

        def __init__(self, pc: int, h_in_write: int, h_out_read: int,
                     proc_info: PROCESS_INFORMATION, reader: _ConPTYReader,
                     h_sig_write: int = 0) -> None:
            super().__init__()
            self._pc = pc
            self._in_write = h_in_write
            self._out_read = h_out_read
            self._sig_write = h_sig_write
            self._proc = proc_info.hProcess
            self.pid = int(proc_info.dwProcessId)
            self._reader = reader
            self._queue = reader.queue

        # PtySignal::ResizeWindow = 8 (microsoft/terminal
        # src/host/PtySignalInputThread.hpp). Пакет — ЛЕНТОЧНЫЙ поток без
        # length-prefix: uint16 signal + uint16 sx(width) + uint16 sy(height),
        # little-endian; resize до подключения клиента складывается в
        # _earlyResize и применяется на ConnectConsole.
        _PTY_SIGNAL_RESIZE_WINDOW = 8

        def resize(self, cols: int, rows: int) -> None:
            """ResizeWindow-пакет в --signal-pipe OpenConsole (#542).

            Тихий no-op если signal-pipe не создан (совместимость со
            старыми хендлами/тестами без --signal). Размеры — ячейки,
            uint16: вне 1..65535 → ValueError.
            """
            if not self._sig_write:
                return
            cols_i, rows_i = int(cols), int(rows)
            if not (1 <= cols_i <= 0xFFFF and 1 <= rows_i <= 0xFFFF):
                raise ValueError(
                    f"resize: cols/rows must be 1..65535, got {cols}x{rows}"
                )
            import struct
            pkt = struct.pack("<HHH", self._PTY_SIGNAL_RESIZE_WINDOW,
                              cols_i, rows_i)
            buf = ctypes.create_string_buffer(pkt)
            written = wintypes.DWORD()
            _WriteFile(self._sig_write, buf, len(pkt),
                       ctypes.byref(written), None)

        def read(self, timeout: float = 0.0) -> bytes:
            try:
                if timeout > 0:
                    return self._queue.get(timeout=timeout)
                return self._queue.get_nowait()
            except Empty:
                return b""

        def write(self, data: bytes) -> int:
            if not self._in_write:
                raise RuntimeError("ConPTYHandle: write on closed PTY")
            buf = ctypes.create_string_buffer(data)
            written = wintypes.DWORD()
            _win_check(
                _WriteFile(self._in_write, buf, len(data), ctypes.byref(written), None),
                "WriteFile",
            )
            return int(written.value)

        def close(self) -> None:
            # OpenConsole-трамплин: _proc — это сам OpenConsole; его
            # TerminateProcess гасит консольный teardown вместе с
            # shell-клиентом (доказано: cmd child умирает с OC, #525).
            # Без этого OC остался бы сиротой: reader висел бы на
            # ReadFile(out_read) вечно.
            if self._pc:
                _ClosePseudoConsole(self._pc)
                self._pc = 0
            if self._proc and self.alive():
                _TerminateProcess(self._proc, 1)
            self._reader.join(timeout=1.5)
            if self._reader.is_alive() and self._out_read:
                _CloseHandle(self._out_read)
                self._out_read = 0
                self._reader.join(timeout=1.0)
            if self._out_read:
                _CloseHandle(self._out_read)
                self._out_read = 0
            if self._in_write:
                _CloseHandle(self._in_write)
                self._in_write = 0
            if self._sig_write:
                _CloseHandle(self._sig_write)
                self._sig_write = 0
            if self._proc:
                _CloseHandle(self._proc)
                self._proc = 0
            self._closed = True

        def escalate_kill(self, stage: str) -> str:
            """RFC-ступени: hangup = EOF на stdin консоли (graceful),
            terminate/kill = TerminateProcess(OpenConsole). Контракт как у
            POSIX-половины (MERC #298)."""
            if stage == "hangup":
                if self._pc:
                    _ClosePseudoConsole(self._pc)
                    self._pc = 0
                elif self._in_write:
                    # Закрытие stdin-пайпа = EOF консольного ввода;
                    # shell может завершиться сам (как ClosePseudoConsole).
                    _CloseHandle(self._in_write)
                    self._in_write = 0
                return "hangup" if not self.alive() else "hangup_ignored"
            if stage in ("terminate", "kill"):
                if not self._proc:
                    return "not_running"
                _TerminateProcess(self._proc, 1)
                return stage if not self.alive() else f"{stage}_ignored"
            return "error: unknown stage"

        def alive(self) -> bool:
            if not self._proc:
                return False
            code = wintypes.DWORD()
            if not _GetExitCodeProcess(self._proc, ctypes.byref(code)):
                return False
            return int(code.value) == STILL_ACTIVE

        @property
        def session_ended(self) -> bool:
            """True, когда дочерний процесс вышел (код выхода записан).

            Без этого супервизор классифицирует естественное завершение команды
            как lost, а не exited → терминал застревает в idle (баг #362-2).
            Аналогично mock_pty.MockPTYHandle.session_ended.
            """
            if not self._proc:
                return False
            code = wintypes.DWORD()
            if not _GetExitCodeProcess(self._proc, ctypes.byref(code)):
                return False
            return int(code.value) != STILL_ACTIVE

    class ConPTYBackend(PTYBackend):
        """Windows-бэкенд: ConPTY через OpenConsole-трамплин (ctypes).

        kernel32!CreatePseudoConsole + PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE
        на Windows не присоединяет ребёнка к HPCON: ребёнок получает
        auto-console → stdin EOF → смерть интерактива за 2–12с (#521/#525,
        reports/SPARK-openconsole-525.md). Рабочая модель — спавним
        vendored OpenConsole.exe --headless с pipe std-хендлами: он сам
        поднимает консоль и default shell (cmd.exe), команда уходит
        текстом в shell через stdin-pipe.
        """

        _OC_PATH = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "conpty", "x64", "OpenConsole.exe",
        )

        @staticmethod
        def _is_plain_shell(command: list[str]) -> bool:
            """command == [cmd.exe]/[cmd] — OC уже даёт этот shell,
            инжектить текстом не нужно (иначе вложенный cmd и session
            не завершится по exit)."""
            return (
                len(command) == 1
                and os.path.basename(command[0]).lower() in ("cmd.exe", "cmd")
            )

        def spawn(self, spec: SpawnSpec) -> ConPTYHandle:
            if not spec.command or not spec.command[0]:
                raise ValueError("spawn: command required")
            oc = self._OC_PATH
            if not os.path.isfile(oc):
                raise OSError(
                    2,
                    f"OpenConsole.exe not found: {oc} "
                    "(ConPTY-трамплин требует vendored conpty/x64/OpenConsole.exe)",
                )
            in_read = in_write = out_read = out_write = None
            sig_read = sig_write = None
            proc_info: Optional[PROCESS_INFORMATION] = None
            try:
                in_read, in_write = _make_pipe()
                out_read, out_write = _make_pipe()
                # --signal-pipe (#542): OC читает ResizeWindow-пакеты из
                # sig_read; родитель пишет в sig_write при resize().
                sig_read, sig_write = _make_pipe()
                # Концы, которые достаются OpenConsole как std-хендлы
                # (его stdin-read и stdout/stderr-write) плюс signal-read,
                # обязаны быть наследуемыми; родительские концы приватны.
                for h in (in_read, out_write, sig_read):
                    _win_check(
                        _SetHandleInformation(h, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT),
                        "SetHandleInformation",
                    )

                startup = STARTUPINFOW()
                startup.cb = ctypes.sizeof(STARTUPINFOW)
                startup.dwFlags = STARTF_USESTDHANDLES
                startup.hStdInput = in_read
                startup.hStdOutput = out_write
                startup.hStdError = out_write

                proc_info = PROCESS_INFORMATION()
                oc_cmdline = _build_cmdline(
                    [oc, "--headless",
                     "--width", str(max(1, int(spec.cols or 80))),
                     "--height", str(max(1, int(spec.rows or 24))),
                     "--signal", f"0x{sig_read:x}"],
                )
                cmdline_buf = ctypes.create_unicode_buffer(oc_cmdline)
                env_block = _build_env_block(spec.env)
                _win_check(
                    _CreateProcessW(
                        None, cmdline_buf, None, None, True,
                        CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
                        env_block, spec.cwd,
                        ctypes.byref(startup), ctypes.byref(proc_info),
                    ),
                    "CreateProcessW(OpenConsole)",
                )

                # OC владеет stdin-read/stdout-write/signal-read концами —
                # закрываем свои копии; hThread не нужен.
                _CloseHandle(in_read)
                in_read = None
                _CloseHandle(out_write)
                out_write = None
                _CloseHandle(sig_read)
                sig_read = None
                _CloseHandle(proc_info.hThread)

                reader = _ConPTYReader(out_read)
                reader.start()

                # Команда уходит в default shell (cmd) через nx_exec_shim:
                # spawn пишет argv/cwd/env в JSON-файл и инжектит
                # ФИКСИРОВАННУЮ строку запуска шима — пользовательские
                # данные не проходят cmd-парсер вообще (#532: кавычки и
                # метасимволы | & < > ^ % ! доходят без деградации).
                # Plain-shell ([cmd.exe]) — OC уже даёт этот shell.
                if not self._is_plain_shell(spec.command):
                    import json as _json
                    import tempfile as _tempfile
                    shim = os.path.join(
                        os.path.dirname(os.path.abspath(__file__)),
                        "nx_exec_shim.py",
                    )
                    # pythonw.exe (демон) не имеет консоли — его std-хендлы
                    # NULL, вывод шима/команды теряется. Берём sibling
                    # python.exe из того же каталога (#532 dogfood).
                    py = sys.executable or "python"
                    if os.path.basename(py).lower() == "pythonw.exe":
                        cand = os.path.join(os.path.dirname(py), "python.exe")
                        py = cand if os.path.isfile(cand) else "python"
                    fd, spec_path = _tempfile.mkstemp(
                        prefix="nx_exec_", suffix=".json")
                    try:
                        with os.fdopen(fd, "w", encoding="utf-8") as f:
                            _json.dump(
                                {
                                    "argv": [str(a) for a in spec.command],
                                    "cwd": spec.cwd,
                                    "env": (
                                        {str(k): str(v) for k, v in spec.env.items()}
                                        if spec.env else None
                                    ),
                                },
                                f,
                            )
                        payload = (
                            _build_cmdline([py, shim, spec_path]) + "\r\n"
                        ).encode("utf-8", "replace")
                        buf = ctypes.create_string_buffer(payload)
                        written = wintypes.DWORD()
                        _win_check(
                            _WriteFile(in_write, buf, len(payload),
                                       ctypes.byref(written), None),
                            "WriteFile(cmdline)",
                        )
                    except BaseException:
                        try:
                            os.unlink(spec_path)
                        except OSError:
                            pass
                        raise

                # pc=0: HPCON нет — handle живёт на процессе OpenConsole.
                return ConPTYHandle(
                    0, in_write, out_read, proc_info, reader,
                    h_sig_write=sig_write or 0,
                )
            except BaseException:
                if proc_info is not None:
                    if proc_info.hProcess:
                        _CloseHandle(proc_info.hProcess)
                    if proc_info.hThread:
                        _CloseHandle(proc_info.hThread)
                for h in (in_read, in_write, out_read, out_write,
                          sig_read, sig_write):
                    if h:
                        _CloseHandle(h)
                raise


def get_default_backend() -> PTYBackend:
    """Реальный бэкенд по платформе (без mock)."""
    if sys.platform == "win32":
        return ConPTYBackend()
    return ForkPTYBackend()
