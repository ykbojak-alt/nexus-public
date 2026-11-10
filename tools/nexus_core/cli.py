#!/usr/bin/env python3
"""
tools/nexus_core/cli.py — консольный CLI `nx` (thin client → core API).

#515 (P0.1): nx — зеркало hc 1:1. hc говорит с живым core по сокету;
nx говорит с nexus-core по HTTP/SSE (core_client). In-process
SupervisorV1 из команд убран: параллельный супервизор респавнил
keep-терминалы в CLI-процессе и конфликтовал с демоном по registry.json
(см. reports/ на тему PTY, GAP-1).

    nx run|send|keys|put|read|wait|ls|get|kill|keep|label|interrupt|
       exec|file|server status|events|templates|doc|machine|connect

Env: NX_TERMINAL_ID (≙ HC_TERMINAL_ID — инжектится ядром в env
терминала), NEXUS_CORE_URL (default http://127.0.0.1:5684),
NEXUS_CORE_TOKEN / NEXUS_CORE_READ_TOKEN → X-Nexus-Key.
HC_COMPAT=1 → алиас `hc` → `nx` (в CLI-слое).

Локальными остаются только: `serve` (запуск/стоп detached-демона —
сам демоном и является) и `update`/`server restart` (честный exit 2).

`put` — hc-семантика: `nx put <TERM> <FILE>` кладёт файл в
files/<machine>/<term>/ песочницы ядра; `nx put <TERM> --text <STR>`
оставляет старый paste-без-Enter (не-hc расширение).
"""

from __future__ import annotations

import argparse
import base64
import functools
import json
import os
import sys
from pathlib import Path
from typing import Optional

from tools.nexus_core import core_client as cc
from tools.nexus_core.daemon import start_daemon, status_daemon, stop_daemon
from tools.nexus_core.api import DEFAULT_HOST, DEFAULT_PORT

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_UNIMPLEMENTED = 2
EXIT_NOT_FOUND = 3      # hc parity: not_found
EXIT_TIMEOUT = 124      # hc parity: wait timeout


def _state_base() -> Path:
    env = os.environ.get("NX_STATE_DIR")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".local" / "state" / "nexus-core"


def _print_json(obj) -> None:
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def _guard(fn):
    """Обёртка команд: CoreOffline/Timeout/Error → stderr + exit code."""
    @functools.wraps(fn)
    def wrapper(args):
        try:
            return fn(args)
        except cc.CoreOffline as exc:
            print(f"error: {exc}", file=sys.stderr)
            return EXIT_ERROR
        except cc.CoreTimeout as exc:
            print(f"error: {exc}", file=sys.stderr)
            return EXIT_TIMEOUT
        except cc.CoreError as exc:
            print(f"error: {exc.message}", file=sys.stderr)
            return EXIT_NOT_FOUND if exc.status == 404 else EXIT_ERROR
    return wrapper


def _env_term() -> str:
    return (os.environ.get("NX_TERMINAL_ID") or "").strip()


def _resolve_term(pos: Optional[str], flag: Optional[str]) -> str:
    """hc-терминал: позиционный аргумент > --term > NX_TERMINAL_ID."""
    return (pos or flag or _env_term()).strip()


def _need_term(term: str) -> bool:
    if term:
        return True
    print("error: terminal required (arg, --term or NX_TERMINAL_ID)",
          file=sys.stderr)
    return False


# ----------------------------------------------------------------------------
# Терминалы
# ----------------------------------------------------------------------------

@_guard
def cmd_run(args) -> int:
    labels = {}
    for kv in args.label:
        if "=" in kv:
            k, _, v = kv.partition("=")
            labels[k.strip()] = v.strip()
    payload = {
        "name": args.name,
        "command": list(args.command) if args.command else None,
        "labels": labels,
        "keep": args.keep,
        "outlive_parent": args.outlive_parent,
    }
    # die_with_parent: None → серверный default (True); передаём только
    # при явном флаге, иначе --no-parent/--die-with-parent не отличить
    # от «не задано» и дефолт API сломался бы в False.
    if args.no_parent:
        payload["die_with_parent"] = False
    elif args.die_with_parent:
        payload["die_with_parent"] = True
    if args.cwd:
        payload["cwd"] = args.cwd
    if args.parent:
        payload["parent"] = args.parent
    if args.machine:
        payload["machine"] = args.machine
    term = cc.api_post("/api/core/run", payload)
    _print_json(term)
    return EXIT_OK


