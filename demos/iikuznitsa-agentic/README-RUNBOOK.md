# NEXUS · demos/iikuznitsa-agentic — demo-stand (skeleton, source-work)

Воспроизводимый стенд для заявки **ИИкузница** Softline, трек
`#AgenticInfrastructure` (см. `docs/farm/IIKUZNITSA-APPLICATION-DRAFT.md` §3).

> **Статус:** skeleton под конкретную задачу Партнёра (появится после допуска).
> Делается модульно: сценарий зашит в `demo_stand.py`, README описывает
> команды и ожидаемый вывод. Не деплой, не коммит в master без отчёта.

---

## Что это

Узкий end-to-end сценарий на существующих API `tools/nexus_core` (ничего
не додумано, никакие роуты не добавлялись):

```
agent A → handoff-doc версия N → agent B читает ту же версию N
        → B запрашивает gated Core-операцию
        → deny / require_approval → approval → результат
след: SSE-событие `policy` + GateAuditTrail (HMAC-SHA256 JSONL) + verify endpoint
offline: честный пустой state (до старта сервера / после остановки)
```

Границы (не заявляем):
- SSE — live/recent события (in-memory history ≤1000), не долговременный audit;
- audit — только покрытые gate-решения, не каждая операция системы;
- политика читается hot из `base/gate-policy.json` (первый match wins).

---

## Файлы

| Файл | Что это |
|---|---|
| `demo_stand.py` | Автономный сценарий-тест (Python 3.10+, stdlib only). **Входная точка.** Режимы: scripted (default) / agentic (`--agentic`) |
| `README-RUNBOOK.md` | Этот документ. |
| `_state/` | Runtime-база core (создаётся, удаляется в конце прогона). `core.log`, `audit.jsonl`, `gate-policy.json` создаются здесь при запуске. |

## Как запустить
### Требования
- Python 3.10+ (проверено на 3.15).
- `tools/nexus_core/api.py` из корня репозитория (PYTHONPATH=ROOT).
- Порт `5801` свободен (по умолчанию; `--port` меняет).
- Только для `--agentic`: NexusLink на `127.0.0.1:5679` и `~/.nexuslink/config.json` с `incoming_token`.

## Режимы: scripted (deterministic, default) vs agentic (LLM)

Стенд имеет **два режима** одного и того же сценария:

| Режим | Флаг | agent A / agent B | Когда использовать |
|---|---|---|
| **scripted** | (нет, по умолчанию) | фиксированные строки/запросы в коде | offline, без LLM, быстрый прогон; fallback |
| **agentic** | `--agentic` | **реальные LLM-агенты** через NexusLink (`/v1/messages`): модель сама выбирает поля handoff-документа и формирует запрос на gated-операцию | демо «реальной агентности» |

В обоих режимах **gate/approvals/audit/SSE — один и тот же живой путь**
(тот же core, те же API, та же политика). Отличается только источник
решений A/B: хардкод или LLM.

### agentic: требования и конфигурация

- NexusLink запущен и слушает `127.0.0.1:5679` (по умолчанию; порт из
  `config.json`).
- `~/.nexuslink/config.json` содержит `incoming_token` (путь можно
  переопределить через `--agentic-config`).
- Модель — слот NexusLink (по умолчанию `claude-sonnet-5`, т.е. класс
  sonnet). **Честно:** во время проверки слот sonnet был недоступен
  (все провайдеры blacklisted/cooling down); прогон выполнен на
  `--agentic-model claude-haiku-4-5` — такой же LLM-путь, другой слот.
  Если слот не сработает, стенд падает в scripted-режим с сообщением.

```bash
# agentic (LLM-агенты), модель по умолчанию sonnet:
python demos/iikuznitsa-agentic/demo_stand.py --agentic
# agentic с конкретным слотом:
python demos/iikuznitsa-agentic/demo_stand.py --agentic --agentic-model claude-haiku-4-5
# agentic с другим конфигом:
python demos/iikuznitsa-agentic/demo_stand.py --agentic --agentic-config D:\path\config.json
```

### Ожидаемый вывод (кратко)
```
RESULT: 32/32 PASS, 0 FAIL
STAND: PASS
```
Каждый шаг печатает `[PASS]`/`[FAIL]` с пояснением. Скрипт возвращает
`0` при полном проходе, `1` при любом FAIL. В шапке печатается режим:
`mode: scripted` или `mode: agentic (LLM <slot> via NexusLink)`. В
agentic-режиме метки шагов содержат `[agentic(LLM …)]`.

## Сценарий по шагам (что происходит внутри)

| SCENE | Что показывается | Ключевые API |
|---|---|---|
| 0 | **Offline/empty**: до старта core обращения не проходят (0); после остановки — тоже. Фейк-данных нет. | (нет) |
| 1 | **Два агента**: терминалы `agent-a`(writer), `agent-b`(reader) лив в `/terminals`. | `POST /api/core/run`, `GET /api/core/terminals` |
| 2 | **Handoff-doc**: A пишет v1, v2 (CAS). В agentic содержимое и поля документа генерирует реальный LLM (агент A сам выбирает структуру). B читает latest=v2 и точную v1; запись по устаревшему `base_version` → 409. | `POST /api/core/doc`, `GET /api/core/doc/latest`, `GET /api/core/doc?version=N` |
| 3 | **Gated op**: политика — deny `kill prod-db`; require_approval `doc_put` (1 approver) и `kill` (dual-control, 2 разных approver). В agentic запрос формирует реальный LLM (агент B). deny→403, require→202, approve→executed; повторный голос того же principal→409. | `POST /api/core/kill`, `GET /api/core/approvals`, `POST /api/core/approvals/{id}` (+ `X-AEGIS-Key`) |
| 4 | **След**: SSE-события `policy`/`doc`; audit-trail с deny/allow/approval_*; `verify` ok=True; `audit.jsonl` на диске. | `GET /api/core/events`, `GET /api/core/audit`, `GET /api/core/audit/verify` |
| 5 | **Offline после остановки**: core убит → обращения снова 0. | (нет) |

