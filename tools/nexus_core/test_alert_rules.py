#!/usr/bin/env python3
"""test_alert_rules.py — W26 rules.json pattern→action."""
from __future__ import annotations
import json, shutil, tempfile, time, unittest
from pathlib import Path
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
from tools.nexus_core.alert_rules import (
    load_rules, load_rules_detailed, reset_cache)
from tools.nexus_core.api import create_app
from tools.nexus_core.mock_pty import MockPTYBackend
from tools.nexus_core.supervisor_v1 import SupervisorV1


def write_rules(tmp: Path, rules: list) -> Path:
    p = tmp / "rules.json"
    p.write_text(json.dumps({"rules": rules}), encoding="utf-8")
    return p


class AlertRulesLoaderTest(unittest.TestCase):
    def setUp(self):
        reset_cache()
        self.tmp = Path(tempfile.mkdtemp(prefix="ar-"))
    def tearDown(self):
        reset_cache()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_normalize_and_skip_bad(self):
        p = write_rules(self.tmp, [
            {"id": "ok", "pattern": "foo", "action": "notify"},
            {"pattern": "bar"},                      # no action→default notify ok
            {"pattern": ""},                          # empty pattern → skip
            {"pattern": "x", "action": "bogus"},      # bad action → skip
            {"pattern": "(["},                        # bad regex → skip
            "not-a-dict",
            {"id": "lbl", "pattern": "y", "action": "label"},  # no label_key → skip
            {"id": "lbl2", "pattern": "y", "action": "label",
             "label_key": "k"},
        ])
        rules = load_rules(p)
        ids = [r["id"] for r in rules]
        self.assertIn("ok", ids)
        self.assertIn("lbl2", ids)
        self.assertNotIn("lbl", ids)
        self.assertEqual(len(rules), 3)  # ok, bar(auto-id), lbl2

    def test_missing_and_broken_file(self):
        self.assertEqual(load_rules(self.tmp / "nope.json"), [])
        p = self.tmp / "bad.json"
        p.write_text("{not json", encoding="utf-8")
        self.assertEqual(load_rules(p), [])
        p.write_text('{"rules": "notlist"}', encoding="utf-8")
        reset_cache()
        self.assertEqual(load_rules(p), [])

    def test_hot_reload_mtime(self):
        p = write_rules(self.tmp, [{"id": "r1", "pattern": "a"}])
        self.assertEqual(len(load_rules(p)), 1)
        time.sleep(0.02)
        write_rules(self.tmp, [{"id": "r1", "pattern": "a"},
                               {"id": "r2", "pattern": "b"}])
        # mtime может совпасть на некоторых FS — форсируем
        import os
        os.utime(p, (time.time() + 1, time.time() + 1))
        self.assertEqual(len(load_rules(p)), 2)


