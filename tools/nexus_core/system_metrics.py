#!/usr/bin/env python3
"""
tools/nexus_core/system_metrics.py — метрики хоста для GET /api/core/system (#537).

Без новых зависимостей (psutil не установлен):
- Windows: kernel32/iphlpapi через ctypes (GetSystemTimes,
  GlobalMemoryStatusEx, GetDiskFreeSpaceExW, GetIfTable, GetTickCount64);
- POSIX: /proc/stat, /proc/meminfo, /proc/uptime, os.statvfs, /proc/net/dev;
- GPU: nvidia-smi subprocess (если есть в PATH), кэш 3с — вызов ~300мс.

cpu_pct и net rx/tx_bps — по ДЕЛЬТЕ двух сэмплов: SystemMetrics хранит
предыдущий сэмпл, первый collect() делает короткий двойной замер (~100мс),
чтобы отдать осмысленное значение сразу, а не нули.
"""

from __future__ import annotations

import ctypes
import os
import shutil
import subprocess
import time
from typing import Any, Dict, Optional

if os.name == "nt":
    from ctypes import wintypes

    _K32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _IPHLP = ctypes.WinDLL("iphlpapi", use_last_error=True)

    class _MEMORYSTATUSEX(ctypes.Structure):
        _fields_ = [
            ("dwLength", wintypes.DWORD),
            ("dwMemoryLoad", wintypes.DWORD),
            ("ullTotalPhys", ctypes.c_ulonglong),
            ("ullAvailPhys", ctypes.c_ulonglong),
            ("ullTotalPageFile", ctypes.c_ulonglong),
            ("ullAvailPageFile", ctypes.c_ulonglong),
            ("ullTotalVirtual", ctypes.c_ulonglong),
            ("ullAvailVirtual", ctypes.c_ulonglong),
            ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
        ]

    class _FILETIME(ctypes.Structure):
        _fields_ = [("dwLowDateTime", wintypes.DWORD),
                    ("dwHighDateTime", wintypes.DWORD)]

    class _MIB_IFROW(ctypes.Structure):
        """MIB_IFROW (iphlpapi). Счётчики 32-битные: при wrap (>4GiB)
        сумма кластера падает → _rates даёт 0 на один сэмпл и ребазится
        (self._prev=cur), потери ограничены одним интервалом опроса."""
        _fields_ = [
            ("wszName", wintypes.WCHAR * 256),
            ("dwIndex", wintypes.DWORD),
            ("dwType", wintypes.DWORD),
            ("dwMtu", wintypes.DWORD),
            ("dwSpeed", wintypes.DWORD),
            ("dwPhysAddrLen", wintypes.DWORD),
            ("bPhysAddr", wintypes.BYTE * 8),
            ("dwAdminStatus", wintypes.DWORD),
            ("dwOperStatus", wintypes.DWORD),
            ("dwLastChange", wintypes.DWORD),
            ("dwInOctets", wintypes.DWORD),
            ("dwInUcastPkts", wintypes.DWORD),
            ("dwInNUcastPkts", wintypes.DWORD),
            ("dwInDiscards", wintypes.DWORD),
            ("dwInErrors", wintypes.DWORD),
            ("dwInUnknownProtos", wintypes.DWORD),
            ("dwOutOctets", wintypes.DWORD),
            ("dwOutUcastPkts", wintypes.DWORD),
            ("dwOutNUcastPkts", wintypes.DWORD),
            ("dwOutDiscards", wintypes.DWORD),
            ("dwOutErrors", wintypes.DWORD),
            ("dwOutQLen", wintypes.DWORD),
            ("dwDescrLen", wintypes.DWORD),
            ("bDescr", wintypes.BYTE * 256),
        ]

    _IF_TYPE_SOFTWARE_LOOPBACK = 24

    # GetIfTable возвращает DWORD = код ошибки (NO_ERROR=0 = УСПЕХ!) —
    # проверять надо !=0, не falsy.
    _IPHLP.GetIfTable.restype = wintypes.DWORD
    _IPHLP.GetIfTable.argtypes = [
        ctypes.c_void_p, ctypes.POINTER(wintypes.DWORD), wintypes.BOOL,
    ]

    def _filetime_val(ft: "_FILETIME") -> int:
        return (int(ft.dwHighDateTime) << 32) | int(ft.dwLowDateTime)


_GPU_CACHE_TTL_S = 3.0
_GPU_QUERY_TIMEOUT_S = 3.0


