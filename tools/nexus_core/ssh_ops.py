#!/usr/bin/env python3
"""
tools/nexus_core/ssh_ops.py — N4: реальный SSH для machine.exec + file.*
против записей реестра машин (transport=ssh).

Контракт (NEXUS_CORE_SPEC.md §0a.5, К6, N4):
    exec  — `ssh -o BatchMode=yes -o ConnectTimeout=5 <host> '<cmd>'`
            с capture stdout/stderr/exit/duration/timeout — ТОТ ЖЕ JSON-
            контракт, что локальный путь (см. machine_registry.machine_exec):
            {machine, argv, stdout, stderr, exit_code, timed_out, duration_ms}.
            Nonzero exit и timeout — результат, а не ошибка (К2/К6).
            Сбой самого ssh-транспорта (cannot connect/auth) — честная
            ошибка RemoteExecError(kind="ssh_unreachable").
    read  — чтение текстового файла или его строк: offset (с 1) / limit
            (по умолчанию все, не более 8 МБ). Реализация: два ssh-вызова
            (`wc -c` — лимит размера; `cat` целиком) и локальная построчная
            обработка: так offset/limit сохраняют строковую семантику
            file_ops (байтовые dd/tail -c/head -c сдвинули бы границы
            посередине UTF-8-последовательностей и ничего не знают о
            строках).
    write — атомарная запись: scp во временный файл remote (/tmp) →
            `ssh mkdir -p <parent>` → `ssh mv <tmp> <path>` — читатель
            видит либо старое, либо новое, никогда половину.
    edit  — read (сырой текст, без разбиения на строки) → локальная
            правка (те же правила exact-once, что file_ops.edit: каждое
            old ровно один раз, пары не пересекаются, all-or-none) →
            write обратно.

Sandbox-правила НЕ распространяются на remote (там нет base): пути
используются как даны (относительные — относительно home удалённого
пользователя), но логируются через log_fn (ledger_event / отчёт).
"""

from __future__ import annotations

import os
import shlex
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Optional

from tools.nexus_core.machine_registry import LOCAL_MACHINE, MachineRegistry

SSH_CONNECT_TIMEOUT_S = 5.0
MAX_READ_BYTES = 8 * 1024 * 1024  # 8 МБ (контракт К7)
FILE_OP_TIMEOUT_S = 30.0
DEFAULT_EXEC_TIMEOUT_S = 60.0
MAX_EXEC_TIMEOUT_S = 600.0

# Маркеры отказа самого ssh-транспорта (обычно exit 255) — это НЕ
# результат команды, а невозможность её доставить.
SSH_UNREACHABLE_MARKERS = (
    "could not resolve",
    "connection refused",
    "connection timed out",
    "operation timed out",
    "network is unreachable",
    "no route to host",
    "permission denied",
    "host key verification failed",
    "too many authentication failures",
    "no supported authentication methods",
    "connection closed by",
    "connection reset",
    "unable to connect",
)


class RemoteExecError(Exception):
    """Ошибка remote-операции: машинный kind + человеческое message.

    kind ∈ machine_not_found | machine_not_ssh | ssh_unreachable |
    ssh_timeout | ssh_error | remote_file_not_found | remote_limit_exceeded
    | invalid_args | edit_invalid.
    """

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message


class RemoteFileNotFound(RemoteExecError):
    """Файл на remote не найден (kind = remote_file_not_found)."""

    def __init__(self, message: str) -> None:
        super().__init__("remote_file_not_found", message)


