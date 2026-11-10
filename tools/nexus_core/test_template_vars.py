#!/usr/bin/env python3
"""test_template_vars.py — W59 параметризованные шаблоны {vars}."""
from __future__ import annotations
import shutil, tempfile, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1
from tools.nexus_core.templates import Template


class TemplateVarsTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="tv-"))
        self.tpl_dir = self.tmp / "templates"
        self.tpl_dir.mkdir(parents=True)
        self.sup = SupervisorV1(backend=MockPTYBackend())
        super().setUp()
    def tearDown(self):
        super().tearDown(); shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.tmp / "state",
                          supervisor=self.sup,
                          templates_dir=self.tpl_dir)

    def _tpl(self, name="agent", extra=""):
        (self.tpl_dir / f"{name}.md").write_text(
            "---\ncommand: run --model {model} --task {task}\n"
            f"{extra}---\nDo {{task}} as {{model}}.\n",
            encoding="utf-8")

    @unittest_run_loop
    async def test_render_substitution(self):
        t = Template(name="x", path=Path("x.md"),
                     command=["run", "--m", "{model}"],
                     body="hi {who} {missing}",
                     meta={"params": "model, who"})
        cmd, body = t.render({"model": "opus", "who": "bob"})
        self.assertEqual(cmd, ["run", "--m", "opus"])
        self.assertEqual(body, "hi bob {missing}")  # unknown → literal
        self.assertEqual(t.params, ["model", "who"])

    @unittest_run_loop
    async def test_run_with_vars(self):
        self._tpl(extra="params: model, task\n")
        r = await self.client.post(
            "/api/core/templates/agent/run",
            json={"vars": {"model": "sonnet", "task": "audit"},
                  "term": "tv-1"})
        self.assertEqual(r.status, 200)
        handle = self.sup.get_terminal("local/tv-1").handle
        self.assertEqual(handle.spec.command,
                         ["run", "--model", "sonnet",
                          "--task", "audit"])
        stdin = handle.stdin_data().decode("utf-8")
        self.assertIn("Do audit as sonnet.", stdin)

    @unittest_run_loop
    async def test_missing_param_400(self):
        self._tpl(extra="params: model, task\n")
        r = await self.client.post(
            "/api/core/templates/agent/run",
            json={"vars": {"model": "x"}, "term": "tv-2"})
        self.assertEqual(r.status, 400)
        d = await r.json()
        self.assertIn("task", d["error"])

    @unittest_run_loop
    async def test_vars_listed_and_backward_compat(self):
        self._tpl(extra="params: model, task\n")
        d = await (await self.client.get(
            "/api/core/templates")).json()
        self.assertEqual(d["templates"][0]["params"],
                         ["model", "task"])
        # старый вызов без vars и без params-декларации → ок
        (self.tpl_dir / "plain.md").write_text(
            "---\ncommand: echo hi\n---\nplain body\n",
            encoding="utf-8")
        r = await self.client.post(
            "/api/core/templates/plain/run",
            json={"term": "tv-3"})
        self.assertEqual(r.status, 200)


if __name__ == "__main__":
    unittest.main()