@_guard
def cmd_send(args) -> int:
    """hc: `send <TERM> <TEXT>`; legacy: `send <TEXT> --term <T>` /
    NX_TERMINAL_ID. Разбор: флаг/env выигрывает позиционный term."""
    flag = args.term_flag or _env_term()
    pos_term, pos_text = args.term, args.text
    if flag:
        term = flag
        text = pos_text if pos_text is not None else pos_term
    else:
        term = pos_term or ""
        text = pos_text
    if not _need_term(term):
        return EXIT_ERROR
    if text is None:
        print("error: text required", file=sys.stderr)
        return EXIT_ERROR
    resp = cc.api_post("/api/core/send", {"term": term, "text": text})
    print(json.dumps(resp, ensure_ascii=False))
    return EXIT_OK


@_guard
def cmd_keys(args) -> int:
    """hc: `keys <TERM> <KEYS>...`; --term/NX_TERMINAL_ID — fallback."""
    vals = list(args.keys)
    flag = args.term_flag or _env_term()
    if flag:
        term, keys = flag, vals
    elif len(vals) >= 2:
        term, keys = vals[0], vals[1:]
    else:
        term, keys = "", vals
    if not _need_term(term):
        return EXIT_ERROR
    resp = cc.api_post("/api/core/keys", {"term": term, "keys": keys})
    print(json.dumps(resp, ensure_ascii=False))
    return EXIT_OK


@_guard
def cmd_put(args) -> int:
    """hc `put <TERM> <FILE>` — файл в files/<machine>/<term>/ ядра;
    `--text` — paste без Enter (наше расширение, не hc)."""
    flag = args.term_flag or _env_term()
    pos_term, pos_file = args.term, args.file
    if args.text is not None:
        term = _resolve_term(pos_term, flag)
        if not _need_term(term):
            return EXIT_ERROR
        resp = cc.api_post("/api/core/send",
                           {"term": term, "text": args.text, "enter": False})
        print(json.dumps(resp, ensure_ascii=False))
        return EXIT_OK
    # file-drop: позиционный term + file; либо file + --term/env
    if flag and pos_file is None and pos_term:
        term, path = flag, pos_term
    else:
        term = _resolve_term(pos_term, flag)
        path = pos_file or (pos_term if flag else None)
    if not _need_term(term):
        return EXIT_ERROR
    if not path:
        print("error: file required (or --text for paste mode)",
              file=sys.stderr)
        return EXIT_ERROR
    src = Path(path)
    if not src.is_file():
        print(f"error: file not found: {path}", file=sys.stderr)
        return EXIT_ERROR
    name = src.name
    if name in ("", ".", ".."):
        print(f"error: invalid file name: {name!r}", file=sys.stderr)
        return EXIT_ERROR
    raw = src.read_bytes()
    resp = cc.api_post("/api/core/putfile", {
        "term": term,
        "name": name,
        "data_b64": base64.b64encode(raw).decode("ascii"),
    }, timeout=120.0)
    # hc: «prints where it landed»
    print(json.dumps(resp, ensure_ascii=False))
    return EXIT_OK


@_guard
def cmd_read(args) -> int:
    """hc `read [TERM]` — хвост экрана (recent_output) через screen-роут."""
    term = _resolve_term(args.term, args.term_flag)
    if not _need_term(term):
        return EXIT_ERROR
    from urllib.parse import quote
    # safe="/" — адрес machine/term не должен есть слэш; screen-роут
    # принимает обе формы (полную и bare-имя).
    resp = cc.api_get(f"/api/core/screen/{quote(term, safe='/')}")
    sys.stdout.write(str(resp.get("screen", "")))
    return EXIT_OK


