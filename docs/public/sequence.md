# Sequence: handoff-документ (A → B → gated-операция → audit)

## Участники

- **Agent A** — первый агент (writer). Пишет версию документа.
- **Agent B** — второй агент (reader). Читает и запрашивает операцию.
- **Core** — локальное ядро `nexus_core` (REST + SSE).
- **Gate** — AEGIS-политика (allow/deny/require_approval/dual_control).
- **Audit** — HMAC-SHA256 JSONL-след (`audit.jsonl`).

## Сценарий (scripted)

```
1. POST /api/core/run {name: "agent-a", command, labels}     → терминал A
   POST /api/core/run {name: "agent-b", command, labels}     → терминал B

2. POST /api/core/doc {content: "v1", base_version: null}     → {version: 1}
   POST /api/core/doc {content: "v2", base_version: 1}        → {version: 2}   (CAS)
   POST /api/core/doc {content: "v3", base_version: 1}        → 409 Conflict   (stale)

3. GET /api/core/doc/latest                                     → {version: 2}
   GET /api/core/doc?version=1                                  → {version: 1}

4. B запрашивает операцию (через gate):
   POST /api/core/kill {term: "prod-db"}                        → 403 deny
   POST /api/core/kill {term: "victim1"}                        → 202 require_approval (dual)
   POST /api/core/doc_put ...                                    → 202 require_approval

5. Approvals:
   GET /api/core/approvals                                        → pending list
   POST /api/core/approvals/{id} {approved: true, by: demo1}    → 1/2
   POST /api/core/approvals/{id} {approved: true, by: demo2}    → executed

6. След:
   SSE /api/core/events                                          → {"type":"policy", ...} и {"type":"doc", ...}
   GET /api/core/audit                                           → gate trail
   GET /api/core/audit/verify                                    → {ok:true, aegis:true, gate_trail:true}
```

## Ключевые гарантии

- **CAS**: `base_version` — оптимистичная блокировка; устаревший base → 409.
- **Deny**: `kill prod-db` отклоняется политикой ещё до мутации.
- **Dual control**: kill требует 2 разных approvals; повторный голос → 409.
- **Audit**: каждая запись имеет HMAC content_hash; `verify` проверяет цепочку.
- **Honest offline**: до старта сервера обращения падают (0/ECONNREFUSED) —
  фейк-данных нет.
