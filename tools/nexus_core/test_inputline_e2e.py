#!/usr/bin/env python3
"""test_inputline_e2e.py — W82 e2e для NEWF InputLine на реальном ConPTY.

Проверяет сквозной путь UI-ввода → API → ConPTY:

  UI InputLine (newf-terminals-grid.tsx):
    line-режим → bridge.sendLine → POST /api/core/send {enter:true}
    raw-режим  → bridge.sendRaw  → POST /api/core/send {enter:false}
    клавиши    → bridge.keys     → POST /api/core/keys {keys:[...]}

Сценарии (cmd.exe, scratch-демон, без CORE_MOCK):
  1. spawn cmd-терминала
  2. send enter:true  «echo MARK»   → команда ИСПОЛНЕНА (маркер ×2:
     echo ввода + строка вывода)
  3. send enter:false «echo MARK»   → НЕ исполнена (маркер ×1 — только
     echo ввода; sendRaw passthrough пишет текст без Enter)
  4. keys [enter]                  → завершает отложенную строку
     (маркер ×2) — keys и send делят один stdin-поток
  5. keys [ctrl+c] на частичной строке → «^C», вывод не появляется
  6. sendRaw с сырым байтом \\x03 (ETX) → «^C» — verbatim passthrough
     в отличие от именованного keymap в /keys

Запуск:  python tools/nexus_core/test_inputline_e2e.py [--port N]
Выход:   0 все PASS / 1 есть FAIL / 2 окружение. Только stdlib.
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
TIMEOUT = 30

_results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, note: str = "") -> None:
    _results.append((name, ok, note))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}"
          + (f" — {note}" if note else ""))


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def api(port: int, method: str, path: str, body=None):
    url = f"http://127.0.0.1:{port}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            raw = r.read()
            try:
                return r.status, json.loads(raw)
            except json.JSONDecodeError:
                return r.status, {"_raw": raw[:200].decode("utf-8", "replace")}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, {"_raw": raw[:200].decode("utf-8", "replace")}


def screen(port: int, term: str) -> str:
    st, d = api(port, "GET", f"/api/core/screen/{term}?lines=200")
    if st != 200 or not isinstance(d, dict):
        return ""
    return str(d.get("screen", ""))


def count(hay: str, needle: str) -> int:
    return hay.count(needle)


def wait_screen(port: int, term: str, needle: str, want: int,
                timeout: float = 12.0) -> tuple[int, str]:
    """Ждать пока count(needle) >= want; вернуть (count, last_screen)."""
    deadline = time.time() + timeout
    txt = ""
    while time.time() < deadline:
        txt = screen(port, term)
        if count(txt, needle) >= want:
            return count(txt, needle), txt
        time.sleep(0.5)
    return count(txt, needle), txt


def wait_ready(port: int, proc: subprocess.Popen, deadline: float) -> bool:
    while time.time() < deadline:
        if proc.poll() is not None:
            return False
        try:
            with urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/api/core/server",
                    timeout=2) as r:
                if r.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(0.4)
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=0,
                    help="0 = свободный порт")
    ap.add_argument("--keep", action="store_true",
                    help="не убивать scratch-демон (debug)")
    args = ap.parse_args()
    port = args.port or free_port()
    base = Path(tempfile.mkdtemp(prefix="nexus-inputline-e2e-"))

    env = dict(os.environ)
    env["NEXUS_CORE_TOKEN"] = ""
    env["NEXUS_CORE_READ_TOKEN"] = ""
    env.pop("CORE_MOCK", None)  # реальный ConPTY backend

    log = open(base / f"server-{port}.log", "wb")
    proc = subprocess.Popen(
        [sys.executable, "-m", "tools.nexus_core.api",
         "--port", str(port), "--base", str(base)],
        cwd=str(REPO), env=env, stdout=log, stderr=subprocess.STDOUT)
    print(f"scratch core: pid={proc.pid} port={port} base={base}")
    term = f"il-{os.getpid() % 100000:05d}"
    try:
        if not wait_ready(port, proc, time.time() + 25):
            print("FAIL: core не поднялся за 25s — см. server.log")
            return 2

        st, d = api(port, "POST", "/api/core/run",
                    {"command": ["cmd"], "name": term, "keep": True})
        check("spawn cmd", st in (200, 201), f"{st} {d}")
        if st not in (200, 201):
            return 1
        time.sleep(2.0)  # ConPTY init

        # --- 2. sendLine: enter=true → исполнение ---
        m_line = f"IL-A-{os.getpid() % 10000}"
        st, d = api(port, "POST", "/api/core/send",
                    {"term": term, "text": f"echo {m_line}",
                     "enter": True})
        check("send enter:true → 200", st == 200, f"{st} {d}")
        n, _ = wait_screen(port, term, m_line, 2)
        check("enter:true исполнил команду", n >= 2,
              f"count={n} (echo+output)")

        # --- 3. sendRaw: enter=false → только ввод, без Enter ---
        m_raw = f"IL-B-{os.getpid() % 10000}"
        st, d = api(port, "POST", "/api/core/send",
                    {"term": term, "text": f"echo {m_raw}",
                     "enter": False})
        check("send enter:false → 200", st == 200, f"{st} {d}")
        time.sleep(2.5)  # дать echo ввода осесть, выводу — не появиться
        txt = screen(port, term)
        n_raw = count(txt, m_raw)
        check("enter:false НЕ исполнил", n_raw == 1,
              f"count={n_raw} (только echo ввода, ждали 1)")

        # --- 4. keys [enter] завершает отложенную строку ---
        st, d = api(port, "POST", "/api/core/keys",
                    {"term": term, "keys": ["enter"]})
        check("keys enter → 200", st == 200, f"{st} {d}")
        n, _ = wait_screen(port, term, m_raw, 2)
        check("keys enter исполнил строку", n >= 2,
              f"count={n}")

        # --- 5. keys [ctrl+c] на частичной строке → строка сброшена ---
        # cmd.exe под ConPTY не всегда рисует «^C» — проверяем
        # поведенчески: прерванный текст не исполняется, shell жив.
        m_int = f"IL-C-{os.getpid() % 10000}"
        api(port, "POST", "/api/core/send",
            {"term": term, "text": f"echo {m_int}", "enter": False})
        time.sleep(1.0)
        st, d = api(port, "POST", "/api/core/keys",
                    {"term": term, "keys": ["ctrl+c"]})
        check("keys ctrl+c → 200", st == 200, f"{st} {d}")
        time.sleep(1.5)
        txt = screen(port, term)
        n_int = count(txt, m_int)
        check("ctrl+c не исполнил строку", n_int <= 1,
              f"count={n_int} (echo ввода, вывода нет)")
        m_c2 = f"IL-C2-{os.getpid() % 10000}"
        api(port, "POST", "/api/core/send",
            {"term": term, "text": f"echo {m_c2}", "enter": True})
        n, _ = wait_screen(port, term, m_c2, 2)
        check("после ctrl+c shell исполняет дальше", n >= 2,
              f"count={n}")
        # если ctrl+c НЕ очистил строку, echo склеился бы в
        # «echo IL-C-…echo IL-C2-…» → вывод содержал бы m_int повторно
        txt = screen(port, term)
        check("ctrl+c очистил строку (m_int не склеился)",
              count(txt, m_int) <= 1,
              f"count={count(txt, m_int)}")

        # --- 6. sendRaw verbatim: сырой байт \x03 (ETX) = Ctrl+C ---
        # JSON "\u0003" → UTF-8 байт 0x03 → ConPTY видит ETX.
        # Отличие от /keys: keys мапит имена, send пишет байты as-is.
        api(port, "POST", "/api/core/send",
            {"term": term, "text": "echo IL-D", "enter": False})
        time.sleep(0.8)
        st, d = api(port, "POST", "/api/core/send",
                    {"term": term, "text": "\u0003", "enter": False})
        check("sendRaw \\x03 → 200", st == 200, f"{st} {d}")
        time.sleep(1.5)
        txt = screen(port, term)
        check("raw \\x03 не исполнил echo IL-D",
              count(txt, "IL-D") <= 1, "")
        m_e = f"IL-E-{os.getpid() % 10000}"
        api(port, "POST", "/api/core/send",
            {"term": term, "text": f"echo {m_e}", "enter": True})
        n, _ = wait_screen(port, term, m_e, 2)
        check("после raw \\x03 shell исполняет дальше", n >= 2,
              f"count={n}")
        # если \x03 НЕ очистил строку, echo склеился бы в
        # «echo IL-Decho IL-E-…» → вывод содержал бы IL-D повторно
        txt = screen(port, term)
        check("raw \\x03 очистил строку (IL-D не склеился)",
              count(txt, "IL-D") <= 1,
              f"count={count(txt, 'IL-D')}")

        # --- sanity: терминал жив после всех passthrough ---
        st, d = api(port, "GET", "/api/core/terminals")
        terms = d.get("terminals", []) if isinstance(d, dict) else []
        alive = any(t.get("name") == term and t.get("state") != "exited"
                    for t in terms)
        check("terminal жив после серии", alive, f"terms={len(terms)}")

    finally:
        api(port, "POST", "/api/core/kill", {"term": term})
        time.sleep(0.5)
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        log.close()
        if not args.keep:
            import shutil
            shutil.rmtree(base, ignore_errors=True)

    passed = sum(1 for _, ok, _ in _results if ok)
    print(f"\n{passed}/{len(_results)} PASS")
    return 0 if passed == len(_results) else 1


if __name__ == "__main__":
    sys.exit(main())
