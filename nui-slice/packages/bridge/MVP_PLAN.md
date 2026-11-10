# Craft Bridge — remediation plan до MVP /tools/solidcraft

AGENT-B · 2026-10-27 · по findings `CODEX-bridge-vs-contract-20261027.md` (7 gaps)
+ смежные: `CODEX-craft-api-contract-20261027.md` (G1/G2/G3), FORGE-recheck (F3/F4).
Режим: file-only design, no code, no live runs.

## 0 · MVP-нарезка — вердикт по каждому gap

| # | Gap (CODEX) | MVP / post-MVP | Резка |
|---|-------------|----------------|-------|
| 1 | Timeout/pending propagation | **MVP** | целиком — иначе длинные операции показываются как сбой |
| 2 | Два auth-секрета в одном | **MVP** | целиком — решается дизайном G6 (bearer не покидает server) |
| 3 | Loopback не enforced | **MVP** | тривиальный фикс, security |
| 4 | Нет /inspect, /design/new; health-семантика | **MVP** | inspect + design.new + `?upstream=1`; versioned schemas — минимально |
| 5 | Capability-based execute | **частично** | 5a: registry enabled-check — MVP; 5b: per-command schemas/permissions — post-MVP |
| 6 | Монтирование в NEXUS UI | **MVP** | Next same-origin proxy + screen + launcher; CORS отпадает; spawn продукта — post-MVP |
| 7 | Contract conformance | **частично** | 7a: offline endpoint-тесты — MVP; 7b: LIVE_PROBE — release-gate (нужен owner-approve на запуск продукта) |

**Post-MVP (полный список):** 5b (param schemas, permission prompts), engine.batch/engine.script
endpoints + adapter payload-cap (F3 из recheck — станет блокером при batch), process spawn/lifecycle
SolidCraft, LIVE_PROBE прогон, MSIX-aware token path + `current.port` discovery (contract gap 5),
TS-adapter — портировать W23-hardening или deprecate (F4), полный MCP-gateway `craft.*` (design §8–9).

## 1 · MVP: per-gap design

### Gap 1 — timeout → pending flow (не «ошибка», а running)

**Файлы:** `packages/bridge/craft-adapter.mjs`, `packages/bridge/craft-bridge.mjs`, `craft-bridge.test.mjs`.

**Подход:**
- Adapter: `#timeout()` (`adapter:118–120`) отклоняет с typed error —
  `Object.assign(new Error('control call timed out'), {code:'timeout', opId:id, method})`.
  ~6 строк. Bridge получает wire id — сейчас недоступен снаружи.
- Bridge: catch timeout-reject → `controlPending()` на том же соединении (pending
  connection-local, протокол это гарантирует) → ответ `202 {ok:true, running:true,
  operation:{id,method}, poll:'/pending'}`. UI поллит `GET /pending` до `done:true,reply`.
- `#withTimeout` (`bridge:142–153`) остаётся back-stop 65s > adapter 60s: срабатывает только
  если адаптер мёртв. `reply.running`-ветка `#mapControl` (`:159`) — сохранить для прямых
  host-timeout ответов.
- Edge: `controlPending` после settle сам по себе call — обычный 60s deadline, ок.

**~Объём:** adapter +8 строк; bridge +40 строк; тесты +4 кейса (timeout→202, poll до done,
terminal fail ≠ running, busy→429 без poll).

### Gap 2 — разделение секретов

**Файлы:** `craft-bridge.mjs`, launcher (см. Gap 6).

