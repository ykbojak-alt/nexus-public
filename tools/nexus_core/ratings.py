#!/usr/bin/env python3
"""tools/nexus_core/ratings.py — orchestrator-scored agent ratings (NEWF_SPEC §6).

Хранилище: <base>/ratings.json — атомарная запись (tmp + os.replace),
threading.Lock на мутации (паттерн machine_registry).

Модель::

    ratings = {
        agent_id: {
            "score": float,        # скользящее среднее последних SCORE_WINDOW оценок (0-10)
            "updated_ts": float,
            "history": [           # cap HISTORY_CAP, старые вытесняются
                {"task": str, "score": float, "ts": float, "note": str}
            ],
        }
    }
"""

from __future__ import annotations

import json
import logging
import math
import os
import shutil
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

log = logging.getLogger(__name__)

RATINGS_FILE_NAME = "ratings.json"
HISTORY_CAP = 50
SCORE_WINDOW = 5
SCORE_MIN, SCORE_MAX = 0.0, 10.0
IDEMPOTENCY_CAP = 2000
IDEMPOTENCY_KEY_MAX = 128


class IdempotencyConflict(ValueError):
    """idempotency_key переиспользован с другим payload/agent → 409."""


class RatingsStore:
    """Рейтинги агентов: append history + sliding-average score."""

    def __init__(self, base: Path) -> None:
        self.base = Path(base)
        self._lock = threading.Lock()
        self._ratings: Dict[str, Dict[str, Any]] = {}
        self._idempotency: Dict[str, Dict[str, Any]] = {}
        self._load()

    # ------------------------------------------------------------------
    # public API
    # ------------------------------------------------------------------
    def all(self) -> Dict[str, Dict[str, Any]]:
        with self._lock:
            return {k: self._public(v) for k, v in self._ratings.items()}

    def get(self, agent_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            rec = self._ratings.get(agent_id)
            return self._public(rec) if rec is not None else None

    def score(
        self,
        agent_id: str,
        score: float,
        task: str = "",
        note: str = "",
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Append оценка + пересчёт score = mean(last SCORE_WINDOW).

        idempotency_key (optional): повторный POST с тем же ключом и тем же
        payload возвращает текущее состояние без второго append (replay);
        тот же ключ с другим agent/payload → IdempotencyConflict. Ключи
        персистятся в ratings.json — replay после рестарта тоже dedup'ится.
        """
        agent_id = str(agent_id).strip()
        if not agent_id:
            raise ValueError("agent_id required")
        try:
            score_f = float(score)
        except (TypeError, ValueError):
            raise ValueError("score must be a number")
        if not (SCORE_MIN <= score_f <= SCORE_MAX):
            raise ValueError(f"score must be in [{SCORE_MIN}, {SCORE_MAX}]")
        entry = {
            "task": str(task or ""),
            "score": score_f,
            "ts": time.time(),
            "note": str(note or ""),
        }
        key = None
        if idempotency_key is not None:
            if not isinstance(idempotency_key, str):
                raise ValueError("idempotency_key must be a string")
            key = idempotency_key.strip()
            if not key or len(key) > IDEMPOTENCY_KEY_MAX:
                raise ValueError(
                    f"idempotency_key must be 1..{IDEMPOTENCY_KEY_MAX} chars")
        with self._lock:
            if key is not None:
                prior = self._idempotency.get(key)
                if prior is not None:
                    same = (
                        prior.get("agent_id") == agent_id
                        and prior.get("score") == score_f
                        and prior.get("task") == entry["task"]
                        and prior.get("note") == entry["note"]
                    )
                    if not same:
                        raise IdempotencyConflict(
                            f"idempotency_key {key!r} already used with "
                            "different payload")
                    rec = self._ratings.get(agent_id)
                    if rec is not None:
                        pub = self._public(rec)
                        pub["idempotent_replay"] = True
                        return pub
                    # agent-запись исчезнуть не может (нет delete API),
                    # но на всякий случай трактуем как новый ключ ниже
            rec = self._ratings.setdefault(
                agent_id, {"score": 0.0, "updated_ts": 0.0, "history": []}
            )
            rec["history"].append(entry)
            if len(rec["history"]) > HISTORY_CAP:
                del rec["history"][:-HISTORY_CAP]
            window = rec["history"][-SCORE_WINDOW:]
            rec["score"] = round(sum(h["score"] for h in window) / len(window), 4)
            rec["updated_ts"] = entry["ts"]
            if key is not None:
                self._idempotency[key] = {
                    "agent_id": agent_id,
                    "score": score_f,
                    "task": entry["task"],
                    "note": entry["note"],
                    "ts": entry["ts"],
                }
                self._gc_idempotency()
            self._save()
            return self._public(rec)

    # ------------------------------------------------------------------
    # persistence
    # ------------------------------------------------------------------
    def _public(self, rec: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "score": rec.get("score", 0.0),
            "updated_ts": rec.get("updated_ts", 0.0),
            "history": [dict(h) for h in rec.get("history", [])],
        }

    def _load(self) -> None:
        path = self.base / RATINGS_FILE_NAME
        try:
            raw = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return
        except Exception as exc:
            # R-7: I/O-ошибка — не молчим, бэкапим и стартуем пустыми
            log.warning("ratings: cannot read %s: %s", path, exc)
            self._preserve_corrupt(path)
            return
        try:
            data = json.loads(raw)
        except Exception as exc:
            # R-7: corrupt JSON — warning + backup, иначе рейтинги
            # теряются молча при каждом рестарте
            log.warning("ratings: corrupt %s (%s) — preserved as .corrupt",
                        path, exc)
            self._preserve_corrupt(path)
            return
        # dedup-store живёт только в wrapped-формате (как пишет _save);
        # flat-legacy файл не может нести idempotency — не путаем с agent_id
        idem_raw = (data.get("idempotency")
                    if isinstance(data, dict) and "ratings" in data else None)
        if isinstance(idem_raw, dict):
            for k, v in idem_raw.items():
                if not isinstance(k, str) or not isinstance(v, dict):
                    continue
                try:
                    ts = float(v.get("ts", 0.0))
                    sc = float(v.get("score", 0.0))
                except (TypeError, ValueError):
                    continue
                if not (math.isfinite(ts) and math.isfinite(sc)):
                    continue
                self._idempotency[k] = {
                    "agent_id": str(v.get("agent_id", "")),
                    "score": sc,
                    "task": str(v.get("task", "")),
                    "note": str(v.get("note", "")),
                    "ts": ts,
                }
            self._gc_idempotency()
        ratings = data.get("ratings", data) if isinstance(data, dict) else {}
        if not isinstance(ratings, dict):
            return
        for agent_id, rec in ratings.items():
            if agent_id in ("ratings", "idempotency"):
                continue  # reserved top-level keys в flat-формате
            if not isinstance(rec, dict):
                continue
            history = []
            for h in (rec.get("history") or []):
                if not isinstance(h, dict):
                    continue
                # R-1: validate-on-load — NaN/Inf/вне-диапазона из
                # corrupt JSON не должны попадать в слайдинг-окно
                try:
                    h_score = float(h.get("score", 0.0))
                    h_ts = float(h.get("ts", 0.0))
                except (TypeError, ValueError):
                    continue
                if not (math.isfinite(h_score) and math.isfinite(h_ts)):
                    continue
                if not (SCORE_MIN <= h_score <= SCORE_MAX):
                    continue
                history.append({
                    "task": str(h.get("task", "")),
                    "score": h_score,
                    "ts": h_ts,
                    "note": str(h.get("note", "")),
                })
            history = history[-HISTORY_CAP:]
            # score пересчитывается из санитизированной истории —
            # хранимое значение не доверяем (self-heal)
            window = history[-SCORE_WINDOW:]
            score = (round(sum(h["score"] for h in window) / len(window), 4)
                     if window else 0.0)
            self._ratings[str(agent_id)] = {
                "score": score,
                "updated_ts": history[-1]["ts"] if history else 0.0,
                "history": history,
            }

    def _gc_idempotency(self) -> None:
        """Cap dedup-store: вытесняем самые старые ключи по ts."""
        if len(self._idempotency) <= IDEMPOTENCY_CAP:
            return
        oldest = sorted(
            self._idempotency.items(), key=lambda kv: kv[1].get("ts", 0.0)
        )[: len(self._idempotency) - IDEMPOTENCY_CAP]
        for k, _ in oldest:
            del self._idempotency[k]

    @staticmethod
    def _preserve_corrupt(path: Path) -> None:
        """Битый ratings.json → ratings.json.corrupt (не затираем)."""
        try:
            dst = path.with_name(path.name + ".corrupt")
            shutil.copy2(path, dst)
        except OSError as exc:
            log.warning("ratings: cannot preserve corrupt file: %s", exc)

    def _save(self) -> None:
        self.base.mkdir(parents=True, exist_ok=True)
        path = self.base / RATINGS_FILE_NAME
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps(
                {"ratings": self._ratings,
                 "idempotency": self._idempotency},
                ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        os.replace(tmp, path)


__all__ = [
    "RatingsStore", "IdempotencyConflict",
    "HISTORY_CAP", "SCORE_WINDOW", "IDEMPOTENCY_CAP",
]