@_guard
def cmd_wait(args) -> int:
    """hc `wait [TERM] [--children] [--output] [--timeout]`.

    Позиционный аргумент: термин, либо legacy-таймаут float
    (`wait 30` = ждать 30s на NX_TERMINAL_ID)."""
    pos = args.wait_arg
    flag = args.term_flag or _env_term()
    timeout = args.timeout
    term = flag
    if pos is not None:
        try:
            pos_timeout = float(pos)
        except ValueError:
            pos_timeout = None
        if pos_timeout is not None:
            # legacy-форма `wait 30` — позиционный таймаут;
            # явный --timeout выигрывает
            if timeout is None:
                timeout = pos_timeout
        else:
            term = term or pos
    term = term or ""
    if not _need_term(term):
        return EXIT_ERROR
    payload = {"term": term}
    if timeout is not None:
        payload["timeout"] = timeout
    if args.children:
        payload["children"] = args.children
    if args.output is not None:
        payload["output"] = args.output
    # сервер может ждать долго — таймаут клиента = timeout + запас
    client_timeout = (timeout + 30.0) if timeout else None
    resp = cc.api_post("/api/core/wait", payload,
                       timeout=client_timeout or 3600.0)
    _print_json(resp)
    if resp.get("timed_out") or resp.get("state") == "timeout":
        return EXIT_TIMEOUT
    return EXIT_OK


@_guard
def cmd_ls(args) -> int:
    resp = cc.api_get("/api/core/terminals")
    rows = resp.get("terminals", [])
    if args.json:
        _print_json(resp)
    else:
        for r in rows:
            print(f"{r.get('address', ''):<28} {r.get('state', ''):<10} "
                  f"{r.get('labels', {})}")
    return EXIT_OK


@_guard
def cmd_get(args) -> int:
    term = _resolve_term(args.term, getattr(args, "term_flag", None))
    if not _need_term(term):
        return EXIT_ERROR
    resp = cc.api_get("/api/core/terminals")
    for t in resp.get("terminals", []):
        addr, name = t.get("address", ""), t.get("name", "")
        if term in (addr, name) or addr.endswith("/" + term):
            _print_json(t)
            return EXIT_OK
    print(f"error: terminal not found: {term}", file=sys.stderr)
    return EXIT_NOT_FOUND


@_guard
def cmd_kill(args) -> int:
    term = _resolve_term(args.term, args.term_flag)
    if not _need_term(term):
        return EXIT_ERROR
    payload = {"term": term}
    if args.stage:
        payload["stage"] = args.stage
    resp = cc.api_post("/api/core/kill", payload, timeout=60.0)
    _print_json(resp)
    return EXIT_OK


@_guard
def cmd_keep(args) -> int:
    """hc `keep <TERM> [--off]` — keep-alive on/off."""
    term = _resolve_term(args.term, args.term_flag)
    if not _need_term(term):
        return EXIT_ERROR
    resp = cc.api_post("/api/core/keep",
                       {"term": term, "keep": not args.off})
    print(json.dumps(resp, ensure_ascii=False))
    return EXIT_OK


@_guard
def cmd_label(args) -> int:
    """hc `label <TERM> <K=V>...`; --term/NX_TERMINAL_ID — fallback."""
    vals = list(args.pairs)
    flag = args.term_flag or _env_term()
    if flag:
        term, pairs = flag, vals
    elif vals and "=" not in vals[0]:
        term, pairs = vals[0], vals[1:]
    else:
        term, pairs = "", vals
    if not _need_term(term):
        return EXIT_ERROR
    labels = {}
    for kv in pairs:
        if "=" not in kv:
            print(f"error: label must be K=V: {kv!r}", file=sys.stderr)
            return EXIT_ERROR
        k, _, v = kv.partition("=")
        labels[k.strip()] = v.strip()
    if not labels:
        print("error: at least one K=V label required", file=sys.stderr)
        return EXIT_ERROR
    resp = cc.api_post("/api/core/label", {"term": term, "labels": labels})
    print(json.dumps(resp, ensure_ascii=False))
    return EXIT_OK


@_guard
def cmd_interrupt(args) -> int:
    term = _resolve_term(args.term, args.term_flag)
    if not _need_term(term):
        return EXIT_ERROR
    resp = cc.api_post("/api/core/interrupt", {"term": term})
    print(json.dumps(resp, ensure_ascii=False))
    return EXIT_OK