**Подход:** `#bearerToken` (только `CRAFT_BRIDGE_TOKEN`, генерится launcher'ом per-run)
и upstream token (только `tokenPathFor(controlPort)`) — два независимых источника
(`bridge:52–75` сейчас сводит к одной строке). Guard: `safeEqual(bearer, upstream)` →
refuse to start (совпадение = misconfig). При Gap 6-прокси bearer вообще не покидает
server-side — browser видит только same-origin `/api/craft/*`.

**~Объём:** +25 строк bridge, +генерация токена в launcher (~10).

### Gap 3 — enforced loopback

**Файлы:** `craft-bridge.mjs` (`:17,48,80–82`).

**Подход:** `start(port)` — убрать `host`-параметр, bind жёстко на `127.0.0.1`.
Remote — только через явный `CRAFT_BRIDGE_ALLOW_REMOTE=1` + предупреждение в лог
(без значения токена). Adapter `connect(port, host)` оставить как есть — клиентская
сторона, loopback-дефолт достаточен.

**~Объём:** ~10 строк.

### Gap 4 — endpoints

**Файлы:** `craft-bridge.mjs`, `craft-adapter.mjs`.

**Подход:**
- `GET /inspect` → `adapter.uiInspect()` → общий mapper. ~10 строк bridge.
- `POST /design/new` → adapter wrapper `designNew()` → `call('ui.documents',
  {action:'new'})` (~6 строк adapter) → bridge route ~15 строк. Контракт: возвращаем
  documents/tabs-state как есть; designId не фабрикуем — UI берёт активный tab.
- `/health`: liveness как сейчас + `GET /health?upstream=1` → дешёвый
  `controlRunning()` → `{ok:true, upstream:'ok'|'down'}`. ~15 строк.

**~Объём:** adapter +8; bridge +40; тесты +3 кейса.

### Gap 5a — registry enabled-check (MVP-срез)

**Файлы:** `craft-bridge.mjs`.

**Подход:** ленивый кэш `engine.commands` (TTL 30 s, инвалид. при reconnect):
перед `/execute` — команда должна существовать в реестре и `enabled:true`,
иначе `400 unknown_command` / `403 command_not_enabled`. Существующие
`ALLOW_PREFIXES`+`DENY_RE` (`:23–24,164–168`) сохранить как первую границу.
Кэш-miss → один fetch реестра, ошибка реестра → fail-closed 502.

**~Объём:** +55 строк; тесты +3 кейса. **5b post-MVP:** per-command param schema
(из registry `params` doc — shape не подтверждён live → ждёт 7b) и permission model.

### Gap 6 — монтирование в NEXUS

**Файлы:**
- `apps/nexus/src/app/api/craft/[...path]/route.ts` — server-side proxy: читает
  `CRAFT_BRIDGE_URL`+`CRAFT_BRIDGE_TOKEN` из server env, проксирует к bridge,
  добавляет Bearer сам. Браузер → same-origin fetch без креденшелов; CORS не нужен.
  ⚠ Per `apps/nexus/AGENTS.md`: перед кодом route читать `node_modules/next/dist/docs/`
  — route-handler API этой версии Next отличается.
- `packages/bridge/craft-bridge-server.mjs` — launcher: resolve controlPort
  (`current.port` файл → SOLIDCRAFT_CONTROL_DIR → arg/env `CRAFT_CONTROL_PORT`),
  генерит bearer → env для Next, `new CraftBridge({...}).start(PORT)`. ~60 строк;
  закрывает и кусок contract gap 5 (current.port discovery).
- `apps/nexus/src/integrations/craft/seam.ts` — typed browser client по образцу
  `integrations/opencode/seam.ts` (`baseUrl=''` same-origin, honest errors). ~120 строк.
- `apps/nexus/src/app/craft/page.tsx` → `src/product/screens/nexus-craft.tsx` — экран:
  status-chip (health?upstream), command list из /commands, run-form, poll /pending
  по `operation` из Gap 1. ~180 строк + тест по образцу `*.test.tsx` рядом.
- Lifecycle: bridge — отдельный node-процесс (process boundary per design §2);
  MVP — запуск launcher'ом вручную/скриптом; спавн solidcraft.exe — post-MVP.

**~Объём:** route ~80; launcher ~60; seam ~120; screen ~180 (+test ~120).

### Gap 7a — offline conformance

**Файлы:** `craft-bridge.mjs` (DI-seam ~10 строк: `new CraftBridge({adapter})`),
`craft-bridge.test.mjs`.

**Подход:** инжектим fake adapter → тесты HTTP-поверхности без сети к продукту:
401/413/400/403/404, mapper-ветки (ok/running/busy/error), 202-flow, traversal.
**7b post-MVP gate:** прогон `live-probe.mjs` по LIVE_PROBE.md с verbatim-записью
в раздел «Факт» — требует одобренного запуска solidcraft.exe.

**~Объём:** bridge DI +10; тесты ~150.

## 2 · Adapter-фиксы, закрываемые вместе с MVP (мелкие, из contract-отчёта)

| ID | Что | Где | ~Строк |
|----|-----|-----|--------|
| G1 | unauthorized-reply без `id` → `#failProtocol`, теряется деталь | `adapter:83–92` — принимать frame с `ok:false` и без id как auth-fail до auth | ~12 |
| G3 | `#authed` не сбрасывается в `connect()` → reconnect без токена | `adapter:49–62` — `this.#authed = false` при connect | ~2 |
| — | error typed `code` для нормализации в bridge | `adapter:118–120,180–184` | ~8 |

## 3 · Порядок работ MVP

1. Adapter: G3, G1, timeout typed-error (Gap 1 dep) — мелкие, независимы.
2. Bridge: Gap 3 → Gap 2 → Gap 4 → Gap 5a → Gap 1 — инкрементально, тесты 7a параллельно.
3. Launcher + Next route + seam (Gap 6) — после стабилизации bridge API.
4. Screen — последним; honest-unavailable до поднятого bridge.
5. Release-gate: LIVE_PROBE (7b) — перед объявлением /tools/solidcraft done.

**Суммарно MVP:** ~700 строк кода + ~300 строк тестов, без новых зависимостей
(node:http/node:net уже в использовании; Next route — существующий app-router).
