#!/usr/bin/env python3
"""test_search_all.py — W19 GET /api/core/search-all?q=."""
from __future__ import annotations
import shutil, tempfile, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class SearchAllTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="grep-"))
        self.state_dir = self.tmp / "state"
        self.sup = SupervisorV1(backend=MockPTYBackend())
        super().setUp()
    def tearDown(self):
        super().tearDown(); shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.state_dir, supervisor=self.sup,
                          templates_dir=self.tmp / "templates")
    async def run_terminal(self, name):
        r = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"]})
        self.assertEqual(r.status, 200)

    @unittest_run_loop
    async def test_finds_across_scrollback(self):
        await self.run_terminal("g1"); await self.run_terminal("g2")
        t1 = self.sup.get_terminal("local/g1")
        t2 = self.sup.get_terminal("local/g2")
        t1.scrollback.extend(["noise", "findme-AAA", "more"])
        t2.scrollback.extend(["findme-BBB", "findme-CCC"])
        r = await self.client.get("/api/core/search-all?q=findme")
        self.assertEqual(r.status, 200)
        d = await r.json()
        self.assertEqual(d["terms_matched"], 2)
        self.assertEqual(d["matches_total"], 3)
        by_term = {x["term"]: x for x in d["results"]}
        # сортировка по total desc → g2 первой
        self.assertEqual(d["results"][0]["term"], "local/g2")
        m = by_term["local/g1"]["matches"][0]
        self.assertEqual(m["line"], 2)
        self.assertIn("findme-AAA", m["text"])
        self.assertEqual(by_term["local/g1"]["total"], 1)

    @unittest_run_loop
    async def test_case_and_empty_and_recent_fallback(self):
        await self.run_terminal("g3")
        t = self.sup.get_terminal("local/g3")
        t.recent_output = "Hello World\nfoo"
        # scrollback пуст → fallback recent_output
        r = await self.client.get("/api/core/search-all?q=hello")
        self.assertEqual((await r.json())["terms_matched"], 0)
        r2 = await self.client.get("/api/core/search-all?q=hello&ic=1")
        d2 = await r2.json()
        self.assertEqual(d2["terms_matched"], 1)
        self.assertTrue(d2["ic"])
        # пустой q → 400
        r3 = await self.client.get("/api/core/search-all")
        self.assertEqual(r3.status, 400)
        r4 = await self.client.get("/api/core/search-all?q=")
        self.assertEqual(r4.status, 400)

    @unittest_run_loop
    async def test_exited_included_no_match_empty(self):
        await self.run_terminal("g4")
        t = self.sup.get_terminal("local/g4")
        t.scrollback.extend(["dead-body needle"])
        t.state = "exited"
        d = await (await self.client.get(
            "/api/core/search-all?q=needle")).json()
        self.assertEqual(d["terms_matched"], 1)
        self.assertEqual(d["results"][0]["state"], "exited")
        # совсем без совпадений
        d2 = await (await self.client.get(
            "/api/core/search-all?q=zzz-nope")).json()
        self.assertEqual(d2["terms_matched"], 0)
        self.assertEqual(d2["results"], [])


    @unittest_run_loop
    async def test_regex_and_context(self):
        """W39: re=1 regex + ctx=N контекст."""
        await self.run_terminal("r1")
        t = self.sup.get_terminal("local/r1")
        t.scrollback.extend([
            "before1", "before2", "ERROR code=42 here",
            "after1", "after2"])
        # regex search
        d = await (await self.client.get(
            "/api/core/search-all?q=ERROR%20code%3D%5Cd%2B&re=1"
        )).json()
        self.assertEqual(d["terms_matched"], 1)
        self.assertTrue(d["re"])
        m = d["results"][0]["matches"][0]
        self.assertEqual(m["line"], 3)
        # ctx=1 → по строке до/после
        d = await (await self.client.get(
            "/api/core/search-all?q=ERROR&ctx=1")).json()
        m = d["results"][0]["matches"][0]
        self.assertIn("context", m)
        self.assertEqual(m["context"]["before"][0]["text"],
                         "before2")
        self.assertEqual(m["context"]["after"][0]["text"],
                         "after1")
        # bad regex → 400
        r = await self.client.get(
            "/api/core/search-all?q=%5B(&re=1")
        self.assertEqual(r.status, 400)
        # ctx clamp: ctx=999 → 20 (не падает)
        d = await (await self.client.get(
            "/api/core/search-all?q=ERROR&ctx=999")).json()
        self.assertEqual(d["ctx"], 20)

    @unittest_run_loop
    async def test_w49_index_dedupe_and_rebuild(self):
        """W49: blob-индекс — same-line dedupe, границы, ребилд."""
        await self.run_terminal("i1")
        t = self.sup.get_terminal("local/i1")
        # два хита на ОДНОЙ строке → total=1 (семантика строк)
        t.scrollback.extend([
            "xxNEEDLExx and NEEDLE again", "clean",
            "NEEDLE", "tail"])
        d = await (await self.client.get(
            "/api/core/search-all?q=NEEDLE")).json()
        r0 = d["results"][0]
        self.assertEqual(r0["total"], 2)  # строки 1 и 3
        lines = {m["line"] for m in r0["matches"]}
        self.assertEqual(lines, {1, 3})
        # индекс построен и переиспользуется
        self.assertIsNotNone(t._sidx_blob)
        self.assertIn("NEEDLE", t._sidx_blob)
        # мутация scrollback → fingerprint меняется → ребилд
        t.scrollback.append("NEEDLE-new-tail")
        d = await (await self.client.get(
            "/api/core/search-all?q=NEEDLE")).json()
        self.assertEqual(d["results"][0]["total"], 3)
        # needle с \n — не матчит (старая семантика)
        d = await (await self.client.get(
            "/api/core/search-all?q=NEEDLE%0Atail")).json()
        self.assertEqual(d["terms_matched"], 0)
        # пустой scrollback + recent_output fallback тоже индексируется
        t2 = self.sup.get_terminal("local/i1")
        t2.scrollback.clear()
        t2.recent_output = "fb-NEEDLE-line"
        d = await (await self.client.get(
            "/api/core/search-all?q=fb-NEEDLE")).json()
        self.assertEqual(d["results"][0]["total"], 1)

    @unittest_run_loop
    async def test_w50_query_syntax(self):
        """W50: from:/label:/state: фильтры + filter-only."""
        await self.run_terminal("w1")
        await self.run_terminal("w2")
        t1 = self.sup.get_terminal("local/w1")
        t2 = self.sup.get_terminal("local/w2")
        t1.labels["env"] = "prod"
        t2.labels["env"] = "dev"
        t1.scrollback.extend(["COMMON hit-one"])
        t2.scrollback.extend(["COMMON hit-two"])
        # state: фильтр — оба idle → оба матчат
        d = await (await self.client.get(
            "/api/core/search-all?q=COMMON%20state:idle")).json()
        self.assertEqual(d["terms_matched"], 2)
        self.assertEqual(d["filters"], {"state": ["idle"]})
        self.assertEqual(d["text"], "COMMON")
        # state:exited → никого
        d = await (await self.client.get(
            "/api/core/search-all?q=COMMON%20state:exited")).json()
        self.assertEqual(d["terms_matched"], 0)
        # label:env=prod → только w1
        d = await (await self.client.get(
            "/api/core/search-all?q=COMMON%20label:env=prod")).json()
        self.assertEqual(d["terms_matched"], 1)
        self.assertEqual(d["results"][0]["term"], "local/w1")
        # label:env (ключ) → оба имеют env
        d = await (await self.client.get(
            "/api/core/search-all?q=COMMON%20label:env")).json()
        self.assertEqual(d["terms_matched"], 2)
        # from:w1 → только w1
        d = await (await self.client.get(
            "/api/core/search-all?q=COMMON%20from:w1")).json()
        self.assertEqual(d["terms_matched"], 1)
        # from:local → machine-префикс → оба
        d = await (await self.client.get(
            "/api/core/search-all?q=COMMON%20from:local")).json()
        self.assertEqual(d["terms_matched"], 2)
        # комбинация фильтров
        d = await (await self.client.get(
            "/api/core/search-all?q=COMMON%20from:w2%20label:env=dev"
        )).json()
        self.assertEqual(d["terms_matched"], 1)
        self.assertEqual(d["results"][0]["term"], "local/w2")
        # filter-only (без текста) → terms-only список
        d = await (await self.client.get(
            "/api/core/search-all?q=state:idle%20label:env=prod")).json()
        self.assertTrue(d["filter_only"])
        self.assertEqual(d["terms_matched"], 1)
        self.assertEqual(d["results"][0]["term"], "local/w1")
        self.assertEqual(d["results"][0]["state"], "idle")
        # неизвестное поле → литерал в тексте (совместимость)
        d = await (await self.client.get(
            "/api/core/search-all?q=error:404")).json()
        self.assertEqual(d["filters"], {})
        self.assertEqual(d["text"], "error:404")


if __name__ == "__main__":
    unittest.main()