@_guard
def cmd_events(args) -> int:
    """hc `events` — живой SSE-поток ядра (replay буфера + follow).

    --limit N — остановиться после N событий (для скриптов/тестов).
    Обрыв соединения завершает поток — reconnect не автоматический
    (Last-Event-ID сервер пока не отдаёт, как и NEWF-клиент).
    """
    count = 0
    try:
        for event in cc.sse_events("/api/core/events"):
            print(json.dumps(event, ensure_ascii=False), flush=True)
            count += 1
            if args.limit is not None and count >= args.limit:
                break
    except KeyboardInterrupt:
        return EXIT_OK
    return EXIT_OK


# ----------------------------------------------------------------------------
# Exec / file (через core API — единый авторитет state)
# ----------------------------------------------------------------------------

@_guard
def cmd_exec(args) -> int:
    argv = [a for a in args.argv if a != "--"]
    if not argv:
        print("error: argv required", file=sys.stderr)
        return EXIT_ERROR
    payload = {"machine": args.machine, "argv": argv}
    if args.timeout is not None:
        payload["timeout"] = args.timeout
    result = cc.api_post("/api/core/exec", payload,
                         timeout=(args.timeout or 60.0) + 30.0)
    if args.json:
        _print_json(result)
        return EXIT_OK
    sys.stdout.write(result.get("stdout", ""))
    if result.get("stderr"):
        sys.stderr.write(result["stderr"])
    if result.get("timed_out"):
        print("error: timed out", file=sys.stderr)
        return EXIT_TIMEOUT
    code = result.get("exit_code")
    return code if isinstance(code, int) and code != 0 else EXIT_OK


@_guard
def cmd_file(args) -> int:
    machine = getattr(args, "machine", "local")
    if args.action == "read":
        params = {"path": args.path, "machine": machine}
        if args.offset is not None:
            params["offset"] = args.offset
        if args.limit is not None:
            params["limit"] = args.limit
        result = cc.api_get("/api/core/file/read", params=params)
        if args.json:
            _print_json(result)
        else:
            content = result.get("content", "")
            sys.stdout.write(content)
            if content and not content.endswith("\n"):
                sys.stdout.write("\n")
        return EXIT_OK
    if args.action == "write":
        content = args.content
        if content is None:
            content = sys.stdin.buffer.read().decode("utf-8", errors="replace")
        result = cc.api_post("/api/core/file/write", {
            "path": args.path, "content": content, "machine": machine,
        })
        _print_json(result)
        return EXIT_OK
    # edit
    pairs = [[o, n] for o, n in zip(args.old, args.new)]
    if len(args.old) != len(args.new):
        print("error: --old/--new count mismatch", file=sys.stderr)
        return EXIT_ERROR
    result = cc.api_post("/api/core/file/edit", {
        "path": args.path, "pairs": pairs, "machine": machine,
    })
    _print_json(result)
    return EXIT_OK


# ----------------------------------------------------------------------------
# Машины / connect / doc / templates / server
# ----------------------------------------------------------------------------

@_guard
def cmd_machine(args) -> int:
    if args.action == "ls":
        resp = cc.api_get("/api/core/machines")
        _print_json(resp)
        return EXIT_OK
    if args.action == "get":
        m = cc.api_get(f"/api/core/machines/{args.name}")
        _print_json(m)
        return EXIT_OK
    if args.action == "add":
        m = cc.api_put(f"/api/core/machines/{args.name}", {
            "host": args.host, "transport": args.transport,
        })
        _print_json(m)
        return EXIT_OK
    if args.action == "rm":
        resp = cc.api_delete(f"/api/core/machines/{args.name}")
        _print_json(resp)
        return EXIT_OK
    if args.action == "rename":
        m = cc.api_post(f"/api/core/machines/{args.old}/rename",
                        {"name": args.new})
        _print_json({"renamed": m})
        return EXIT_OK
    if args.action == "update":
        # update ≠ upsert: машины быть должно (PUT создал бы новую)
        cur = cc.api_get(f"/api/core/machines/{args.name}")
        payload = {}
        if args.host is not None:
            payload["host"] = args.host
        if args.transport is not None:
            payload["transport"] = args.transport
        if args.labels:
            labels = {}
            for kv in args.labels:
                if "=" not in kv:
                    raise cc.CoreError(400, f"label must be K=V: {kv!r}")
                k, v = kv.split("=", 1)
                labels[k] = v
            payload["labels"] = labels
        if payload:
            cur = cc.api_put(f"/api/core/machines/{args.name}", payload)
        _print_json(cur)
        return EXIT_OK
    if args.action == "login":
        cur = cc.api_get(f"/api/core/machines/{args.name}")
        m = cc.api_post(f"/api/core/machines/{args.name}/connect", {
            "host": cur.get("host", args.name),
            "transport": cur.get("transport", "ssh"),
        })
        state = {"connected": "reachable",
                 "needs_login": "auth-needed"}.get(m.get("state"),
                                                 m.get("state"))
        _print_json({"name": m.get("name", args.name), "state": state,
                     "why": m.get("why")})
        return EXIT_OK
    print(f"error: machine: unknown action {args.action}", file=sys.stderr)
    return EXIT_ERROR


