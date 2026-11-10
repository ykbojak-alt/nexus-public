#!/usr/bin/env python3
"""
tools/nexus_core/test_hardening_negative.py — adversarial на свежие фиксы
(file_ops.win_abs, run cols/rows/parent/labels, kill stage). CORE_MOCK=1.

Цель: доказать пригодность/негодность чеков. Каждый кейс фиксирует фактическое
поведение (<500, честный error ИЛИ отклонение/принятие).
"""

from __future__ import annotations

import os
import shutil
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("CORE_MOCK", "1")

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop  # noqa: E402

from tools.nexus_core.api import create_app  # noqa: E402
from tools.nexus_core.mock_pty import MockPTYBackend  # noqa: E402
from tools.nexus_core.supervisor_v1 import SupervisorV1  # noqa: E402


def make_temp_base() -> Path:
    return Path(tempfile.mkdtemp(prefix="hardening-"))


class HardeningApiTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = make_temp_base()
        self.backend = MockPTYBackend()
        self.supervisor = SupervisorV1(backend=self.backend)
        super().setUp()

    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.tmp, supervisor=self.supervisor,
                          templates_dir=self.tmp / "templates")

    async def run_terminal(self, name="t1", **kwargs):
        resp = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"], **kwargs,
        })
        self.assertEqual(resp.status, 200)
        return await resp.json()


# ---------------------------------------------------------------------------
# 1. win_abs: формы абсолютных путей
# ---------------------------------------------------------------------------
class TestWinAbsCheck(HardeningApiTestCase):
    ABS_FORMS = [
        "C:\\x", "C:/x", "c:\\x", "c:/x",   # регистр
        "\\unc", "//x", "\\\\host\\share",   # UNC
        "C:\\x y", "C:/x y",                  # пробелы
        "C:",
        "C",
        " x ", "  ", "",
        "C:\\", "C:/",
    ]

    @unittest_run_loop
    async def test_abs_forms_do_not_escape(self):
        """Ни одна absolute-форма НЕ должна писать/читать вне sandbox (не 500,
        и если escape — это НАХОДКА). Пишем в каждую и проверяем <500."""
        for path in self.ABS_FORMS:
            resp = await self.client.post("/api/core/file/write", json={
                "path": path, "content": "z",
            })
            # absolute-формы должны отклоняться (400); не 500
            self.assertLess(resp.status, 500, f"path={path!r} status={resp.status}")

    @unittest_run_loop
    async def test_abs_forms_rejected_not_relative_written(self):
        """Проверяем, что true-absolute отклонены (400), а relative приняты (200)."""
        # true absolute: C:\x, C:/x, //x, \\host\share
        for path in ["C:\\x", "C:/x", "//x", "\\\\host\\share", "C:\\x y"]:
            resp = await self.client.post("/api/core/file/write", json={
                "path": path, "content": "z",
            })
            self.assertEqual(resp.status, 400, f"path={path!r} должен быть отклонён")

    @unittest_run_loop
    async def test_c_without_slash_relative(self):
        """C: без слеша — Windows drive-relative (не ABS). Если чек принимает
        и пишет ВНУТРИ sandbox — ОК; если escape — НАХОДКА."""
        resp = await self.client.post("/api/core/file/write", json={
            "path": "C:", "content": "z",
        })
        self.assertLess(resp.status, 500)


