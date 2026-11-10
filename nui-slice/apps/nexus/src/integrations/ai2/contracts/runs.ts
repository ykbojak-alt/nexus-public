import type { Ai2Page, Ai2Usage } from './common';

/**
 * Run contracts — `/v1/runs`, `/v1/processes`, `/v1/runs/{id}/*`.
 * Timestamps are unix seconds (floats), as stored by AI-2.
 */

export type Ai2RunStatus = 'running' | 'done' | 'error' | 'cancelled' | 'timeout';

/**
 * Нормализованная ошибка завершённого с ошибкой прогона (W1-172, wire `error`):
 * `{kind, retry_after, status, upstream}` verbatim — `kind` не выдумывается,
 * `retry_after` — секунды из Retry-After провайдера (нет заголовка → null),
 * `upstream` — base_url без учётных данных.
 */
export interface Ai2RunError {
  kind?: string | null;
  retryAfter?: number | null;
  status?: number | null;
  upstream?: string | null;
}

/** Run record as returned by GET /v1/runs[/id] (after `shown()` mapping). */
export interface Ai2Run {
  runId: string;
  status: Ai2RunStatus;
  tenant?: string;
  project?: string | null;
  taskId?: string;
  task?: string;
  config?: string;
  mock?: boolean;
  agent?: string;
  parent?: string;
  /** Retry-chain link (wire `retry_of`) — a retry shares the parent thread. */
  retryOf?: string | null;
  /** Thread session link (wire `session_id`, W1-190): the root run of the
   *  thread this run belongs to; null — run has no session. */
  sessionId?: string | null;
  /** Однострочный превью промпта для списка (wire `preview`, W1-185):
   *  первые 160 символов task_text без переводов строк. */
  preview?: string | null;
  /** Нормализованная ошибка завершённого прогона (wire `error`); отсутствует
   *  у не-ошибочных прогонов. */
  error?: Ai2RunError | null;
  answer?: string | null;
  stopReason?: string | null;
  usage?: Ai2Usage | null;
  success?: boolean | null;
  score?: number | null;
  /** Run ids this run waits on (POST depends_on) — dependency edges. */
  dependsOn?: string[];
  createdAt?: number;
  finishedAt?: number | null;
}

/** Accepted run reference — POST /v1/runs (202) and /cancel. */
export interface Ai2RunRef {
  runId: string;
  status: string;
  /** Эхо `session_id` из запроса (W1-190): присутствует, только когда новый
   *  ход явно присоединён к существующей сессии. */
  sessionId?: string;
}

/** Final run result — GET /v1/runs/{id}/result. */
export interface Ai2RunResult {
  runId: string;
  status: Ai2RunStatus | string;
  answer?: string | null;
  score?: number | null;
  verified?: boolean | null;
  stopReason?: string | null;
  usage?: Ai2Usage;
  durationS?: number | null;
  config?: string;
  createdAt?: number;
  finishedAt?: number | null;
}

/**
 * Run event — GET /v1/runs/{id}/events rows and SSE stream items.
 * `seq` is absent on ephemeral SSE frames (model_delta — server sends
 * them without `id`) and present on every persisted event.
 */
export interface Ai2RunEvent {
  seq?: number;
  ts?: number;
  runId?: string;
  type: string;
  [key: string]: unknown;
}

/**
 * Wave XI — нормализованный вызов инструмента (карточка ToolCall).
 * Wire-поля события `tool_call` — snake_case verbatim (`call_id`,
 * `parent_call_id`, `tool`, `input`, `result`, `is_error`); маппер ниже
 * приводит к контракту волны. `parentCallId` заполнен только у вызовов,
 * порождённых внутри инструмента (напр. `spawn_agent` → дочерний прогон
 * связывается с вызовом); у обычных вызовов поле отсутствует — карточка
 * честно без родителя. `duration_ms` хост считает реально (мс); событие
 * пишется по завершении вызова, поэтому `startedAt` выводится как
 * `ts − duration_ms/1000`, а при отсутствии длительности — сам `ts`.
 */
export interface ToolCall {
  callId: string | null;
  parentCallId?: string;
  name: string;
  /** Дискриминатор природы вызова (NQ-085): 'subagent' — спавн субагента
   *  (wire `tool` = spawn_agent), 'tool' — обычный инструмент. Отсутствует
   *  у старых прогонов (до XI W1) — честный «нет данных». */
  kind?: 'tool' | 'subagent';
  input: unknown;
  output?: unknown;
  startedAt: number | null;
  durationMs?: number;
  status: 'ok' | 'error' | 'running';
}

/**
 * Извлечь ToolCall из события траектории. Возвращает null для событий,
 * не являющихся вызовом инструмента. `callId` null = хост не записал id
 * (события старых прогонов до XI W1) — честный «нет данных», не выдумка.
 */