@_guard
def cmd_connect(args) -> int:
    """Регистрация ssh-машины через core API + опциональный --session
    (ssh-терминал на ней — локальный PTY с ssh-клиентом, как раньше)."""
    host = args.host
    name = args.name or host.split("@")[-1].split(":")[0]
    # connect ≠ upsert: существующая машина — ошибка (registry.add
    # semantics; перевыдача — через machine rm/update).
    try:
        cc.api_get(f"/api/core/machines/{name}")
    except cc.CoreError as exc:
        if exc.status != 404:
            raise
    else:
        print(f"error: machine already exists: {name}", file=sys.stderr)
        return EXIT_ERROR
    m = cc.api_put(f"/api/core/machines/{name}",
                   {"host": host, "transport": "ssh"})
    if args.session:
        term = cc.api_post("/api/core/run", {
            "name": f"ssh-{name}",
            "command": ["ssh", "-o", "BatchMode=yes", "-t", host],
            "labels": {"machine": name, "session": "ssh"},
            "machine": name,
            "keep": False,
        })
        _print_json({"term": term.get("address"), "machine": name,
                     "status": "session_started"})
        return EXIT_OK
    if not args.probe:
        _print_json(m)
        return EXIT_OK
    m = cc.api_post(f"/api/core/machines/{name}/connect",
                    {"host": host, "transport": "ssh"})
    _print_json(m)
    return EXIT_OK


@_guard
def cmd_doc(args) -> int:
    if args.content is not None:
        resp = cc.api_put("/api/core/doc", {"content": args.content})
        if args.json:
            _print_json(resp)
        else:
            print(json.dumps({"version": resp.get("version"),
                              "status": resp.get("status")}))
        return EXIT_OK
    if args.version is not None:
        doc = cc.api_get("/api/core/doc", params={"version": args.version})
    else:
        doc = cc.api_get("/api/core/doc/latest")
    if args.json:
        _print_json(doc)
    else:
        print(doc.get("content", ""))
    return EXIT_OK


@_guard
def cmd_templates(args) -> int:
    resp = cc.api_get("/api/core/templates")
    templates = resp.get("templates", [])
    if args.json:
        _print_json(resp)
    else:
        for t in templates:
            cmdline = " ".join(t.get("command") or []) or "(shell)"
            print(f"{t.get('name', ''):<24} {cmdline}")
    return EXIT_OK


@_guard
def cmd_server(args) -> int:
    if args.action != "status":
        print(
            f"error: server {args.action} is not implemented in "
            "nexus-core (no safe self-respawn path)",
            file=sys.stderr,
        )
        return EXIT_UNIMPLEMENTED
    resp = cc.api_get("/api/core/server")
    _print_json(resp)
    return EXIT_OK


def cmd_system(args) -> int:
    """system — host metrics из GET /api/core/system (#537).

    Требует core с endpoint'ом (демон, запущенный после #537);
    на старом билде — честный HTTP-404 от api_get.
    """
    resp = cc.api_get("/api/core/system")
    _print_json(resp)
    return EXIT_OK


def cmd_serve(args) -> int:
    """serve: detached-запуск API-сервера (nx serve), + --status/--stop.

    Локальная команда by design: управляет daemon.json, а не API.
    """
    base = Path(args.base) if getattr(args, "base", None) else _state_base()
    if args.stop:
        return stop_daemon(base)
    if args.status:
        return status_daemon(base)
    port = args.port if args.port is not None else DEFAULT_PORT
    return start_daemon(base, host=args.host, port=port)


