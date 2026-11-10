#!/usr/bin/env python3
"""
tools/nexus_core/test_send_file.py — W2 send-file endpoint.

API (AioHTTPTestCase + MockPTYBackend): content→файл в
files/local/<term>/, name-переопределение/дефолт, path→копия из
песочницы (basename-имя, бинарь), send=true → путь в stdin
терминала, ошибки: both/neither → 400, bad name → 400,
unknown term → 404, missing source → 404, non-str content → 400.

Запуск: pytest tools/nexus_core/test_send_file.py
"""

from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class SendFileApiTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="send-file-"))
        self.state_dir = self.tmp / "state"
        self.backend = MockPTYBackend()
        self.sup = SupervisorV1(backend=self.backend)
        super().setUp()

    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.state_dir,
                          supervisor=self.sup,
                          templates_dir=self.tmp / "templates")

    async def run_terminal(self, name="t1", **kwargs):
        resp = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"], **kwargs})
        self.assertEqual(resp.status, 200)
        return await resp.json()

    async def send_file(self, term="t1", **body):
        return await self.client.post(
            f"/api/core/terminal/{term}/send-file", json=body)

    def drop_path(self, term="t1", name="file.txt"):
        return self.state_dir / "files" / "local" / term / name

    # -- content ---------------------------------------------------------

    @unittest_run_loop
    async def test_content_creates_file(self):
        await self.run_terminal("t1")
        resp = await self.send_file(content="hello nexus")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["path"], "files/local/t1/file.txt")
        self.assertEqual(data["term"], "local/t1")
        self.assertEqual(data["bytes"], len("hello nexus"))
        self.assertFalse(data["sent"])
        self.assertEqual(data["status"], "delivered")
        self.assertTrue(self.drop_path().is_file())
        self.assertEqual(
            self.drop_path().read_text(encoding="utf-8"), "hello nexus")

    @unittest_run_loop
    async def test_content_custom_name(self):
        await self.run_terminal("t1")
        resp = await self.send_file(content="x", name="note.md")
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["path"], "files/local/t1/note.md")
        self.assertTrue(self.drop_path("t1", "note.md").is_file())

    # -- path source ------------------------------------------------------

    @unittest_run_loop
    async def test_path_copies_binary_with_basename(self):
        await self.run_terminal("t1")
        src_rel = "incoming/blob.bin"
        src_abs = self.state_dir / src_rel
        src_abs.parent.mkdir(parents=True, exist_ok=True)
        payload = bytes(range(256)) * 4
        src_abs.write_bytes(payload)
        resp = await self.send_file(path=src_rel)
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["path"], "files/local/t1/blob.bin")
        self.assertEqual(self.drop_path("t1", "blob.bin").read_bytes(),
                         payload)
        # источник не тронут
        self.assertEqual(src_abs.read_bytes(), payload)

    @unittest_run_loop
    async def test_path_custom_name(self):
        await self.run_terminal("t1")
        (self.state_dir / "a.txt").write_text("A", encoding="utf-8")
        resp = await self.send_file(path="a.txt", name="renamed.txt")
        self.assertEqual(resp.status, 200)
        self.assertEqual(
            (await resp.json())["path"], "files/local/t1/renamed.txt")

    # -- send -------------------------------------------------------------

    @unittest_run_loop
    async def test_send_true_types_abs_path(self):
        await self.run_terminal("t1")
        resp = await self.send_file(content="z", name="z.txt", send=True)
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertTrue(data["sent"])
        term = self.sup.get_terminal("local/t1")
        handle = next(iter(self.backend.terminals.values()))
        stdin = handle.stdin_data().decode("utf-8")
        self.assertIn(str(self.drop_path("t1", "z.txt").resolve()), stdin)
        self.assertNotIn("\r", stdin)  # enter=false — без Enter
        self.assertIsNotNone(term)

    @unittest_run_loop
    async def test_send_false_no_stdin(self):
        await self.run_terminal("t1")
        resp = await self.send_file(content="z")
        self.assertEqual(resp.status, 200)
        handle = next(iter(self.backend.terminals.values()))
        self.assertEqual(handle.stdin_data(), b"")

    # -- ошибки -----------------------------------------------------------

    @unittest_run_loop
    async def test_both_path_and_content_400(self):
        await self.run_terminal("t1")
        resp = await self.send_file(path="x", content="y")
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_neither_path_nor_content_400(self):
        await self.run_terminal("t1")
        resp = await self.send_file(name="x.txt")
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_bad_names_400(self):
        await self.run_terminal("t1")
        for bad in ("a/b", "a\\b", "..", "", "  "):
            resp = await self.send_file(content="x", name=bad)
            self.assertEqual(resp.status, 400, bad)

    @unittest_run_loop
    async def test_unknown_terminal_404(self):
        resp = await self.send_file("ghost", content="x")
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_missing_source_404(self):
        await self.run_terminal("t1")
        resp = await self.send_file(path="no/such.bin")
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_absolute_source_rejected(self):
        await self.run_terminal("t1")
        resp = await self.send_file(path="D:/Windows/win.ini")
        self.assertEqual(resp.status, 400)  # sandbox: abs → FileOpsError

    @unittest_run_loop
    async def test_non_string_content_400(self):
        await self.run_terminal("t1")
        resp = await self.send_file(content=123)
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_non_bool_send_400(self):
        await self.run_terminal("t1")
        resp = await self.send_file(content="x", send="yes")
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_w55_chunked_resume(self):
        """W55: content_b64+offset — докачка чанками."""
        import base64
        await self.run_terminal("t1")
        data = b"\x00\x01\x02HELLO-BINARY\xff\xfe"
        # три чанка с offset
        chunks = [data[:4], data[4:10], data[10:]]
        off = 0
        for ch in chunks:
            resp = await self.send_file(
                content_b64=base64.b64encode(ch).decode(),
                name="blob.bin", offset=off)
            self.assertEqual(resp.status, 200)
            d = await resp.json()
            self.assertEqual(d["offset"], off)
            self.assertEqual(d["bytes"], len(ch))
            off += len(ch)
        # файл собран байт-в-байт
        p = (self.state_dir / "files/local/t1/blob.bin")
        self.assertEqual(p.read_bytes(), data)
        # повтор чанка (retry) идемпотентен — перезапись того же
        resp = await self.send_file(
            content_b64=base64.b64encode(chunks[1]).decode(),
            name="blob.bin", offset=4)
        self.assertEqual(resp.status, 200)
        self.assertEqual(p.read_bytes(), data)
        # offset за пределы — sparse-дыра нулями
        resp = await self.send_file(
            content_b64=base64.b64encode(b"Z").decode(),
            name="sparse.bin", offset=10)
        self.assertEqual(resp.status, 200)
        sp = (self.state_dir / "files/local/t1/sparse.bin")
        self.assertEqual(sp.read_bytes(), b"\x00" * 10 + b"Z")

    @unittest_run_loop
    async def test_w55_validation(self):
        import base64
        await self.run_terminal("t1")
        # path+offset → 400
        resp = await self.send_file(
            path="x.txt", offset=5)
        self.assertEqual(resp.status, 400)
        # offset<0 → 400
        resp = await self.send_file(
            content="x", offset=-1)
        self.assertEqual(resp.status, 400)
        # bad b64 → 400
        resp = await self.send_file(content_b64="!!!")
        self.assertEqual(resp.status, 400)
        # content+content_b64 вместе → 400 (XOR-3)
        resp = await self.send_file(
            content="x",
            content_b64=base64.b64encode(b"y").decode())
        self.assertEqual(resp.status, 400)
        # content+offset>0 — легально (текст-чанк)
        resp = await self.send_file(
            content="TAIL", name="t.txt", offset=0)
        self.assertEqual(resp.status, 200)


if __name__ == "__main__":
    unittest.main()
