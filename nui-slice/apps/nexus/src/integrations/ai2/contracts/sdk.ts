/**
 * Wave XIV — подтверждения инструментов SDK-канала
 * (docs/product/sdk-confirm-contract.md, draft 0.2).
 *
 * Маршруты за флагом AI2_SDK_ENABLED: без него хост честно отвечает 503
 * с причиной — seam есть, данные не выдумываются.
 *
 * GET /v1/sdk/runs/{id}/confirmations → открытые карточки (awaiting +
 * deferred), решённые из списка уходят. Поля на проводе camelCase,
 * verbatim от SDK-контекста (input — параметры вызова, UI маскирует).
 * `requestedAt` — epoch-секунды хоста; таймаут карточки
 * (AI2_SDK_CONFIRM_TIMEOUT_S, умолч. 300 с) на проводе не отдаётся.
 *
 * POST /v1/sdk/runs/{id}/confirmations/{callId} {decision, reason?}:
 * allow/deny → {resolved:true}; defer → {resolved:false,state:'deferred'},
 * решение принимается позже тем же POST (идемпотентно), таймаут не
 * отменяется. 404 — ожидания нет/уже решено; 422 — decision вне enum.
 */
export type SdkConfirmationState = 'awaiting' | 'deferred' | (string & {});
export type SdkConfirmDecision = 'allow' | 'deny' | 'defer';

export interface SdkConfirmation {
  callId: string;
  /** Имя инструмента verbatim (Bash, Write, rewind, …); null — хост не отдал. */
  tool: string | null;
  /** Параметры вызова verbatim — маскируются в UI, никогда не правятся. */
  input: unknown;
  /** parent_tool_use_id контекста SDK — вложенный вызов субагента. */
  parentCallId: string | null;
  state: SdkConfirmationState;
  /** epoch-секунды хоста; null — хост не отдал. */
  requestedAt: number | null;
}

export interface SdkConfirmResult {
  resolved: boolean;
  /** 'deferred' на defer-ответе; иначе отсутствует. */
  state?: string | null;
}

/** GET /v1/sdk/audit — verbatim journal row. Nullable evidence stays null. */
export interface SdkAuditEntry {
  id: string;
  ts: number | null;
  actor: string | null;
  runId: string | null;
  callId: string | null;
  tool: string | null;
  decision: string;
  reason: string | null;
  initiator: string | null;
  source: string | null;
  sha256: string | null;
}

export interface SdkAuditPage {
  entries: SdkAuditEntry[];
  total: number | null;
  limit: number | null;
  offset: number | null;
}

/* ------------------------------------------------------------------ */
/* Сессии агента SDK — docs/product/sdk-sessions-contract.md (draft).   */
/* ------------------------------------------------------------------ */

/** Родительская точка ветвления (verbatim от хоста). */
export interface SdkSessionParent {
  sessionId: string;
  atMessage: string;
}

/**
 * GET /v1/sdk/sessions → Session-контракт (kind:'sdk' — сессия Claude Code,
 * не окно шины Devin). Все поля verbatim: messageCount/lastActivityAt —
 * null, когда SDK их не отдал (не 0 и не выдуманные).
 */
export interface SdkSession {
  id: string;
  window: string;
  kind: string;
  title: string | null;
  /** 'busy' | 'idle' verbatim — неизвестное значение показываем как есть. */
  status: string;
  /** last_modified SDK в миллисекундах; null — SDK не отдал. */
  lastActivityAt: number | null;
  /** null — SDK счётчик сообщений не отдаёт (честный «—», не 0). */
  messageCount: number | null;
  parent: SdkSessionParent | null;
  archived: boolean;
}

/** PATCH /v1/sdk/sessions/{id} — хотя бы одно поле обязательно (иначе 422). */
export interface SdkSessionPatch {
  title?: string;
  archived?: boolean;
}