def cmd_update(args) -> int:
    """update — честно unimplemented (exit 2), swap/install вне scope."""
    print(
        "error: update is not implemented in nexus-core (binary swap "
        "and install are out of scope)",
        file=sys.stderr,
    )
    return EXIT_UNIMPLEMENTED


# ----------------------------------------------------------------------------
# Парсер (hc-грамматика 1:1; терминал — позиционный как у hc,
# --term/NX_TERMINAL_ID — fallback)
# ----------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="nx", description="nexus-core CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    p_run = sub.add_parser("run", help="spawn terminal")
    p_run.add_argument("name")
    p_run.add_argument("command", nargs=argparse.REMAINDER)
    p_run.add_argument("--label", action="append", default=[], metavar="K=V")
    p_run.add_argument("--cwd")
    p_run.add_argument("--on", dest="machine", metavar="MACHINE")
    p_run.add_argument("--parent")
    p_run.add_argument("--no-parent", action="store_true",
                       help="die_with_parent=False (default: die with parent)")
    p_run.add_argument("--die-with-parent", action="store_true",
                       dest="die_with_parent")
    p_run.add_argument("--outlive-parent", action="store_true",
                       dest="outlive_parent")
    p_run.add_argument("--rm", action="store_true")
    p_run.add_argument("--no-keep", action="store_false", dest="keep")
    p_run.set_defaults(keep=True, fn=cmd_run)

    p_send = sub.add_parser("send", help="paste text + enter")
    p_send.add_argument("term", nargs="?", help="hc: send <TERM> <TEXT>")
    p_send.add_argument("text", nargs="?")
    p_send.add_argument("--term", dest="term_flag")
    p_send.set_defaults(fn=cmd_send)

    p_keys = sub.add_parser("keys", help="press named keys")
    p_keys.add_argument("keys", nargs="+")
    p_keys.add_argument("--term", dest="term_flag")
    p_keys.set_defaults(fn=cmd_keys)

    p_put = sub.add_parser("put", help="deliver file beside terminal (hc) "
                                       "or paste text (--text)")
    p_put.add_argument("term", nargs="?")
    p_put.add_argument("file", nargs="?")
    p_put.add_argument("--text", metavar="TEXT",
                       help="paste without Enter (extension, not hc put)")
    p_put.add_argument("--term", dest="term_flag")
    p_put.set_defaults(fn=cmd_put)

    p_read = sub.add_parser("read", help="read terminal screen tail")
    p_read.add_argument("term", nargs="?")
    p_read.add_argument("--term", dest="term_flag")
    p_read.set_defaults(fn=cmd_read)

    p_wait = sub.add_parser("wait", help="wait for exit/children/output")
    p_wait.add_argument("wait_arg", nargs="?",
                        help="terminal, or legacy timeout (float seconds)")
    p_wait.add_argument("--timeout", type=float)
    p_wait.add_argument("--children", choices=["all", "any"])
    p_wait.add_argument("--output")
    p_wait.add_argument("--term", dest="term_flag")
    p_wait.set_defaults(fn=cmd_wait)

    p_ls = sub.add_parser("ls", help="list live terminals")
    p_ls.add_argument("--all", action="store_true",
                      help="accepted for hc parity (core keeps finished "
                           "terms until purge; API lists all)")
    p_ls.add_argument("--json", action="store_true", dest="json")
    p_ls.set_defaults(fn=cmd_ls)

    p_get = sub.add_parser("get", help="terminal info")
    p_get.add_argument("term", nargs="?")
    p_get.add_argument("--term", dest="term_flag")
    p_get.set_defaults(fn=cmd_get)

    p_kill = sub.add_parser("kill", help="kill (hangup→terminate→kill)")
    p_kill.add_argument("term", nargs="?")
    p_kill.add_argument("--stage", choices=["hangup", "terminate", "kill"])
    p_kill.add_argument("--term", dest="term_flag")
    p_kill.set_defaults(fn=cmd_kill)

    p_keep = sub.add_parser("keep", help="keep a live terminal after loss")
    p_keep.add_argument("term", nargs="?")
    p_keep.add_argument("--off", action="store_true")
    p_keep.add_argument("--term", dest="term_flag")
    p_keep.set_defaults(fn=cmd_keep)

    p_label = sub.add_parser("label", help="set labels K=V (key= removes)")
    p_label.add_argument("pairs", nargs="+")
    p_label.add_argument("--term", dest="term_flag")
    p_label.set_defaults(fn=cmd_label)

    p_interrupt = sub.add_parser("interrupt", help="press the stop key")
    p_interrupt.add_argument("term", nargs="?")
    p_interrupt.add_argument("--term", dest="term_flag")
    p_interrupt.set_defaults(fn=cmd_interrupt)

    p_events = sub.add_parser("events", help="follow core events (SSE)")
    p_events.add_argument("--limit", type=int, default=None,
                          help="stop after N events (default: follow forever)")
    p_events.set_defaults(fn=cmd_events)

    p_templates = sub.add_parser("templates", help="list personas")
    p_templates.add_argument("--json", action="store_true", dest="json")
    p_templates.set_defaults(fn=cmd_templates)

    p_doc = sub.add_parser("doc", help="versioned document")
    p_doc.add_argument("--version", type=int)
    p_doc.add_argument("--json", action="store_true", dest="json")
    p_doc.add_argument("--content")
    p_doc.set_defaults(fn=cmd_doc)

    p_exec = sub.add_parser("exec", help="run a program without a terminal")
    p_exec.add_argument("--on", dest="machine", default="local",
                        metavar="MACHINE")
    p_exec.add_argument("--timeout", type=float)
    p_exec.add_argument("--json", action="store_true", dest="json")
    p_exec.add_argument("argv", nargs=argparse.REMAINDER)
    p_exec.set_defaults(fn=cmd_exec)

    p_file = sub.add_parser("file", help="file read/write/edit via core")
    fsub = p_file.add_subparsers(dest="action", required=True)
    p_fread = fsub.add_parser("read", help="print a text file or lines")
    p_fread.add_argument("path")
    p_fread.add_argument("--offset", type=int)
    p_fread.add_argument("--limit", type=int)
    p_fread.add_argument("--on", dest="machine", default="local",
                         metavar="MACHINE")
    p_fread.add_argument("--json", action="store_true", dest="json")
    p_fread.set_defaults(fn=cmd_file)
    p_fwrite = fsub.add_parser("write", help="write stdin (or --content)")
    p_fwrite.add_argument("path")
    p_fwrite.add_argument("--content")
    p_fwrite.add_argument("--on", dest="machine", default="local",
                          metavar="MACHINE")
    p_fwrite.add_argument("--json", action="store_true", dest="json")
    p_fwrite.set_defaults(fn=cmd_file)
    p_fedit = fsub.add_parser("edit", help="exact old→new (once each)")
    p_fedit.add_argument("path")
    p_fedit.add_argument("--old", action="append", default=[], metavar="OLD")
    p_fedit.add_argument("--new", action="append", default=[], metavar="NEW")
    p_fedit.add_argument("--on", dest="machine", default="local",
                         metavar="MACHINE")
    p_fedit.add_argument("--json", action="store_true", dest="json")
    p_fedit.set_defaults(fn=cmd_file)

    p_machine = sub.add_parser("machine", help="machines registry (via core)")
    msub = p_machine.add_subparsers(dest="action", required=True)
    p_madd = msub.add_parser("add", help="add a machine")
    p_madd.add_argument("name")
    p_madd.add_argument("host")
    p_madd.add_argument("--transport", choices=["local", "ssh"],
                        default="ssh")
    p_madd.set_defaults(fn=cmd_machine)
    p_mrm = msub.add_parser("rm", help="forget a machine (terms untouched)")
    p_mrm.add_argument("name")
    p_mrm.set_defaults(fn=cmd_machine)
    p_mrename = msub.add_parser("rename", help="breaking address change")
    p_mrename.add_argument("old")
    p_mrename.add_argument("new")
    p_mrename.set_defaults(fn=cmd_machine)
    msub.add_parser("ls", help="list machines").set_defaults(fn=cmd_machine,
                                                           action="ls")
    p_mget = msub.add_parser("get", help="show one machine")
    p_mget.add_argument("name")
    p_mget.set_defaults(fn=cmd_machine)
    p_mupdate = msub.add_parser("update", help="edit machine record")
    p_mupdate.add_argument("name")
    p_mupdate.add_argument("--host")
    p_mupdate.add_argument("--transport", choices=["local", "ssh"])
    p_mupdate.add_argument("--labels", action="append", default=[],
                           metavar="K=V")
    p_mupdate.set_defaults(fn=cmd_machine)
    p_mlogin = msub.add_parser("login", help="probe ssh auth path")
    p_mlogin.add_argument("name")
    p_mlogin.set_defaults(fn=cmd_machine)

    p_connect = sub.add_parser("connect", help="register a remote ssh machine")
    p_connect.add_argument("host")
    p_connect.add_argument("--name")
    p_connect.add_argument("--no-probe", action="store_false", dest="probe")
    p_connect.add_argument("--session", action="store_true",
                           help="start live ssh terminal")
    p_connect.set_defaults(probe=True, fn=cmd_connect)

    p_server = sub.add_parser("server", help="server status/restart")
    p_server.add_argument("action", choices=["status", "restart"])
    p_server.set_defaults(fn=cmd_server)

    p_system = sub.add_parser(
        "system", help="host metrics: cpu/mem/disks/net/gpu/uptime (#537)")
    p_system.set_defaults(fn=cmd_system)

    p_serve = sub.add_parser("serve", help="run API server detached (daemon)")
    p_serve.add_argument("--stop", action="store_true", help="stop the daemon")
    p_serve.add_argument("--status", action="store_true",
                         help="daemon status")
    p_serve.add_argument("--port", type=int)
    p_serve.add_argument("--host", default=DEFAULT_HOST)
    p_serve.add_argument("--base", type=Path,
                         help="state dir (default: NX_STATE_DIR)")
    p_serve.set_defaults(fn=cmd_serve)

    p_update = sub.add_parser("update", help="swap binary (unimplemented)")
    p_update.add_argument("args", nargs="*")
    p_update.set_defaults(fn=cmd_update)

    return parser


