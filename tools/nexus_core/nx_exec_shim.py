#!/usr/bin/env python3
"""
tools/nexus_core/nx_exec_shim.py — exec-шим для OpenConsole-трамплина (#532).

pty_backend.spawn не может передать argv напрямую: команда идёт текстом
через stdin-pipe в default shell (cmd.exe), а cmd-парсер съедает кавычки
и метасимволы (`| & < > ^ % !`). Обход: spawn пишет spec.command в
JSON-файл и инжектит ФИКСИРОВАННУЮ строку

    "<python>" "< этот файл >" "<json-spec>"

которая не содержит пользовательских данных и потому не может быть
искажена cmd-парсингом. Шим читает argv/cwd/env из JSON и запускает
subprocess.call со СПИСКОМ argv — CreateProcessW получает корректный
cmdline через list2cmdline, shell-парсинга пользовательской команды
нет вообще. std-хендлы наследуются от консоли → вывод идёт в PTY.

Файл-спека удаляется шимом при старте (даже при ошибке exec).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("nx_exec_shim: usage: nx_exec_shim <spec.json>", file=sys.stderr)
        return 2
    spec_path = sys.argv[1]
    try:
        with open(spec_path, "r", encoding="utf-8") as f:
            spec = json.load(f)
    except Exception as e:  # noqa: BLE001 — shim обязан отчитаться в консоль
        print(f"nx_exec_shim: cannot read spec {spec_path}: {e}", file=sys.stderr)
        return 2
    try:
        os.unlink(spec_path)
    except OSError:
        pass

    argv = spec.get("argv")
    if not isinstance(argv, list) or not argv or not all(
        isinstance(a, str) for a in argv
    ):
        print("nx_exec_shim: spec.argv must be a non-empty list[str]",
              file=sys.stderr)
        return 2

    cwd = spec.get("cwd") or None
    env_extra = spec.get("env")
    env = None
    if isinstance(env_extra, dict) and env_extra:
        env = dict(os.environ)
        env.update({str(k): str(v) for k, v in env_extra.items()})

    try:
        argv0 = os.path.basename(str(argv[0])).lower()
        # cmd /c|/k: хвост после флага — command line для cmd-парсера,
        # а не argv для CreateProcess. list2cmdline закавычивает его как
        # один аргумент → cmd /c снимает внешние кавычки и ломает
        # внутренние ("dir \"C:\Program Files\"" → syntax error).
        # Передаём весь хвост строкой — cmd парсит её один раз, как
        # при ручном вводе (#532).
        if argv0 in ("cmd.exe", "cmd"):
            for i, a in enumerate(argv[1:], 1):
                if str(a).lower() in ("/c", "/k"):
                    head = argv[0]
                    if " " in head:
                        head = '"%s"' % head
                    cmdline = head + " " + " ".join(str(x) for x in argv[1:])
                    return int(subprocess.call(cmdline, cwd=cwd, env=env))
        return int(subprocess.call(argv, cwd=cwd, env=env))
    except Exception as e:  # noqa: BLE001
        print(f"nx_exec_shim: exec failed: {e}", file=sys.stderr)
        return 127


if __name__ == "__main__":
    sys.exit(main())