/**
 * POST /v1/sdk/sessions/{id}/fork → 201: запись ветки. state —
 * pending|linked|failed verbatim; childSessionId — null, пока SDK не
 * прислал session_id дочерней сессии (при linked появляется в списке).
 */
export interface SdkForkResult {
  id: string;
  parentSessionId: string;
  atMessage: string | null;
  key: string | null;
  childSessionId: string | null;
  state: 'pending' | 'linked' | 'failed' | (string & {});
}

/** POST /v1/sdk/runs — запуск; resume продолжает ленту сессии,
 *  fork/forkAt — ветвление (только вместе с resume, иначе 422). */
export interface SdkRunInput {
  task: string;
  resume?: string;
  fork?: boolean;
  forkAt?: string;
  directory?: string;
}

/** Delegation-образный хэндл прогона SDK: {id, to:'claude-sdk', state}. */
export interface SdkRunHandle {
  id: string;
  to: string;
  state: string;
  createdAt: number | null;
}

/* ------------------------------------------------------------------ */
/* Делегации/отмена/хэндофы SDK — sdk-delegations-contract.md (draft).  */
/* ------------------------------------------------------------------ */

/**
 * GET /v1/sdk/delegations[?parent_run_id=] → запись делегации verbatim.
 * state: sent|answered|failed|cancelled — из живых событий прогона,
 * неизвестные значения показываем как пришли (и null — как «—»).
 */
export interface SdkDelegation {
  id: string;
  parentRunId: string | null;
  agent: string | null;
  label: string | null;
  state: string | null;
  createdAt: number | null;
  /** Из ResultMessage или разницы ts событий; null — хост не знает. */
  durationMs: number | null;
  /** subtype финала; null — финала не было. */
  summary: string | null;
  /** Всегда null (файлового свода нет) — поле держим verbatim. */
  summaryPath: string | null;
}

/**
 * Хэндоф между ассистентами (GET/POST /v1/sdk/handoffs[?status=]).
 * status: pending|accepted|declined verbatim; reason/resolvedAt — решение.
 * На проводе поле отправителя — `from` (host), не путать с from_agent
 * входного тела.
 */
export interface SdkHandoff {
  id: string;
  from: string | null;
  to: string;
  prompt: string;
  runId: string | null;
  status: 'pending' | 'accepted' | 'declined' | (string & {});
  reason: string | null;
  createdAt: number | null;
  resolvedAt: number | null;
}

/* ------------------------------------------------------------------ */
/* Правила проекта рабочего каталога — sdk-rules-contract.md (draft).   */
/* ------------------------------------------------------------------ */

/**
 * GET /v1/sdk/rules[?directory=] → метаданные rule-файлов (AGENTS.md,
 * CLAUDE.md, .clinerules, .continue/rules/*, .cursor/rules/*). Только
 * метаданные — содержимое файлов хост не отдаёт и не исполняет.
 */
export interface SdkRule {
  path: string;
  name: string;
  sizeBytes: number | null;
  mtimeMs: number | null;
  /** agents-md|claude-md|clinerules|continue-rules|cursor-rules verbatim. */
  source: string;
}

export interface SdkRulesResult {
  /** Рабочий каталог прогона verbatim; null — хост не отдал. */
  root: string | null;
  rules: SdkRule[];
}

/* ------------------------------------------------------------------ */
/* Сохранённые сценарии и промпты — prompts-contract.md (draft).        */
/* GET /v1/prompts смешивает файлы каталога (source:'file') и            */
/* сохранённые сценарии SDK (source:'saved'). CRUD — за AI2_SDK_ENABLED. */
/* ------------------------------------------------------------------ */

export interface SdkPromptEntry {
  name: string;
  /** Относительный путь в каталоге файлов; null — saved-запись. */
  path: string | null;
  /** id сохранённого сценария; отсутствует у file-записей. */
  id: string | null;
  source: 'file' | 'saved' | (string & {});
  updatedAt: number | null;
}