def _collect_gpu() -> Optional[Dict[str, Any]]:
    """nvidia-smi → {pct, vram_used, vram_total, temp} первой GPU или None."""
    exe = shutil.which("nvidia-smi")
    if not exe:
        return None
    try:
        # stdout -> temp file, NOT a pipe: on Windows run()'s post-timeout
        # communicate() can block forever waiting for pipe EOF if a
        # grandchild inherited the handle. File output avoids the pipe
        # entirely; after kill we just read the file.
        import tempfile
        fd, tmp = tempfile.mkstemp(prefix="nxgpu-", suffix=".txt")
        try:
            with open(fd, "w", encoding="utf-8", errors="replace") as f:
                subprocess.run(
                    [exe, "--query-gpu=utilization.gpu,memory.used,"
                          "memory.total,temperature.gpu",
                          "--format=csv,noheader,nounits"],
                    stdout=f, stderr=subprocess.DEVNULL,
                    timeout=_GPU_QUERY_TIMEOUT_S,
                )
            with open(tmp, "r", encoding="utf-8",
                      errors="replace") as rf:
                out_text = rf.read().strip()
        finally:
            try:
                os.unlink(tmp)
            except OSError:
                pass
    except Exception:
        return None
    if not out_text:
        return None
    line = out_text.splitlines()[0]
    parts = [p.strip() for p in line.split(",")]
    if len(parts) < 4:
        return None
    try:
        return {
            "pct": float(parts[0]),
            "vram_used": int(float(parts[1])),
            "vram_total": int(float(parts[2])),
            "temp": float(parts[3]),
        }
    except ValueError:
        return None


def _win_cpu_times() -> tuple[float, float, float]:
    """(idle, kernel, user) в секундах. kernel включает idle."""
    idle = _FILETIME()
    kern = _FILETIME()
    user = _FILETIME()
    if not _K32.GetSystemTimes(
        ctypes.byref(idle), ctypes.byref(kern), ctypes.byref(user)
    ):
        return 0.0, 0.0, 0.0
    return (_filetime_val(idle) / 1e7,
            _filetime_val(kern) / 1e7,
            _filetime_val(user) / 1e7)


def _posix_cpu_times() -> tuple[float, float, float]:
    try:
        with open("/proc/stat", "r", encoding="ascii") as f:
            parts = f.readline().split()[1:]
        vals = [int(x) for x in parts]
        idle = vals[3] + (vals[4] if len(vals) > 4 else 0)  # idle+iowait
        total = float(sum(vals))
        return idle / os.sysconf("SC_CLK_TCK"), total / os.sysconf("SC_CLK_TCK"), 0.0
    except Exception:
        return 0.0, 0.0, 0.0


def _win_mem() -> tuple[int, int]:
    st = _MEMORYSTATUSEX()
    st.dwLength = ctypes.sizeof(st)
    if not _K32.GlobalMemoryStatusEx(ctypes.byref(st)):
        return 0, 0
    return int(st.ullTotalPhys), int(st.ullAvailPhys)


def _posix_mem() -> tuple[int, int]:
    info = {}
    try:
        with open("/proc/meminfo", "r", encoding="ascii") as f:
            for line in f:
                k, _, rest = line.partition(":")
                info[k.strip()] = int(rest.strip().split()[0]) * 1024
        total = info.get("MemTotal", 0)
        avail = info.get("MemAvailable", info.get("MemFree", 0))
        return total, avail
    except Exception:
        return 0, 0


def _win_disks() -> list:
    disks = []
    for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        root = f"{letter}:\\"
        if not os.path.exists(root):
            continue
        free = ctypes.c_ulonglong()
        total = ctypes.c_ulonglong()
        if not _K32.GetDiskFreeSpaceExW(
            root, None, ctypes.byref(total), ctypes.byref(free)
        ):
            continue
        disks.append({
            "letter": letter + ":",
            "free": int(free.value),
            "total": int(total.value),
        })
    return disks


def _posix_disks() -> list:
    disks = []
    try:
        for mount in ("/", "/home", "/mnt", "/media"):
            if not os.path.exists(mount):
                continue
            st = os.statvfs(mount)
            disks.append({
                "letter": mount,
                "free": int(st.f_bavail * st.f_frsize),
                "total": int(st.f_blocks * st.f_frsize),
            })
    except OSError:
        pass
    return disks


# GetIfTable на Windows отдаёт ОДНУ физическую NIC несколькими строками
# (per-binding GUID'ы TCPIP_{...}) с идентичными счётчиками — проверено на
# Windows: 12 nonzero-строк = 3 реальных интерфейса. Счётчики строк-алиасов
# синхронны с точностью до гонки чтения (~килобайты), поэтому кластеризуем
# по близости значений и берём max кластера.
_NET_CLUSTER_TOL = 1024 * 1024  # 1 MiB — покрывает дрейф алиасов


