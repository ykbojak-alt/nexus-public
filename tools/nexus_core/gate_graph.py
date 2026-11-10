#!/usr/bin/env python3
"""
tools/nexus_core/gate_graph.py — явная машина состояний policy-gate (AO-1c).

Паттерн NVIDIA/auto-ontology `text_to_sql_graph.py`, адаптированный под
NEXUS без langgraph: декларативные узлы + чистые роутеры `state -> node` +
`node_start`-анонсы ДО начала работы узла (клиент видит текущий шаг, а не
предыдущий — app.stream() отдаёт update только по завершении).

Отличие от text_to_sql: gate-run **возобновляемый** — escalate паркует run
в pending (AEGIS `_pending` / auctioneer `pending_gate`), следующий
approve()/decide() продолжает с `_resume_from`, а не с entry. Это тот же
приём, что `_entry_router` + `_resume_from` в референсе.

Использование:
    graph = GateGraph()
    graph.add_node("propose", propose_fn)
    graph.add_conditional_edges("propose", route_decision,
                                {"permit": "execute", "escalate": "await_approval"})
    graph.set_resume("await_approval")   # suspend/resume точка
    runner = GateRunner(graph, sink=events.channel.publish)
    runner.run(state)                    # синхронный прогон до suspend/END

SSE-контракт (через существующий event_sink → /api/core/events):
    event: node_start
    data: {"type":"node_start","graph":"gate","node":"propose",
           "run_id":"...", "op":"hivebid.release",
           "approval_id":"...", "ts": ...}
Имена узлов — только [a-zA-Z0-9_-] (HERETIC #456: точка в имени
вырезается санитайзером events.py). AEGIS-сторона эмитит тот же
контракт с префиксом aegis_* (aegis_evaluate/aegis_decide/...).
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)

# Тег события — зеркалит NODE_START_EVENT референса; events.py санитизирует
# etype, "node_start" проходит фильтр [a-zA-Z0-9_-].
NODE_START_EVENT = "node_start"
NODE_DONE_EVENT = "node_done"

# Человекочитаемые метки для UI (аналог NODE_LABELS референса).
NODE_LABELS: Dict[str, str] = {
    "build_intent": "Сборка payout-intent",
    "propose": "AEGIS evaluate",
    "await_approval": "Ожидание approve()",
    "approve_step": "Шаг escalation-цепочки",
    "execute": "Исполнение permit",
    "denied": "Отказано",
    "done": "Завершено",
}

END = "__end__"
SUSPEND = "__suspend__"   # run паркуется: вернётся через resume_from


@dataclass
class GateRun:
    """Состояние одного прогона gate-графа (serializable — живёт в
    auctioneer state.pending_gate / AEGIS pending между запросами)."""
    run_id: str
    op: str = ""
    node: str = ""
    resume_from: Optional[str] = None
    decision: str = ""                # permit | deny | escalate | ""
    approval_id: Optional[str] = None
    intent_valid: bool = True         # False → GateDenied ДО propose (HERETIC edge-case)
    deny_reason: str = ""             # expired | stale_policy | drift | policy | ...
    payload: Dict[str, Any] = field(default_factory=dict)
    path_state: Dict[str, Any] = field(default_factory=dict)
    result: Any = None
    suspended: bool = False   # run паркуется в await_approval до approve()


class GateGraph:
    """Декларативный граф: nodes + edge-map'ы + suspend/resume."""

    def __init__(self) -> None:
        self.nodes: Dict[str, Callable[[GateRun], Any]] = {}
        self.edges: Dict[str, Dict[str, str]] = {}
        # node -> router fn (state -> key в edge-map)
        self.routers: Dict[str, Callable[[GateRun], str]] = {}
        self.entry: Optional[str] = None
        self.resume_node: Optional[str] = None
        self.labels = dict(NODE_LABELS)

    def add_node(self, name: str, fn: Callable[[GateRun], Any]) -> None:
        self.nodes[name] = fn

    def set_entry(self, name: str) -> None:
        self.entry = name

    def set_resume(self, name: str) -> None:
        """Узел, на который заходит run после suspend (approve-коллбек)."""
        self.resume_node = name

    def add_edge(self, frm: str, to: str) -> None:
        self.edges.setdefault(frm, {})["*"] = to

    def add_conditional_edges(
        self, frm: str, router: Callable[[GateRun], str],
        edge_map: Dict[str, str],
    ) -> None:
        self.routers[frm] = router
        self.edges[frm] = dict(edge_map)


