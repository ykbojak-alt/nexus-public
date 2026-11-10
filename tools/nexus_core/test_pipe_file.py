#!/usr/bin/env python3
"""test_pipe_file.py — W25 POST /terminal/<n>/pipe-file."""
from __future__ import annotations
import shutil, tempfile, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class PipeFileTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="pf-"))
        self.state_dir = self.tmp / "state"
        self.sup = SupervisorV1(backend=MockPTYBackend())
        super().setUp()
    def tearDown(self):
        super().tearDown(); shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.state_dir, supervisor=self.sup,
                          templates_dir=self.tmp / "templates")
    async def run_terminal(self, name="pf1"):
        r = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"]})
        self.assertEqual(r.status, 200)
    async def pipe(self, name="pf1", path="out/pf1.log", **kw):
        return await self.client.post(
            f"/api/core/terminal/{name}/pipe-file",
            json={"path": path, **kw})
    def file_bytes(self, rel="out/pf1.log"):
        return (self.state_dir / rel).read_bytes()

    @unittest_run_loop
    async def test_output_appended_live(self):
        await self.run_terminal()
        r = await self.pipe()
        self.assertEqual(r.status, 200)
        d = await r.json()
        self.assertEqual(d["status"], "piped")
        # файл создан (touch)
        self.assertTrue((self.state_dir / "out/pf1.log").exists())
        # вывод → файл
        t = self.sup.get_terminal("local/pf1")
        t.handle.stdout.extend(b"CHUNK-1\n")
        self.sup.step_once()
        t.handle.stdout.extend(b"CHUNK-2\n")
        self.sup.step_once()
        data = self.file_bytes()
        self.assertIn(b"CHUNK-1", data)
        self.assertIn(b"CHUNK-2", data)
        # list
        d2 = await (await self.client.get(
            "/api/core/pipe-files")).json()
        self.assertEqual(d2["count"], 1)
        self.assertEqual(d2["pipes"][0]["path"], "out/pf1.log")
        self.assertGreater(d2["pipes"][0]["bytes"], 0)
        # события file_pipe
        self.assertTrue(any(e["type"] == "file_pipe"
                            for e in self.sup.events))

    @unittest_run_loop
    async def test_remove_and_retarget(self):
        await self.run_terminal()
        await self.pipe(path="a.log")
        t = self.sup.get_terminal("local/pf1")
        t.handle.stdout.extend(b"TO-A\n")
        self.sup.step_once()
        # перенацеливание
        await self.pipe(path="b.log")
        t.handle.stdout.extend(b"TO-B\n")
        self.sup.step_once()
        self.assertIn(b"TO-A", self.file_bytes("a.log"))
        self.assertNotIn(b"TO-B", self.file_bytes("a.log"))
        self.assertIn(b"TO-B", self.file_bytes("b.log"))
        # снятие
        r = await self.pipe(path=None)
        d = await r.json()
        self.assertEqual(d["status"], "removed")
        t.handle.stdout.extend(b"AFTER\n")
        self.sup.step_once()
        self.assertNotIn(b"AFTER", self.file_bytes("b.log"))
        # повторное снятие → none
        r2 = await self.pipe(path=None)
        self.assertEqual((await r2.json())["status"], "none")

    @unittest_run_loop
    async def test_validation(self):
        await self.run_terminal()
        # abs path → 400
        self.assertEqual((await self.pipe(path="/etc/x")).status, 400)
        self.assertEqual((await self.pipe(path="C:/win/x")).status, 400)
        self.assertEqual((await self.pipe(path="../esc")).status, 400)
        # bad type
        self.assertEqual((await self.client.post(
            "/api/core/terminal/pf1/pipe-file",
            json={"path": 5})).status, 400)
        # 404
        self.assertEqual((await self.pipe(name="ghost")).status, 404)

    @unittest_run_loop
    async def test_rotation_on_threshold(self):
        """W45: file_pipe_max → rotate path→path.1, запись продолжается."""
        await self.run_terminal()
        await self.pipe(path="rot.log")
        self.sup.file_pipe_max = 10  # маленький порог для теста
        t = self.sup.get_terminal("local/pf1")
        t.handle.stdout.extend(b"CHUNK-AAAAA\n")  # 12 байт
        self.sup.step_once()
        # порог превышен (12>10), но ротация на следующем чанке
        t.handle.stdout.extend(b"CHUNK-BBBB\n")
        self.sup.step_once()
        # старый файл → rot.log.1, новый rot.log со вторым чанком
        old = self.file_bytes("rot.log.1")
        new = self.file_bytes("rot.log")
        self.assertIn(b"CHUNK-AAAAA", old)
        self.assertIn(b"CHUNK-BBBB", new)
        self.assertNotIn(b"CHUNK-AAAAA", new)
        # событие ротации
        self.assertTrue(any(e["type"] == "file_pipe_rotate"
                            for e in self.sup.events))
        # full не выставлен — запись жива
        d = await (await self.client.get(
            "/api/core/pipe-files")).json()
        self.assertFalse(d["pipes"][0]["full"])
        # ротация не убила pipe — третий чанк тоже пишется
        t.handle.stdout.extend(b"CHUNK-CCCC\n")
        self.sup.step_once()
        self.assertIn(b"CHUNK-CCCC", self.file_bytes("rot.log"))

    @unittest_run_loop
    async def test_rotation_without_rotator_full(self):
        """W45: без file_rotator — старое поведение full+stop."""
        await self.run_terminal()
        await self.pipe(path="full.log")
        self.sup.file_pipe_max = 5
        self.sup.file_rotator = None  # как при ручном supervisor
        t = self.sup.get_terminal("local/pf1")
        t.handle.stdout.extend(b"AAAAAABBBBCCCC\n")
        self.sup.step_once()
        t.handle.stdout.extend(b"MORE\n")
        self.sup.step_once()
        d = await (await self.client.get(
            "/api/core/pipe-files")).json()
        self.assertTrue(d["pipes"][0]["full"])
        self.assertTrue(any(e["type"] == "file_pipe_full"
                            for e in self.sup.events))


if __name__ == "__main__":
    unittest.main()