/** POST/PATCH /v1/prompts → полная запись сценария (body вербатим). */
export interface SdkSavedPrompt {
  id: string;
  title: string;
  body: string;
  createdAt: number | null;
  updatedAt: number | null;
}

/* ------------------------------------------------------------------ */
/* Учёт прогона и чекпоинты отката — sdk-usage-checkpoints-contract.md  */
/* (draft). Отсутствующее у SDK значение приходит null — в UI это        */
/* «нет данных», не ноль.                                                */
/* ------------------------------------------------------------------ */

export interface SdkRunUsage {
  runId: string;
  sessionId: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  totalCostUsd: number | null;
  durationMs: number | null;
  durationApiMs: number | null;
  numTurns: number | null;
  /** Доля заполнения контекста 0..1; null — SDK не отдал. */
  contextFill: number | null;
  /** Разбивка по моделям verbatim; null — нет данных. */
  modelUsage: unknown;
}

export interface SdkCheckpointFile {
  path: string;
  sha256: string | null;
  size: number | null;
  mtime: number | null;
  existed: boolean | null;
  /** 'secrets' — файл секретов, из снапшота исключён (verbatim). */
  excluded?: string;
  /** 'outside-root'|'oversized' — в снапшот не вошёл (verbatim). */
  skipped?: string;
}

export interface SdkCheckpoint {
  id: string;
  runId: string;
  callId: string | null;
  tool: string | null;
  root: string | null;
  createdAt: string | null;
  files: SdkCheckpointFile[];
}

/** Ответ POST …/checkpoints/{id}/rewind → карточка подтверждения
 *  tool='rewind' verbatim; решение идёт тем же confirm-маршрутом. */
export type SdkRewindCard = SdkConfirmation;

/* ------------------------------------------------------------------ */
/* Учёт по сессиям и ассистентам (W1 задача 23) — KPI /home и токены   */
/* в списке сессий. Суммы — host `_USAGE_SUM_KEYS` + model/contextFill. */
/* Отсутствующее у SDK значение приходит null — в UI «нет данных», не 0. */
/* Источник: `ai2/sdk_sessions.py` (session_usage/assistant_usage),      */
/* маршруты GET /v1/sdk/sessions/{id}/usage и /v1/sdk/usage/assistants.  */
/* ------------------------------------------------------------------ */

export interface SdkUsageTotals {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  totalCostUsd: number | null;
  durationMs: number | null;
  durationApiMs: number | null;
  numTurns: number | null;
  /** Модель, на которой шёл учёт; null — SDK не отдал. */
  model: string | null;
  /** Доля заполнения контекста 0..1; null — SDK не отдал. */
  contextFill: number | null;
  /** Разбивка по моделям verbatim; null — нет данных. */
  modelUsage: unknown;
}

/**
 * GET /v1/sdk/sessions/{id}/usage — сводка по сессии (персистентно,
 * переживает рестарт; ветка после fork получает свой sid).
 * 404 — сессия неизвестна; пустое/неизвестное → null, не 0.
 */
export interface SdkSessionUsage extends SdkUsageTotals {
  sessionId: string;
  /** Сколько прогонов в сводке; null — хост не отдал. */
  runs: number | null;
}

/** Строка GET /v1/sdk/usage/assistants: делегированные прогоны по agent,
 *  прогоны без ассистента — 'unassigned' (verbatim от хоста). */
export interface SdkAssistantUsageRow extends SdkUsageTotals {
  assistant: string;
  runs: number;
}

/** Пусто → `assistants: []` (честный пустой, не ошибка). */
export interface SdkAssistantUsage {
  assistants: SdkAssistantUsageRow[];
}

/** Фильтры списка сессий (host Query: archived/assistant/status/limit). */
export interface SdkSessionQuery {
  archived?: boolean;
  assistant?: string;
  status?: string;
  limit?: number;
}