export function toolCallFromEvent(e: Ai2RunEvent): ToolCall | null {
  if (e.type !== 'tool_call') return null;
  const name = e.tool ?? e.name;
  if (typeof name !== 'string' || name === '') return null;
  const ts = typeof e.ts === 'number' ? e.ts : null;
  const durationMs = typeof e.duration_ms === 'number' ? e.duration_ms : undefined;
  return {
    callId: typeof e.call_id === 'string' ? e.call_id : null,
    parentCallId: typeof e.parent_call_id === 'string' ? e.parent_call_id : undefined,
    name,
    kind: e.tool === 'spawn_agent' ? 'subagent' : 'tool',
    input: e.input,
    output: e.result,
    startedAt: ts != null && durationMs != null ? ts - durationMs / 1000 : ts,
    durationMs,
    // persisted-события несут is_error bool; SDK-поток (волна XI W1) шлёт
    // is_error=null на вызове в полёте — честный 'running', не 'ok'
    status: e.is_error === true ? 'error' : (e.is_error === false ? 'ok' : 'running'),
  };
}

/** Process-table row — GET /v1/processes (`ps` view of the Agent OS). */
export interface Ai2Process {
  pid: number;
  runId: string;
  tenant: string;
  state: 'new' | 'ready' | 'running' | 'blocked' | 'done' | 'failed' | 'cancelled' | string;
  parentPid?: number | null;
  config?: string;
  agent?: string | null;
  capabilities?: { granted?: string[]; tools_allowed?: string[]; tools_denied?: string[] } | Record<string, unknown>;
  createdAt?: number;
  startedAt?: number | null;
  finishedAt?: number | null;
  stopReason?: string | null;
  workdir?: string | null;
}

/** POST /v1/runs body — public camelCase input, mapped to wire by the client. */
export interface CreateRunInput {
  task: string;
  config?: string;
  mock?: boolean;
  project?: string;
  useMemory?: boolean;
  model?: string;
  maxCostUsd?: number;
  priority?: number;
  dependsOn?: string[];
  agent?: string;
  maxDurationS?: number;
  /** Project-root fs policy (fs-access dispatch) — sent only when the user
   *  declared roots; absent keeps the workdir-only default. Wire: fs_policy. */
  fsPolicy?: import('./fs').FsPolicy;
  /** Idempotency-Key header value (server remembers it for a day). */
  idempotencyKey?: string;
  /** Сессия (корневой прогон треда), к которой присоединяется новый ход
   *  (W1-190). Несуществующая → 404 `session_not_found`; протухшая →
   *  409 `session_expired`. */
  sessionId?: string;
}

/** GET /v1/runs query filters. */
export interface ListRunsQuery {
  limit?: number;
  offset?: number;
  config?: string;
  agent?: string;
  parent?: string;
  project?: string;
  status?: Ai2RunStatus;
  since?: number;
  until?: number;
  /** Фильтр по сессии (wire `session_id`, W1-190) — только прогоны этого
   *  треда; неизвестная сессия → пустой список. */
  sessionId?: string;
  /** Курсорная пагинация (W1-185): run_id последнего элемента предыдущей
   *  страницы; страница идёт строго старше курсора. Несовместим с offset
   *  (422); неизвестный курсор → 404 `run_not_found`. */
  before?: string;
}

export interface Ai2RunsPage extends Ai2Page<Ai2Run> {
  runs: Ai2Run[];
  /** Wire verbatim (W1-185): есть ли следующая страница. */
  has_more?: boolean;
  /** Wire verbatim: курсор следующей страницы (run_id крайнего элемента),
   *  null когда страниц больше нет. */
  next_cursor?: string | null;
}

/**
 * Пропуск в журнале событий прогона (W1-177): дыра в сохранённых seq не
 * остаётся молчаливой — в JSON-списке `/v1/runs/{id}/events` поле `gaps`
 * несёт пары `{expected_seq, received_seq}`; пустой список — пропусков нет.
 */
export interface Ai2RunGap {
  expectedSeq: number;
  receivedSeq: number;
}

/**
 * Ответ retention-прохода `POST /v1/runs/gc` (W1-173/185) — wire verbatim:
 * `dry_run=true` — только план; `deleted` всегда 0 (hard-delete не делается);
 * `plan` — записи `{run_id, session_id, created_at, status}`.
 */
export interface Ai2RunsGcResult {
  dry_run: boolean;
  older_than_days: number;
  keep_per_session: number;
  candidates: number;
  archived: number;
  deleted: number;
  plan?: Array<{
    run_id: string;
    session_id: string | null;
    created_at: number | null;
    status: string;
  }>;
}
