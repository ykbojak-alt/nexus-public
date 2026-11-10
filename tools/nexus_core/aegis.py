#!/usr/bin/env python3
"""tools/nexus_core/aegis.py — детерминистический policy-gate для NEXUS.

Аналог CERBERUS (HADES OMEGA), но исправлены его архитектурные слабости:
- deny-by-default: нет совпавшего правила → DENY для sensitive-классов
  (у них R-008 fail-open PERMIT на любом непокрытом вводе);
- аудит сразу уходит в event-канал supervisor'а (у них — in-memory Map,
  перезапуск теряет журнал);
- gate стоит ПЕРЕД исполнением (handle_run / доставка), а не советует
  рядом;
- ESCALATE → явный approval-контур: решение висит pending, пока человек
  не подтвердит/не отклонит через API.

Использование::

    gate = AegisGuard(event_sink=sup._emit)
    decision = gate.evaluate(proposal, ctx)
    if decision.outcome == "permit": ...
    elif decision.outcome == "escalate": ... # ждём approve()
"""

from __future__ import annotations

import copy
import hashlib
import json
import logging
import math
import os
import threading
import time
import uuid
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional

OUTCOMES = ("permit", "deny", "escalate")

log = logging.getLogger(__name__)

# Классы условий (таксономия совместима с CERBERUS, чтобы правила читались
# одинаково; реализация своя).
COND_ALWAYS = "always"
COND_AMOUNT_LIMIT = "amount_limit"
COND_ALLOWLIST = "allowlist"          # payload[field] не в списке → нарушение
COND_BUDGET_THRESHOLD = "budget_threshold"
COND_AGENT_PERMISSION = "agent_permission"  # агент не в списке на operation
COND_COMPOUND = "compound"
COND_RATE_LIMIT = "rate_limit"      # > max_count событий за window_s → нарушение
COND_AMOUNT_WINDOW = "amount_window"  # сумма payload_field за window_s > max_amount → нарушение

KNOWN_COND_TYPES = frozenset({
    COND_ALWAYS,
    COND_AMOUNT_LIMIT,
    COND_ALLOWLIST,
    COND_BUDGET_THRESHOLD,
    COND_AGENT_PERMISSION,
    COND_COMPOUND,
    COND_RATE_LIMIT,
    COND_AMOUNT_WINDOW,
})

COMPOUND_OPERATORS = ("AND", "OR")

# scope rate-limit окна: по агенту, по типу операции, по паре, глобально
RATE_SCOPES = ("agent", "operation", "agent:operation", "global")

# Классы операций (server-side чувствительность — клиентский флаг ignored)
OP_CLASS_SENSITIVE = "sensitive"
OP_CLASS_OBSERVE = "observe"
OP_CLASSES = (OP_CLASS_SENSITIVE, OP_CLASS_OBSERVE)

# Пределы устойчивости (против DoS-ввода).
MAX_COMPOUND_DEPTH = 8      # глубже — fail-closed (нарушение)
MAX_AUDIT_BYTES = 10 * 1024 * 1024  # ротация JSONL по размеру
AUDIT_ROTATIONS = 3         # .1 .2 .3
MAX_AUDIT_READ = 1000       # cap limit в audit_records / GET /api/core/audit

# Approval-контур (A-5: до этого pendings были бессрочны и безграничны).
APPROVAL_TTL_S = 3600.0     # срок жизни escalate-запроса
MAX_PENDING = 1000          # cap очереди; переполнение → fail-closed deny
MAX_RATE_KEYS = 10000       # cap ключей rate-стейта; переполнение → нарушение
MAX_APPROVAL_TTL_S = 86400.0  # cap per-proposal approval_ttl override (24ч)

# W3 panic circuit-breaker (#468, паттерн near-aegis watchdog):
# panic_on замораживает ВСЕ evaluate → deny panic_mode; panic_off —
# только panic_owner и только после обязательного cooldown.
PANIC_COOLDOWN_S = 300.0    # дефолтный cooldown до снятия заморозки

# W1 verdict-attestation (#468, паттерн near-aegis verdicts):
# операции из attested_operations требуют verdict по payload_hash;
# нет verdict → deny no_verdict (fail-closed, их DENY_NO_VERDICT);
# verdict deny или risk >= verdict_deny_risk → deny verdict_deny.
MAX_VERDICTS = 10000        # cap verdict-store; переполнение → отказ приёма
VERDICT_DENY_RISK = 0.5     # risk-порог deny-вердикта
VERDICTS = ("permit", "deny")

# W2 guardian M-of-N (#469b, паттерн near-aegis guardian release):
# параллельные approve-голоса от designated guardians вместо
# sequential escalation chain. threshold approve-голосов → release
# через approve(); один deny-голос любого guardian → reject.
# Финальное решение всегда проходит approve() — expiry/stale-policy/
#chain/audit идентичны одиночному approve.
GUARDIAN_VOTES = ("approve", "deny")


def _json_native_violation(obj: Any, path: str = "payload") -> Optional[str]:
    """FIX-69 PC-3a (#472): None — payload сериализуем канонически; строка —
    первая находка (пишется в audit.reason и marker-payload).

    Разрешено ровно то, что json.dumps печатает БЕЗ default=...:
    None/bool/int/конечный float/str/dict/list/tuple, ключи dict — str.
    tuple разрешён: json печатает его списком, _normalize_amounts приводит
    к списку, поэтому (1,2) и [1,2] дают один хэш.
    """
    if obj is None or isinstance(obj, (bool, int, str)):
        return None
    if isinstance(obj, float):
        if math.isfinite(obj):
            return None
        return f"{path}: non-finite float {obj!r}"
    if isinstance(obj, dict):
        for k, v in obj.items():
            if not isinstance(k, str):
                return f"{path}: dict key {k!r} is not str"
            found = _json_native_violation(v, f"{path}.{k}")
            if found is not None:
                return found
        return None
    if isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            found = _json_native_violation(v, f"{path}[{i}]")
            if found is not None:
                return found
        return None
    return f"{path}: {type(obj).__name__} is not JSON-native"