## Политика gate (что находится в `base/gate-policy.json`, hot-read)

```json
[
  {"match": {"action": "kill", "subject": "prod-db"}, "decision": "deny"},
  {"match": {"action": "doc_put"}, "decision": "require_approval"},
  {"match": {"action": "kill"}, "decision": "require_approval", "dual_control": true}
]
```

- `deny` → 403, мутация не исполняется.
- `require_approval` → 202 `{approval_id, status:"pending"}`; запрос
  откладывается на `CORE_APPROVAL_TTL_S` (env `NEXUS_APPROVAL_TTL_S`, по
  умолчанию 600 c).
- `dual_control` (или опасные встроенные action: kill/group-kill/… ) → нужны
  **два разных** approver'а (`required_approvals=2`); повторный голос от
  того же principal → 409.
- Admission: `AEGIS_ADMIN_KEYS` (JSON `{"<token>": {"name", "roles"}}`),
  заголовок `X-AEGIS-Key`. Env `AEGIS_ALLOW_UNATTESTED=1` выставляется
  стендом (dev-opt-out), но путь `/api/core/proposals` сценарием **не
  используется** — прогон идёт через обычные мутации `/api/core/*`,
  которые не требуют attestation.

## Аудит и проверяемость

- `base/audit.jsonl` — append-only JSONL, каждая строка:
  `{v:1, seq, ts, action, subject, decision, detail, prev_hash, hash}`.
  `hash` = HMAC-SHA256 канонического JSON **без** поля `hash`; ключ
  `audit.key` (mode 0600). Цепочка переживает рестарт.
- `GET /api/core/audit/verify` → `{ok:true, ...}` — проверяет и AEGIS
  hash-chain, и gate_trail.
- SSE: `GET /api/core/events` — `event: policy` / `event: doc` (и др.);
  `data` содержит `outcome`, `rule_id`, `policy_hash`, `payload_hash`,
  `content_hash`, `seq` (последние 1000, replay через `Last-Event-ID`).
  Стенд строго требует `content_hash` у **каждого** policy-события
  (отсутствие поля = FAIL).

## Reset / повторный прогон

```bash
# чистое состояние — удалить базу (скрипт делает это сам при `--keep-state`-отсутствии)
rm -rf demos/iikuznitsa-agentic/_state
python demos/iikuznitsa-agentic/demo_stand.py
```

Скрипт сам убивает поднятый core в конце (SCENE-5) и удаляет `_state/`
(если не `--keep-state`). Если что-то осталось висеть:

```bash
netstat -ano | grep ":5801" | grep LISTEN   # найти PID
taskkill //F //PID <PID> //T
```

## Fallback: скринкаст-чеклист (на случай сетевого сбоя)

Если live-демо невозможно (нет сети / прокси недоступен), пройти по записи:

1. [ ] Открыть терминал в корне репозитория.
2. [ ] `python demos/iikuznitsa-agentic/demo_stand.py` — показать вывод:
       `32/32 PASS`.
3. [ ] Поднять core вручную и показать ключевые API по шагам:
       ```
       python tools/nexus_core/api.py --port 5801 --base demos/iikuznitsa-agentic/_state_manual
       curl http://127.0.0.1:5801/api/core/server
       ```
4. [ ] Показать `doc` v1→v2 (A→B) и CAS-409.
5. [ ] Показать `kill prod-db` → 403 (deny).
6. [ ] Показать `doc_put` → 202, `approvals` → approve(demo1) → executed.
7. [ ] Показать `kill victim1` → 202 dual, demo1→1/2, demo2→executed, victim exited.
8. [ ] Показать `audit` (entries c deny/allow/approval_*) и `audit/verify` → ok=true.
9. [ ] Показать `events` (SSE): `event: policy` + `event: doc`.
10. [ ] Убить core, показать честный offline (соединение не проходит).
11. [ ] (Необязательно) показать `_state_manual/audit.jsonl` — HMAC-цепочку.

## Ограничения / не заявлять

- Не является judge-ready демонстрацией, пока не прогнан на фиксированной
  версии (этот репозиторий).
- SSE — оперативная лента (память), не долговременный audit.
- Audit покрывает gate-решения, не каждую операцию.
- Нет фейк-данных: offline/empty == пусто.
- Порт/адрес и env `AEGIS_ADMIN_KEYS` — только для демо; в проде
  секреты вне репозитория.
- `--agentic` зависит от живого NexusLink (`127.0.0.1:5679`) и доступности
  провайдеров: при недоступности LLM стенд честно падает в scripted-режим
  (fallback), а не молча пропускает проверки.
- Слот по умолчанию `claude-sonnet-5` (класс sonnet) может быть недоступен
  (blacklisted/cooling down) — выбирается параметром `--agentic-model`;
  прогон проверен на `claude-haiku-4-5`.
- Agentic-недетерминизм: LLM сама выбирает структуру handoff-документа и
  форму запроса, поэтому содержимое может отличаться между прогонами;
  проверки в этом режиме структурные (non-empty), не побайтовые.
- agentic — демо «реальной агентности» (два LLM-агента через реальный
  doc API + gated-операция), не судья-ready оценка качества модели.