class AlertRulesApiTestCase(AioHTTPTestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="ara-"))
        self.state_dir = self.tmp / "state"
        self.rules_path = write_rules(self.tmp, [
            {"id": "n1", "pattern": "PINGME", "action": "notify",
             "once": True},
            {"id": "l1", "pattern": "TAGME", "action": "label",
             "label_key": "alerted", "label_value": "yes"},
            {"id": "k1", "pattern": "KILLME", "action": "kill"},
            {"id": "off", "pattern": "OFF", "action": "notify",
             "enabled": False},
        ])
        self.sup = SupervisorV1(backend=MockPTYBackend())
        self.sup.alert_rules_path = self.rules_path
        super().setUp()
    def tearDown(self):
        super().tearDown(); shutil.rmtree(self.tmp, ignore_errors=True)
    def get_app(self):
        return create_app(base=self.state_dir, supervisor=self.sup,
                          templates_dir=self.tmp / "templates")
    async def run_terminal(self, name="a1"):
        r = await self.client.post("/api/core/run", json={
            "name": name, "command": ["sh", "-i"]})
        self.assertEqual(r.status, 200)
    def term(self, name="a1"):
        return self.sup.get_terminal(f"local/{name}")

    @unittest_run_loop
    async def test_notify_label_kill_actions(self):
        await self.run_terminal()
        t = self.term()
        t.handle.stdout.extend(b"line PINGME here\nline TAGME too\n")
        self.sup.step_once()
        # notify → alert event
        alerts = [e for e in self.sup.events if e["type"] == "alert"]
        kinds = {(a["rule"], a["action"]) for a in alerts}
        self.assertIn(("n1", "notify"), kinds)
        self.assertIn(("l1", "label"), kinds)
        # label применён
        self.assertEqual(t.labels.get("alerted"), "yes")
        # once: повторный chunk с PINGME → нет второго notify
        n_before = len([a for a in alerts if a["rule"] == "n1"])
        t.handle.stdout.extend(b"PINGME again\n")
        self.sup.step_once()
        n_after = len([e for e in self.sup.events
                       if e["type"] == "alert" and e["rule"] == "n1"])
        self.assertEqual(n_after, n_before)
        # kill
        t.handle.stdout.extend(b"now KILLME\n")
        self.sup.step_once()
        # kill → handle закрыт → тот же тик пометил exited
        self.assertTrue(t.handle is None or t.handle.closed)
        self.assertEqual(t.state, "exited")
        self.assertTrue(any(e["type"] == "alert" and e["rule"] == "k1"
                            for e in self.sup.events))
        # disabled rule не сработал
        self.assertFalse(any(e.get("rule") == "off"
                             for e in self.sup.events
                             if e["type"] == "alert"))

    @unittest_run_loop
    async def test_notify_url_enqueues_webhook(self):
        await self.run_terminal()
        # добавляем url к notify-правилу
        write_rules(self.tmp, [
            {"id": "w", "pattern": "PINGME", "action": "notify",
             "url": "http://127.0.0.1:9/hook"},
        ])
        import os
        os.utime(self.rules_path, (time.time() + 2,
                                   time.time() + 2))
        from tools.nexus_core.alert_rules import reset_cache
        reset_cache()
        t = self.term()
        t.handle.stdout.extend(b"PINGME\n")
        self.sup.step_once()
        self.assertEqual(len(self.sup.pending_webhooks), 1)
        self.assertEqual(self.sup.pending_webhooks[0]["url"],
                         "http://127.0.0.1:9/hook")
        self.assertEqual(self.sup.pending_webhooks[0]["payload"]
                         ["event"], "alert")

    @unittest_run_loop
    async def test_get_alert_rules_endpoint(self):
        r = await self.client.get("/api/core/alert-rules")
        self.assertEqual(r.status, 200)
        # endpoint читает DEFAULT файл, не наш tmp — просто shape
        d = await r.json()
        self.assertIn("rules", d)
        self.assertIn("count", d)
        self.assertIn("errors", d)  # W46
        ids = {x["id"] for x in d["rules"]}
        self.assertIn("fatal-log", ids)  # дефолтный rules.json

    @unittest_run_loop
    async def test_rule_test_dry_run(self):
        """W46: POST /alert-rules/test — валидация + matches."""
        await self.run_terminal()
        t = self.term()
        t.scrollback.extend(["line1 PINGME here", "plain line"])
        # bad regex → valid:false, не 500
        r = await self.client.post("/api/core/alert-rules/test",
                                   json={"pattern": "(["})
        d = await r.json()
        self.assertFalse(d["valid"])
        self.assertIn("bad regex", d["error"])
        # missing pattern → 400
        self.assertEqual((await self.client.post(
            "/api/core/alert-rules/test", json={})).status, 400)
        # unknown term → 404
        self.assertEqual((await self.client.post(
            "/api/core/alert-rules/test",
            json={"pattern": "x", "term": "ghost"})).status, 404)
        # match по term scrollback
        r = await self.client.post("/api/core/alert-rules/test",
                                   json={"pattern": "PINGME",
                                         "term": "a1"})
        d = await r.json()
        self.assertTrue(d["valid"])
        self.assertEqual(len(d["matches"]), 1)
        self.assertEqual(d["matches"][0]["term"], "local/a1")
        self.assertEqual(d["matches"][0]["match"], "PINGME")
        # без term — скан всех терминалов
        r = await self.client.post("/api/core/alert-rules/test",
                                   json={"pattern": "PINGME"})
        d = await r.json()
        self.assertEqual(len(d["matches"]), 1)
        # no match → пусто, valid:true
        r = await self.client.post("/api/core/alert-rules/test",
                                   json={"pattern": "ZZZNOPE",
                                         "term": "a1"})
        d = await r.json()
        self.assertTrue(d["valid"])
        self.assertEqual(d["matches"], [])


class AlertRulesDetailedTest(unittest.TestCase):
    """W46: load_rules_detailed — ошибки DSL с index+reason."""

    def setUp(self):
        reset_cache()
        self.tmp = Path(tempfile.mkdtemp(prefix="ard-"))
    def tearDown(self):
        reset_cache()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_errors_surfaced(self):
        p = write_rules(self.tmp, [
            {"id": "ok", "pattern": "GOOD", "action": "notify"},
            "notadict",
            {"pattern": "X", "action": "bogus"},
            {"pattern": "([", "action": "kill"},
            {"pattern": "Y", "action": "label"},  # нет label_key
        ])
        d = load_rules_detailed(p)
        self.assertEqual(d["count"], 1)
        self.assertEqual(d["rules"][0]["id"], "ok")
        self.assertEqual(len(d["errors"]), 4)
        reasons = " ".join(e["reason"] for e in d["errors"])
        self.assertIn("not an object", reasons)
        self.assertIn("bad action", reasons)
        self.assertIn("bad regex", reasons)
        self.assertIn("label_key", reasons)
        # индексы ошибок указывают на позицию в rules[]
        self.assertEqual([e["index"] for e in d["errors"]],
                         [1, 2, 3, 4])

    def test_clean_file_no_errors(self):
        p = write_rules(self.tmp, [
            {"id": "a", "pattern": "x", "action": "notify"}])
        d = load_rules_detailed(p)
        self.assertEqual(d["errors"], [])


if __name__ == "__main__":
    unittest.main()
