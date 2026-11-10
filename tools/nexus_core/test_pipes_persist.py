#!/usr/bin/env python3
"""test_pipes_persist.py — W29 pipes.json переживает restart."""
from __future__ import annotations
import json, shutil, tempfile, unittest
from pathlib import Path
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class PipesPersistTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="pp-"))
        self.reg = self.tmp / "state" / "registry.json"
    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_roundtrip_restart(self):
        sup = SupervisorV1(backend=MockPTYBackend(),
                           registry_path=self.reg)
        sup.add_pipe("local/a", "local/b")
        sup.add_pipe("local/a", "local/c")
        sup.add_pipe("local/x", "local/y")
        sup.add_file_pipe("local/f", "out.log")
        pipes_file = self.reg.with_name("pipes.json")
        self.assertTrue(pipes_file.exists())
        data = json.loads(pipes_file.read_text(encoding="utf-8"))
        self.assertEqual(data["pipes"]["local/a"],
                         ["local/b", "local/c"])
        self.assertEqual(data["file_pipes"]["local/f"], "out.log")
        # «restart» — новый supervisor на том же registry_path
        sup2 = SupervisorV1(backend=MockPTYBackend(),
                            registry_path=self.reg)
        self.assertEqual(sup2.pipes["local/a"], ["local/b", "local/c"])
        self.assertEqual(sup2.pipes["local/x"], ["local/y"])
        self.assertEqual(sup2.file_pipes["local/f"], "out.log")

    def test_remove_persists(self):
        sup = SupervisorV1(backend=MockPTYBackend(),
                           registry_path=self.reg)
        sup.add_pipe("local/a", "local/b")
        sup.remove_pipe("local/a", "local/b")
        sup2 = SupervisorV1(backend=MockPTYBackend(),
                            registry_path=self.reg)
        self.assertNotIn("local/a", sup2.pipes)
        # remove всех от src
        sup.add_pipe("local/a", "local/b")
        sup.add_pipe("local/a", "local/c")
        sup.remove_pipe("local/a")
        sup3 = SupervisorV1(backend=MockPTYBackend(),
                            registry_path=self.reg)
        self.assertNotIn("local/a", sup3.pipes)

    def test_remove_file_pipe_persists(self):
        sup = SupervisorV1(backend=MockPTYBackend(),
                           registry_path=self.reg)
        sup.add_file_pipe("local/f", "a.log")
        sup.remove_file_pipe("local/f")
        sup2 = SupervisorV1(backend=MockPTYBackend(),
                            registry_path=self.reg)
        self.assertNotIn("local/f", sup2.file_pipes)

    def test_no_registry_path_inmemory(self):
        sup = SupervisorV1(backend=MockPTYBackend())
        self.assertIsNone(sup._pipes_path)
        sup.add_pipe("local/a", "local/b")
        sup2 = SupervisorV1(backend=MockPTYBackend())
        self.assertEqual(sup2.pipes, {})  # без пути — не персистит

    def test_broken_file_tolerated(self):
        self.reg.parent.mkdir(parents=True, exist_ok=True)
        self.reg.with_name("pipes.json").write_text(
            "{broken", encoding="utf-8")
        sup = SupervisorV1(backend=MockPTYBackend(),
                           registry_path=self.reg)
        self.assertEqual(sup.pipes, {})
        self.assertEqual(sup.file_pipes, {})

    def test_dedup_on_load(self):
        self.reg.parent.mkdir(parents=True, exist_ok=True)
        self.reg.with_name("pipes.json").write_text(json.dumps(
            {"pipes": {"local/a": ["local/b", "local/b", "local/c"]}}),
            encoding="utf-8")
        sup = SupervisorV1(backend=MockPTYBackend(),
                           registry_path=self.reg)
        self.assertEqual(sup.pipes["local/a"], ["local/b", "local/c"])


if __name__ == "__main__":
    unittest.main()