def _exact_edit(text: str, pairs: list[tuple[str, str]]) -> str:
    """Точная замена old → new (правила file_ops.edit, К7):
    каждое old ровно один раз, пары не пересекаются, all-or-none.

    Работает над строкой целиком (не поверх строк), чтобы не потерять
    разделители строк (в т.ч. CRLF) при обратной записи.
    """
    hits: list[tuple[int, int]] = []
    for i, (old, _new) in enumerate(pairs):
        count = text.count(old)
        if count != 1:
            raise RemoteExecError(
                "edit_invalid",
                f"old string must occur exactly once, found {count}: {old!r}",
            )
        hits.append((text.index(old), i))
    hits.sort(key=lambda h: h[0])
    for j in range(1, len(hits)):
        prev_idx, prev_i = hits[j - 1]
        idx, _i = hits[j]
        if idx < prev_idx + len(pairs[prev_i][0]):
            raise RemoteExecError("edit_invalid", "replacement pairs overlap")
    result = text
    for idx, i in sorted(hits, key=lambda h: h[0], reverse=True):
        old, new = pairs[i]
        result = result[:idx] + new + result[idx + len(old):]
    return result


class SshOps:
    """SSH-операции против реестра машин (machine.name → machine.host).

    log_fn: Optional[Callable[[str], None]] — колбэк для логирования
    операций с путями (ledger_event / отчёт), вызывается с описанием.
    """

    def __init__(self, registry: MachineRegistry, log_fn: Optional[object] = None) -> None:
        self.registry = registry
        self.log_fn = log_fn

    # ------------------------------------------------------------------
    # Внутреннее
    # ------------------------------------------------------------------

    def _log(self, text: str) -> None:
        if self.log_fn is not None:
            try:
                self.log_fn(text)
            except Exception:
                pass

    def _resolve(self, machine: str) -> tuple[str, str]:
        """machine → (имя, host). Ошибки: machine_not_found / machine_not_ssh."""
        name = (machine or LOCAL_MACHINE).strip()
        row = self.registry.get(name)
        if row is None:
            raise RemoteExecError("machine_not_found", f"machine not found: {name}")
        if row.transport != "ssh":
            raise RemoteExecError(
                "machine_not_ssh",
                f"machine {name!r} is not an ssh transport (transport={row.transport})",
            )
        return name, row.host

    @staticmethod
    def _is_ssh_failure(returncode: Optional[int], stderr: str) -> bool:
        if returncode != 255:
            return False
        err = stderr.lower()
        return any(marker in err for marker in SSH_UNREACHABLE_MARKERS)

    def _run(self, host: str, argv: list[str], timeout: Optional[float] = None,
             connect_timeout: float = SSH_CONNECT_TIMEOUT_S,
             stdin: Optional[bytes] = None) -> dict:
        """Запуск argv через ssh на host. Возвращает exec-контракт
        {stdout, stderr, exit_code, timed_out, duration_ms}.

        `stdin` — опциональные байты в stdin удалённой команды
        (payload-канал без попадания в argv/ps — T-06).

        Сбой транспорта (cannot connect/auth) → RemoteExecError
        (kind="ssh_unreachable"). Nonzero exit и timeout — результат.
        """
        if timeout is None:
            limit = DEFAULT_EXEC_TIMEOUT_S
        else:
            limit = float(timeout)
            if limit <= 0:
                raise RemoteExecError("invalid_args", "timeout must be > 0")
            limit = min(limit, MAX_EXEC_TIMEOUT_S)
        command = shlex.join(str(a) for a in argv)
        ssh_argv = [
            "ssh",
            "-o", "BatchMode=yes",
            "-o", f"ConnectTimeout={int(connect_timeout)}",
            host,
            command,
        ]
        start = time.monotonic()
        try:
            result = subprocess.run(
                ssh_argv, input=stdin, capture_output=True, timeout=limit
            )
            timed_out = False
            exit_code = result.returncode
            stdout, stderr = result.stdout, result.stderr
        except subprocess.TimeoutExpired as exc:
            timed_out = True
            exit_code = None
            stdout = exc.stdout or b""
            stderr = exc.stderr or b""
        duration_ms = int((time.monotonic() - start) * 1000)
        stdout_text = stdout.decode("utf-8", errors="replace")
        stderr_text = stderr.decode("utf-8", errors="replace")
        if not timed_out and self._is_ssh_failure(exit_code, stderr_text):
            raise RemoteExecError(
                "ssh_unreachable",
                f"ssh to {host!r} failed: {stderr_text.strip()[:300]}",
            )
        return {
            "stdout": stdout_text,
            "stderr": stderr_text,
            "exit_code": exit_code,
            "timed_out": timed_out,
            "duration_ms": duration_ms,
        }

    @staticmethod
    def _file_error(op: str, path: str, result: dict) -> RemoteExecError:
        stderr = result["stderr"].strip()
        if "no such file" in stderr.lower() or "not found" in stderr.lower():
            return RemoteFileNotFound(f"{op}: {path!r}: file not found")
        return RemoteExecError(
            "ssh_error", f"{op} failed on {path!r}: {stderr[:300]}"
        )

    def _read_raw(self, host: str, path: str) -> str:
        """Сырое содержимое файла (весь текст, без разбиения на строки)."""
        size = self._run(host, ["wc", "-c", path], timeout=FILE_OP_TIMEOUT_S)
        if size["timed_out"]:
            raise RemoteExecError("ssh_timeout", f"wc timed out on {host!r}: {path!r}")
        if size["exit_code"] != 0:
            raise self._file_error("wc", path, size)
        try:
            byte_count = int(size["stdout"].strip().split()[0])
        except (ValueError, IndexError) as exc:
            raise RemoteExecError(
                "ssh_error", f"unexpected wc -c output: {size['stdout'][:100]!r}"
            ) from exc
        if byte_count > MAX_READ_BYTES:
            raise RemoteExecError(
                "remote_limit_exceeded",
                f"file exceeds {MAX_READ_BYTES} byte read limit: {path!r}",
            )
        data = self._run(host, ["cat", path], timeout=FILE_OP_TIMEOUT_S)
        if data["timed_out"]:
            raise RemoteExecError("ssh_timeout", f"cat timed out on {host!r}: {path!r}")
        if data["exit_code"] != 0:
            raise self._file_error("cat", path, data)
        return data["stdout"]

    def _write_raw(self, host: str, path: str, content: str) -> None:
        """Атомарная запись: scp → tmp на remote, затем mv tmp → path."""
        fd, tmp_local = tempfile.mkstemp(prefix="nx-ssh-write-", suffix=".tmp")
        remote_tmp = f"/tmp/{Path(tmp_local).name}"
        try:
            # Бинарный режим: на Windows текстовый режим перевёл бы \n → \r\n
            # (а после edit + \r\n → \r\r\n), ломая байты remote-файла.
            with os.fdopen(fd, "wb") as fh:
                fh.write(content.encode("utf-8"))
            scp_argv = [
                "scp",
                "-o", "BatchMode=yes",
                "-o", f"ConnectTimeout={int(SSH_CONNECT_TIMEOUT_S)}",
                tmp_local,
                f"{host}:{remote_tmp}",
            ]
            try:
                scp_result = subprocess.run(
                    scp_argv, capture_output=True, timeout=FILE_OP_TIMEOUT_S
                )
            except subprocess.TimeoutExpired as exc:
                raise RemoteExecError(
                    "ssh_timeout", f"scp to {host!r} timed out"
                ) from exc
            if scp_result.returncode != 0:
                raise RemoteExecError(
                    "ssh_unreachable",
                    f"scp to {host!r} failed: "
                    f"{scp_result.stderr.decode('utf-8', errors='replace').strip()[:300]}",
                )
            parent = path.rsplit("/", 1)[0] if "/" in path else "."
            if not parent:
                parent = "/"
            mkdir = self._run(host, ["mkdir", "-p", parent], timeout=FILE_OP_TIMEOUT_S)
            if mkdir["exit_code"] != 0:
                raise RemoteExecError(
                    "ssh_error", f"mkdir -p failed on {host!r}: {mkdir['stderr'][:300]}"
                )
            move = self._run(host, ["mv", remote_tmp, path], timeout=FILE_OP_TIMEOUT_S)
            if move["exit_code"] != 0:
                raise RemoteExecError(
                    "ssh_error", f"mv failed on {host!r}: {move['stderr'][:300]}"
                )
        finally:
            try:
                os.unlink(tmp_local)
            except OSError:
                pass

    # ------------------------------------------------------------------
    # Публичные операции
    # ------------------------------------------------------------------

    def exec(self, machine: str, argv: list[str],
             timeout: Optional[float] = None,
             stdin: Optional[bytes] = None) -> dict:
        """machine.exec на remote: ТОТ ЖЕ контракт, что локальный путь.
        `stdin` — байты в stdin удалённой команды (T-06)."""
        if not isinstance(argv, list) or not argv or not all(
            isinstance(a, str) for a in argv
        ):
            raise RemoteExecError("invalid_args", "argv must be a non-empty list of strings")
        if stdin is not None and not isinstance(stdin, (bytes, str)):
            raise RemoteExecError("invalid_args", "stdin must be bytes or str")
        name, host = self._resolve(machine)
        if isinstance(stdin, str):
            stdin = stdin.encode("utf-8")
        result = self._run(host, argv, timeout=timeout, stdin=stdin)
        result["machine"] = name
        result["argv"] = [str(a) for a in argv]
        self._log(f"ssh exec {name}: host={host} argv={result['argv']}")
        return result

    def read(self, machine: str, path: str,
             offset: int = 1, limit: Optional[int] = None) -> dict:
        """Чтение текстового файла или его строк (offset — с 1, строки)."""
        if offset < 1:
            raise RemoteExecError("invalid_args", "offset must be >= 1")
        if limit is not None and limit < 1:
            raise RemoteExecError("invalid_args", "limit must be >= 1")
        name, host = self._resolve(machine)
        text = self._read_raw(host, path)
        lines = text.splitlines()
        start = offset - 1
        selected = lines[start: start + limit] if limit is not None else lines[start:]
        self._log(f"ssh read {name}: host={host} path={path!r} offset={offset} limit={limit}")
        return {
            "path": path,
            "machine": name,
            "content": "\n".join(selected),
            "lines": len(selected),
            "total_lines": len(lines),
            "offset": offset,
            "limit": limit,
        }

    def write(self, machine: str, path: str, content: str) -> dict:
        """Атомарная запись (scp → tmp, mv → path)."""
        if not isinstance(content, str):
            raise RemoteExecError("invalid_args", "content (string) required")
        name, host = self._resolve(machine)
        self._write_raw(host, path, content)
        self._log(f"ssh write {name}: host={host} path={path!r} bytes={len(content.encode('utf-8'))}")
        return {
            "path": path,
            "machine": name,
            "bytes": len(content.encode("utf-8")),
        }

    def edit(self, machine: str, path: str,
             pairs: list[tuple[str, str]]) -> dict:
        """read → локальная правка (exact-once, как file_ops) → write."""
        if not isinstance(pairs, list) or not pairs:
            raise RemoteExecError("invalid_args", "at least one (old, new) pair required")
        for i, (old, new) in enumerate(pairs):
            if not isinstance(old, str) or not old:
                raise RemoteExecError(
                    "invalid_args", f"pair {i}: old must be a non-empty string"
                )
            if not isinstance(new, str):
                raise RemoteExecError("invalid_args", f"pair {i}: new must be a string")
        name, host = self._resolve(machine)
        text = self._read_raw(host, path)
        edited = _exact_edit(text, pairs)
        self._write_raw(host, path, edited)
        self._log(
            f"ssh edit {name}: host={host} path={path!r} replacements={len(pairs)}"
        )
        return {"path": path, "machine": name, "replacements": len(pairs)}
