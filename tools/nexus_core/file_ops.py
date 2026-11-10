#!/usr/bin/env python3
"""
tools/nexus_core/file_ops.py — файловые руки агента (N3, file API).

Контракт (NEXUS_CORE_SPEC.md §0a.3, К7):
    read  — печать текстового файла или его строк: --offset (с 1),
             --limit (по умолчанию все, не более 8 МБ);
    write — атомарная запись (tmp → replace): читатель видит либо старое,
             либо новое, никогда половину; недостающие папки создаются;
    edit  — точная замена: old → new (каждое old ровно один раз, пары не
             пересекаются), all-or-none — любая невыполнимая пара
             отклоняет всю правку целиком.

Sandbox: все пути разрешаются относительно корня (supervisor.base /
state dir); уход за пределы корня отклоняется, абсолютные пути запрещены.
"""

from __future__ import annotations

import json
import os
import stat
import tempfile
from pathlib import Path
from typing import Optional

MAX_READ_BYTES = 8 * 1024 * 1024  # 8 МБ (контракт К7)

# #478 (NEWF read-only мост, contracts/QODER-newf-backend-475.md §2.1):
# песочница является хранилищем — нужен только честный walk с потолками.
DEFAULT_LIST_LIMIT = 2000      # записей в ответе; сверх ⇒ truncated: true
MAX_LIST_DEPTH = 12            # жёсткий потолок рекурсии (depth=0 = "до потолка")
MAX_LIST_BYTES = 4 * 1024 * 1024  # потолок сериализованного ответа ⇒ 413

# Windows-джанкшен — не symlink для os.lstat, но наружу из песочницы выносит
# так же. Path.is_junction() появился в 3.12; на более старом хосте остаётся
# только resolve()+is_relative_to (он и есть второй пояс защиты).
_IS_JUNCTION = getattr(Path, "is_junction", None)


class FileOpsError(ValueError):
    """Ошибка файловой операции (sandbox, аргументы, содержимое)."""


class FileOpsNotFound(FileOpsError):
    """Файл не найден."""


class FileOpsTooLarge(FileOpsError):
    """Ответ list() не влезает в MAX_LIST_BYTES — молча урезать нельзя."""