def _normalize_amounts(obj: Any) -> Any:
    """FIX-69 PC-3a (#472): канонический JSON-образ payload для payload_hash.

    -0.0 -> 0.0 (иначе равные по смыслу суммы дают разные хэши → ложный
    drift-deny). bool не число и не трогается. tuple -> list (json и так
    пишет их списком). Ничего не удаляется и не сортируется сверх sort_keys
    в _canonical_payload_bytes.
    """
    if isinstance(obj, bool):
        return obj
    if isinstance(obj, float):
        return 0.0 if obj == 0.0 else obj
    if isinstance(obj, dict):
        return {str(k): _normalize_amounts(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_normalize_amounts(v) for v in obj]
    return obj


def _canonical_payload_bytes(payload: Any) -> bytes:
    """Канонические байты payload. Отличия от прежней формы
    `json.dumps(payload, sort_keys=True, default=str)`:

    1. `default=str` убран. Он тихо превращал Decimal("1.0") и "1.0" в
       одну строку → ОДИНАКОВЫЙ хэш, т.е. привязка не различала тип
       заявленной суммы (и verdict по одному содержимому засчитывался
       другому — attestation-обход).
    2. `allow_nan=False`. Раньше NaN/Infinity сериализовались как
       `NaN`/`Infinity` — не-JSON текст.
    3. Явные `separators=(",", ":")` и `ensure_ascii=True` — хэш не
       зависит от умолчаний stdlib.
    4. `-0.0` нормализуется в `0.0`.

    Fail-closed: не-JSON тип → TypeError, NaN/Inf → ValueError.
    Вызывающий обязан превратить это в deny (validator в _evaluate
    отсекает такие payload до хэширования).
    """
    return json.dumps(
        _normalize_amounts(payload),
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
        ensure_ascii=True,
    ).encode("utf-8")


@dataclass
class PolicyCondition:
    type: str
    max_amount: Optional[float] = None
    payload_field: str = "amount"       # имя поля в payload (allowlist/amount/budget)
    allowed: List[str] = field(default_factory=list)
    budget_percent: float = 100.0
    operator: str = "AND"              # AND | OR — для compound
    conditions: List["PolicyCondition"] = field(default_factory=list)
    # rate_limit: > max_count событий за window_s → нарушение
    window_s: float = 60.0
    max_count: int = 1
    rate_scope: str = "global"         # agent | operation | agent:operation | global


@dataclass
class PolicyRule:
    id: str
    description: str
    operation: str = "*"               # тип операции или '*'
    agent: str = "*"                   # имя агента или '*'
    condition: PolicyCondition = field(
        default_factory=lambda: PolicyCondition(COND_ALWAYS)
    )
    outcome: str = "deny"
    priority: int = 0
    active: bool = True
    # escalation-цепочка ролей для outcome="escalate": каждый шаг требует
    # approve от следующей роли; reject на любом шаге → deny chain_aborted
    escalation_chain: List[str] = field(default_factory=list)


@dataclass
class OperationProposal:
    """Предложение операции от агента/оркестратора (до исполнения)."""
    operation_type: str
    agent: str
    payload: Dict[str, Any] = field(default_factory=dict)
    # DEPRECATED: чувствительность определяется сервером через
    # policy.operation_class — клиентский флаг игнорируется (A-1 байпас).
    # Поле сохранено для совместимости wire-формата.
    sensitive: bool = True
    id: str = field(default_factory=lambda: uuid.uuid4().hex)


@dataclass
class Decision:
    proposal_id: str
    outcome: str                       # permit | deny | escalate
    rule_id: Optional[str]
    reason: str
    escalate_to: Optional[str] = None  # требуемая роль текущего шага
    approval_id: Optional[str] = None  # выставляется при escalate
    policy_hash: str = ""
    escalation_chain: List[str] = field(default_factory=list)
    decided_at: float = field(default_factory=time.time)


@dataclass
class Policy:
    version: str
    rules: List[PolicyRule]
    default_outcome: str = "deny"      # deny-by-default (их R-008 был fail-open)
    operation_permissions: Dict[str, List[str]] = field(default_factory=dict)
    # operation → "sensitive"|"observe"; отсутствующие → sensitive.
    # Клиентский флаг proposal.sensitive не участвует (server-side классификация).
    operation_class: Dict[str, str] = field(default_factory=dict)

    def canonical(self) -> str:
        return json.dumps(
            {
                "version": self.version,
                "default_outcome": self.default_outcome,
                "operation_permissions": self.operation_permissions,
                "operation_class": self.operation_class,
                "rules": [
                    {
                        "id": r.id,
                        "operation": r.operation,
                        "agent": r.agent,
                        "condition": _cond_dict(r.condition),
                        "outcome": r.outcome,
                        "priority": r.priority,
                        "active": r.active,
                        "escalation_chain": list(r.escalation_chain),
                    }
                    for r in self.rules
                ],
            },
            sort_keys=True,
            separators=(",", ":"),
        )


def _cond_dict(c: PolicyCondition) -> Dict[str, Any]:
    return {
        "type": c.type,
        "max_amount": c.max_amount,
        "payload_field": c.payload_field,
        "allowed": sorted(c.allowed),
        "budget_percent": c.budget_percent,
        "operator": c.operator,
        "conditions": [_cond_dict(x) for x in c.conditions],
        "window_s": c.window_s,
        "max_count": c.max_count,
        "rate_scope": c.rate_scope,
    }


def _as_finite(value: Any, default: float = 0.0) -> float:
    """Парсит число (включая числовые строки '1e9'); не-финальное → default."""
    try:
        f = float(value)
    except (TypeError, ValueError):
        return default
    return f if math.isfinite(f) else default


def _find_amount_limit(cond: PolicyCondition) -> Optional[PolicyCondition]:
    """Первый amount_limit в дереве условия (включая compound) —
    для ESCALATE→DENY downgrade по ctx.hard_limit."""
    if cond.type == COND_AMOUNT_LIMIT:
        return cond
    for sub in cond.conditions:
        found = _find_amount_limit(sub)
        if found is not None:
            return found
    return None


class AegisGuard:
    """Детерминистический gate: proposal → rules → Decision + аудит-событие.

    Persistence (HERETIC #399/#410):
    - `state_path` — атомарный persist rate/amount-окон (tmp+replace).
      **Single-instance precondition**: один AegisGuard на state_path —
      два процесса делят файл last-writer-wins (окна могут потеряться).
      Advisory `.lck` при старте детектит гонку (warning в лог), но не
      гарантирует — держите один инстанс.
    - Corrupt/unreadable windows-файл → `_windows_untrusted`: окна
      пусты, rate_limit/amount_window условия = violation (fail-closed),
      persist пропускается, оригинал сохранён + `.corrupt` копия.
      Reset: вручную заменить/удалить `state_path` (+`.corrupt`) и
      рестартануть — до этого window-gated операции deny."""

    def __init__(
        self,
        policy: Optional[Policy] = None,
        event_sink: Optional[Callable[[Dict[str, Any]], None]] = None,
        audit_path: Optional[str] = None,
        state_path: Optional[str] = None,
        approval_ttl_s: float = APPROVAL_TTL_S,
        max_pending: int = MAX_PENDING,
        max_rate_keys: int = MAX_RATE_KEYS,
        panic_cooldown_s: float = PANIC_COOLDOWN_S,
        panic_owner: str = "owner",
        reviewers: Optional[Iterable[str]] = None,
        attested_operations: Optional[Iterable[str]] = None,
        verdict_deny_risk: float = VERDICT_DENY_RISK,
        guardians: Optional[Iterable[str]] = None,
        guardian_threshold: Optional[int] = None,
        two_person_required: bool = False,
    ) -> None:
        self.policy = policy or default_policy()
        # Валидация политики (дубликаты rule.id → ошибка конструкции).
        self._validate_policy(self.policy)
        self.policy_hash = hashlib.sha256(
            self.policy.canonical().encode("utf-8")
        ).hexdigest()
        self.event_sink = event_sink
        self.audit_path = audit_path
        self.approval_ttl_s = approval_ttl_s
        self.max_pending = max_pending
        self.max_rate_keys = max_rate_keys
        self._audit: List[Dict[str, Any]] = []
        self._pending: Dict[str, Dict[str, Any]] = {}   # approval_id → record
        self._rate_events: Dict[str, List[float]] = {}  # rate-limit окна
        # amount_window: накопление суммы (ts, amount) по scope-ключу —
        # закрывает split-amount bypass per-op amount_limit (HERETIC G-2)
        self._amount_windows: Dict[str, List[tuple]] = {}
        self._last_audit_hash: Optional[str] = None     # хвост hash-цепочки
        # один lock на emit+append+ротацию: цепочка и файл линейны
        # (ThreadingHTTPServer пускает конкурентных writers)
        self._audit_lock = threading.Lock()
        # RLock: pending/rate-стейт — check-then-act под единым锁ом
        # (approve pop→reinsert, rate consume, pending cap)
        self._state_lock = threading.RLock()
        self.evaluation_count = 0
        self._state_path = state_path
        self._windows_dirty = False
        # HERETIC #410: corrupt windows-файл → fail-closed. Окна
        # недоверенны → rate_limit/amount_window условия = violation,
        # persist пропускается (corrupt-файл не затираем) до ручного
        # reset (заменить/удалить aegis-windows.json).
        self._windows_untrusted = False
        self._state_lock_fd: Optional[int] = None
        # W3 panic circuit-breaker: {"active","by","started_at"}.
        # panic_cooldown_s <= 0 разрешает мгновенный panic_off — только
        # для тестов/явной конфигурации, не дефолт.
        self.panic_cooldown_s = float(panic_cooldown_s)
        self.panic_owner = str(panic_owner or "owner")
        self._panic: Dict[str, Any] = {
            "active": False, "by": None, "started_at": 0.0,
        }
        # W1 verdict-attestation: reviewers — кто может submit_verdict;
        # attested_operations — op-типы, требующие verdict по payload_hash
        # ("*" — все sensitive). Пустые множества = фича выключена.
        self._reviewers = frozenset(str(r) for r in (reviewers or ()))
        self._attested_ops = frozenset(
            str(o) for o in (attested_operations or ()))
        self.verdict_deny_risk = float(verdict_deny_risk)
        self._verdicts: Dict[str, Dict[str, Any]] = {}  # payload_hash → rec
        # W2 guardian M-of-N: голоса по approval_id → {guardian: vote}.
        # Пустой _guardians = фича выключена (guardian_vote → not configured).
        # threshold None → len(guardians) (единогласие — самый строгий
        # дефолт для skeleton); явное значение валидируется в диапазоне.
        self._guardians = frozenset(str(g) for g in (guardians or ()))
        if guardian_threshold is None:
            guardian_threshold = len(self._guardians)
        self.guardian_threshold = int(guardian_threshold)
        if self._guardians and not (
                1 <= self.guardian_threshold <= len(self._guardians)):
            raise ValueError(
                f"guardian_threshold {self.guardian_threshold} out of "
                f"range 1..{len(self._guardians)}")
        self._guardian_votes: Dict[str, Dict[str, Dict[str, Any]]] = {}
        # W77 consume-on-execute permits (tier 3.2, FIX-69 #472):
        # approve()/guardian-release → mint permit {permit_id, approval_id,
        # operation_type, payload_hash, policy_hash, expires_at, consumed}.
        # Ретрай mutation с тем же payload_hash → consume → execute.
        # Single-use; reuse/expired/stale-policy → evaluate заново
        # (re-escalate, fail-safe). Persist в том же state-файле.
        self._permits: Dict[str, Dict[str, Any]] = {}
        # FIX-69 PC-1 (two-person rule, #472): один держатель admin-токена
        # не может закрыть два разных шага escalation-цепочки. Включается
        # только при ролевых admin-идентичностях (AEGIS_ADMIN_KEYS) —
        # legacy-single-token deployment проверку не запрашивает.
        self.two_person_required = bool(two_person_required)
        if self._state_path:
            self._acquire_state_lock()
            self._load_windows()
        if self.audit_path:
            self._load_audit()

    # ------------------------------------------------------------------
    # Окна rate/amount — персистентность (HERETIC #399 A-1)
    # ------------------------------------------------------------------
    # in-memory окна обнулялись рестартом → холодный обход кумулятивных
    # потолков. Атомарная запись (tmp+replace, как ratings.json) на каждую
    # мутацию окон (dirty-флаг): debounce здесь = обход, proposals —
    # редкий admin/auction путь, fsync-стоимость приемлема.

    WINDOWS_MAX_ENTRIES_PER_KEY = 10000

    def _max_window_s(self) -> float:
        """Максимальный window_s по всем rate_limit/amount_window
        условиям политики — горизонт фильтрации при загрузке."""
        best = 3600.0
        stack = [r.condition for r in self.policy.rules]
        while stack:
            c = stack.pop()
            if c.type in (COND_RATE_LIMIT, COND_AMOUNT_WINDOW):
                best = max(best, c.window_s)
            stack.extend(c.conditions)
        return best

    def _acquire_state_lock(self) -> None:
        """Advisory single-instance lock на <state>.lck (HERETIC #410).

        Best-effort: Windows msvcrt.locking / POSIX fcntl.flock, non-
        blocking. Занятый lock → warning в лог (не блокируем старт —
        precondition single-instance задокументирован, lock — детектор,
        не гарант). Держим fd до смерти процесса."""
        fd = -1
        try:
            lock_path = self._state_path + ".lck"
            fd = os.open(lock_path, os.O_CREAT | os.O_RDWR)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self._state_lock_fd = fd
        except OSError as exc:
            if fd >= 0:
                try:
                    os.close(fd)
                except OSError:
                    pass
            log.warning(
                "aegis: state lock %s.lck unavailable/contended (%s) — "
                "run a single AegisGuard per state_path", self._state_path, exc)
        except ImportError:
            pass  # платформа без lock API — precondition на документации

    @staticmethod
    def _preserve_corrupt(path: Path) -> None:
        """Битый windows.json → windows.json.corrupt (копия, оригинал
        остаётся — untrusted-флаг держит fail-closed до ручного reset)."""
        try:
            dst = path.with_name(path.name + ".corrupt")
            import shutil
            shutil.copy2(path, dst)
        except OSError as exc:
            log.warning("aegis: cannot preserve corrupt file: %s", exc)

    def _load_windows(self) -> None:
        path = Path(self._state_path)
        # HERETIC #410: хвост от прерванной записи — всегда мусор,
        # подчищаем при старте.
        try:
            path.with_suffix(".tmp").unlink(missing_ok=True)
        except OSError as exc:
            log.warning("aegis: cannot clean stale tmp %s: %s", path, exc)
        try:
            raw = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return
        except Exception as exc:
            log.warning("aegis: cannot read %s: %s", path, exc)
            self._windows_untrusted = True
            self._preserve_corrupt(path)
            return
        try:
            data = json.loads(raw)
        except Exception as exc:
            # HERETIC #410: corrupt JSON → fail-closed. Раньше except:
            # return молча обнулял окна → кумулятивные потолки обходились
            # рестартом+битым файлом.
            log.warning(
                "aegis: corrupt windows state %s (%s) — untrusted, "
                "window conditions fail closed until manual reset",
                path, exc)
            self._windows_untrusted = True
            self._preserve_corrupt(path)
            return
        if not isinstance(data, dict):
            log.warning(
                "aegis: windows state %s is not a dict (%s) — untrusted, "
                "fail closed until manual reset", path, type(data).__name__)
            self._windows_untrusted = True
            self._preserve_corrupt(path)
            return
        now = time.time()
        horizon = self._max_window_s()
        cap = self.WINDOWS_MAX_ENTRIES_PER_KEY
        rate = data.get("rate")
        if isinstance(rate, dict):
            for k, evs in rate.items():
                if not isinstance(k, str) or not isinstance(evs, list):
                    continue
                live = [float(t) for t in evs[-cap:]
                        if isinstance(t, (int, float))
                        and math.isfinite(t) and now - t < horizon]
                if live:
                    self._rate_events[k] = live
        amt = data.get("amount")
        if isinstance(amt, dict):
            for k, evs in amt.items():
                if not isinstance(k, str) or not isinstance(evs, list):
                    continue
                live = []
                for pair in evs[-cap:]:
                    if (isinstance(pair, (list, tuple)) and len(pair) == 2
                            and all(isinstance(x, (int, float))
                                    and math.isfinite(x) for x in pair)
                            and now - pair[0] < horizon):
                        live.append((float(pair[0]), float(pair[1])))
                if live:
                    self._amount_windows[k] = live
        # W3/W1: panic + verdicts живут в том же атомарном state-файле —
        # рестарт не должен снимать emergency-freeze или терять attestation.
        panic = data.get("panic")
        if isinstance(panic, dict) and panic.get("active"):
            try:
                self._panic = {
                    "active": True,
                    "by": str(panic.get("by") or "?"),
                    "started_at": float(panic.get("started_at") or 0.0),
                }
            except (TypeError, ValueError):
                pass
        verdicts = data.get("verdicts")
        if isinstance(verdicts, dict):
            for h, v in list(verdicts.items())[-MAX_VERDICTS:]:
                if isinstance(h, str) and isinstance(v, dict):
                    self._verdicts[h] = v
        gvotes = data.get("guardian_votes")
        if isinstance(gvotes, dict):
            for aid, votes in gvotes.items():
                if isinstance(aid, str) and isinstance(votes, dict):
                    self._guardian_votes[aid] = {
                        str(g): v for g, v in votes.items()
                        if isinstance(v, dict)}
        # W77: permits переживают рестарт — иначе approve→restart→retry
        # снова эскалировал бы одобренную операцию.
        permits = data.get("permits")
        if isinstance(permits, dict):
            for pid, rec in permits.items():
                if (isinstance(pid, str) and isinstance(rec, dict)
                        and isinstance(rec.get("payload_hash"), str)):
                    self._permits[pid] = dict(rec)

    def _maybe_save_windows(self, force: bool = False) -> bool:
        """Атомарный persist окон при наличии мутаций (dirty-флаг).
        force — для тестов/остановки. Без state_path — no-op.

        W87: возвращает bool — consume_permit обязан знать, дошёл ли
        consumed-флаг до диска (write failure → permit «воскреснет»
        после restart → replay-вектор). True — persisted/no-op,
        False — untrusted ИЛИ OSError (уже re-dirty + warn)."""
        if not self._state_path:
            return True
        if self._windows_untrusted:
            # #410: corrupt-файл — forensic evidence, свежий state поверх
            # него выглядел бы «чистым» и снял бы fail-closed при рестарте.
            return False
        with self._state_lock:
            if not force and not self._windows_dirty:
                return True
            payload = {
                "rate": {k: list(v) for k, v in self._rate_events.items()},
                "amount": {k: [list(p) for p in v]
                           for k, v in self._amount_windows.items()},
                "panic": {
                    "active": bool(self._panic.get("active")),
                    "by": self._panic.get("by"),
                    "started_at": self._panic.get("started_at") or 0.0,
                },
                "verdicts": dict(self._verdicts),
                "guardian_votes": {
                    aid: dict(v) for aid, v in self._guardian_votes.items()},
                "permits": dict(self._permits),
            }
            self._windows_dirty = False
        path = Path(self._state_path)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(payload), encoding="utf-8")
            os.replace(tmp, path)
            return True
        except OSError as exc:
            # #410: не глотаем — warn + re-dirty, чтобы следующее
            # evaluate повторило persist (окна не теряются молча).
            log.warning("aegis: windows persist failed %s: %s", path, exc)
            with self._state_lock:
                self._windows_dirty = True
            return False

    # ------------------------------------------------------------------
    # Валидация политики
    # ------------------------------------------------------------------

    def _validate_policy(self, policy: Policy) -> None:
        seen: set[str] = set()
        for rule in policy.rules:
            if not rule.id:
                raise ValueError("rule.id must be non-empty")
            if rule.id in seen:
                raise ValueError(f"duplicate rule id: {rule.id}")
            seen.add(rule.id)
            if rule.outcome not in OUTCOMES:
                raise ValueError(f"rule {rule.id}: unknown outcome {rule.outcome!r}")
            if rule.escalation_chain:
                if rule.outcome != "escalate":
                    raise ValueError(
                        f"rule {rule.id}: escalation_chain only valid "
                        f"with outcome='escalate'"
                    )
                if any(not isinstance(s, str) or not s.strip()
                       for s in rule.escalation_chain):
                    raise ValueError(
                        f"rule {rule.id}: escalation_chain entries must "
                        f"be non-empty strings"
                    )
            self._validate_condition(rule.condition, rule.id)
        for op, cls in policy.operation_class.items():
            if cls not in OP_CLASSES:
                raise ValueError(
                    f"operation_class[{op!r}]: unknown class {cls!r}"
                )

    @staticmethod
    def _validate_condition(cond: PolicyCondition, rule_id: str) -> None:
        """Незнакомый тип условия — ошибка загрузки политики (fail-closed,
        иначе молчаливый `return False` делал бы deny-правило мёртвым)."""
        if cond.type not in KNOWN_COND_TYPES:
            raise ValueError(
                f"rule {rule_id}: unknown condition type {cond.type!r}"
            )
        if cond.type == COND_COMPOUND:
            if cond.operator not in COMPOUND_OPERATORS:
                raise ValueError(
                    f"rule {rule_id}: unknown compound operator "
                    f"{cond.operator!r}"
                )
            for sub in cond.conditions:
                AegisGuard._validate_condition(sub, rule_id)
        if cond.type in (COND_RATE_LIMIT, COND_AMOUNT_WINDOW):
            if cond.rate_scope not in RATE_SCOPES:
                raise ValueError(
                    f"rule {rule_id}: unknown rate_scope {cond.rate_scope!r}"
                )
            if not (cond.window_s > 0 and math.isfinite(cond.window_s)):
                raise ValueError(f"rule {rule_id}: window_s must be > 0")
        if cond.type == COND_RATE_LIMIT:
            if not isinstance(cond.max_count, int) or cond.max_count < 1:
                raise ValueError(f"rule {rule_id}: max_count must be int >= 1")
        if cond.type == COND_AMOUNT_WINDOW:
            # кумулятивный потолок обязателен и конечен — None/inf сделало
            # бы правило мёртвым (молчаливый no-op хуже fail-closed)
            if (cond.max_amount is None
                    or not math.isfinite(cond.max_amount)
                    or cond.max_amount < 0):
                raise ValueError(
                    f"rule {rule_id}: amount_window requires finite "
                    f"max_amount >= 0"
                )

    # ------------------------------------------------------------------
    # evaluate
    # ------------------------------------------------------------------

    def evaluate(
        self,
        proposal: OperationProposal,
        ctx: Optional[Dict[str, Any]] = None,
        simulate: bool = False,
        approval_ttl: Optional[float] = None,
    ) -> Decision:
        """proposal → Decision + дебаунс-персист окон (state_path)."""
        decision = self._evaluate(proposal, ctx, simulate, approval_ttl)
        self._maybe_save_windows()
        return decision

    def _evaluate(
        self,
        proposal: OperationProposal,
        ctx: Optional[Dict[str, Any]] = None,
        simulate: bool = False,
        approval_ttl: Optional[float] = None,
    ) -> Decision:
        """proposal → Decision. simulate=True — dry-run: то же решение,
        но без pending-записи и без расхода rate-окон (аудит type=simulate).
        approval_ttl — per-request TTL эскалации (clamp ≤ MAX_APPROVAL_TTL_S)."""
        with self._state_lock:
            self.evaluation_count += 1
        ctx = ctx or {}
        self._announce(
            "aegis_evaluate", proposal_id=proposal.id,
            operation_type=proposal.operation_type, agent=proposal.agent,
            simulate=simulate)
        if approval_ttl is not None:
            try:
                approval_ttl = float(approval_ttl)
            except (TypeError, ValueError):
                raise ValueError("approval_ttl must be a number")
            if not math.isfinite(approval_ttl) or approval_ttl <= 0:
                raise ValueError("approval_ttl must be positive finite")

        # FIX-69 PC-3a (#472): payload обязан быть JSON-native. Раньше нет:
        # _payload_hash принимал Decimal/NaN (default=str), а аудит-писатель
        # в _emit() печатал record без default → TypeError ронял запрос на
        # полпути (не deny). Теперь malformed = детерминированный deny с
        # marker-payload — и хэш, и аудит-строка существуют.
        violation = _json_native_violation(proposal.payload)
        if violation is not None:
            proposal = replace(
                proposal,
                payload={"__payload_uncanonical__": violation},
            )
            return self._finalize(
                proposal,
                Decision(
                    proposal_id=proposal.id,
                    outcome="deny",
                    rule_id="PAYLOAD-CANON",
                    reason=f"payload_uncanonical: {violation}",
                ),
                simulate=simulate,
                approval_ttl=approval_ttl,
            )

        # W3 panic circuit-breaker (#468): заморозка сильнее любых правил —
        # deny до классификации, включая observe и simulate (честный
        # dry-run показывает реальный исход: deny). panic_off — прямой
        # метод, evaluate не нужен → дедлока нет.
        if self._panic_active():
            p = self._panic_snapshot()
            return self._finalize(
                proposal,
                Decision(
                    proposal_id=proposal.id,
                    outcome="deny",
                    rule_id="PANIC",
                    reason=(
                        f"panic_mode: frozen by {p.get('by')} — owner "
                        f"'{self.panic_owner}' release after "
                        f"{self.panic_cooldown_s:.0f}s cooldown"
                    ),
                ),
                simulate=simulate,
                approval_ttl=approval_ttl,
            )

        # Observe-класс: без правил, сразу permit (но аудит пишется).
        # Класс определяется серверной политикой — клиентский
        # proposal.sensitive сознательно игнорируется (A-1 байпас).
        op_class = self.policy.operation_class.get(
            proposal.operation_type, OP_CLASS_SENSITIVE
        )
        if op_class == OP_CLASS_OBSERVE:
            return self._finalize(
                proposal,
                Decision(
                    proposal_id=proposal.id,
                    outcome="permit",
                    rule_id=None,
                    reason="observe-class operation — not sensitive",
                ),
                simulate=simulate,
                approval_ttl=approval_ttl,
            )

        # W1 verdict-attestation (#468): op из attested_operations требует
        # verdict по payload_hash ДО правил — нет verdict → deny
        # no_verdict (fail-closed), verdict deny/risk → deny verdict_deny.
        # Проверка до rules-цикла: unattested операции не жгут окна.
        if self._attestation_required(proposal.operation_type):
            veto = self._verdict_veto(
                proposal.operation_type,
                self._payload_hash(proposal.payload),
            )
            if veto is not None:
                return self._finalize(
                    proposal,
                    Decision(
                        proposal_id=proposal.id,
                        outcome="deny",
                        rule_id="VERDICT",
                        reason=veto,
                    ),
                    simulate=simulate,
                    approval_ttl=approval_ttl,
                )

        rules = sorted(
            (
                r
                for r in self.policy.rules
                if r.active
                and r.operation in ("*", proposal.operation_type)
                and r.agent in ("*", proposal.agent)
            ),
            key=lambda r: (-r.priority, r.id),  # детерминированный тай-брейк
        )
        for rule in rules:
            if self._match(rule.condition, proposal, ctx,
                           consume=not simulate):
                outcome = self._resolve_outcome(rule, proposal, ctx)
                return self._finalize(
                    proposal,
                    Decision(
                        proposal_id=proposal.id,
                        outcome=outcome,
                        rule_id=rule.id,
                        reason=f"rule {rule.id}: {rule.description}",
                        escalate_to=(
                            rule.escalation_chain[0]
                            if rule.escalation_chain
                            else "human"
                        ) if outcome == "escalate" else None,
                        escalation_chain=list(rule.escalation_chain),
                    ),
                    simulate=simulate,
                    approval_ttl=approval_ttl,
                )

        # deny-by-default для sensitive-класса (их дефолт был PERMIT — дыра)
        return self._finalize(
            proposal,
            Decision(
                proposal_id=proposal.id,
                outcome=self.policy.default_outcome,
                rule_id=None,
                reason="no matching rule — default outcome "
                f"({self.policy.default_outcome})",
                escalate_to="human"
                if self.policy.default_outcome == "escalate"
                else None,
            ),
            simulate=simulate,
            approval_ttl=approval_ttl,
        )

    # ------------------------------------------------------------------
    # conditions
    # ------------------------------------------------------------------

    def _match(
        self,
        cond: PolicyCondition,
        proposal: OperationProposal,
        ctx: Dict[str, Any],
        depth: int = 0,
        consume: bool = True,
    ) -> bool:
        payload = proposal.payload
        if cond.type == COND_ALWAYS:
            return True
        if cond.type == COND_AGENT_PERMISSION:
            allowed = self.policy.operation_permissions.get(
                proposal.operation_type
            )
            # маппинг для op не задан → правило непроверяемо → нарушение
            if not allowed:
                return True
            return proposal.agent not in allowed
        if cond.type == COND_AMOUNT_LIMIT:
            raw = payload.get(cond.payload_field)
            # отсутствие поля — нарушение (fail-closed, иначе payout
            # без amount уходил бы в permit-хвост)
            if raw is None:
                return True
            amount = _as_finite(raw, default=float("inf"))
            # не-число, NaN, ±inf, отрицательное → нарушение (fail-closed)
            if amount < 0:
                return True
            cap = cond.max_amount if cond.max_amount is not None else float("inf")
            return amount > cap
        if cond.type == COND_ALLOWLIST:
            value = payload.get(cond.payload_field)
            if value is None:
                return True
            return str(value) not in cond.allowed
        if cond.type == COND_BUDGET_THRESHOLD:
            raw = payload.get(cond.payload_field)
            if raw is None:
                return True
            amount = _as_finite(raw, default=float("inf"))
            if amount < 0:
                return True
            available = _as_finite(
                ctx.get("budget", ctx.get("budget_limit", float("inf"))),
                default=float("inf"),
            )
            return amount > available * (cond.budget_percent / 100.0)
        if cond.type == COND_COMPOUND:
            # Глубоко вложенный compound → fail-closed (нарушение).
            if depth >= MAX_COMPOUND_DEPTH:
                return True
            results = [
                self._match(c, proposal, ctx, depth + 1, consume=consume)
                for c in cond.conditions
            ]
            return all(results) if cond.operator == "AND" else any(results)
        if cond.type == COND_RATE_LIMIT:
            return self._rate_violation(cond, proposal, consume=consume)
        if cond.type == COND_AMOUNT_WINDOW:
            return self._amount_window_violation(cond, proposal,
                                                 consume=consume)
        # неизвестный тип (не может появиться через валидатор — страховка
        # от мутации объекта после загрузки) → нарушение, а не пропуск
        return True

    # ------------------------------------------------------------------
    # W3 panic circuit-breaker (#468)
    # ------------------------------------------------------------------

    def _panic_active(self) -> bool:
        with self._state_lock:
            return bool(self._panic.get("active"))

    def _panic_snapshot(self) -> Dict[str, Any]:
        with self._state_lock:
            return dict(self._panic)

    def panic_status(self) -> Dict[str, Any]:
        """Текущее состояние circuit-breaker'а (для GET /api/core/panic)."""
        p = self._panic_snapshot()
        active = bool(p.get("active"))
        started = float(p.get("started_at") or 0.0)
        remaining = (
            max(0.0, self.panic_cooldown_s - (time.time() - started))
            if active else 0.0
        )
        return {
            "active": active,
            "by": p.get("by"),
            "started_at": started,
            "cooldown_s": self.panic_cooldown_s,
            "owner": self.panic_owner,
            "remaining_s": round(remaining, 3),
        }

    def panic_on(self, by: str = "operator") -> Dict[str, Any]:
        """Заморозить gate: все evaluate → deny panic_mode.

        Любой аутентифицированный вызывающий может активировать —
        направление fail-safe (заморозка останавливает, но не тратит).
        Идемпотентно: повторный вызов не сдвигает started_at (первый
        panic_started_at побеждает, как у near-aegis)."""
        with self._state_lock:
            if self._panic.get("active"):
                return self.panic_status()
            self._panic = {
                "active": True, "by": str(by), "started_at": time.time(),
            }
            self._windows_dirty = True
        self._emit({
            "type": "panic", "audit_id": uuid.uuid4().hex,
            "action": "on", "by": str(by), "ts": time.time(),
        })
        self._announce("aegis_panic_on", by=str(by))
        self._maybe_save_windows()  # W83: panic переживает restart
        return self.panic_status()

    def panic_off(
        self, by: str = "operator", now: Optional[float] = None
    ) -> Dict[str, Any]:
        """Снять заморозку: только panic_owner и только после cooldown.

        Возвращает {"released": bool, "reason": str, ...status} — отказ
        тоже аудируется (action=off_denied), попытка взлома cooldown
        видна в журнале."""
        now = time.time() if now is None else float(now)
        with self._state_lock:
            p = dict(self._panic)
            if not p.get("active"):
                return {"released": False, "reason": "panic not active",
                        **self.panic_status()}
            started = float(p.get("started_at") or 0.0)
            elapsed = max(0.0, now - started)
            remaining = self.panic_cooldown_s - elapsed
            if str(by) != self.panic_owner:
                reason = (f"only owner '{self.panic_owner}' may release "
                          f"panic mode")
            elif remaining > 0:
                reason = (f"cooldown still running "
                          f"({remaining:.1f}s left)")
            else:
                reason = None
            if reason is not None:
                denied = {"released": False, "reason": reason,
                          **self.panic_status()}
            else:
                self._panic = {"active": False, "by": str(by),
                               "started_at": 0.0}
                self._windows_dirty = True
                denied = None
        if denied is not None:
            self._emit({
                "type": "panic", "audit_id": uuid.uuid4().hex,
                "action": "off_denied", "by": str(by),
                "reason": denied["reason"], "ts": now,
            })
            self._announce("aegis_panic_off", done=True, by=str(by),
                           released=False, reason=denied["reason"])
            return denied
        self._emit({
            "type": "panic", "audit_id": uuid.uuid4().hex,
            "action": "off", "by": str(by), "ts": now,
        })
        self._announce("aegis_panic_off", done=True, by=str(by),
                       released=True)
        self._maybe_save_windows()  # W83
        return {"released": True, "reason": "panic released",
                **self.panic_status()}

    # ------------------------------------------------------------------
    # W1 verdict-attestation (#468)
    # ------------------------------------------------------------------

    @staticmethod
    def _payload_hash(payload: Dict[str, Any]) -> str:
        """Канонический хэш payload — тот же, что пишет pending/аудит
        в _finalize. Verdict ключуется по нему: attestation связывает
        решение с конкретным содержимым заявки.

        FIX-69 PC-3a (#472): байты берёт _canonical_payload_bytes (без
        default=str). Прежняя форма печатала Decimal("1.0") и "1.0" одной
        строкой, поэтому verdict, поставленный под одну сумму, засчитывался
        под другую: ключ attestation не связывал решение с содержимым.
        copy.deepcopy больше не нужен — _normalize_amounts строит новые
        словари/списки, неизменяемые листья разделять безопасно.
        """
        return hashlib.sha256(_canonical_payload_bytes(payload)).hexdigest()

    def _attestation_required(self, operation_type: str) -> bool:
        return ("*" in self._attested_ops
                or operation_type in self._attested_ops)

    def _verdict_veto(
        self, operation_type: str, payload_hash: str
    ) -> Optional[str]:
        """None — verdict разрешает (правила решают дальше); str — причина
        deny. Fail-closed: нет записи → no_verdict; deny/risk → veto."""
        with self._state_lock:
            rec = self._verdicts.get(payload_hash)
        if rec is None:
            return (f"no_verdict: attestation required for "
                    f"'{operation_type}'")
        if rec.get("verdict") == "deny":
            note = rec.get("note") or ""
            return (f"verdict_deny by {rec.get('by')}"
                    + (f": {note}" if note else ""))
        risk = rec.get("risk")
        if risk is not None:
            risk_f = _as_finite(risk, default=1.0)
            if risk_f >= self.verdict_deny_risk:
                return (f"verdict_risk by {rec.get('by')}: "
                        f"risk={risk_f} >= {self.verdict_deny_risk}")
        return None

    def submit_verdict(
        self,
        payload_hash: str,
        verdict: str,
        by: str,
        risk: Optional[float] = None,
        note: str = "",
    ) -> Optional[Dict[str, Any]]:
        """Reviewer кладёт verdict по payload_hash (их submit_verdict).

        None — отказ: `by` не в reviewers, verdict вне VERDICTS,
        hash не 64-hex, store переполнен (fail-closed: новые verdicts
        не принимаются → attested ops остаются no_verdict deny)."""
        if str(by) not in self._reviewers:
            return None
        if verdict not in VERDICTS:
            return None
        if (not isinstance(payload_hash, str) or len(payload_hash) != 64
                or not all(c in "0123456789abcdefABCDEF"
                           for c in payload_hash)):
            return None
        risk_f: Optional[float] = None
        if risk is not None:
            try:
                risk_f = float(risk)
            except (TypeError, ValueError):
                return None
            if not math.isfinite(risk_f) or not (0.0 <= risk_f <= 1.0):
                return None
        rec = {
            "payload_hash": payload_hash.lower(),
            "verdict": verdict,
            "by": str(by),
            "risk": risk_f,
            "note": str(note)[:500],
            "ts": time.time(),
        }
        with self._state_lock:
            if payload_hash.lower() not in self._verdicts \
                    and len(self._verdicts) >= MAX_VERDICTS:
                return None
            self._verdicts[payload_hash.lower()] = rec
            self._windows_dirty = True
        self._emit({
            "type": "verdict", "audit_id": uuid.uuid4().hex,
            "payload_hash": rec["payload_hash"], "verdict": verdict,
            "by": str(by), "risk": risk_f, "ts": rec["ts"],
        })
        self._announce("aegis_verdict", payload_hash=rec["payload_hash"],
                       verdict=verdict, by=str(by))
        self._maybe_save_windows()  # W83: verdict переживает restart
        return rec

    def get_verdict(self, payload_hash: str) -> Optional[Dict[str, Any]]:
        with self._state_lock:
            return self._verdicts.get(str(payload_hash).lower())

    def list_verdicts(self, limit: int = 100) -> List[Dict[str, Any]]:
        limit = max(1, min(int(limit), MAX_AUDIT_READ))
        with self._state_lock:
            return list(self._verdicts.values())[-limit:]

    # ------------------------------------------------------------------
    # W2 guardian M-of-N (#469b)
    # ------------------------------------------------------------------

    def guardian_status(self, approval_id: str) -> Dict[str, Any]:
        """Состояние голосования по approval (для GET/диагностики)."""
        with self._state_lock:
            votes = {
                g: dict(v)
                for g, v in self._guardian_votes.get(approval_id, {}).items()
            }
            pending = approval_id in self._pending
        approve_count = sum(
            1 for v in votes.values() if v.get("decision") == "approve")
        return {
            "approval_id": approval_id,
            "configured": bool(self._guardians),
            "guardians": sorted(self._guardians),
            "threshold": self.guardian_threshold,
            "votes": votes,
            "approve_count": approve_count,
            "deny_count": len(votes) - approve_count,
            "pending": pending,
        }

    def guardian_vote(
        self,
        approval_id: str,
        by: str,
        decision: str = "approve",
        note: str = "",
        now: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Голос guardian'а по escalate-заявке (параллельно, не цепочка).

        - `by` обязан быть в guardians; повторный голос отклоняется.
        - approve-голоса копятся; при достижении threshold → release
          через approve() (те же expiry/stale/chain проверки).
        - Один deny-голос → немедленный reject через approve(False).
        - approve() сам чистит pending; мы чистим собранные голоса.
        """
        now = time.time() if now is None else float(now)
        if decision not in GUARDIAN_VOTES:
            return {"ok": False,
                    "reason": f"decision must be one of {GUARDIAN_VOTES}"}
        if not self._guardians:
            return {"ok": False, "reason": "guardian votes not configured"}
        if str(by) not in self._guardians:
            return {"ok": False,
                    "reason": f"'{by}' is not a configured guardian"}
        with self._state_lock:
            pending = self._pending.get(approval_id)
            if pending is None:
                return {"ok": False,
                        "reason": "unknown or already resolved approval"}
            if pending.get("expires_at", float("inf")) <= now:
                return {"ok": False, "reason": "approval expired"}
            votes = self._guardian_votes.setdefault(approval_id, {})
            if str(by) in votes:
                return {"ok": False,
                        "reason": f"'{by}' already voted on this approval"}
            votes[str(by)] = {
                "decision": decision, "note": str(note)[:500], "ts": now,
            }
            self._windows_dirty = True
            approve_count = sum(
                1 for v in votes.values() if v.get("decision") == "approve")
            any_deny = any(
                v.get("decision") == "deny" for v in votes.values())
            release = (decision == "approve"
                       and approve_count >= self.guardian_threshold) \
                or any_deny
            voters = sorted(votes)
        status = self.guardian_status(approval_id)
        self._emit({
            "type": "guardian", "audit_id": uuid.uuid4().hex,
            "approval_id": approval_id, "by": str(by),
            "decision": decision, "note": str(note)[:500],
            "approve_count": status["approve_count"],
            "threshold": self.guardian_threshold,
            "released": release, "ts": now,
        })
        self._announce(
            "aegis_guardian_vote", approval_id=approval_id, by=str(by),
            decision=decision, approve_count=status["approve_count"],
            threshold=self.guardian_threshold, released=release)
        if not release:
            # W83: голоса — часть persist-payload; flush сразу,
            # иначе restart теряет набранные голоса.
            self._maybe_save_windows()
            return {
                "ok": True, "released": False,
                "reason": (f"vote recorded "
                           f"({status['approve_count']}/"
                           f"{self.guardian_threshold} approve)"),
                **{k: status[k] for k in
                   ("approve_count", "deny_count", "threshold", "votes")},
            }
        # Финал — через approve(): expiry/stale-policy/escalation-chain/
        # audit идентичны одиночному решению. by-метка = список проголосовавших.
        final = self.approve(
            approval_id, approved=not any_deny,
            by=f"guardians({','.join(voters)})")
        with self._state_lock:
            self._guardian_votes.pop(approval_id, None)
            self._windows_dirty = True
        # W83: release/deny + очистка голосов — persist сразу
        # (approve()→_mint_permit уже флашит, но deny-ветка нет).
        self._maybe_save_windows()
        return {
            "ok": True, "released": True, "approved": not any_deny,
            "outcome": final.outcome if final is not None else None,
            "reason": final.reason if final is not None else "resolved",
            "voters": voters,
        }

    # ------------------------------------------------------------------
    # W77 consume-on-execute permits (FIX-69 tier 3.2, #472)
    # ------------------------------------------------------------------

    def _mint_permit(self, pending: Dict[str, Any], approval_id: str,
                     now: float) -> Optional[str]:
        """Терминальный permit для одобренной escalate-операции.

        Mint только при outcome=permit (не stale, не deny, цепочка
        завершена). expires_at = deadline самой заявки — permit не
        переживает approval TTL. policy_hash фиксируется: reload_policy
        между approve и retry инвалидирует permit → повторная эскалация
        (replay-binding как у policy-defer пути)."""
        payload_hash = pending.get("payload_hash")
        op_type = pending.get("operation_type")
        expires_at = pending.get("expires_at")
        if (not payload_hash or not op_type
                or not isinstance(expires_at, (int, float))
                or expires_at <= now):
            return None
        permit_id = uuid.uuid4().hex
        with self._state_lock:
            self._permits[permit_id] = {
                "permit_id": permit_id,
                "approval_id": approval_id,
                "operation_type": op_type,
                "payload_hash": payload_hash,
                "policy_hash": self.policy_hash,
                "created_at": now,
                "expires_at": float(expires_at),
                "consumed": False,
            }
            self._windows_dirty = True
        self._announce(
            "aegis_permit_minted", permit_id=permit_id,
            approval_id=approval_id, operation_type=op_type)
        # W83: flush сразу — иначе restart между mint и следующим
        # evaluate теряет permit (dirty-флаг без persist = data loss).
        # W87: failure → audit (in-memory permit жив до restart,
        # направление fail-safe — потеря, не replay).
        if not self._maybe_save_windows():
            self._emit({
                "type": "aegis_permit_persist_failed",
                "audit_id": uuid.uuid4().hex,
                "permit_id": permit_id,
                "approval_id": approval_id,
                "operation_type": op_type,
                "phase": "mint",
                "ts": time.time(),
            })
            self._announce(
                "aegis_permit_persist_failed", permit_id=permit_id,
                approval_id=approval_id, operation_type=op_type,
                phase="mint")
        return permit_id

    def consume_permit(self, operation_type: str, payload_hash: str,
                       now: Optional[float] = None) -> Optional[str]:
        """Single-use consume permit по {operation_type, payload_hash}.

        Возвращает permit_id при успехе, None — permit нет/expired/
        consumed/stale-policy → caller обязан идти в evaluate
        (re-escalate, fail-safe). Атомарно под _state_lock: check+mark
        consumed — один поток не получит два execute на один permit.
        """
        # W87 (CODEX W5l): now считаем ВНУТРИ лока — permit мог истечь
        # между входом в функцию и получением _state_lock; внешний now
        # использовал бы «протухшее» время ожидания.
        with self._state_lock:
            now = time.time() if now is None else float(now)
            for pid, rec in list(self._permits.items()):
                if (not isinstance(rec.get("expires_at"), (int, float))
                        or rec["expires_at"] <= now):
                    del self._permits[pid]
                    self._windows_dirty = True
                    continue
                if (rec.get("operation_type") == operation_type
                        and rec.get("payload_hash") == payload_hash
                        and rec.get("policy_hash") == self.policy_hash
                        and not rec.get("consumed")):
                    rec["consumed"] = True
                    rec["consumed_at"] = now
                    self._windows_dirty = True
                    # W87: persist ДО announce/return — если запись на
                    # диск упала, consumed на диске остался False →
                    # permit «воскреснет» после restart и даст replay.
                    # Fail-closed: откатываем consumed и возвращаем
                    # None → caller идёт в evaluate (re-escalate).
                    persisted = self._maybe_save_windows()
                    if not persisted:
                        rec["consumed"] = False
                        rec.pop("consumed_at", None)
                        self._windows_dirty = True
                        self._emit({
                            "type": "aegis_permit_persist_failed",
                            "audit_id": uuid.uuid4().hex,
                            "permit_id": pid,
                            "approval_id": rec.get("approval_id"),
                            "operation_type": operation_type,
                            "payload_hash": payload_hash,
                            "ts": now,
                        })
                        self._announce(
                            "aegis_permit_persist_failed",
                            permit_id=pid,
                            approval_id=rec.get("approval_id"),
                            operation_type=operation_type)
                        return None
                    self._announce(
                        "aegis_permit_consumed", permit_id=pid,
                        approval_id=rec.get("approval_id"),
                        operation_type=operation_type)
                    return pid
            # expire-чистка внутри loop тоже dirty — flush и на miss
            self._maybe_save_windows()
            return None

    def _rate_violation(self, cond: PolicyCondition,
                        proposal: OperationProposal,
                        consume: bool = True) -> bool:
        """Sliding-window rate limit. Счётчик — в state gate, не в payload
        (иначе подделывается). Попытка расходует окно при прохождении
        проверки; over-limit → нарушение, но не продлевает окно (окно
        восстанавливается по истечении window_s — нет вечного локаута).
        Переполнение ключей state → нарушение (безграничный рост = DoS).
        consume=False (simulate) — read-only проверка, окно не трогается.
        _windows_untrusted (corrupt state, #410) → violation: потолок
        нельзя проверить → не permit."""
        if self._windows_untrusted:
            return True
        now = time.time()
        key = self._scope_key(cond.rate_scope, proposal)
        with self._state_lock:
            events = self._rate_events.get(key)
            if events is None:
                if consume and len(self._rate_events) >= self.max_rate_keys:
                    return True  # state overflow → fail-closed
                events = []
                if consume:
                    self._rate_events[key] = events
            live = [t for t in events if now - t < cond.window_s]
            if len(live) >= cond.max_count:
                return True
            if consume:
                events[:] = live
                events.append(now)
                self._windows_dirty = True
            return False

    @staticmethod
    def _scope_key(scope: str, proposal: OperationProposal) -> str:
        if scope == "agent":
            return proposal.agent
        if scope == "operation":
            return proposal.operation_type
        if scope == "agent:operation":
            return f"{proposal.agent}:{proposal.operation_type}"
        return "*"  # global

    def _amount_window_violation(self, cond: PolicyCondition,
                                 proposal: OperationProposal,
                                 consume: bool = True) -> bool:
        """Кумулятивный amount-window: сумма payload[payload_field] за
        window_s по scope-ключу + текущая заявка > max_amount → нарушение.

        Закрывает split-amount bypass per-op amount_limit: N операций
        по отдельности под потолком в сумме пробивают кумулятивный лимит
        (HERETIC G-2). Те же инварианты, что у rate_limit: отсутствие/
        не-число/отрицательное поле → нарушение (fail-closed), over-limit
        не продлевает окно, simulate не расходует, переполнение ключей →
        нарушение. _windows_untrusted (#410) → violation."""
        if self._windows_untrusted:
            return True
        now = time.time()
        raw = proposal.payload.get(cond.payload_field)
        amount = _as_finite(raw, default=-1.0)
        if amount < 0:
            return True  # нет поля / не число / NaN / отрицательное
        key = self._scope_key(cond.rate_scope, proposal)
        with self._state_lock:
            entries = self._amount_windows.get(key)
            if entries is None:
                if consume and len(self._amount_windows) >= self.max_rate_keys:
                    return True  # state overflow → fail-closed
                entries = []
                if consume:
                    self._amount_windows[key] = entries
            live = [(t, a) for t, a in entries if now - t < cond.window_s]
            total = sum(a for _, a in live) + amount
            if total > cond.max_amount:
                return True
            if consume:
                entries[:] = live
                entries.append((now, amount))
                self._windows_dirty = True
            return False

    def _resolve_outcome(
        self,
        rule: PolicyRule,
        proposal: OperationProposal,
        ctx: Dict[str, Any],
    ) -> str:
        """ESCALATE может понижаться до DENY при жёстком превышении
        (amount_limit ищется по всему дереву условия — раньше compound
        обходил downgrade)."""
        if rule.outcome != "escalate":
            return rule.outcome
        amount_cond = _find_amount_limit(rule.condition)
        if amount_cond is not None:
            amount = _as_finite(
                proposal.payload.get(amount_cond.payload_field) or 0,
                default=float("inf"),
            )
            hard = ctx.get("hard_limit")
            if hard is not None:
                hard_f = _as_finite(hard, default=float("inf"))
                if amount > hard_f:
                    return "deny"
        return "escalate"

    # ------------------------------------------------------------------
    # аудит + approval
    # ------------------------------------------------------------------

    def _finalize(
        self,
        proposal: OperationProposal,
        decision: Decision,
        simulate: bool = False,
        approval_ttl: Optional[float] = None,
    ) -> Decision:
        decision.policy_hash = self.policy_hash
        # A-5 TOCTOU: payload замораживается — pending и аудит видят
        # снапшот, а не мутабельный dict вызывающего; payload_hash связывает
        # решение с конкретным содержимым (мутация после evaluate не
        # меняет ни pending, ни журнал)
        payload_snapshot = copy.deepcopy(proposal.payload)
        payload_hash = self._payload_hash(payload_snapshot)
        if decision.outcome == "escalate":
            if simulate:
                # dry-run: решение показано, но pending не создаётся —
                # approval_id остаётся None, escalate "не существует"
                decision.reason += " — simulate (no pending)"
            else:
                with self._state_lock:
                    self._gc_pending(decision.decided_at)
                    if len(self._pending) >= self.max_pending:
                        # очередь одобрений переполнена → fail-closed deny
                        decision.outcome = "deny"
                        decision.approval_id = None
                        decision.escalate_to = None
                        decision.reason += " — approvals pending cap exceeded"
                    else:
                        approval_id = uuid.uuid4().hex
                        decision.approval_id = approval_id
                        ttl = self.approval_ttl_s if approval_ttl is None \
                            else min(approval_ttl, MAX_APPROVAL_TTL_S)
                        self._pending[approval_id] = {
                            "approval_id": approval_id,
                            "proposal_id": proposal.id,
                            "operation_type": proposal.operation_type,
                            "agent": proposal.agent,
                            "payload": payload_snapshot,
                            "payload_hash": payload_hash,
                            "reason": decision.reason,
                            "rule_id": decision.rule_id,
                            # фиксируем политику на момент эскалации — approve()
                            # откажет решению, если она устарела (stale policy_hash)
                            "policy_hash": self.policy_hash,
                            "requested_at": decision.decided_at,
                            "expires_at": decision.decided_at + ttl,
                            # escalation-цепочка: роли шагов и текущая позиция
                            "escalation_chain": list(decision.escalation_chain),
                            "chain_pos": 0,
                        }
        if decision.approval_id and not simulate:
            # run паркуется: следующий approve() продолжит цепочку
            self._announce(
                "aegis_await_approval", proposal_id=proposal.id,
                operation_type=proposal.operation_type,
                approval_id=decision.approval_id,
                escalation_chain=list(decision.escalation_chain))
        record = {
            "type": "simulate" if simulate else "policy",
            "audit_id": uuid.uuid4().hex,
            "proposal_id": proposal.id,
            "operation_type": proposal.operation_type,
            "agent": proposal.agent,
            "payload": payload_snapshot,
            "payload_hash": payload_hash,
            "outcome": decision.outcome,
            "rule_id": decision.rule_id,
            "reason": decision.reason,
            "approval_id": decision.approval_id,
            "policy_hash": self.policy_hash,
            "ts": decision.decided_at,
        }
        self._announce(
            "aegis_decide", done=True, proposal_id=proposal.id,
            operation_type=proposal.operation_type,
            outcome=decision.outcome, rule_id=decision.rule_id,
            approval_id=decision.approval_id,
            policy_hash=self.policy_hash)
        self._emit(record)
        return decision

    def _gc_pending(self, now: Optional[float] = None) -> None:
        """Сбор истёкших escalate-запросов → аудит `approval_expired`."""
        now = now if now is not None else time.time()
        with self._state_lock:
            expired = [
                aid for aid, p in self._pending.items()
                if p.get("expires_at", float("inf")) <= now
            ]
            for aid in expired:
                pend = self._pending.pop(aid)
                self._guardian_votes.pop(aid, None)  # W2: голоса умирают с pending
                self._windows_dirty = True
                self._emit({
                    "type": "policy",
                    "audit_id": uuid.uuid4().hex,
                    "proposal_id": pend["proposal_id"],
                    "operation_type": pend["operation_type"],
                    "agent": pend["agent"],
                    "payload": pend["payload"],
                    "payload_hash": pend.get("payload_hash"),
                    "outcome": "deny",
                    "rule_id": pend.get("rule_id"),
                    "reason": "approval_expired",
                    "approval_id": aid,
                    "policy_hash": self.policy_hash,
                    "ts": now,
                })
                self._announce(
                    "aegis_await_approval", done=True,
                    proposal_id=pend["proposal_id"],
                    operation_type=pend["operation_type"],
                    approval_id=aid, outcome="deny",
                    reason="approval_expired")

    def _two_person_violation(
        self,
        pending: Dict[str, Any],
        chain: List[str],
        pos: int,
        by: str,
        roles: Optional[List[str]],
        approved: bool,
    ) -> Optional[str]:
        """FIX-69 PC-1 (#472): None — шаг засчитать; строка — причина,
        по которой шагу НЕ бывать засчитанным (approval остаётся pending
        на этом же шаге, не расходуется).

        Проверяется только approved=True: reject обязан быть доступным
        любому админу (fail-safe). Роли сверяются с chain[pos]; одна и та
        же идентичность не может закрыть два разных шага цепочки.
        """
        if not approved or not self.two_person_required or not chain:
            return None
        need = chain[pos] if pos < len(chain) else "human"
        granted = list(roles or [])
        if need not in granted:
            return (
                f"two_person_role: step {pos + 1}/{len(chain)} requires "
                f"role {need!r}, approver {by!r} has {granted or '[]'} "
                "-- approval stays pending, ask a holder of that role"
            )
        steps = pending.get("approved_by_steps") or []
        already = [str(s.get("by")) for s in steps]
        if by in already:
            return (
                f"two_person_identity: approver {by!r} already signed "
                f"step(s) {[s.get('step') for s in steps]} of this "
                f"approval (chain {chain}) -- a second, different identity "
                "is required -- approval stays pending"
            )
        return None

    def approve(
        self, approval_id: str, approved: bool, by: str = "operator",
        roles: Optional[List[str]] = None,
    ) -> Optional[Decision]:
        """Человек подтверждает/отклоняет escalate → финальное решение.

        Решение под старой политикой отклоняется: эскалация фиксирует
        policy_hash, при reload approve() даёт stale-deny — операцию нужно
        переоценить под актуальным набором правил. Истёкший запрос
        (expires_at) → deny `approval_expired`."""
        self._announce(
            "aegis_approve_step", approval_id=approval_id,
            approved=approved, by=by)
        with self._state_lock:
            pending = self._pending.pop(approval_id, None)
            # policy_hash snapshot ПОД локом: stale-check, decision и
            # audit-record обязаны видеть один hash — reload_policy между
            # pop и записью не должен давать approve, «проскочивший» под
            # уже сменившейся политикой (HERETIC #411 lock-gap).
            current_hash = self.policy_hash
        if pending is None:
            self._gc_pending()
            self._announce(
                "aegis_approve_step", done=True, approval_id=approval_id,
                outcome="missing")
            return None
        requested_hash = pending.get("policy_hash")
        if pending.get("expires_at", float("inf")) <= time.time():
            outcome = "deny"
            reason = "approval_expired"
            decision = Decision(
                proposal_id=pending["proposal_id"],
                outcome=outcome,
                rule_id=pending.get("rule_id"),
                reason=reason,
            )
            decision.policy_hash = current_hash
            self._emit({
                "type": "policy",
                "audit_id": uuid.uuid4().hex,
                "proposal_id": pending["proposal_id"],
                "operation_type": pending["operation_type"],
                "agent": pending["agent"],
                "payload": pending["payload"],
                "payload_hash": pending.get("payload_hash"),
                "outcome": outcome,
                "rule_id": pending.get("rule_id"),
                "reason": reason,
                "approval_id": approval_id,
                "approved_by": by,
                "stale": False,
                "requested_policy_hash": requested_hash,
                "policy_hash": current_hash,
                "ts": decision.decided_at,
            })
            self._announce(
                "aegis_approve_step", done=True,
                proposal_id=pending["proposal_id"],
                operation_type=pending["operation_type"],
                approval_id=approval_id, outcome=outcome,
                reason=reason)
            return decision
        stale = requested_hash is not None and requested_hash != current_hash
        chain = pending.get("escalation_chain") or []
        pos = pending.get("chain_pos", 0)
        # FIX-69 PC-1: two-person проверка ДО ветвления цепочки —
        # нарушенный шаг не потребляет pending (вернётся на ту же
        # позицию), reject никогда не гейтится (fail-safe).
        violation = self._two_person_violation(
            pending, chain, pos, by, roles, approved)
        if violation is not None:
            with self._state_lock:
                self._pending[approval_id] = pending
            decision = Decision(
                proposal_id=pending["proposal_id"],
                outcome="escalate",
                rule_id=pending.get("rule_id"),
                reason=violation,
                escalate_to=chain[pos] if pos < len(chain) else "human",
                approval_id=approval_id,
                escalation_chain=list(chain),
            )
            decision.policy_hash = current_hash
            self._emit({
                "type": "policy",
                "audit_id": uuid.uuid4().hex,
                "proposal_id": pending["proposal_id"],
                "operation_type": pending["operation_type"],
                "agent": pending["agent"],
                "payload": pending["payload"],
                "payload_hash": pending.get("payload_hash"),
                "outcome": "escalate",
                "rule_id": pending.get("rule_id"),
                "reason": violation,
                "approval_id": approval_id,
                "approved_by": by,
                "approved_roles": list(roles or []),
                "two_person_step_rejected": True,
                "escalation_step": pos,
                "escalation_chain": list(chain),
                "stale": False,
                "requested_policy_hash": requested_hash,
                "policy_hash": current_hash,
                "ts": decision.decided_at,
            })
            self._announce(
                "aegis_approve_step", done=True,
                proposal_id=pending["proposal_id"],
                operation_type=pending["operation_type"],
                approval_id=approval_id, outcome="escalate",
                escalation_step=pos, two_person_step_rejected=True)
            return decision
        # escalation-цепочка: промежуточный approve → следующий шаг
        # (pending возвращается в очередь с chain_pos+1), reject на любом
        # шаге → deny chain_aborted
        if not stale and approved and pos < len(chain) - 1:
            new_pos = pos + 1
            pending.setdefault("approved_by_steps", []).append(
                {"step": pos, "by": by, "roles": list(roles or []),
                 "ts": time.time()})
            pending["chain_pos"] = new_pos
            with self._state_lock:
                self._pending[approval_id] = pending
            decision = Decision(
                proposal_id=pending["proposal_id"],
                outcome="escalate",
                rule_id=pending.get("rule_id"),
                reason=(
                    f"escalation step {pos + 1}/{len(chain)} approved by "
                    f"{by} → next: {chain[new_pos]}"
                ),
                escalate_to=chain[new_pos],
                approval_id=approval_id,
                escalation_chain=list(chain),
            )
            decision.policy_hash = current_hash
            self._emit({
                "type": "policy",
                "audit_id": uuid.uuid4().hex,
                "proposal_id": pending["proposal_id"],
                "operation_type": pending["operation_type"],
                "agent": pending["agent"],
                "payload": pending["payload"],
                "payload_hash": pending.get("payload_hash"),
                "outcome": "escalate",
                "rule_id": pending.get("rule_id"),
                "reason": decision.reason,
                "approval_id": approval_id,
                "approved_by": by,
                "escalation_step": new_pos,
                "escalation_chain": list(chain),
                "stale": False,
                "requested_policy_hash": requested_hash,
                "policy_hash": current_hash,
                "ts": decision.decided_at,
            })
            self._announce(
                "aegis_approve_step", done=True,
                proposal_id=pending["proposal_id"],
                operation_type=pending["operation_type"],
                approval_id=approval_id, outcome="escalate",
                escalation_step=new_pos,
                escalation_chain=list(chain))
            return decision
        if stale:
            outcome = "deny"
            reason = (
                f"stale policy: escalated under {requested_hash[:12]}, "
                f"decided under {current_hash[:12]} — resubmit"
            )
        elif approved:
            outcome = "permit"
            reason = f"human approved by {by}"
            if chain:
                reason += f" (chain complete {len(chain)}/{len(chain)})"
        else:
            outcome = "deny"
            reason = f"human rejected by {by}"
            if chain:
                reason += f" (chain aborted at step {pos + 1}/{len(chain)})"
        decision = Decision(
            proposal_id=pending["proposal_id"],
            outcome=outcome,
            rule_id=pending.get("rule_id"),
            reason=reason,
        )
        decision.policy_hash = current_hash
        # W77: терминальный permit → mint consume-on-execute permit.
        # Только чистый permit (не stale, не deny, цепочка закрыта) —
        # deny/stale/escalate-step permit не создают.
        permit_id = None
        if outcome == "permit" and not stale:
            permit_id = self._mint_permit(
                pending, approval_id, decision.decided_at)
        record = {
            "type": "policy",
            "audit_id": uuid.uuid4().hex,
            "proposal_id": pending["proposal_id"],
            "operation_type": pending["operation_type"],
            "agent": pending["agent"],
            "payload": pending["payload"],
            "outcome": outcome,
            "rule_id": pending.get("rule_id"),
            "reason": decision.reason,
            "approval_id": approval_id,
            "permit_id": permit_id,
            "approved_by": by,
            "approved_roles": list(roles or []),
            "approved_by_steps": list(pending.get("approved_by_steps") or []),
            "two_person_required": self.two_person_required,
            # FIX-69 PC-3.6 (#472): терминальный permit/deny обязан нести
            # тот же payload_hash, что pending и chain-step записи — без
            # него post-hoc сверка журнала слепа на самом важном исходе.
            "payload_hash": pending.get("payload_hash"),
            "stale": stale,
            # обе стороны хэша — аудит показывает, под какой политикой
            # эскалация запрошена и под какой решена
            "requested_policy_hash": requested_hash,
            "policy_hash": current_hash,
            "ts": decision.decided_at,
        }
        self._announce(
            "aegis_approve_step", done=True,
            proposal_id=pending["proposal_id"],
            operation_type=pending["operation_type"],
            approval_id=approval_id, outcome=outcome,
            stale=stale)
        self._emit(record)
        return decision

    def reload_policy(self, policy: Policy) -> str:
        """Hot-reload: новая политика → новый hash, аудит-событие policy_reload."""
        self._validate_policy(policy)
        old_hash = self.policy_hash
        # hash считается ДО swap: читатель никогда не увидит
        # новую policy со старым hash (decision.policy_hash консистентен)
        new_hash = hashlib.sha256(
            policy.canonical().encode("utf-8")
        ).hexdigest()
        with self._state_lock:
            self.policy = policy
            self.policy_hash = new_hash
        record = {
            "type": "policy_reload",
            "audit_id": uuid.uuid4().hex,
            "old_policy_hash": old_hash,
            "new_policy_hash": self.policy_hash,
            "version": policy.version,
            "ts": time.time(),
        }
        self._emit(record)
        return self.policy_hash

    def _announce(
        self, node: str, *, done: bool = False, **fields: Any
    ) -> None:
        """node_start/node_done прогресс-события gate-графа (AO-1c).

        Тот же event_sink → /api/core/events, что и аудит, но БЕЗ
        hash-chain записи: прогресс — не audit record. Best-effort:
        падение sink не должно ронять policy-логику (контракт
        announce_node_start референса auto-ontology). Имена узлов —
        только [a-zA-Z0-9_-] (HERETIC #456: точка вырезается
        санитайзером events.py)."""
        if self.event_sink is None:
            return
        try:
            ev = {
                "type": "node_done" if done else "node_start",
                "graph": "aegis",
                "node": node,
                "ts": time.time(),
            }
            ev.update(fields)
            self.event_sink(ev)
        except Exception:
            log.debug("aegis node announce failed", exc_info=True)

    def _emit(self, record: Dict[str, Any]) -> None:
        """Запись в журнал: hash-цепочка — каждая запись несёт
        `prev_audit_hash` (= content_hash предыдущей) и собственный
        `content_hash` поверх всего, включая prev (проверяемая цепочка,
        удаление/перестановка детектятся audit_chain_verify)."""
        with self._audit_lock:
            record = dict(record)
            record["prev_audit_hash"] = self._last_audit_hash
            record["content_hash"] = hashlib.sha256(
                json.dumps(record, sort_keys=True).encode("utf-8")
            ).hexdigest()
            self._last_audit_hash = record["content_hash"]
            self._audit.append(record)
            if self.event_sink is not None:
                self.event_sink(record)
            if self.audit_path:
                self._append_audit(record)

    def audit_chain_verify(self) -> Dict[str, Any]:
        """Пересчёт hash-цепочки журнала. Записи до внедрения цепочки
        (без prev_audit_hash) — chain-exempt, но content_hash проверяется."""
        prev: Optional[str] = None
        with self._audit_lock:
            snapshot = list(self._audit)
        for i, rec in enumerate(snapshot):
            body = {k: v for k, v in rec.items() if k != "content_hash"}
            expect = hashlib.sha256(
                json.dumps(body, sort_keys=True).encode("utf-8")
            ).hexdigest()
            if rec.get("content_hash") != expect:
                return {
                    "ok": False, "records": i, "first_bad": i,
                    "audit_id": rec.get("audit_id"),
                    "error": "content_hash mismatch",
                }
            if "prev_audit_hash" in rec and rec["prev_audit_hash"] != prev:
                return {
                    "ok": False, "records": i, "first_bad": i,
                    "audit_id": rec.get("audit_id"),
                    "error": "chain broken",
                }
            prev = rec.get("content_hash")
        return {"ok": True, "records": len(snapshot)}

    # ------------------------------------------------------------------
    # персистентный аудит (JSONL + ротация + чтение при рестарте)
    # ------------------------------------------------------------------

    def _load_audit(self) -> None:
        path = Path(self.audit_path)
        if not path.exists():
            return
        try:
            with open(path, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        self._audit.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
        except OSError:
            pass
        # хвост цепочки — новые записи продолжают её после рестарта
        if self._audit:
            self._last_audit_hash = self._audit[-1].get("content_hash")

    def _append_audit(self, record: Dict[str, Any]) -> None:
        path = Path(self.audit_path)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            line = json.dumps(record, ensure_ascii=False) + "\n"
            if path.exists() and path.stat().st_size + len(line) > MAX_AUDIT_BYTES:
                self._rotate_audit(path)
            with open(path, "a", encoding="utf-8") as fh:
                fh.write(line)
        except OSError:
            pass  # аудит-файл опционален; event-канал — первичный

    def _rotate_audit(self, path: Path) -> None:
        for i in range(AUDIT_ROTATIONS, 0, -1):
            src = Path(f"{path}.{i-1}") if i > 1 else path
            dst = Path(f"{path}.{i}")
            if src.exists():
                if dst.exists():
                    dst.unlink()
                os.replace(src, dst)

    def pending_approvals(self) -> List[Dict[str, Any]]:
        now = time.time()
        with self._state_lock:
            snapshot = list(self._pending.values())
        out = []
        for p in snapshot:
            chain = p.get("escalation_chain") or []
            pos = p.get("chain_pos", 0)
            out.append({
                **p,
                "stale": p.get("policy_hash") != self.policy_hash,
                "expired": p.get("expires_at", float("inf")) <= now,
                "required_role": chain[pos] if pos < len(chain) else "human",
                "chain_step": f"{pos + 1}/{len(chain)}" if chain else None,
                # FIX-69 PC-1/PC-3.1 (#472): оператор видит, кто уже
                # подписал шаги и какой хэш содержимого одобряется —
                # до исполнения, не post-hoc.
                "signed_by": [str(s.get("by"))
                              for s in p.get("approved_by_steps") or []],
                "payload_hash": p.get("payload_hash"),
            })
        return out

    def audit_records(
        self,
        outcome: Optional[str] = None,
        agent: Optional[str] = None,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        if limit < 1:
            limit = 1
        if limit > MAX_AUDIT_READ:
            limit = MAX_AUDIT_READ
        with self._audit_lock:
            recs = list(self._audit)
        if outcome:
            recs = [r for r in recs if r["outcome"] == outcome]
        if agent:
            recs = [r for r in recs if r["agent"] == agent]
        return recs[-limit:]

    def audit_export(
        self,
        from_ts: Optional[float] = None,
        to_ts: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Верифицируемый экспорт журнала: записи (с prev/content хэшами)
        + отчёт verify над всей цепочкой — сторонний проверяющий может
        пересчитать цепочку по entries."""
        with self._audit_lock:
            snapshot = list(self._audit)
        entries = [
            r for r in snapshot
            if (from_ts is None or r.get("ts", 0) >= from_ts)
            and (to_ts is None or r.get("ts", 0) <= to_ts)
        ]
        return {
            "format": "aegis-audit-export/1",
            "exported_at": time.time(),
            "policy_hash": self.policy_hash,
            "count": len(entries),
            "verify": self.audit_chain_verify(),
            "entries": entries,
        }


def default_policy() -> Policy:
    """Политика NEXUS по умолчанию — deny-by-default для внешних действий.

    Классы: send/keys/run — исполнение (sensitive); payouts — финансы
    (лимит + человек на больших суммах).
    """
    return Policy(
        version="1.0.0",
        default_outcome="deny",
        operation_permissions={
            "payout": ["treasury"],
            "exec": ["orchestrator"],
        },
        # server-side чувствительность: только этот список — observe-класс,
        # всё остальное sensitive (клиентский флаг не учитывается)
        operation_class={
            "observe": OP_CLASS_OBSERVE,
            "status": OP_CLASS_OBSERVE,
            "tail": OP_CLASS_OBSERVE,
            "read": OP_CLASS_OBSERVE,
            "list": OP_CLASS_OBSERVE,
        },
        rules=[
            PolicyRule(
                id="N-001",
                description="payout свыше лимита — отказ",
                operation="payout",
                condition=PolicyCondition(
                    COND_AMOUNT_LIMIT, payload_field="amount", max_amount=50_000
                ),
                outcome="deny",
                priority=100,
            ),
            PolicyRule(
                id="N-002",
                description="payout 10k–50k — одобрение человеком",
                operation="payout",
                condition=PolicyCondition(
                    COND_AMOUNT_LIMIT, payload_field="amount", max_amount=10_000
                ),
                outcome="escalate",
                priority=90,
            ),
            PolicyRule(
                id="N-003",
                description="финансовые операции — только treasury-агент",
                operation="payout",
                condition=PolicyCondition(COND_AGENT_PERMISSION),
                outcome="deny",
                priority=200,
            ),
            PolicyRule(
                id="N-004",
                description="внешняя команда — только оркестратор",
                operation="exec",
                condition=PolicyCondition(COND_AGENT_PERMISSION),
                outcome="deny",
                priority=200,
            ),
            PolicyRule(
                id="N-005",
                description="статус/чтение — всегда разрешено",
                operation="observe",
                condition=PolicyCondition(COND_ALWAYS),
                outcome="permit",
                priority=10,
            ),
            PolicyRule(
                id="N-006",
                description="payout в пределах лимита — permit (после проверки прав)",
                operation="payout",
                condition=PolicyCondition(COND_ALWAYS),
                outcome="permit",
                priority=5,
            ),
            # #468 gate coverage: mutating-эндпоинты core идут через gate —
            # permit-правила сохраняют прежнее поведение, но добавляют
            # аудит-записи, panic-заморозку и точку для будущих
            # rate/escalate-ограничений через policy update (без кода).
            PolicyRule(
                id="N-007",
                description="core machine mutations — permit (token-gated, gate-аудит)",
                operation="core.machine_mutation",
                condition=PolicyCondition(COND_ALWAYS),
                outcome="permit",
                priority=5,
            ),
            PolicyRule(
                id="N-008",
                description="aegis policy_update — permit (admin-gated, gate-аудит)",
                operation="aegis.policy_update",
                condition=PolicyCondition(COND_ALWAYS),
                outcome="permit",
                priority=5,
            ),
            PolicyRule(
                id="N-009",
                description="aegis ratings_score — permit (admin-gated, gate-аудит)",
                operation="aegis.ratings_score",
                condition=PolicyCondition(COND_ALWAYS),
                outcome="permit",
                priority=5,
            ),
            PolicyRule(
                id="N-010",
                description="core exec — permit (token-gated, gate-аудит; argv в payload_hash)",
                operation="core.exec",
                condition=PolicyCondition(COND_ALWAYS),
                outcome="permit",
                priority=5,
            ),
            # #469b: остаток mutating-поверхности — terminal/file/doc.
            # Чувствительный контент (file content, terminal text, doc
            # body, template args) в payload НЕ кладётся — api.py шлёт
            # *_sha хэши, аудит остаётся компактным и без секретов.
            PolicyRule(
                id="N-011",
                description="core terminal mutations — permit (token-gated, gate-аудит)",
                operation="core.terminal_mutation",
                condition=PolicyCondition(COND_ALWAYS),
                outcome="permit",
                priority=5,
            ),
            PolicyRule(
                id="N-012",
                description="core file mutations — permit (token-gated, gate-аудит; content→sha)",
                operation="core.file_mutation",
                condition=PolicyCondition(COND_ALWAYS),
                outcome="permit",
                priority=5,
            ),
            PolicyRule(
                id="N-013",
                description="core doc/template mutations — permit (token-gated, gate-аудит)",
                operation="core.doc_mutation",
                condition=PolicyCondition(COND_ALWAYS),
                outcome="permit",
                priority=5,
            ),
            PolicyRule(
                id="N-014",
                description="core template run — permit (token-gated, gate-аудит; args→sha)",
                operation="core.template_mutation",
                condition=PolicyCondition(COND_ALWAYS),
                outcome="permit",
                priority=5,
            ),
        ],
    )


__all__ = [
    "COND_ALWAYS",
    "COND_AMOUNT_LIMIT",
    "COND_ALLOWLIST",
    "COND_BUDGET_THRESHOLD",
    "COND_AGENT_PERMISSION",
    "COND_COMPOUND",
    "COND_RATE_LIMIT",
    "RATE_SCOPES",
    "KNOWN_COND_TYPES",
    "COND_AMOUNT_WINDOW",
    "COMPOUND_OPERATORS",
    "APPROVAL_TTL_S",
    "MAX_PENDING",
    "MAX_RATE_KEYS",
    "MAX_AUDIT_READ",
    "OP_CLASS_SENSITIVE",
    "OP_CLASS_OBSERVE",
    "OP_CLASSES",
    "OUTCOMES",
    "PANIC_COOLDOWN_S",
    "MAX_VERDICTS",
    "VERDICT_DENY_RISK",
    "VERDICTS",
    "PolicyCondition",
    "PolicyRule",
    "OperationProposal",
    "Decision",
    "Policy",
    "AegisGuard",
    "default_policy",
]