class GateRunner:
    """Исполнитель: run(state) до END/SUSPEND; node_start до работы узла."""

    def __init__(self, graph: GateGraph,
                 sink: Optional[Callable[[Dict[str, Any]], None]] = None,
                 max_steps: int = 64) -> None:
        self.graph = graph
        self.sink = sink
        self.max_steps = max_steps

    # ---- анонсы (best-effort, как announce_node_start референса) ----
    def _emit(self, event_type: str, run: GateRun, **extra) -> None:
        if self.sink is None:
            return
        try:
            ev = {"type": event_type, "graph": "gate",
                  "node": run.node or run.resume_from,
                  "run_id": run.run_id, "op": run.op, "ts": time.time()}
            if run.approval_id:
                ev["approval_id"] = run.approval_id
            ev.update(extra)
            self.sink(ev)
        except Exception:  # прогресс не должен ронять run
            logger.debug("node event sink failed", exc_info=True)

    def announce_node_start(self, run: GateRun) -> None:
        self._emit(NODE_START_EVENT, run)

    def announce_node_done(self, run: GateRun, **extra) -> None:
        self._emit(NODE_DONE_EVENT, run, **extra)

    # ---- исполнение ----
    def run(self, run: GateRun) -> GateRun:
        """Прогон до терминала. Возвращает run: node==END/SUSPEND — финал."""
        g = self.graph
        run.suspended = False
        node = run.resume_from or g.entry
        steps = 0
        while node not in (END, SUSPEND, None) and steps < self.max_steps:
            steps += 1
            if node not in g.nodes:
                raise KeyError(f"gate graph: unknown node {node!r}")
            run.node = node
            # node_start — ДО работы узла (весь смысл паттерна)
            self.announce_node_start(run)
            g.nodes[node](run)
            self.announce_node_done(run, decision=run.decision or None)
            run.resume_from = None
            node = self._route(run, node)
        if node == SUSPEND:
            run.suspended = True
        elif steps >= self.max_steps:
            raise RuntimeError("gate graph: step cap exceeded")
        return run

    def _route(self, run: GateRun, node: str) -> Optional[str]:
        router = self.gate_routers_get(node)
        if router is None:
            # без роутера — единственный edge "*" или END
            emap = self.graph.edges.get(node, {})
            return emap.get("*") or END
        key = router(run)
        emap = self.graph.edges.get(node, {})
        if key not in emap:
            raise KeyError(
                f"gate graph: node {node!r} router → {key!r} "
                f"not in edge-map {sorted(emap)}")
        return emap[key]

    def gate_routers_get(self, node: str):
        return self.graph.routers.get(node)


# ----------------------------------------------------------------------
# Канонический gate-граф для payout-операций (release/award).
# Фаза 1 дизайна: узлы — точки интеграции, fn'ы подключает caller.
# ----------------------------------------------------------------------

def route_intent_validity(run: GateRun) -> str:
    """Pre-gate router: невалидный intent (award_id None / amount=0 /
    пустой payout-список) → denied ДО propose — edge-case HERETIC'а
    «no-award/amount=0 → GateDenied before propose»."""
    return "valid" if run.intent_valid else "invalid"


def route_gate_decision(run: GateRun) -> str:
    """Роутер по решению AEGIS — аналог route_sql_validation референса.

    Чистая функция state -> ключ edge-map; raise на неизвестном decision —
    как LangGraph падает на ключе вне карты.
    """
    d = run.decision
    if d == "permit":
        return "permit"
    if d == "deny":
        return "deny"
    if d == "escalate":
        return "escalate"
    return "invalid"   # пустой/неизвестный decision — отдельный edge


def build_payout_graph(node_impls: Dict[str, Callable[[GateRun], Any]],
                       resume_node: str = "approve_step") -> GateGraph:
    """Собирает payout gate-граф из готовых node-реализаций.

    node_impls — {"build_intent": fn, "propose": fn, "execute": fn,
                  "approve_step": fn, "register_pending": fn}; терминальные
      denied/done — встроенные no-op'ы.
    Edge-map (зеркало decide→permit/deny/escalate AEGIS + HERETIC
    docs/AEGIS_GATE_TRANSITIONS.md):
      build_intent → valid→propose | invalid→denied   (GateDenied до propose)
      propose      → permit→execute | deny→denied | escalate→await_approval
      await_approval→(suspend; resume → approve_step)   [ESCALATE/CHAIN_PENDING]
      approve_step → permit→execute | deny→denied | escalate→await_approval
                     (intermediate approve → REQUEUE: chain_pending в path_state)
      execute      → done                               [RELEASE + drift-check]
    deny_reason в run фиксирует причину: expired | stale_policy | drift | policy.
    """
    g = GateGraph()
    for name, fn in node_impls.items():
        g.add_node(name, fn)
    # await_approval — no-op узел: suspend обеспечивает edge-map → SUSPEND
    g.add_node("await_approval", lambda run: None)
    g.add_node("denied", lambda run: None)
    g.add_node("done", lambda run: None)

    g.set_entry("build_intent")
    g.set_resume(resume_node)

    g.add_conditional_edges("build_intent", route_intent_validity, {
        "valid": "propose", "invalid": "denied"})
    g.add_conditional_edges("propose", route_gate_decision, {
        "permit": "execute", "deny": "denied", "escalate": "await_approval",
        "invalid": "denied"})
    # await_approval — suspend: runner._route не вызывается для SUSPEND
    g.edges["await_approval"] = {"*": SUSPEND}
    g.add_conditional_edges(resume_node, route_gate_decision, {
        "permit": "execute", "deny": "denied", "escalate": "await_approval",
        "invalid": "denied"})
    g.add_edge("execute", "done")
    return g