class FileOps:
    """Файловые операции в пределах sandbox-корня."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root).expanduser().resolve()

    # ------------------------------------------------------------------
    # Внутреннее — sandbox-resolve
    # ------------------------------------------------------------------

    def _resolve(self, path: str) -> Path:
        if not isinstance(path, str) or not path.strip():
            raise FileOpsError("path required")
        p = Path(path)
        # os.path.isabs платформенно-зависим: на POSIX "C:\x" и "\\unc" —
        # не абсолютные → провалились бы в sandbox. Ловим Windows-формы явно.
        win_abs = (
            len(path) >= 3 and path[0].isalpha() and path[1] == ":" and path[2] in "\\/"
        ) or path.startswith(("\\\\", "//"))
        if p.is_absolute() or win_abs:
            raise FileOpsError(f"absolute path not allowed: {path!r}")
        q = (self.root / p).resolve()
        if not q.is_relative_to(self.root):
            raise FileOpsError(f"path escapes sandbox: {path!r}")
        return q

    def resolve_dir(self, path: str) -> Path:
        """Как _resolve, но для «каталог, который надо перечислять/осмотреть»:
        отсутствующий ⇒ FileOpsNotFound (404), не-каталог ⇒ FileOpsError (400).
        """
        p = self._resolve(path)
        if not p.exists():
            raise FileOpsNotFound(f"path not found: {path!r}")
        if not p.is_dir():
            raise FileOpsError(f"not a directory: {path!r}")
        return p

    @staticmethod
    def _atomic_write_bytes(path: Path, data: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(
            dir=str(path.parent), prefix=".nx-file-", suffix=".tmp"
        )
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
            os.replace(tmp, path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

    @staticmethod
    def _atomic_write(path: Path, text: str) -> None:
        FileOps._atomic_write_bytes(path, text.encode("utf-8"))

    # ------------------------------------------------------------------
    # read / write / edit
    # ------------------------------------------------------------------

    def read(
        self,
        path: str,
        offset: int = 1,
        limit: Optional[int] = None,
    ) -> dict:
        """Читает текстовый файл (строки). offset — с 1; limit — лимит строк."""
        if offset < 1:
            raise FileOpsError("offset must be >= 1")
        if limit is not None and limit < 1:
            raise FileOpsError("limit must be >= 1")
        p = self._resolve(path)
        if not p.is_file():
            raise FileOpsNotFound(f"file not found: {path!r}")
        data = p.read_bytes()
        if len(data) > MAX_READ_BYTES:
            raise FileOpsError(
                f"file exceeds {MAX_READ_BYTES} byte read limit: {path!r}"
            )
        text = data.decode("utf-8", errors="replace")
        lines = text.splitlines()
        start = offset - 1
        selected = lines[start : start + limit] if limit is not None else lines[start:]
        return {
            "path": str(Path(path)),
            "content": "\n".join(selected),
            "lines": len(selected),
            "total_lines": len(lines),
            "offset": offset,
            "limit": limit,
        }

    def read_bytes(self, path: str, max_bytes: Optional[int] = None) -> bytes:
        """Читает файл байт-в-байт (send-file копии). Размер проверяется
        по stat до чтения; лимит — MAX_READ_BYTES или явный max_bytes."""
        limit = MAX_READ_BYTES if max_bytes is None else int(max_bytes)
        p = self._resolve(path)
        if not p.is_file():
            raise FileOpsNotFound(f"file not found: {path!r}")
        if p.stat().st_size > limit:
            raise FileOpsError(
                f"file exceeds {limit} byte read limit: {path!r}"
            )
        return p.read_bytes()

    def list(
        self,
        path: str = ".",
        depth: int = 1,
        limit: Optional[int] = None,
    ) -> dict:
        """Перечисляет песочницу (§2.1 #475): depth=1 — только дети,
        depth=0 — рекурсия до MAX_LIST_DEPTH. kind ∈ dir|file|other,
        bytes=None для каталога и «stat не удался» (0 читалось бы как пустой
        файл). Пути записей — относительно корня, posix: их можно вернуть
        в read как есть. Симлинки/джанкшены наружу не разворачиваются.
        """
        if depth < 0:
            raise FileOpsError("depth must be >= 0")
        if depth > MAX_LIST_DEPTH:
            raise FileOpsError(f"depth must be <= {MAX_LIST_DEPTH}")
        if limit is None:
            limit = DEFAULT_LIST_LIMIT
        if limit < 1:
            raise FileOpsError("limit must be >= 1")
        target = self._resolve(path)
        if not target.exists():
            raise FileOpsNotFound(f"file not found: {path!r}")

        entries: list[dict] = []
        # dict-флаг: nonlocal-bool в рекурсии читался бы как присваивание
        out = {"truncated": False}
        max_levels = MAX_LIST_DEPTH if depth == 0 else depth
        visited: set[Path] = {target}

        def rel(p: Path) -> str:
            return p.relative_to(self.root).as_posix()

        def classify(entry: Path) -> tuple[str, Optional[int]]:
            try:
                st = os.lstat(entry)
            except OSError:
                return "other", None
            mode = st.st_mode
            if stat.S_ISLNK(mode):
                return "other", None
            if stat.S_ISDIR(mode):
                if _IS_JUNCTION is not None and _IS_JUNCTION(entry):
                    return "other", None
                try:
                    real = entry.resolve()
                except OSError:
                    return "other", None
                if not real.is_relative_to(self.root):
                    return "other", None
                return "dir", None
            if stat.S_ISREG(mode):
                return "file", st.st_size
            return "other", None

        def walk(directory: Path, level: int) -> None:
            try:
                with os.scandir(directory) as it:
                    children = sorted(it, key=lambda e: e.name)
            except OSError:
                out["truncated"] = True   # каталог не прочитан — это не «пусто»
                return
            for child in children:
                if len(entries) >= limit:
                    out["truncated"] = True
                    return
                cp = Path(child.path)
                kind, size = classify(cp)
                entries.append({"path": rel(cp), "kind": kind, "bytes": size})
                if kind != "dir":
                    continue
                if level >= max_levels:
                    # Явный depth клиента — запрошенный форма-ответ, не урезание.
                    # truncated честен только когда режет жёсткий потолок (§2.1).
                    if depth == 0:
                        out["truncated"] = True
                    continue
                real = cp.resolve()
                if real in visited:
                    out["truncated"] = True
                    continue
                visited.add(real)
                walk(cp, level + 1)

        if target.is_dir():
            walk(target, 1)
        else:
            kind, size = classify(target)
            entries.append({"path": rel(target), "kind": kind, "bytes": size})

        result = {
            "path": rel(target),
            "entries": entries,
            "count": len(entries),
            "truncated": out["truncated"],
        }
        if len(json.dumps(result).encode("utf-8")) > MAX_LIST_BYTES:
            raise FileOpsTooLarge(f"listing exceeds {MAX_LIST_BYTES} bytes")
        return result

    def write(self, path: str, content: str) -> dict:
        """Атомарно пишет строку в файл (tmp → replace, создаёт папки)."""
        if not isinstance(content, str):
            raise FileOpsError("content (string) required")
        p = self._resolve(path)
        self._atomic_write(p, content)
        return {"path": str(Path(path)), "bytes": len(content.encode("utf-8"))}

    def write_bytes(self, path: str, data: bytes) -> dict:
        """Атомарно пишет бинарные данные (tmp → replace, создаёт папки).

        Для putfile-дропов (#515): бинарь не прогоняется через UTF-8 —
        .png и прочее ложатся байт-в-байт.
        """
        if not isinstance(data, (bytes, bytearray)):
            raise FileOpsError("data (bytes) required")
        p = self._resolve(path)
        self._atomic_write_bytes(p, bytes(data))
        return {"path": str(Path(path)), "bytes": len(data)}

    def write_bytes_at(self, path: str, offset: int,
                       data: bytes) -> dict:
        """W55: запись байтов по смещению — докачка send-file.

        offset ≥ 0; файл создаётся при отсутствии (дыра до offset
        заполняется нулями — sparse). Перезапись середины файла
        допустима (idempotent retry безопасен). Не атомарно —
        chunk-семантика.
        """
        if not isinstance(offset, int) or isinstance(offset, bool) \
                or offset < 0:
            raise FileOpsError("offset must be int >= 0")
        if not isinstance(data, (bytes, bytearray)):
            raise FileOpsError("data (bytes) required")
        p = self._resolve(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        mode = "r+b" if p.exists() else "wb"
        with open(p, mode) as fh:
            fh.seek(offset)
            fh.write(bytes(data))
            fh.flush()
            size = max(p.stat().st_size, fh.tell())
        return {"path": str(Path(path)), "offset": offset,
                "written": len(data), "size": size}

    def append_bytes(self, path: str, data: bytes) -> dict:
        """W25: append бинарных данных в файл (live pipe-file).

        Не атомарно — tail-семантика: pump дозаписывает чанки вывода.
        """
        if not isinstance(data, (bytes, bytearray)):
            raise FileOpsError("data (bytes) required")
        p = self._resolve(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "ab") as fh:
            fh.write(bytes(data))
        return {"path": str(Path(path)), "appended": len(data)}

    def rotate(self, path: str) -> bool:
        """W45: ротация pipe-file — path → path.1 (атомарный os.replace).

        True если файл существовал и переименован; False если файла
        нет (ротировать нечего). Следующий append_bytes создаст
        свежий path. Одно поколение бэкапа (.1 перезаписывается).
        """
        p = self._resolve(path)
        if not p.is_file():
            return False
        bak = p.with_name(p.name + ".1")
        os.replace(p, bak)
        return True

    def edit(self, path: str, pairs: list[tuple[str, str]]) -> dict:
        """Точная замена old → new: каждое old ровно один раз, без наложений,
        all-or-none (если любая пара невыполнима — ошибка, файл не меняется).
        """
        if not isinstance(pairs, list) or not pairs:
            raise FileOpsError("at least one (old, new) pair required")
        for i, (old, new) in enumerate(pairs):
            if not isinstance(old, str) or not old:
                raise FileOpsError(f"pair {i}: old must be a non-empty string")
            if not isinstance(new, str):
                raise FileOpsError(f"pair {i}: new must be a string")
        p = self._resolve(path)
        if not p.is_file():
            raise FileOpsNotFound(f"file not found: {path!r}")
        text = p.read_text(encoding="utf-8", errors="replace")

        hits: list[tuple[int, int]] = []  # (индекс вхождения, номер пары)
        for i, (old, _new) in enumerate(pairs):
            count = text.count(old)
            if count != 1:
                raise FileOpsError(
                    f"old string must occur exactly once, found {count}: {old!r}"
                )
            hits.append((text.index(old), i))

        # непересечение: сортируем по позиции, проверяем границы
        hits.sort(key=lambda h: h[0])
        for j in range(1, len(hits)):
            prev_idx, prev_i = hits[j - 1]
            idx, _i = hits[j]
            if idx < prev_idx + len(pairs[prev_i][0]):
                raise FileOpsError("replacement pairs overlap")

        # применяем снизу вверх, чтобы индексы не съезжали
        result = text
        for idx, i in sorted(hits, key=lambda h: h[0], reverse=True):
            old, new = pairs[i]
            result = result[:idx] + new + result[idx + len(old):]

        self._atomic_write(p, result)
        return {"path": str(Path(path)), "replacements": len(pairs)}
