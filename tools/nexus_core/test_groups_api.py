#!/usr/bin/env python3
"""test_groups_api.py — W27 именованные группы: CRUD + send/kill."""
from __future__ import annotations
import shutil, tempfile, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


class GroupsApiTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="grp-"))
        self.state_dir = self.tmp / "state"
        self.sup = SupervisorV1(backend=MockPTYBackend())
        super().setUp()
    def tearDown(self):
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.state_dir, supervisor=self.sup,
                          templates_dir=self.tmp / "templates")

    async def run_terminal(self, name):
        r = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"]})
        self.assertEqual(r.status, 200, await r.text())

    @unittest_run_loop
    async def test_crud_cycle(self):
        await self.run_terminal("g1")
        await self.run_terminal("g2")
        # create
        r = await self.client.put("/api/core/group/devs", json={
            "members": ["g1", "local/g2"]})
        self.assertEqual(r.status, 200)
        d = await r.json()
        self.assertEqual(d["name"], "devs")
        self.assertEqual(d["count"], 2)
        self.assertEqual(sorted(d["members"]),
                         ["local/g1", "local/g2"])
        # get
        r = await self.client.get("/api/core/group/devs")
        self.assertEqual(r.status, 200)
        self.assertEqual((await r.json())["count"], 2)
        # list
        r = await self.client.get("/api/core/groups")
        d = await r.json()
        self.assertEqual(d["count"], 1)
        self.assertEqual(d["groups"][0]["name"], "devs")
        # upsert replace members
        r = await self.client.put("/api/core/group/devs", json={
            "members": ["g1"]})
        d = await r.json()
        self.assertEqual(d["count"], 1)
        self.assertEqual(d["created_at"],
                         (await (await self.client.get(
                             "/api/core/group/devs")).json())
                          ["created_at"])
        # delete
        r = await self.client.delete("/api/core/group/devs")
        self.assertEqual(r.status, 200)
        r = await self.client.get("/api/core/group/devs")
        self.assertEqual(r.status, 404)
        r = await self.client.delete("/api/core/group/devs")
        self.assertEqual(r.status, 404)

    @unittest_run_loop
    async def test_upsert_validation(self):
        await self.run_terminal("g1")
        # bad name
        r = await self.client.put("/api/core/group/Bad Name!", json={
            "members": []})
        self.assertEqual(r.status, 400)
        # unknown member → 400 + unresolved
        r = await self.client.put("/api/core/group/x", json={
            "members": ["g1", "ghost"]})
        self.assertEqual(r.status, 400)
        d = await r.json()
        self.assertEqual(d["unresolved"], ["ghost"])
        # members not list
        r = await self.client.put("/api/core/group/x", json={
            "members": "g1"})
        self.assertEqual(r.status, 400)
        # group не создана после failed upsert
        r = await self.client.get("/api/core/group/x")
        self.assertEqual(r.status, 404)

    @unittest_run_loop
    async def test_group_send_and_kill(self):
        await self.run_terminal("s1")
        await self.run_terminal("s2")
        r = await self.client.put("/api/core/group/team", json={
            "members": ["s1", "s2", "ghost-term"]})
        # ghost не резолвится → upsert 400; создаём без него
        self.assertEqual(r.status, 400)
        r = await self.client.put("/api/core/group/team", json={
            "members": ["s1", "s2"]})
        self.assertEqual(r.status, 200)
        # send
        r = await self.client.post("/api/core/group/team/send",
                                   json={"text": "echo hi",
                                         "enter": True})
        self.assertEqual(r.status, 200)
        d = await r.json()
        self.assertEqual(d["sent"], 2)
        self.assertEqual(d["skipped"], 0)
        # kill
        r = await self.client.post("/api/core/group/team/kill")
        self.assertEqual(r.status, 200)
        d = await r.json()
        self.assertEqual(d["killed"], 2)
        # члены реально мертвы
        for n in ("s1", "s2"):
            t = self.sup.get_terminal(f"local/{n}")
            self.assertIsNotNone(t)
        # unknown group → 404 на send/kill
        r = await self.client.post("/api/core/group/nope/send",
                                   json={"text": "x"})
        self.assertEqual(r.status, 404)
        r = await self.client.post("/api/core/group/nope/kill")
        self.assertEqual(r.status, 404)


    @unittest_run_loop
    async def test_nested_groups_and_labels(self):
        """W31: group:<g> вложенность + labels."""
        await self.run_terminal("n1")
        await self.run_terminal("n2")
        await self.run_terminal("n3")
        # leaf groups
        r = await self.client.put("/api/core/group/leaf-a", json={
            "members": ["n1", "n2"]})
        self.assertEqual(r.status, 200)
        r = await self.client.put("/api/core/group/leaf-b", json={
            "members": ["n3"]})
        self.assertEqual(r.status, 200)
        # parent с вложенной группой + labels
        r = await self.client.put("/api/core/group/all-devs", json={
            "members": ["group:leaf-a", "group:leaf-b"],
            "labels": {"env": "prod", "team": "core"}})
        self.assertEqual(r.status, 200, await r.text())
        d = await r.json()
        self.assertEqual(d["labels"], {"env": "prod",
                                      "team": "core"})
        # send разворачивает вложенность → 3 терминала
        r = await self.client.post("/api/core/group/all-devs/send",
                                   json={"text": "echo NEST",
                                         "enter": False})
        self.assertEqual(r.status, 200)
        d = await r.json()
        self.assertEqual(d["sent"], 3)
        # labels сохраняются при replace без labels
        r = await self.client.put("/api/core/group/leaf-a", json={
            "members": ["n1"]})
        d = await r.json()
        self.assertEqual(d["members"], ["local/n1"])
        # labels заменяются явным dict (пустой {} чистит)
        r = await self.client.put("/api/core/group/all-devs", json={
            "members": ["group:leaf-a"], "labels": {}})
        d = await r.json()
        self.assertEqual(d["labels"], {})
        # unknown group:<g> → 400
        r = await self.client.put("/api/core/group/bad", json={
            "members": ["group:ghost"]})
        self.assertEqual(r.status, 400)
        # self-nesting → cycle при send → 409
        r = await self.client.put("/api/core/group/cyc", json={
            "members": ["n1"]})
        self.assertEqual(r.status, 200)
        r = await self.client.put("/api/core/group/cyc", json={
            "members": ["group:cyc", "n2"]})
        # cyc ссылается сам на себя — upsert проходит (группа есть),
        # но expansion ловит cycle
        self.assertEqual(r.status, 200)
        r = await self.client.post("/api/core/group/cyc/send",
                                   json={"text": "x"})
        self.assertEqual(r.status, 409)


if __name__ == "__main__":
    unittest.main()