def _win_net_octets() -> tuple[int, int]:
    """Суммарные In/OutOctets по admin-up не-loopback интерфейсам.

    Строки-алиасы одной NIC склеиваются кластеризацией по близости
    счётчиков (см. _NET_CLUSTER_TOL); из кластера берётся max.
    """
    size = wintypes.DWORD(0)
    buf = None
    # Между вызовами таблица может вырасти (новый интерфейс) — 122 на
    # втором вызове означает "перечитать размер", поэтому до 2 попыток.
    for _ in range(2):
        rc = _IPHLP.GetIfTable(None, ctypes.byref(size), False)
        if rc != 122 or size.value <= 0 or size.value > 16 * 1024 * 1024:
            return 0, 0
        buf = (ctypes.c_char * size.value)()
        rc = _IPHLP.GetIfTable(buf, ctypes.byref(size), False)
        if rc == 0:
            break
        buf = None
    if buf is None:
        return 0, 0
    num = int.from_bytes(bytes(buf[:4]), "little")  # MIB_IFTABLE.numEntries
    row_size = ctypes.sizeof(_MIB_IFROW)
    base = ctypes.addressof(buf)
    clusters: list[list[int]] = []  # [[max_in, max_out], ...]
    off = 4
    for _ in range(num):
        if off + row_size > size.value:
            break
        row = _MIB_IFROW.from_buffer_copy(
            ctypes.string_at(base + off, row_size))
        off += row_size
        # Фильтр по admin-up: oper-status на ряде драйверов залипает в
        # dormant(5) даже при реальном трафике.
        if row.dwAdminStatus != 1 or row.dwType == _IF_TYPE_SOFTWARE_LOOPBACK:
            continue
        rin, rout = int(row.dwInOctets), int(row.dwOutOctets)
        for cl in clusters:
            if (abs(rin - cl[0]) <= _NET_CLUSTER_TOL
                    and abs(rout - cl[1]) <= _NET_CLUSTER_TOL):
                cl[0] = max(cl[0], rin)
                cl[1] = max(cl[1], rout)
                break
        else:
            clusters.append([rin, rout])
    return sum(c[0] for c in clusters), sum(c[1] for c in clusters)


def _posix_net_octets() -> tuple[int, int]:
    rx = tx = 0
    try:
        with open("/proc/net/dev", "r", encoding="ascii") as f:
            for line in f.readlines()[2:]:
                name, _, rest = line.partition(":")
                if name.strip() == "lo":
                    continue
                vals = rest.split()
                rx += int(vals[0])
                tx += int(vals[8])
    except Exception:
        pass
    return rx, tx


class SystemMetrics:
    """Коллектор со сэмпл-кэшем для rate-метрик (cpu/net) и GPU."""

    def __init__(self) -> None:
        self._prev: Optional[tuple] = None  # (t, idle, total, rx, tx)
        self._gpu_cache: tuple = (0.0, None)  # (ts, value)

    def _sample(self) -> tuple:
        t = time.monotonic()
        if os.name == "nt":
            idle, kern, user = _win_cpu_times()
            # kernel-time на Windows УЖЕ включает idle — total = kern+user.
            total = kern + user
            net = _win_net_octets()
        else:
            idle, total, _ = _posix_cpu_times()
            net = _posix_net_octets()
        return (t, idle, total, net[0], net[1])

    def _rates(self, prev: tuple, cur: tuple) -> tuple[float, float, float]:
        dt = cur[0] - prev[0]
        dtotal = cur[2] - prev[2]
        didle = cur[1] - prev[1]
        cpu = 0.0
        if dt > 0 and dtotal > 0:
            cpu = max(0.0, min(100.0, (1.0 - didle / dtotal) * 100.0))
        rx = tx = 0.0
        if dt > 0:
            rx = max(0.0, (cur[3] - prev[3]) / dt)
            tx = max(0.0, (cur[4] - prev[4]) / dt)
        return cpu, rx, tx

    def collect(self) -> Dict[str, Any]:
        """Текущий снимок: {cpu_pct, mem_*, disks, net, gpu, uptime_s}."""
        if os.name == "nt":
            mem_total, mem_avail = _win_mem()
            disks = _win_disks()
            uptime = _K32.GetTickCount64() / 1000.0
        else:
            mem_total, mem_avail = _posix_mem()
            disks = _posix_disks()
            try:
                with open("/proc/uptime", "r", encoding="ascii") as f:
                    uptime = float(f.read().split()[0])
            except Exception:
                uptime = 0.0

        # Первый сэмпл: короткий двойной замер, чтобы rate'ы были живыми.
        prev = self._prev
        if prev is None:
            time.sleep(0.1)
            prev = self._sample()
        cur = self._sample()
        self._prev = cur
        cpu_pct, rx_bps, tx_bps = self._rates(prev, cur)

        # GPU с TTL-кэшем (nvidia-smi ~300мс).
        now = time.monotonic()
        gpu_ts, gpu_val = self._gpu_cache
        if now - gpu_ts > _GPU_CACHE_TTL_S:
            gpu_val = _collect_gpu()
            self._gpu_cache = (now, gpu_val)

        return {
            "cpu_pct": round(cpu_pct, 1),
            "mem_used": mem_total - mem_avail,
            "mem_total": mem_total,
            "disks": disks,
            "net": {"rx_bps": round(rx_bps, 1), "tx_bps": round(tx_bps, 1)},
            "gpu": gpu_val,
            "uptime_s": round(uptime, 1),
        }


_default: Optional[SystemMetrics] = None


def get_system_metrics() -> SystemMetrics:
    """Singleton для endpoint'а (сэмпл-кэш должен переживать запросы)."""
    global _default
    if _default is None:
        _default = SystemMetrics()
    return _default