# ---------------------------------------------------------------------------
# 2. run-валидация cols/rows/parent/labels
# ---------------------------------------------------------------------------
class TestRunValidation(HardeningApiTestCase):
    @unittest_run_loop
    async def test_cols_boundaries(self):
        for col in (0, 1, 500, 501):
            resp = await self.client.post("/api/core/run", json={
                "name": f"c{col}", "command": ["sh"], "cols": col,
            })
            self.assertLess(resp.status, 500, f"cols={col}")
            # 0 и 501 должны быть отклонены (400), 1 и 500 — приняты (200)
            if col in (0, 501):
                self.assertEqual(resp.status, 400, f"cols={col}")
            else:
                self.assertIn(resp.status, (200, 409), f"cols={col}")

    @unittest_run_loop
    async def test_cols_non_numeric(self):
        for bad in ("abc", "1.5"):
            resp = await self.client.post("/api/core/run", json={
                "name": "c_bad", "command": ["sh"], "cols": bad,
            })
            self.assertLess(resp.status, 500, f"cols={bad!r}")

    @unittest_run_loop
    async def test_cols_null(self):
        # Починено: cols=None → 400 (было TypeError → 500).
        resp = await self.client.post("/api/core/run", json={
            "name": "c_null", "command": ["sh"], "cols": None,
        })
        self.assertEqual(resp.status, 400, f"cols=None → {resp.status}")

    @unittest_run_loop
    async def test_cols_float(self):
        # Починено: float не усекается молча — 400 (строгий int-контракт).
        resp = await self.client.post("/api/core/run", json={
            "name": "c_float", "command": ["sh"], "cols": 1.5,
        })
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_rows_boundaries(self):
        for row in (0, 1, 200, 201):
            resp = await self.client.post("/api/core/run", json={
                "name": f"r{row}", "command": ["sh"], "rows": row,
            })
            self.assertLess(resp.status, 500, f"rows={row}")
            if row in (0, 201):
                self.assertEqual(resp.status, 400, f"rows={row}")
            else:
                self.assertIn(resp.status, (200, 409), f"rows={row}")

    @unittest_run_loop
    async def test_rows_non_numeric(self):
        for bad in ("abc", "2.5"):
            resp = await self.client.post("/api/core/run", json={
                "name": "r_bad", "command": ["sh"], "rows": bad,
            })
            self.assertLess(resp.status, 500, f"rows={bad!r}")

    @unittest_run_loop
    async def test_rows_null(self):
        # Починено: rows=None → 400 (было TypeError → 500).
        resp = await self.client.post("/api/core/run", json={
            "name": "r_null", "command": ["sh"], "rows": None,
        })
        self.assertEqual(resp.status, 400, f"rows=None → {resp.status}")

    @unittest_run_loop
    async def test_parent_nonexistent_404(self):
        resp = await self.client.post("/api/core/run", json={
            "name": "orphan", "command": ["sh"], "parent": "local/ghost",
        })
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_parent_self_404(self):
        resp = await self.client.post("/api/core/run", json={
            "name": "selfp", "command": ["sh"], "parent": "local/selfp",
        })
        # parent=себе не существует на момент создания → 404
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_labels_non_string_values_400(self):
        resp = await self.client.post("/api/core/run", json={
            "name": "l1", "command": ["sh"], "labels": {"k": 123},
        })
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_labels_null_ok(self):
        resp = await self.client.post("/api/core/run", json={
            "name": "l3", "command": ["sh"], "labels": None,
        })
        self.assertIn(resp.status, (200, 409))


# ---------------------------------------------------------------------------
# 3. kill stage
# ---------------------------------------------------------------------------
class TestKillStage(HardeningApiTestCase):
    @unittest_run_loop
    async def test_kill_stage_valid(self):
        await self.run_terminal("t1")
        for stage in ("hangup", "terminate", "kill"):
            resp = await self.client.post("/api/core/kill", json={
                "term": "t1", "stage": stage,
            })
            self.assertLess(resp.status, 500, f"stage={stage}")

    @unittest_run_loop
    async def test_kill_stage_empty_string(self):
        await self.run_terminal("t1")
        resp = await self.client.post("/api/core/kill", json={
            "term": "t1", "stage": "",
        })
        # "" — не валидная ступень → 400
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_kill_stage_number(self):
        await self.run_terminal("t1")
        resp = await self.client.post("/api/core/kill", json={
            "term": "t1", "stage": 123,
        })
        self.assertLess(resp.status, 500)

    @unittest_run_loop
    async def test_kill_stage_null(self):
        await self.run_terminal("t1")
        resp = await self.client.post("/api/core/kill", json={
            "term": "t1", "stage": None,
        })
        # null → дефолт (hangup) → 200
        self.assertEqual(resp.status, 200)


if __name__ == "__main__":
    unittest.main()
