"""NEWF_SPEC §6 — orchestrator-scored agent ratings: store + REST."""

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

try:
    from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop
    from tools.nexus_core.api import create_app
    from tools.nexus_core.mock_pty import MockPTYBackend
    from tools.nexus_core.supervisor_v1 import SupervisorV1
    _HAS_AIOHTTP = True
except ImportError:  # store-only окружение (без aiohttp)
    _HAS_AIOHTTP = False

    class AioHTTPTestCase:  # type: ignore[no-redef]
        pass

    def unittest_run_loop(fn):  # type: ignore[no-redef]
        return fn

from tools.nexus_core.ratings import IdempotencyConflict, RatingsStore


class RatingsStoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="nexus-ratings-test-"))
        self.store = RatingsStore(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_score_appends_history_and_sets_score(self):
        rec = self.store.score("alice", 8.0, task="#380", note="ok")
        self.assertEqual(rec["score"], 8.0)
        self.assertEqual(len(rec["history"]), 1)
        self.assertEqual(rec["history"][0]["task"], "#380")
        self.assertEqual(rec["history"][0]["note"], "ok")
        self.assertGreater(rec["updated_ts"], 0)

    def test_sliding_average_last_5(self):
        for s in (10, 8, 6, 4, 2, 0):
            self.store.score("bob", s)
        # last 5 = 8,6,4,2,0 → mean 4.0
        self.assertEqual(self.store.get("bob")["score"], 4.0)

    def test_score_bounds_rejected(self):
        for bad in (-0.1, 10.1, "x", None, float("nan")):
            with self.assertRaises(ValueError):
                self.store.score("bob", bad)

    def test_history_cap_50(self):
        for i in range(60):
            self.store.score("bob", 5.0, task=f"t{i}")
        rec = self.store.get("bob")
        self.assertEqual(len(rec["history"]), 50)
        self.assertEqual(rec["history"][0]["task"], "t10")

    def test_persistence_across_instances(self):
        self.store.score("carol", 7.5, task="#386", note="ops ok")
        store2 = RatingsStore(self.tmp)
        rec = store2.get("carol")
        self.assertIsNotNone(rec)
        self.assertEqual(rec["score"], 7.5)
        self.assertEqual(rec["history"][0]["task"], "#386")

    def test_file_written_atomically(self):
        self.store.score("dave", 9.0)
        path = self.tmp / "ratings.json"
        self.assertTrue(path.exists())
        self.assertFalse((self.tmp / "ratings.json.tmp").exists())
        data = json.loads(path.read_text(encoding="utf-8"))
        self.assertIn("dave", data["ratings"])

    def test_empty_agent_id_rejected(self):
        with self.assertRaises(ValueError):
            self.store.score("  ", 5.0)

    def test_load_sanitizes_nan_inf_out_of_range(self):
        # R-1: corrupt JSON с NaN/Inf/вне-диапазона не должен попадать
        # в history/слайдинг; score пересчитывается из валидных записей
        (self.tmp / "ratings.json").write_text(json.dumps({
            "ratings": {
                "eve": {
                    "score": 999.0,  # corrupt stored score — не доверяем
                    "updated_ts": 1.0,
                    "history": [
                        {"task": "ok1", "score": 8.0, "ts": 1.0, "note": ""},
                        {"task": "nan", "score": float("nan"), "ts": 2.0,
                         "note": ""},
                        {"task": "inf", "score": float("inf"), "ts": 3.0,
                         "note": ""},
                        {"task": "oor", "score": 42.0, "ts": 4.0, "note": ""},
                        {"task": "neg", "score": -3.0, "ts": 5.0, "note": ""},
                        {"task": "ok2", "score": 6.0, "ts": 6.0, "note": ""},
                    ],
                },
            },
        }), encoding="utf-8")
        store2 = RatingsStore(self.tmp)
        rec = store2.get("eve")
        self.assertEqual(len(rec["history"]), 2)   # только валидные
        self.assertEqual(rec["score"], 7.0)        # mean(8,6), не 999
        for h in rec["history"]:
            self.assertTrue(0.0 <= h["score"] <= 10.0)

    def test_load_corrupt_file_preserved_and_logged(self):
        # R-7: битый JSON → warning + .corrupt backup + пустое состояние
        path = self.tmp / "ratings.json"
        path.write_text("{not valid json!!!", encoding="utf-8")
        import logging
        with self.assertLogs("tools.nexus_core.ratings", level="WARNING"):
            store2 = RatingsStore(self.tmp)
        self.assertEqual(store2.all(), {})
        self.assertTrue((self.tmp / "ratings.json.corrupt").exists())

    # -- #412 idempotency -------------------------------------------------

    def test_idempotent_replay_no_double_append(self):
        rec1 = self.store.score(
            "ivy", 8.0, task="#412", idempotency_key="k1")
        self.assertNotIn("idempotent_replay", rec1)
        rec2 = self.store.score(
            "ivy", 8.0, task="#412", idempotency_key="k1")
        self.assertTrue(rec2["idempotent_replay"])
        # история не выросла — ledger не инфлейтится
        self.assertEqual(len(self.store.get("ivy")["history"]), 1)
        self.assertEqual(self.store.get("ivy")["score"], 8.0)

    def test_idempotency_conflict_different_payload(self):
        self.store.score("ivy", 8.0, idempotency_key="k1")
        for kwargs in (
            {"score": 9.0},                      # другой score
            {"score": 8.0, "task": "other"},     # другая задача
            {"score": 8.0, "note": "x"},         # другая заметка
        ):
            with self.assertRaises(IdempotencyConflict):
                self.store.score("ivy", idempotency_key="k1", **kwargs)
        # другой agent с тем же ключом — тоже конфликт
        with self.assertRaises(IdempotencyConflict):
            self.store.score("bob", 8.0, idempotency_key="k1")
        # и ничего не добавилось
        self.assertIsNone(self.store.get("bob"))
        self.assertEqual(len(self.store.get("ivy")["history"]), 1)

    def test_idempotency_persists_across_restart(self):
        self.store.score("ivy", 8.0, task="#412", idempotency_key="k1")
        store2 = RatingsStore(self.tmp)
        rec = store2.score("ivy", 8.0, task="#412",
                           idempotency_key="k1")
        self.assertTrue(rec["idempotent_replay"])
        self.assertEqual(len(store2.get("ivy")["history"]), 1)
        with self.assertRaises(IdempotencyConflict):
            store2.score("ivy", 5.0, idempotency_key="k1")

    def test_idempotency_key_validation(self):
        for bad in ("", "   ", "x" * 200, 123):
            with self.assertRaises((ValueError, TypeError)):
                self.store.score("ivy", 5.0, idempotency_key=bad)

    def test_no_key_behaves_as_before(self):
        # без ключа — прежняя семантика, дубликаты append'ятся
        self.store.score("ivy", 8.0)
        self.store.score("ivy", 8.0)
        self.assertEqual(len(self.store.get("ivy")["history"]), 2)


@unittest.skipUnless(_HAS_AIOHTTP, "aiohttp not installed")
class RatingsApiTest(AioHTTPTestCase):
    ADMIN_TOKEN = "test-ratings-token"

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="nexus-ratings-api-"))
        self.supervisor = SupervisorV1(backend=MockPTYBackend())
        os.environ["AEGIS_ADMIN_TOKEN"] = self.ADMIN_TOKEN
        super().setUp()

    def tearDown(self):
        os.environ.pop("AEGIS_ADMIN_TOKEN", None)
        super().tearDown()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get_app(self):
        return create_app(base=self.tmp, supervisor=self.supervisor)

    @unittest_run_loop
    async def test_get_all_empty(self):
        resp = await self.client.get("/api/core/ratings")
        self.assertEqual(resp.status, 200)
        self.assertEqual((await resp.json())["ratings"], {})

    @unittest_run_loop
    async def test_get_missing_404(self):
        resp = await self.client.get("/api/core/ratings/nobody")
        self.assertEqual(resp.status, 404)

    @unittest_run_loop
    async def test_score_then_get(self):
        resp = await self.client.post(
            "/api/core/ratings/forge/score",
            json={"score": 9.0, "task": "#372", "note": "clean"},
            headers={"X-AEGIS-Key": self.ADMIN_TOKEN},
        )
        self.assertEqual(resp.status, 200)
        data = await resp.json()
        self.assertEqual(data["rating"]["score"], 9.0)
        self.assertEqual(data["rating"]["history"][0]["task"], "#372")

        resp = await self.client.get("/api/core/ratings/forge")
        self.assertEqual(resp.status, 200)
        self.assertEqual((await resp.json())["rating"]["score"], 9.0)

        resp = await self.client.get("/api/core/ratings")
        self.assertIn("forge", (await resp.json())["ratings"])

    @unittest_run_loop
    async def test_invalid_score_400(self):
        for score in (11, -1, "high"):
            resp = await self.client.post(
                "/api/core/ratings/x/score", json={"score": score},
                headers={"X-AEGIS-Key": self.ADMIN_TOKEN},
            )
            self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_invalid_json_400(self):
        resp = await self.client.post(
            "/api/core/ratings/x/score",
            data=b"not-json",
            headers={
                "Content-Type": "application/json",
                "X-AEGIS-Key": self.ADMIN_TOKEN,
            },
        )
        self.assertEqual(resp.status, 400)

    @unittest_run_loop
    async def test_sliding_average_via_api(self):
        for s in (10, 6, 2):
            await self.client.post(
                "/api/core/ratings/a/score", json={"score": s},
                headers={"X-AEGIS-Key": self.ADMIN_TOKEN},
            )
        resp = await self.client.get("/api/core/ratings/a")
        self.assertEqual((await resp.json())["rating"]["score"], 6.0)

    @unittest_run_loop
    async def test_score_authz(self):
        # без ключа → 401
        resp = await self.client.post(
            "/api/core/ratings/a/score", json={"score": 5}
        )
        self.assertEqual(resp.status, 401)
        # без токена в env → 503 disabled (B-C1)
        os.environ.pop("AEGIS_ADMIN_TOKEN", None)
        resp = await self.client.post(
            "/api/core/ratings/a/score", json={"score": 5},
            headers={"X-AEGIS-Key": "anything"},
        )
        self.assertEqual(resp.status, 503)

    @unittest_run_loop
    async def test_score_idempotency_replay_and_conflict(self):
        hdr = {"X-AEGIS-Key": self.ADMIN_TOKEN}
        body = {"score": 7.0, "task": "#412", "idempotency_key": "api-k1"}
        r1 = await self.client.post(
            "/api/core/ratings/judge/score", json=body, headers=hdr)
        self.assertEqual(r1.status, 200)
        d1 = await r1.json()
        self.assertNotIn("idempotent_replay", d1["rating"])

        # replay: тот же ключ+payload → 200, история не растёт
        r2 = await self.client.post(
            "/api/core/ratings/judge/score", json=body, headers=hdr)
        self.assertEqual(r2.status, 200)
        d2 = await r2.json()
        self.assertTrue(d2["rating"]["idempotent_replay"])
        self.assertEqual(len(d2["rating"]["history"]), 1)

        # конфликт: тот же ключ, другой score → 409
        r3 = await self.client.post(
            "/api/core/ratings/judge/score",
            json={**body, "score": 9.0}, headers=hdr)
        self.assertEqual(r3.status, 409)

        # невалидный тип ключа → 400
        r4 = await self.client.post(
            "/api/core/ratings/judge/score",
            json={**body, "idempotency_key": 42}, headers=hdr)
        self.assertEqual(r4.status, 400)


if __name__ == "__main__":
    unittest.main()