# Команды, чей argv может содержать неизвестные флаги
# (update --version 1.2): парсим их вручную.
_STUB_COMMANDS = frozenset(("update",))

# Опции `run`, у которых есть значение / которые — чистые флаги.
# Нужны для ручного сплита argv (см. _split_run_argv).
_RUN_OPTS_WITH_VALUE = frozenset(
    ("--label", "--cwd", "--on", "--parent"))
_RUN_FLAGS = frozenset(
    ("--no-parent", "--die-with-parent", "--outlive-parent",
     "--rm", "--no-keep"))


def _split_run_argv(argv: list[str]) -> list[str]:
    """hc-грамматика `nx run <name> [opts…] [--] <command…>`.

    Парсер использует nargs=REMAINDER для command: он захватывает ВСЁ
    после name, включая опции — `run t1 --label r=x cmd` молча клал
    '--label' в command и CreateProcessW падал на несуществующем exe.
    Режем вручную: name — первый токен; дальше известные опции до '--'
    или первого не-опционного токена (начало command); остальное —
    command дословно. Возвращаемый argv: опции ДО name, чтобы
    argparse их распарсил, name, затем command-остаток.
    """
    if not argv or argv[0] != "run":
        return argv
    rest = argv[1:]
    if not rest or rest[0].startswith("-"):
        return argv  # name не задан — ошибка пусть выдаст argparse
    name, opts, i = rest[0], [], 1
    cmd: list[str] = []
    while i < len(rest):
        tok = rest[i]
        if tok == "--":
            cmd = rest[i + 1:]
            break
        base = tok.split("=", 1)[0]
        if base in _RUN_OPTS_WITH_VALUE:
            if "=" in tok:
                opts.append(tok)
                i += 1
            elif i + 1 < len(rest):
                opts.extend((tok, rest[i + 1]))
                i += 2
            else:
                opts.append(tok)
                i += 1
            continue
        if tok in _RUN_FLAGS:
            opts.append(tok)
            i += 1
            continue
        cmd = rest[i:]
        break
    return ["run"] + opts + [name] + cmd


def main(argv: Optional[list[str]] = None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    # HC_COMPAT=1: алиас hc → nx
    if argv and os.environ.get("HC_COMPAT") == "1" and argv[0] in ("hc", "nx"):
        argv = argv[1:]
    if argv and argv[0] in _STUB_COMMANDS:
        return cmd_update(None)
    argv = _split_run_argv(list(argv))
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
