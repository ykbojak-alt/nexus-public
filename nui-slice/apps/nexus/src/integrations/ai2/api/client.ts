import { Ai2ApiError, Ai2NetworkError } from './errors';
import type { Ai2ErrorBody } from '../contracts/common';
import type {
  Ai2Process,
  Ai2Run,
  Ai2RunError,
  Ai2RunEvent,
  Ai2RunGap,
  Ai2RunRef,
  Ai2RunResult,
  Ai2RunsGcResult,
  Ai2RunsPage,
  CreateRunInput,
  ListRunsQuery,
} from '../contracts/runs';
import type {
  Ai2Agent,
  Ai2AgentsPage,
  Ai2CreatedPlugin,
  Ai2Handoff,
  Ai2Plugin,
  Ai2PluginsPage,
  CreateAgentInput,
  CreatePluginInput,
  PatchAgentInput,
  PatchPluginInput,
} from '../contracts/agents';
import type {
  BusDelegation,
  BusOverview,
  BusSession,
  DelegateTaskInput,
} from '../contracts/bus';
import type {
  SdkCheckpoint,
  SdkCheckpointFile,
  SdkAuditEntry,
  SdkAuditPage,
  SdkConfirmDecision,
  SdkConfirmResult,
  SdkConfirmation,
  SdkDelegation,
  SdkForkResult,
  SdkHandoff,
  SdkRule,
  SdkRewindCard,
  SdkRulesResult,
  SdkRunHandle,
  SdkRunInput,
  SdkRunUsage,
  SdkAssistantUsage,
  SdkAssistantUsageRow,
  SdkSavedPrompt,
  SdkSession,
  SdkSessionPatch,
  SdkSessionQuery,
  SdkSessionUsage,
  SdkUsageTotals,
} from '../contracts/sdk';
import type {
  McpCallInput,
  McpCallResponse,
  McpCatalog,
  McpServer,
} from '../contracts/mcp';
import type {
  AddMemoryInput,
  Ai2MemoryItem,
  MemoryListQuery,
  MemorySearchQuery,
} from '../contracts/memory';
import type {
  Ai2ApiKey,
  Ai2CreatedApiKey,
  Ai2Health,
  Ai2Healthz,
  Ai2Metrics,
  Ai2Model,
  Ai2Preset,
  Ai2UsageReport,
  CreateApiKeyInput,
  ScenarioHealth,
} from '../contracts/system';
import type {
  Ai2CreatedWebhook,
  Ai2Webhook,
  Ai2WebhookDelivery,
  CreateWebhookInput,
  PatchWebhookInput,
} from '../contracts/webhooks';
import type { Ai2Capabilities, Ai2Feature, Ai2FeatureMap } from '../contracts/capabilities';
import type {
  Ai2WorkerGrant,
  Ai2WorkerLaunched,
  Ai2WorkerStatus,
  WorkerLaunchInput,
  WorkerRequestInput,
} from '../contracts/worker';
import type {
  Ai2GeneratedImage,
  Ai2ImageGenerateRequest,
} from '../contracts/images';
import type {
  Ai2ChatCompactInput,
  Ai2ChatCompactResult,
  Ai2ChatCompactionConfig,
  Ai2ChatCompactionStatus,
  Ai2ChatHistoryEntry,
  Ai2ChatHistoryPage,
  Ai2ChatHistoryQuery,
  Ai2ChatRetryInput,
  Ai2ChatRetryResult,
  Ai2ChatSessionExpiry,
  Ai2ChatSessionsPage,
} from '../contracts/chat-compaction';
import type {
  Ai2Speech,
  Ai2TtsInput,
  Ai2Transcript,
  Ai2VoiceCatalog,
} from '../contracts/voice';
import type {
  Ai2TelegramAuthInput,
  Ai2TelegramChat,
  Ai2TelegramMessage,
  Ai2TelegramState,
} from '../contracts/telegram';
import type {
  FsPolicy,
  FsRequestStatus,
  FsValidateResult,
  FsWriteRequest,
} from '../contracts/fs';
import type {
  NeuPluginEntry,
  NeuPluginInventory,
} from '../contracts/neu-plugins';

/**
 * Typed browser client for the AI-2 FastAPI surface (Task 5, Window 1).
 * Transport: same-origin `fetch` by default; tests inject `fetchImpl`.
 * Wire snake_case → public camelCase happens here; arbitrary payloads
 * (memory meta, usage, capabilities) pass through untouched.
 */

export interface Ai2ClientConfig {
  /** Base URL — '' (same origin, static desktop build) or http://127.0.0.1:PORT. */
  baseUrl?: string;
  /** API key → `Authorization: Bearer`. Absent → no auth headers (dev mode). */
  apiKey?: string;
  fetchImpl?: typeof fetch;
  /** Client-side request timeout in ms (0 = none). Default: none. */
  timeoutMs?: number;
}

/** Per-call request controls; `timeoutMs` overrides the client default. */
export interface Ai2RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

// --- wire shapes (only what we map) ----------------------------------------

type Wire = Record<string, unknown>;

/** Wave XII W1 — prompt-файл каталога библиотеки: имя и путь verbatim от хоста.
 *  XIV: контракт расширен — source 'file'|'saved', path null у saved-записей. */
export interface Ai2PromptFile {
  name: string;
  path: string | null;
  /** XIV: 'file' — файл каталога AI2_PROMPTS_DIR; 'saved' — сценарий SDK. */
  source?: 'file' | 'saved' | (string & {});
  /** XIV: id сохранённого сценария (только source:'saved'). */
  id?: string | null;
  updatedAt?: number | null;
}

const opt = <T>(v: T | null | undefined): T | undefined => (v ?? undefined);

function mapRunError(w: Wire): Ai2RunError {
  // W1-172: поля verbatim — kind не выдумывается, отсутствие честно null.
  return {
    kind: w.kind == null ? null : String(w.kind),
    retryAfter: w.retry_after == null ? null : Number(w.retry_after),
    status: w.status == null ? null : Number(w.status),
    upstream: w.upstream == null ? null : String(w.upstream),
  };
}

function mapRun(w: Wire): Ai2Run {
  return {
    runId: String(w.run_id),
    status: w.status as Ai2Run['status'],
    tenant: opt(w.tenant as string | undefined),
    project: w.project === undefined ? undefined : (w.project as string | null),
    taskId: opt(w.task_id as string | null | undefined),
    task: opt((w.task_text ?? w.task) as string | null | undefined),
    config: opt(w.config as string | null | undefined),
    mock: w.mock === undefined ? undefined : Boolean(w.mock),
    agent: opt(w.agent as string | null | undefined),
    parent: opt(w.parent as string | null | undefined),
    retryOf: w.retry_of === undefined ? undefined : (w.retry_of as string | null),
    // W1-190: сессия — корневой прогон треда; поле может отсутствовать у
    // старых записей — null verbatim, не выдуманный id.
    sessionId: w.session_id === undefined ? undefined : (w.session_id as string | null),
    // W1-185: однострочный превью промпта для списка.
    preview: w.preview === undefined ? undefined : (w.preview as string | null),
    // W1-172: нормализованная ошибка завершённого прогона.
    error: w.error == null ? (w.error === undefined ? undefined : null)
      : mapRunError(w.error as Wire),
    answer: w.answer === undefined ? undefined : (w.answer as string | null),
    stopReason: opt(w.stop_reason as string | null | undefined),
    usage: w.usage === undefined ? undefined : (w.usage as Ai2Run['usage']),
    success: w.success === undefined ? undefined : (w.success as boolean | null),
    score: w.score === undefined ? undefined : (w.score as number | null),
    dependsOn: opt(w.depends_on as string[] | null | undefined),
    createdAt: opt(w.created_at as number | null | undefined),
    finishedAt: w.finished_at === undefined ? undefined : (w.finished_at as number | null),
  };
}

/** W1-173: блок `session` (протухание по TTL) — wire snake → camel. */
function mapSessionExpiry(w: Wire): Ai2ChatSessionExpiry {
  return {
    expired: w.expired === true,
    ttlHours: typeof w.ttl_hours === 'number' ? w.ttl_hours : 0,
    lastActivityAt: typeof w.last_activity_at === 'number' ? w.last_activity_at : null,
    idleSeconds: typeof w.idle_seconds === 'number' ? w.idle_seconds : null,
    reason: w.reason == null ? null : String(w.reason),
  };
}

function mapRunRef(w: Wire): Ai2RunRef {
  return {
    runId: String(w.run_id),
    status: String(w.status),
    // W1-190: эхо session_id есть только при явном присоединении к сессии.
    ...(w.session_id !== undefined ? { sessionId: String(w.session_id) } : {}),
  };
}

function mapRunResult(w: Wire): Ai2RunResult {
  return {
    runId: String(w.run_id),
    status: String(w.status),
    answer: w.answer === undefined ? undefined : (w.answer as string | null),
    score: w.score === undefined ? undefined : (w.score as number | null),
    verified: w.verified === undefined ? undefined : (w.verified as boolean | null),
    stopReason: opt(w.stop_reason as string | null | undefined),
    usage: opt(w.usage as Ai2RunResult['usage'] | null | undefined),
    durationS: opt(w.duration_s as number | null | undefined),
    config: opt(w.config as string | null | undefined),
    createdAt: opt(w.created_at as number | null | undefined),
    finishedAt: w.finished_at === undefined ? undefined : (w.finished_at as number | null),
  };
}

export function mapRunEvent(w: Wire): Ai2RunEvent {
  const { run_id, seq, ts, type, ...rest } = w;
  return {
    seq: seq as number,
    ts: opt(ts as number | null | undefined),
    runId: opt(run_id as string | null | undefined),
    type: String(type ?? 'message'),
    ...rest,
  };
}

function mapProcess(w: Wire): Ai2Process {
  return {
    pid: w.pid as number,
    runId: String(w.run_id),
    tenant: String(w.tenant),
    state: w.state as Ai2Process['state'],
    parentPid: opt(w.parent_pid as number | null | undefined),
    config: opt(w.config as string | null | undefined),
    agent: opt(w.agent as string | null | undefined),
    capabilities: opt(w.capabilities as Ai2Process['capabilities'] | null | undefined),
    createdAt: opt(w.created_at as number | null | undefined),
    startedAt: opt(w.started_at as number | null | undefined),
    finishedAt: w.finished_at === undefined ? undefined : (w.finished_at as number | null),
    stopReason: opt(w.stop_reason as string | null | undefined),
    workdir: opt(w.workdir as string | null | undefined),
  };
}

function mapAgent(w: Wire): Ai2Agent {
  return {
    tenant: String(w.tenant),
    name: String(w.name),
    description: (w.description as string) ?? '',
    config: w.config === undefined ? undefined : (w.config as string | null),
    capabilities: (w.capabilities as string[]) ?? [],
    taskPrefix: (w.task_prefix as string) ?? '',
    maxCostUsd: w.max_cost_usd === undefined ? undefined : (w.max_cost_usd as number | null),
    // Wave XI — handoff-кнопки спеки; сервер до миграции колонки поле не отдаёт
    handoffs: Array.isArray(w.handoffs) ? (w.handoffs as Ai2Handoff[]) : undefined,
    createdAt: w.created_at as number,
    updatedAt: w.updated_at as number,
  };
}

function mapPlugin(w: Wire): Ai2Plugin {
  return {
    tenant: String(w.tenant),
    name: String(w.name),
    description: (w.description as string) ?? '',
    url: String(w.url),
    active: Boolean(w.active),
    hasSecret: Boolean(w.has_secret),
    createdAt: w.created_at as number,
    updatedAt: w.updated_at as number,
  };
}

function mapMemoryItem(w: Wire): Ai2MemoryItem {
  return {
    id: String(w.id),
    tenant: String(w.tenant),
    project: String(w.project),
    text: String(w.text),
    meta: (w.meta as Record<string, unknown>) ?? {},
    createdAt: w.created_at as number,
    score: w.score === undefined ? undefined : (w.score as number | null),
  };
}

function mapWebhook(w: Wire): Ai2Webhook {
  return {
    webhookId: String(w.webhook_id),
    url: String(w.url),
    events: (w.events as string[]) ?? [],
    active: Boolean(w.active),
    createdAt: String(w.created_at),
  };
}

function mapDelivery(w: Wire): Ai2WebhookDelivery {
  return {
    deliveryId: String(w.delivery_id),
    event: String(w.event),
    status: String(w.status),
    attempts: w.attempts as number,
    nextAt: opt(w.next_at as string | null | undefined),
    lastCode: w.last_code === undefined ? undefined : (w.last_code as number | null),
    lastError: opt(w.last_error as string | null | undefined),
    createdAt: String(w.created_at),
    finishedAt: opt(w.finished_at as string | null | undefined),
  };
}

function mapUsageReport(w: Wire): Ai2UsageReport {
  return {
    period: String(w.period),
    tenant: String(w.tenant),
    runsTotal: w.runs_total as number,
    runsSucceeded: w.runs_succeeded as number,
    runsFailed: w.runs_failed as number,
    runsCancelled: w.runs_cancelled as number,
    runsTimeout: w.runs_timeout as number,
    runsRunning: w.runs_running as number,
    costUsd: w.cost_usd as number,
    breakdown: (w.breakdown as Ai2UsageReport['breakdown']) ?? {},
    budgetUsd: w.budget_usd === undefined ? undefined : (w.budget_usd as number | null),
  };
}

function mapKey(w: Wire): Ai2ApiKey {
  return {
    keyId: String(w.key_id),
    name: String(w.name),
    scopes: (w.scopes as string[]) ?? [],
    prefix: String(w.prefix),
    status: String(w.status),
    createdAt: String(w.created_at),
    expiresAt: opt(w.expires_at as string | null | undefined) ?? null,
    revokedAt: opt(w.revoked_at as string | null | undefined) ?? null,
  };
}

/** Wire time: ISO-8601 по контракту; epoch-число принимаем для старых
 *  хостов/снимков — Date.parse на float-строке дал бы NaN и «вечный» грант. */
const mapWireTime = (v: unknown): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v * 1000).toISOString();
  return opt(v as string | null | undefined) ?? null;
};

function mapWorkerGrant(w: Wire): Ai2WorkerGrant {
  return {
    grantId: String(w.grant_id),
    roots: (w.roots as string[]) ?? [],
    ops: (w.ops as string[]) ?? [],
    commands: ((w.commands as string[][]) ?? []).map((c) => [...c]),
    mode: w.mode as Ai2WorkerGrant['mode'],
    expiresAt: mapWireTime(w.expires_at),
    revoked: Boolean(w.revoked),
    createdAt: mapWireTime(w.created_at) ?? String(w.created_at),
  };
}

function mapWorkerStatus(w: Wire): Ai2WorkerStatus {
  const g = w.grant as Wire | undefined;
  return {
    state: w.state as Ai2WorkerStatus['state'],
    launched: w.launched === undefined ? undefined : Boolean(w.launched),
    pid: w.pid === undefined ? undefined : (w.pid as number | null),
    restarts: w.restarts === undefined ? undefined : Number(w.restarts),
    maxRestarts: w.max_restarts === undefined ? undefined : Number(w.max_restarts),
    uptimeS: w.uptime_s === undefined ? undefined : (w.uptime_s as number | null),
    grant: g === undefined ? undefined : {
      grantId: String(g.grant_id),
      mode: g.mode as Ai2WorkerGrant['mode'],
      roots: (g.roots as string[]) ?? [],
      ops: (g.ops as string[]) ?? [],
      expiresAt: mapWireTime(g.expires_at),
      revoked: Boolean(g.revoked),
    },
  };
}

// --- client -----------------------------------------------------------------

export interface Ai2Client {
  healthz(opts?: Ai2RequestOptions): Promise<Ai2Healthz>;
  health(opts?: Ai2RequestOptions): Promise<Ai2Health>;
  /** Wave XV — приёмочный шлюз сценария S1-S9 (W1): каждый шаг —
   *  реальный вызов seam'а хоста; статус/причина verbatim, без заглушек. */
  scenarioHealth(opts?: Ai2RequestOptions): Promise<ScenarioHealth>;
  metrics(opts?: Ai2RequestOptions): Promise<Ai2Metrics>;
  /** GET /v1/capabilities — honest host feature map (W1-05). */
  capabilities(opts?: Ai2RequestOptions): Promise<Ai2Capabilities>;
  models: { list(opts?: Ai2RequestOptions): Promise<{ models: Ai2Model[]; default: string }> };
  presets: { list(opts?: Ai2RequestOptions): Promise<{ presets: Ai2Preset[]; default: string }> };
  agents: {
    list(query?: { limit?: number; offset?: number }, opts?: Ai2RequestOptions): Promise<Ai2AgentsPage>;
    get(name: string, opts?: Ai2RequestOptions): Promise<Ai2Agent>;
    create(input: CreateAgentInput, opts?: Ai2RequestOptions): Promise<Ai2Agent>;
    update(name: string, patch: PatchAgentInput, opts?: Ai2RequestOptions): Promise<Ai2Agent>;
    delete(name: string, opts?: Ai2RequestOptions): Promise<void>;
  };
  plugins: {
    list(query?: { limit?: number; offset?: number }, opts?: Ai2RequestOptions): Promise<Ai2PluginsPage>;
    get(name: string, opts?: Ai2RequestOptions): Promise<Ai2Plugin>;
    create(input: CreatePluginInput, opts?: Ai2RequestOptions): Promise<Ai2CreatedPlugin>;
    update(name: string, patch: PatchPluginInput, opts?: Ai2RequestOptions): Promise<Ai2Plugin>;
    delete(name: string, opts?: Ai2RequestOptions): Promise<void>;
  };
  processes: {
    list(query?: { state?: string }, opts?: Ai2RequestOptions): Promise<{ processes: Ai2Process[] }>;
  };
  runs: {
    list(query?: ListRunsQuery, opts?: Ai2RequestOptions): Promise<Ai2RunsPage>;
    get(runId: string, opts?: Ai2RequestOptions): Promise<Ai2Run>;
    create(input: CreateRunInput, opts?: Ai2RequestOptions): Promise<Ai2RunRef>;
    cancel(runId: string, opts?: Ai2RequestOptions): Promise<Ai2RunRef>;
    events(runId: string, query?: { after?: number; limit?: number }, opts?: Ai2RequestOptions): Promise<{ runId: string; status: string; events: Ai2RunEvent[]; gaps: Ai2RunGap[] }>;
    result(runId: string, opts?: Ai2RequestOptions): Promise<Ai2RunResult>;
    audit(runId: string, opts?: Ai2RequestOptions): Promise<{ runId: string; events: unknown[] }>;
    /** POST /v1/runs/gc (W1-173) — retention-проход: архивирует завершённые
     *  прогоны старше политики; `dryRun` — только план. `deleted` всегда 0 —
     *  hard-delete хост не делает. */
    gc(query?: { dryRun?: boolean; olderThanDays?: number; keepPerSession?: number },
      opts?: Ai2RequestOptions): Promise<Ai2RunsGcResult>;
  };
  /** W1-133 explicit compaction and W1-139 background status. */
  chat: {
    compact(input: Ai2ChatCompactInput, opts?: Ai2RequestOptions): Promise<Ai2ChatCompactResult>;
    /** W3-143: cursor-пагинация истории треда — `beforeId` строго старше
     *  курсора, `effective` просит compact-ноды вместо покрытых сообщений. */
    history(threadId: string, q?: Ai2ChatHistoryQuery, opts?: Ai2RequestOptions): Promise<Ai2ChatHistoryPage>;
    compactionStatus(sessionId: string, opts?: Ai2RequestOptions): Promise<Ai2ChatCompactionStatus | null>;
    compactionConfig(opts?: Ai2RequestOptions): Promise<Ai2ChatCompactionConfig>;
    /** GET /v1/chat/sessions (W1-189) — треды tenant'а с состоянием
     *  протухания; постранично по limit/offset. */
    sessions(query?: { limit?: number; offset?: number }, opts?: Ai2RequestOptions): Promise<Ai2ChatSessionsPage>;
    /** POST /v1/chat/retry — повтор сообщения истории: `messageId` вида
     *  `<run_id>:task` | `<run_id>:answer` → 202 новый прогон-повтор;
     *  404 `message_not_found`, 409 (прогон идёт / `session_expired`),
     *  402 бюджет. */
    retry(input: Ai2ChatRetryInput, opts?: Ai2RequestOptions): Promise<Ai2ChatRetryResult>;
  };
  memory: {
    add(input: AddMemoryInput, opts?: Ai2RequestOptions): Promise<{ id: string; project: string }>;
    list(query: MemoryListQuery, opts?: Ai2RequestOptions): Promise<Ai2MemoryItem[]>;
    search(query: MemorySearchQuery, opts?: Ai2RequestOptions): Promise<Ai2MemoryItem[]>;
    delete(itemId: string, opts?: Ai2RequestOptions): Promise<void>;
  };
  webhooks: {
    list(opts?: Ai2RequestOptions): Promise<{ webhooks: Ai2Webhook[]; events: string[] }>;
    create(input: CreateWebhookInput, opts?: Ai2RequestOptions): Promise<Ai2CreatedWebhook>;
    update(webhookId: string, patch: PatchWebhookInput, opts?: Ai2RequestOptions): Promise<Ai2Webhook>;
    delete(webhookId: string, opts?: Ai2RequestOptions): Promise<void>;
    deliveries(webhookId: string, query?: { limit?: number }, opts?: Ai2RequestOptions): Promise<{ deliveries: Ai2WebhookDelivery[] }>;
  };
  usage: {
    get(query?: { period?: string; tenant?: string }, opts?: Ai2RequestOptions): Promise<Ai2UsageReport>;
  };
  keys: {
    list(query?: { tenant?: string }, opts?: Ai2RequestOptions): Promise<{ keys: Ai2ApiKey[] }>;
    create(input: CreateApiKeyInput, opts?: Ai2RequestOptions): Promise<Ai2CreatedApiKey>;
    delete(keyId: string, opts?: Ai2RequestOptions): Promise<void>;
  };
  /** Local grant-bounded worker — /v1/worker/* (W1-07..09). Single worker per server. */
  worker: {
    /** POST /v1/worker/launch → 201; 409 when a worker is already up. */
    launch(input: WorkerLaunchInput, opts?: Ai2RequestOptions): Promise<Ai2WorkerLaunched>;
    /** GET /v1/worker/status — honest `down` when never launched. */
    status(opts?: Ai2RequestOptions): Promise<{ worker: Ai2WorkerStatus }>;
    /** POST /v1/worker/request — grant denials surface as Ai2ApiError 403. */
    request(input: WorkerRequestInput, opts?: Ai2RequestOptions): Promise<unknown>;
    /** POST /v1/worker/revoke — live grant stops answering (403 on next op). */
    revoke(opts?: Ai2RequestOptions): Promise<{ worker: Ai2WorkerStatus }>;
    /** POST /v1/worker/shutdown — graceful frame, then kill. */
    shutdown(opts?: Ai2RequestOptions): Promise<{ worker: Ai2WorkerStatus }>;
  };
  /** Remote image generation — POST /v1/images/generate (INT-23). */
  images: {
    /**
     * Generate an image. Check `capabilities().features.imageGen` first —
     * `supported: false` + reason when provider keys are not configured
     * (the endpoint then honestly answers 503).
     */
    generate(input: Ai2ImageGenerateRequest, opts?: Ai2RequestOptions): Promise<Ai2GeneratedImage>;
  };
  /** Host TTS — GET /v1/voice/voices + POST /v1/voice/tts (W1 voice). */
  voice: {
    /** Voice catalog with per-voice honest `available` (provider key present). */
    list(opts?: Ai2RequestOptions): Promise<Ai2VoiceCatalog>;
    /**
     * Synthesize text → audio. Check `capabilities().features.voice` first —
     * `supported: false` + reason when the cloud provider key is missing (the
     * endpoint then honestly answers 503).
     */
    speak(input: Ai2TtsInput, opts?: Ai2RequestOptions): Promise<Ai2Speech>;
    /**
     * Audio bytes → transcript (faster-whisper on the host; the container —
     * wav/webm/ogg/mp3 — is what the browser recorded, sent verbatim).
     * Check `list().stt.supported` first — 503 with host reason when off.
     */
    transcribe(audio: Blob, opts?: Ai2RequestOptions & { language?: 'ru' | 'en' | 'auto' }): Promise<Ai2Transcript>;
  };
  /** Telegram user-client за typed boundary (W1) — GET/POST /v1/telegram/*.
   *  Host владеет TDLib и кредами; shell видит только DTO. Без native
   *  библиотеки/кредов `status()` честно отдаёт unavailable + причину. */
  telegram: {
    /** Adapter state machine: status/authStep/error, verbatim vocabulary. */
    status(opts?: Ai2RequestOptions): Promise<Ai2TelegramState>;
    /** One auth step — send exactly the field the current authStep asks for. */
    auth(input: Ai2TelegramAuthInput, opts?: Ai2RequestOptions): Promise<Ai2TelegramState>;
    /** Main chat list (host requires connected — 409 otherwise). */
    chats(opts?: Ai2RequestOptions): Promise<Ai2TelegramChat[]>;
    history(chatId: string, opts?: Ai2RequestOptions & { limit?: number }): Promise<Ai2TelegramMessage[]>;
    /** Explicit user-initiated send only (contract boundary). */
    send(chatId: string, text: string, opts?: Ai2RequestOptions): Promise<Ai2TelegramMessage>;
    logout(opts?: Ai2RequestOptions): Promise<Ai2TelegramState>;
  };
  /** fs-access (dispatch 2026-10-20): folder validation + scoped write
   *  requests. The boundary lives in the host — these are typed DTO calls,
   *  never a UI-side grant. */
  fs: {
    /** POST /v1/fs/validate — exists + is dir → ok + canonical path;
     *  failure is `ok:false` + verbatim reason, not an HTTP error. */
    validate(path: string, opts?: Ai2RequestOptions): Promise<FsValidateResult>;
    /** GET /v1/fs/requests — newest first; filters map to host query. */
    requests(q?: { status?: FsRequestStatus; runId?: string; limit?: number },
      opts?: Ai2RequestOptions): Promise<FsWriteRequest[]>;
    /** Approve → host performs the deferred write atomically (scoped:
     *  this (run_id, root, path, op) only — never a global mode change). */
    approve(requestId: string, opts?: Ai2RequestOptions): Promise<FsWriteRequest>;
    /** Deny → file unchanged; resolved event lands in the run trace. */
    deny(requestId: string, opts?: Ai2RequestOptions): Promise<FsWriteRequest>;
  };
  /**
   * Wave XI — шина окон NEU (/v1/bus/*). Сессии окон (windows.json +
   * inbox/outbox) и делегация задач через send.ps1 — реальный побочный
   * эффект на хосте, не мок. Хост отвечает 503 с причиной, когда
   * AI2_NEXUS_BUS не настроен.
   */
  bus: {
    /** GET /v1/bus/sessions — Session[] по контракту волны. */
    sessions(opts?: Ai2RequestOptions): Promise<{ sessions: BusSession[] }>;
    /** POST /v1/bus/delegations → Delegation; state 'locked' при session_locked. */
    delegate(input: DelegateTaskInput, opts?: Ai2RequestOptions): Promise<BusDelegation>;
    /** GET /v1/bus/delegations/{id} → Delegation; 404 — не найдена. */
    delegation(id: string, opts?: Ai2RequestOptions): Promise<BusDelegation>;
    /**
     * XIV — GET /v1/bus/overview (bus-overview-contract.md): обзор W1–W5 +
     * хвост watch.log. Всегда 200; status 'unknown' — каталог шины не
     * настроен на хосте (честный пустой, не ошибка).
     */
    overview(opts?: Ai2RequestOptions): Promise<BusOverview>;
  };
  /**
   * Wave XIV — подтверждения инструментов SDK-канала
   * (/v1/sdk/runs/{id}/confirmations*, sdk-confirm-contract.md draft 0.2).
   * Маршруты за AI2_SDK_ENABLED: без флага хост честно отвечает 503
   * с причиной verbatim — экран показывает «хост не ответил», не мок.
   */
  sdk: {
    /** GET …/confirmations — открытые карточки прогона (awaiting+deferred). */
    confirmations(runId: string, opts?: Ai2RequestOptions): Promise<{ confirmations: SdkConfirmation[] }>;
    /** POST …/confirmations/{callId} {decision: allow|deny|defer, reason?}. */
    confirm(
      runId: string,
      callId: string,
      input: { decision: SdkConfirmDecision; reason?: string },
      opts?: Ai2RequestOptions,
    ): Promise<SdkConfirmResult>;
    /** GET /v1/sdk/audit — decision journal; filtered to plugin install by UI. */
    auditLog(q?: { limit?: number; offset?: number; runId?: string }, opts?: Ai2RequestOptions): Promise<SdkAuditPage>;
    /**
     * XIV — сессии агента SDK (sdk-sessions-contract.md, draft):
     * GET /v1/sdk/sessions (?archived=true показывает архивные),
     * PATCH title/archived в sidecar метаданных, POST …/fork — ветка от
     * сообщения (идемпотентно по key), POST /v1/sdk/runs — прогон
     * (resume продолжает ленту сессии). Тот же флаг AI2_SDK_ENABLED.
     */
    sessions(q?: SdkSessionQuery, opts?: Ai2RequestOptions): Promise<{ sessions: SdkSession[] }>;
    /** XV — сводка учёта по сессии (KPI /home, задача W1 23): суммы
     *  токенов/стоимости, null — «нет данных»; 404 — сессия неизвестна. */
    sessionUsage(sessionId: string, opts?: Ai2RequestOptions): Promise<SdkSessionUsage>;
    /** XV — учёт по ассистентам (задача W1 23): пусто → assistants: []. */
    assistantUsage(opts?: Ai2RequestOptions): Promise<SdkAssistantUsage>;
    patchSession(sessionId: string, input: SdkSessionPatch, opts?: Ai2RequestOptions): Promise<{ id: string; updated: boolean }>;
    forkSession(
      sessionId: string,
      input: { task: string; atMessage?: string; key?: string },
      opts?: Ai2RequestOptions,
    ): Promise<SdkForkResult>;
    run(input: SdkRunInput, opts?: Ai2RequestOptions): Promise<SdkRunHandle>;
    /**
     * XIV — делегации SDK (sdk-delegations-contract.md, draft):
     * GET /v1/sdk/delegations[?parent_run_id=] — дерево дочерних
     * фоновых прогонов verbatim; POST …/delegations — параллельный
     * прогон-потомок (права наследуются от родителя, не расширяются);
     * POST …/cancel — кооперативная отмена (стоп на следующем
     * сообщении потока, не мгновенная). Всё за AI2_SDK_ENABLED.
     */
    delegations(q?: { parentRunId?: string }, opts?: Ai2RequestOptions): Promise<{ delegations: SdkDelegation[] }>;
    delegate(
      runId: string,
      input: { task: string; agent?: string; label?: string },
      opts?: Ai2RequestOptions,
    ): Promise<SdkRunHandle>;
    cancelRun(runId: string, opts?: Ai2RequestOptions): Promise<{ id: string; cancelled: boolean }>;
    /**
     * XIV — хэндофы между ассистентами (тот же контракт): GET список
     * с фильтром ?status=, POST create, POST {id}/accept|decline
     * {reason?}. Повторное решение — 409 verbatim.
     */
    handoffs(
      q?: { status?: 'pending' | 'accepted' | 'declined' },
      opts?: Ai2RequestOptions,
    ): Promise<{ handoffs: SdkHandoff[] }>;
    createHandoff(
      input: { to: string; prompt: string; fromAgent?: string; runId?: string },
      opts?: Ai2RequestOptions,
    ): Promise<SdkHandoff>;
    resolveHandoff(
      id: string,
      accept: boolean,
      reason?: string,
      opts?: Ai2RequestOptions,
    ): Promise<SdkHandoff>;
    /**
     * XIV — правила проекта рабочего каталога (sdk-rules-contract.md,
     * draft): GET /v1/sdk/rules[?directory=] → {root, rules[]} — только
     * метаданные файлов, содержимое не возвращается.
     */
    rules(q?: { directory?: string }, opts?: Ai2RequestOptions): Promise<SdkRulesResult>;
    /**
     * XIV — учёт и чекпоинты отката прогона (sdk-usage-checkpoints-
     * contract.md, draft): GET /v1/sdk/runs/{id}/usage — токены/стоимость
     * с деревом делегаций, отсутствующее у SDK → null (UI «нет данных»);
     * GET …/checkpoints — манифесты снапшотов перед изменяющими файлы
     * вызовами; POST …/rewind → 202 + карточка подтверждения
     * tool='rewind' — реальный откат только после allow.
     */
    usage(runId: string, opts?: Ai2RequestOptions): Promise<SdkRunUsage>;
    checkpoints(runId: string, opts?: Ai2RequestOptions): Promise<{ checkpoints: SdkCheckpoint[] }>;
    rewind(runId: string, checkpointId: string, opts?: Ai2RequestOptions): Promise<SdkRewindCard>;
  };
  /**
   * XIV — каталог MCP-серверов (mcp-servers-contract.md, draft):
   * GET /v1/mcp/servers — без SDK-флага; tools verbatim из конфига
   * или null; envKeys — только имена. POST …/call — через канал
   * подтверждений fs_requests: без requestId создаёт заявку
   * (awaiting_confirmation), с requestId — исполняет approved-вызов.
   */
  mcp: {
    servers(opts?: Ai2RequestOptions): Promise<McpCatalog>;
    call(name: string, input: McpCallInput, opts?: Ai2RequestOptions): Promise<McpCallResponse>;
  };
  /**
   * Wave XII W1 — каталог prompt-файлов библиотеки (GET /v1/prompts,
   * источник AI2_PROMPTS_DIR на хосте). XIV: ответ расширен —
   * source 'file'|'saved' + id/updatedAt у сохранённых; каталога нет →
   * честный пустой список. CRUD сохранённых — за AI2_SDK_ENABLED
   * (POST/PATCH/DELETE /v1/prompts/{id}); секретоподобный текст → 422.
   */
  prompts(opts?: Ai2RequestOptions): Promise<{ prompts: Ai2PromptFile[] }>;
  createPrompt(input: { title: string; body: string }, opts?: Ai2RequestOptions): Promise<SdkSavedPrompt>;
  updatePrompt(id: string, input: { title?: string; body?: string }, opts?: Ai2RequestOptions): Promise<SdkSavedPrompt>;
  deletePrompt(id: string, opts?: Ai2RequestOptions): Promise<{ id: string; deleted: boolean }>;
  /**
   * Wave XVI — инвентарь NEU-плагинов оболочки (neu-plugin-panels-spec.md
   * п.2.5 и docs/product/neu-plugin-host-contract.md (W1).
   */
  neuPlugins: {
    /** GET /v1/neu/plugins — инвентарь бандлов и строк. */
    list(opts?: Ai2RequestOptions): Promise<NeuPluginInventory>;
    /** POST /v1/neu/plugins/{id}/toggle {enabled} → {plugin}. */
    setEnabled(id: string, enabled: boolean, opts?: Ai2RequestOptions): Promise<NeuPluginEntry>;
    /** POST /v1/neu/plugins/{id}/rows/{rowId}/toggle {enabled} → {plugin}. */
    setRowEnabled(id: string, rowId: string, enabled: boolean, opts?: Ai2RequestOptions): Promise<NeuPluginEntry>;
  };
}

export function createAi2Client(config: Ai2ClientConfig = {}): Ai2Client {
  const baseUrl = (config.baseUrl ?? '').replace(/\/+$/, '');
  const fetchImpl = config.fetchImpl ?? fetch.bind(globalThis);

  async function request<T>(path: string, init: RequestInit = {}, query?: Record<string, unknown>, opts: Ai2RequestOptions = {}): Promise<T> {
    const url = new URL(`${baseUrl}${path}`, baseUrl ? undefined : globalThis.location?.href);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      }
    }
    const headers = new Headers(init.headers);
    if (init.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    if (config.apiKey) {
      headers.set('Authorization', `Bearer ${config.apiKey}`);
    }
    const timeoutMs = opts.timeoutMs ?? config.timeoutMs ?? 0;
    const timeoutSignal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
    const signal = timeoutSignal && opts.signal ? AbortSignal.any([timeoutSignal, opts.signal])
      : (timeoutSignal ?? opts.signal);
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, headers, signal });
    } catch (err) {
      // Inspect which signal fired — undici surfaces the abort reason
      // inconsistently across runtimes, so classify by signal state.
      if (timeoutSignal?.aborted) throw new Ai2NetworkError('timeout', path, err);
      if (opts.signal?.aborted) throw new Ai2NetworkError('aborted', path, err);
      if (err instanceof TypeError) throw new Ai2NetworkError('offline', path, err);
      throw err;
    }
    if (res.status === 204 || res.status === 205) return undefined as T;
    const text = await res.text();
    const body = text ? safeJson(text) : undefined;
    if (!res.ok) {
      throw new Ai2ApiError(res.status, body as Partial<Ai2ErrorBody> | undefined);
    }
    return body as T;
  }

  function safeJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return { message: text };
    }
  }

  const json = (method: string) => (body: unknown): RequestInit =>
    ({ method, body: JSON.stringify(body) });

  return {
    healthz: (opts) => request('/healthz', {}, undefined, opts),
    health: (opts) => request('/v1/health', {}, undefined, opts),
    scenarioHealth: async (opts) => {
      const w = await request<Wire>('/v1/scenario/health', {}, undefined, opts);
      return {
        steps: ((w.steps as Wire[]) ?? []).map((s) => ({
          id: String(s.id ?? ''),
          title: String(s.title ?? ''),
          status: String(s.status ?? 'unavailable'),
          detail: s.detail == null ? null : String(s.detail),
          latencyMs: typeof s.latencyMs === 'number' ? s.latencyMs : null,
        })),
        generatedAt: typeof w.generatedAt === 'number' ? w.generatedAt : null,
      };
    },
    metrics: (opts) => request('/v1/metrics', {}, undefined, opts),
    capabilities: async (opts) => {
      const w = await request<Wire>('/v1/capabilities', {}, undefined, opts);
      const features: Ai2FeatureMap = {} as Ai2FeatureMap;
      for (const [k, v] of Object.entries((w.features as Record<string, Wire>) ?? {})) {
        const camel = k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
        features[camel] = {
          supported: Boolean(v.supported),
          reason: (v.reason as string | null) ?? null,
          via: v.via as string | undefined,
          models: v.models as string[] | undefined,
        } satisfies Ai2Feature;
      }
      return {
        version: String(w.version ?? ''),
        tenant: String(w.tenant ?? ''),
        features,
        capabilityVocabulary: (w.capability_vocabulary as string[]) ?? [],
        agentCapabilities: (w.agent_capabilities as string[]) ?? [],
        scopes: (w.scopes as string[]) ?? [],
        components: (w.components as Ai2Capabilities['components']) ?? {},
        ts: String(w.ts ?? ''),
      };
    },

    models: { list: (opts) => request('/v1/models', {}, undefined, opts) },
    presets: { list: (opts) => request('/v1/presets', {}, undefined, opts) },

    agents: {
      list: async (q, opts) => {
        const w = await request<Wire>('/v1/agents', {}, { limit: q?.limit, offset: q?.offset }, opts);
        return { ...w, agents: ((w.agents as Wire[]) ?? []).map(mapAgent) } as Ai2AgentsPage;
      },
      get: async (name, opts) => mapAgent(await request<Wire>(`/v1/agents/${encodeURIComponent(name)}`, {}, undefined, opts)),
      create: async (input, opts) => mapAgent(await request<Wire>('/v1/agents', json('POST')({
        name: input.name,
        description: input.description,
        config: input.config,
        capabilities: input.capabilities,
        task_prefix: input.taskPrefix,
        max_cost_usd: input.maxCostUsd,
        handoffs: input.handoffs,
      }), undefined, opts)),
      update: async (name, patch, opts) => mapAgent(await request<Wire>(`/v1/agents/${encodeURIComponent(name)}`, json('PATCH')({
        description: patch.description,
        config: patch.config,
        capabilities: patch.capabilities,
        task_prefix: patch.taskPrefix,
        max_cost_usd: patch.maxCostUsd,
        handoffs: patch.handoffs,
      }), undefined, opts)),
      delete: (name, opts) => request(`/v1/agents/${encodeURIComponent(name)}`, { method: 'DELETE' }, undefined, opts),
    },

    plugins: {
      list: async (q, opts) => {
        const w = await request<Wire>('/v1/plugins', {}, { limit: q?.limit, offset: q?.offset }, opts);
        return { ...w, plugins: ((w.plugins as Wire[]) ?? []).map(mapPlugin) } as Ai2PluginsPage;
      },
      get: async (name, opts) => mapPlugin(await request<Wire>(`/v1/plugins/${encodeURIComponent(name)}`, {}, undefined, opts)),
      create: async (input, opts) => mapPlugin(await request<Wire>('/v1/plugins', json('POST')(input), undefined, opts)) as Ai2CreatedPlugin,
      update: async (name, patch, opts) => mapPlugin(await request<Wire>(`/v1/plugins/${encodeURIComponent(name)}`, json('PATCH')(patch), undefined, opts)),
      delete: (name, opts) => request(`/v1/plugins/${encodeURIComponent(name)}`, { method: 'DELETE' }, undefined, opts),
    },

    processes: {
      list: async (q, opts) => {
        const w = await request<Wire>('/v1/processes', {}, { state: q?.state }, opts);
        return { processes: ((w.processes as Wire[]) ?? []).map(mapProcess) };
      },
    },

    runs: {
      list: async (q, opts) => {
        // sessionId/before — единственные camel-ключи query; остальные уже
        // snake-совместимы и уходят verbatim. before+offset → 422 хоста;
        // неизвестный курсор → 404 run_not_found (W1-185).
        const { sessionId, before, ...rest } = q ?? {};
        const w = await request<Wire>('/v1/runs', {}, {
          ...rest,
          session_id: sessionId,
          before,
        }, opts);
        return { ...w, runs: ((w.runs as Wire[]) ?? []).map(mapRun) } as Ai2RunsPage;
      },
      get: async (runId, opts) => mapRun(await request<Wire>(`/v1/runs/${encodeURIComponent(runId)}`, {}, undefined, opts)),
      create: async (input, opts) => {
        const { idempotencyKey, ...rest } = input;
        const headers = new Headers();
        if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
        const wire = {
          task: rest.task,
          config: rest.config ?? 'baseline',
          mock: rest.mock ?? false,
          project: rest.project,
          use_memory: rest.useMemory,
          fs_policy: rest.fsPolicy == null ? undefined : {
            mode: rest.fsPolicy.mode,
            roots: rest.fsPolicy.roots.map((r) => ({ id: r.id, path: r.path, access: r.access })),
            request_writes: rest.fsPolicy.requestWrites,
          },
          model: rest.model,
          max_cost_usd: rest.maxCostUsd,
          priority: rest.priority,
          depends_on: rest.dependsOn,
          agent: rest.agent,
          max_duration_s: rest.maxDurationS,
          // W1-190: присоединение нового хода к сессии (корневой прогон треда).
          session_id: rest.sessionId,
        };
        // strict RunIn: omit undefined optional fields
        for (const k of Object.keys(wire) as (keyof typeof wire)[]) {
          if (wire[k] === undefined) delete wire[k];
        }
        return mapRunRef(await request<Wire>('/v1/runs', { ...json('POST')(wire), headers }, undefined, opts));
      },
      cancel: async (runId, opts) =>
        mapRunRef(await request<Wire>(`/v1/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' }, undefined, opts)),
      events: async (runId, q, opts) => {
        const w = await request<Wire>(`/v1/runs/${encodeURIComponent(runId)}/events`, {},
          { after: q?.after, limit: q?.limit }, opts);
        return {
          runId: String(w.run_id),
          status: String(w.status),
          events: ((w.events as Wire[]) ?? []).map(mapRunEvent),
          // W1-177: дыры в сохранённых seq — честный список, не тишина.
          gaps: ((w.gaps as Wire[] | undefined) ?? []).map((g) => ({
            expectedSeq: Number(g.expected_seq),
            receivedSeq: Number(g.received_seq),
          })),
        };
      },
      result: async (runId, opts) => mapRunResult(await request<Wire>(`/v1/runs/${encodeURIComponent(runId)}/result`, {}, undefined, opts)),
      audit: async (runId, opts) => {
        const w = await request<Wire>(`/v1/runs/${encodeURIComponent(runId)}/audit`, {}, undefined, opts);
        return { runId: String(w.run_id), events: (w.events as unknown[]) ?? [] };
      },
      // W1-173: retention-проход — параметры идут query-строкой, ответ
      // verbatim (dry_run/older_than_days/keep_per_session/candidates/
      // archived/deleted/plan).
      gc: async (q, opts) =>
        request<Ai2RunsGcResult>('/v1/runs/gc', { method: 'POST' }, {
          dry_run: q?.dryRun,
          older_than_days: q?.olderThanDays,
          keep_per_session: q?.keepPerSession,
        }, opts),
    },

    chat: {
      compact: async (input, opts) => {
        const wire: Record<string, unknown> = {};
        if ('runIds' in input && input.runIds !== undefined) wire.run_ids = input.runIds;
        if ('thread' in input && input.thread !== undefined) wire.thread = input.thread;
        if ('sessionId' in input && input.sessionId !== undefined) wire.session_id = input.sessionId;
        if (input.maxTokens !== undefined) wire.max_tokens = input.maxTokens;
        if (input.maxMessages !== undefined) wire.max_messages = input.maxMessages;
        if (input.keepTokens !== undefined) wire.keep_tokens = input.keepTokens;
        const w = await request<Wire>('/v1/chat/compact', json('POST')(wire), undefined, opts);
        if (
          typeof w.compacted !== 'boolean'
          || typeof w.thread_id !== 'string'
          || !Array.isArray(w.covers_message_ids)
          || !w.covers_message_ids.every((id) => typeof id === 'string')
          || !Array.isArray(w.kept_message_ids)
          || !w.kept_message_ids.every((id) => typeof id === 'string')
        ) throw new Error('Invalid AI-2 chat compact response');
        const common = {
          threadId: w.thread_id,
          coversMessageIds: w.covers_message_ids as string[],
          keptMessageIds: w.kept_message_ids as string[],
        };
        if (w.compacted === false) {
          if (typeof w.reason !== 'string') throw new Error('Invalid AI-2 chat compact no-op response');
          return { compacted: false, reason: w.reason, ...common };
        }
        if (
          typeof w.compact_id !== 'string'
          || typeof w.summary !== 'string'
          || typeof w.created_at !== 'string'
        ) throw new Error('Invalid AI-2 chat compact success response');
        return {
          compacted: true,
          compactId: w.compact_id,
          summary: w.summary,
          createdAt: w.created_at,
          ...common,
        };
      },
      history: async (threadId, q, opts) => {
        const w = await request<Wire>(
          '/v1/chat/history',
          {},
          {
            session_id: threadId,
            limit: q?.limit,
            before_id: q?.beforeId,
            effective: q?.effective === true ? 1 : undefined,
          },
          opts,
        );
        if (
          typeof w.session_id !== 'string'
          || !Array.isArray(w.messages)
          || typeof w.has_more !== 'boolean'
          || (w.next_cursor !== null && typeof w.next_cursor !== 'string')
          || typeof w.limit !== 'number'
        ) throw new Error('Invalid AI-2 chat history response');
        const messages: Ai2ChatHistoryEntry[] = [];
        for (const item of w.messages as Wire[]) {
          if (item == null || typeof item !== 'object') throw new Error('Invalid AI-2 chat history entry');
          if (item.type === 'compact') {
            const id = typeof item.compact_id === 'string' ? item.compact_id : item.id;
            if (
              typeof id !== 'string'
              || typeof item.summary !== 'string'
              || !Array.isArray(item.covers_message_ids)
              || !item.covers_message_ids.every((m) => typeof m === 'string')
            ) throw new Error('Invalid AI-2 chat history compact entry');
            messages.push({
              type: 'compact',
              id,
              summary: item.summary,
              coversMessageIds: item.covers_message_ids as string[],
              createdAt: typeof item.created_at === 'string' ? item.created_at : null,
            });
            continue;
          }
          if (
            item.type !== 'message'
            || typeof item.id !== 'string'
            || (item.role !== 'user' && item.role !== 'assistant')
            || (item.text !== null && typeof item.text !== 'string')
          ) throw new Error('Invalid AI-2 chat history message entry');
          const usage = item.usage as Wire | null | undefined;
          messages.push({
            type: 'message',
            id: item.id,
            role: item.role,
            text: (item.text as string | null) ?? null,
            createdAt: typeof item.created_at === 'number' ? item.created_at : null,
            usageTokens: typeof usage?.tokens === 'number' ? usage.tokens : null,
          });
        }
        return {
          sessionId: w.session_id,
          messages,
          limit: w.limit,
          hasMore: w.has_more,
          nextCursor: w.next_cursor,
        };
      },
      compactionStatus: async (sessionId, opts) => {
        const w = await request<Wire>(
          '/v1/chat/compaction-status',
          {},
          { session_id: sessionId },
          opts,
        );
        const state = w.compaction != null && typeof w.compaction === 'object'
          ? w.compaction as Wire
          : null;
        if (state != null && typeof state.compaction !== 'string') return null;
        // W1-173: блок session едет и без compaction-состояния — null-ответ
        // только когда хост не прислал ни того, ни другого.
        const session = w.session != null && typeof w.session === 'object'
          ? mapSessionExpiry(w.session as Wire)
          : null;
        if (state == null && session == null) return null;
        return {
          sessionId: typeof w.session_id === 'string' ? w.session_id : sessionId,
          compaction: state == null ? null : (state.compaction as string),
          ...(typeof state?.triggered === 'boolean' ? { triggered: state.triggered } : {}),
          ...(typeof state?.reason === 'string' ? { reason: state.reason } : {}),
          ...(typeof state?.used_tokens === 'number' ? { usedTokens: state.used_tokens } : {}),
          ...(typeof state?.threshold_tokens === 'number' ? { thresholdTokens: state.threshold_tokens } : {}),
          ...(typeof state?.usage_method === 'string' ? { usageMethod: state.usage_method } : {}),
          ...(typeof state?.compact_id === 'string' ? { compactId: state.compact_id } : {}),
          // W1-173: блок session — протухание сессии по TTL.
          ...(session ? { session } : {}),
        };
      },
      compactionConfig: async (opts) => {
        const w = await request<Wire>('/v1/chat/compaction-config', {}, undefined, opts);
        if (
          (w.window_tokens !== null && typeof w.window_tokens !== 'number')
          || typeof w.reserve_tokens !== 'number'
          || typeof w.keep_tokens !== 'number'
          || (w.threshold_tokens !== null && typeof w.threshold_tokens !== 'number')
        ) throw new Error('Invalid AI-2 chat compaction config response');
        return {
          windowTokens: w.window_tokens as number | null,
          reserveTokens: w.reserve_tokens as number,
          keepTokens: w.keep_tokens as number,
          thresholdTokens: w.threshold_tokens as number | null,
        };
      },
      // W1-189/190/199: полный постраничный список тредов tenant'а с
      // состоянием протухания; новые сверху по last_activity_at.
      sessions: async (q, opts) => {
        const w = await request<Wire>('/v1/chat/sessions', {},
          { limit: q?.limit, offset: q?.offset }, opts);
        return {
          sessions: ((w.sessions as Wire[]) ?? []).map((s) => ({
            sessionId: String(s.session_id),
            runs: typeof s.runs === 'number' ? s.runs : 0,
            createdAt: s.created_at == null ? null : String(s.created_at),
            lastActivityAt: typeof s.last_activity_at === 'number' ? s.last_activity_at : null,
            expired: s.expired === true,
            ttlHours: typeof s.ttl_hours === 'number' ? s.ttl_hours : 0,
            reason: s.reason == null ? null : String(s.reason),
          })),
          limit: typeof w.limit === 'number' ? w.limit : 0,
          offset: typeof w.offset === 'number' ? w.offset : 0,
          hasMore: w.has_more === true,
          nextCursor: w.next_cursor == null ? null : String(w.next_cursor),
          ttlHours: typeof w.ttl_hours === 'number' ? w.ttl_hours : 0,
        };
      },
      // POST /v1/chat/retry: повтор сообщения истории → 202 новый прогон.
      // Idempotency-Key поддержан хостом (Idempotent-Replayed на повторе).
      retry: async (input, opts) => {
        const headers = new Headers();
        if (input.idempotencyKey) headers.set('Idempotency-Key', input.idempotencyKey);
        const w = await request<Wire>('/v1/chat/retry',
          { ...json('POST')({ message_id: input.messageId }), headers }, undefined, opts);
        return {
          runId: String(w.run_id),
          retryOf: w.retry_of == null ? null : String(w.retry_of),
          sourceMessageId: String(w.source_message_id ?? input.messageId),
          status: String(w.status ?? 'running'),
        };
      },
    },

    memory: {
      add: (input, opts) => request('/v1/memory', json('POST')(input), undefined, opts),
      list: async (q, opts) => {
        const w = await request<Wire>('/v1/memory', {},
          { project: q.project, limit: q.limit, offset: q.offset }, opts);
        return ((w.items as Wire[]) ?? []).map(mapMemoryItem);
      },
      search: async (q, opts) => {
        const w = await request<Wire>('/v1/memory/search', {},
          { project: q.project, q: q.q, k: q.k }, opts);
        return ((w.items as Wire[]) ?? []).map(mapMemoryItem);
      },
      delete: (itemId, opts) => request(`/v1/memory/${encodeURIComponent(itemId)}`, { method: 'DELETE' }, undefined, opts),
    },

    webhooks: {
      list: async (opts) => {
        const w = await request<Wire>('/v1/webhooks', {}, undefined, opts);
        return {
          webhooks: ((w.webhooks as Wire[]) ?? []).map(mapWebhook),
          events: (w.events as string[]) ?? [],
        };
      },
      create: async (input, opts) => {
        const w = await request<Wire>('/v1/webhooks', json('POST')(input), undefined, opts);
        return { ...mapWebhook(w), secret: String(w.secret) };
      },
      update: async (webhookId, patch, opts) => {
        // strict WebhookPatch: omit undefined — server rejects explicit nulls (422)
        const wire: Record<string, unknown> = { ...patch };
        for (const k of Object.keys(wire)) if (wire[k] === undefined) delete wire[k];
        return mapWebhook(await request<Wire>(`/v1/webhooks/${encodeURIComponent(webhookId)}`, json('PATCH')(wire), undefined, opts));
      },
      delete: (webhookId, opts) => request(`/v1/webhooks/${encodeURIComponent(webhookId)}`, { method: 'DELETE' }, undefined, opts),
      deliveries: async (webhookId, q, opts) => {
        const w = await request<Wire>(`/v1/webhooks/${encodeURIComponent(webhookId)}/deliveries`, {},
          { limit: q?.limit }, opts);
        return { deliveries: ((w.deliveries as Wire[]) ?? []).map(mapDelivery) };
      },
    },

    usage: {
      get: async (q, opts) => mapUsageReport(await request<Wire>('/v1/usage', {},
        { period: q?.period, tenant: q?.tenant }, opts)),
    },

    keys: {
      list: async (q, opts) => {
        const w = await request<Wire>('/v1/keys', {}, { tenant: q?.tenant }, opts);
        return { keys: ((w.keys as Wire[]) ?? []).map(mapKey) };
      },
      create: async (input, opts) => {
        // wire: expiresAt → expires_at; `tenant` is operator-only — UI never sends it.
        const wire: Record<string, unknown> = { name: input.name, scopes: input.scopes };
        if (input.expiresAt !== undefined) wire.expires_at = input.expiresAt;
        const w = await request<Wire>('/v1/keys', json('POST')(wire), undefined, opts);
        // key_view carries the secret on `key` — exactly once, never re-listed.
        return { ...mapKey(w), secret: String(w.key) };
      },
      delete: (keyId, opts) => request(`/v1/keys/${encodeURIComponent(keyId)}`, { method: 'DELETE' }, undefined, opts),
    },

    worker: {
      launch: async (input, opts) => {
        const wire: Record<string, unknown> = { roots: input.roots };
        if (input.ops !== undefined) wire.ops = input.ops;
        if (input.commands !== undefined) wire.commands = input.commands;
        if (input.mode !== undefined) wire.mode = input.mode;
        if (input.ttlS !== undefined) wire.ttl_s = input.ttlS;
        const w = await request<Wire>('/v1/worker/launch', json('POST')(wire), undefined, opts);
        return { worker: mapWorkerStatus(w.worker as Wire), grant: mapWorkerGrant(w.grant as Wire) };
      },
      status: async (opts) => {
        const w = await request<Wire>('/v1/worker/status', {}, undefined, opts);
        return { worker: mapWorkerStatus(w.worker as Wire) };
      },
      request: async (input, opts) => {
        const wire: Record<string, unknown> = { op: input.op, args: input.args ?? {} };
        if (input.timeoutS !== undefined) wire.timeout_s = input.timeoutS;
        const w = await request<Wire>('/v1/worker/request', json('POST')(wire), undefined, opts);
        return w.result;
      },
      revoke: async (opts) => {
        const w = await request<Wire>('/v1/worker/revoke', { method: 'POST' }, undefined, opts);
        return { worker: mapWorkerStatus(w.worker as Wire) };
      },
      shutdown: async (opts) => {
        const w = await request<Wire>('/v1/worker/shutdown', { method: 'POST' }, undefined, opts);
        return { worker: mapWorkerStatus(w.worker as Wire) };
      },
    },

    images: {
      generate: async (input, opts) => {
        const wire: Record<string, unknown> = { prompt: input.prompt };
        if (input.model !== undefined) wire.model = input.model;
        if (input.enrich !== undefined) wire.enrich = input.enrich;
        const w = await request<Wire>('/v1/images/generate', json('POST')(wire), undefined, opts);
        return {
          imageB64: String(w.image_b64 ?? ''),
          mime: String(w.mime ?? ''),
          bytes: Number(w.bytes ?? 0),
          model: String(w.model ?? ''),
          costUsd: (w.cost_usd as number | null) ?? null,
          prompt: String(w.prompt ?? ''),
          enrichedPrompt: (w.enriched_prompt as string | null) ?? null,
          enriched: Boolean(w.enriched),
        } satisfies Ai2GeneratedImage;
      },
    },

    voice: {
      list: async (opts) => {
        const w = await request<Wire>('/v1/voice/voices', {}, undefined, opts);
        return {
          voices: ((w.voices as Wire[]) ?? []).map((v) => ({
            id: String(v.id),
            engine: String(v.engine),
            label: String(v.label),
            labelEn: String(v.label_en ?? ''),
            available: Boolean(v.available),
            reason: v.reason == null ? null : String(v.reason),
          })),
          defaultVoice: String(w.default_voice ?? ''),
          formats: (w.formats as string[]) ?? [],
          defaultFormat: String(w.default_format ?? ''),
          stt: {
            supported: Boolean((w.stt as Wire | undefined)?.supported),
            reason: (w.stt as Wire | undefined)?.reason == null ? null : String((w.stt as Wire).reason),
            model: (w.stt as Wire | undefined)?.model == null ? undefined : String((w.stt as Wire).model),
          },
        } satisfies Ai2VoiceCatalog;
      },
      speak: async (input, opts) => {
        const wire: Record<string, unknown> = { text: input.text };
        if (input.voice !== undefined) wire.voice = input.voice;
        if (input.format !== undefined) wire.format = input.format;
        const w = await request<Wire>('/v1/voice/tts', json('POST')(wire), undefined, opts);
        return {
          audioB64: String(w.audio_b64 ?? ''),
          mime: String(w.mime ?? ''),
          bytes: Number(w.bytes ?? 0),
          voice: String(w.voice ?? ''),
          chars: Number(w.chars ?? 0),
          cached: w.cached === true,
        } satisfies Ai2Speech;
      },
      transcribe: async (audio, opts) => {
        const { language, ...reqOpts } = opts ?? {};
        const w = await request<Wire>('/v1/voice/stt', {
          method: 'POST',
          headers: { 'content-type': audio.type || 'application/octet-stream' },
          body: audio,
        }, language != null && language !== 'auto' ? { language } : undefined, reqOpts);
        return {
          text: String(w.text ?? ''),
          language: w.language == null ? null : String(w.language),
          languageProbability: Number(w.language_probability ?? 0),
          durationS: Number(w.duration_s ?? 0),
          model: w.model == null ? null : String(w.model),
        } satisfies Ai2Transcript;
      },
    },

    telegram: {
      status: async (opts) => {
        const w = await request<Wire>('/v1/telegram/status', {}, undefined, opts);
        return mapTelegramState(w);
      },
      auth: async (input, opts) => {
        const wire: Record<string, unknown> = {};
        if (input.phone !== undefined) wire.phone = input.phone;
        if (input.code !== undefined) wire.code = input.code;
        if (input.password !== undefined) wire.password = input.password;
        const w = await request<Wire>('/v1/telegram/auth', json('POST')(wire), undefined, opts);
        return mapTelegramState(w);
      },
      chats: async (opts) => {
        const w = await request<Wire>('/v1/telegram/chats', {}, undefined, opts);
        return ((w.chats as Wire[]) ?? []).map(mapTelegramChat);
      },
      history: async (chatId, opts) => {
        const { limit, ...reqOpts } = opts ?? {};
        const w = await request<Wire>('/v1/telegram/history', {}, {
          chat_id: chatId,
          ...(limit !== undefined ? { limit: String(limit) } : {}),
        }, reqOpts);
        return ((w.messages as Wire[]) ?? []).map(mapTelegramMessage);
      },
      send: async (chatId, text, opts) => {
        const w = await request<Wire>('/v1/telegram/send',
          json('POST')({ chat_id: chatId, text }), undefined, opts);
        return mapTelegramMessage(w);
      },
      logout: async (opts) => {
        const w = await request<Wire>('/v1/telegram/logout', json('POST')({}), undefined, opts);
        return mapTelegramState(w);
      },
    },

    fs: {
      validate: async (path, opts) => {
        const w = await request<Wire>('/v1/fs/validate', json('POST')({ path }), undefined, opts);
        return {
          ok: w.ok === true,
          path: opt(w.path as string | null | undefined),
          reason: opt(w.reason as string | null | undefined),
        } satisfies FsValidateResult;
      },
      requests: async (q, opts) => {
        const w = await request<Wire>('/v1/fs/requests', {},
          { status: q?.status, run_id: q?.runId, limit: q?.limit }, opts);
        return ((w.requests as Wire[]) ?? []).map(mapFsRequest);
      },
      approve: async (requestId, opts) => {
        const w = await request<Wire>(`/v1/fs/requests/${encodeURIComponent(requestId)}/approve`,
          json('POST')({}), undefined, opts);
        return mapFsRequest(w.request as Wire);
      },
      deny: async (requestId, opts) => {
        const w = await request<Wire>(`/v1/fs/requests/${encodeURIComponent(requestId)}/deny`,
          json('POST')({}), undefined, opts);
        return mapFsRequest(w.request as Wire);
      },
    },

    bus: {
      sessions: async (opts) => {
        const w = await request<Wire>('/v1/bus/sessions', {}, undefined, opts);
        return { sessions: ((w.sessions as Wire[]) ?? []).map(mapBusSession) };
      },
      delegate: (input, opts) =>
        request<Wire>('/v1/bus/delegations', json('POST')(input), undefined, opts)
          .then((w) => w as unknown as BusDelegation),
      delegation: async (id, opts) =>
        request<Wire>(`/v1/bus/delegations/${encodeURIComponent(id)}`, {}, undefined, opts)
          .then((w) => w as unknown as BusDelegation),
      overview: async (opts) => {
        const w = await request<Wire>('/v1/bus/overview', {}, undefined, opts);
        return {
          status: String(w.status ?? 'unknown') as BusOverview['status'],
          generatedAt: Number(w.generatedAt ?? 0),
          windows: ((w.windows as Wire[]) ?? []).map((win) => ({
            window: String(win.window ?? ''),
            state: String(win.state ?? 'idle') as BusOverview['windows'][number]['state'],
            queue: Number(win.queue ?? 0),
            sent: Number(win.sent ?? 0),
            outbox: Number(win.outbox ?? 0),
            currentTask: win.currentTask == null ? null : String(win.currentTask),
            sendAgeMin: typeof win.sendAgeMin === 'number' ? win.sendAgeMin : null,
            lastAnswerAt: typeof win.lastAnswerAt === 'number' ? win.lastAnswerAt : null,
          })),
          watch: ((w.watch as Wire[]) ?? []).map((e) => ({
            time: e.time == null ? null : String(e.time),
            window: e.window == null ? null : String(e.window),
            file: e.file == null ? null : String(e.file),
            event: String(e.event ?? ''),
          })),
        };
      },
    },

    sdk: {
      confirmations: async (runId, opts) => {
        const w = await request<Wire>(
          `/v1/sdk/runs/${encodeURIComponent(runId)}/confirmations`, {}, undefined, opts);
        return {
          confirmations: ((w.confirmations as Wire[]) ?? []).map((c) => ({
            callId: String(c.callId ?? c.call_id ?? ''),
            tool: c.tool == null ? null : String(c.tool),
            input: c.input,
            parentCallId: (c.parentCallId ?? c.parent_call_id) == null
              ? null : String(c.parentCallId ?? c.parent_call_id),
            state: String(c.state ?? 'awaiting') as SdkConfirmation['state'],
            requestedAt: typeof c.requestedAt === 'number'
              ? c.requestedAt
              : (typeof c.requested_at === 'number' ? c.requested_at : null),
          })),
        };
      },
      confirm: (runId, callId, input, opts) =>
        request<Wire>(
          `/v1/sdk/runs/${encodeURIComponent(runId)}/confirmations/${encodeURIComponent(callId)}`,
          json('POST')(input), undefined, opts)
          .then((w) => ({
            resolved: w.resolved === true,
            state: w.state == null ? null : String(w.state),
          })),
      auditLog: async (q, opts) => {
        const w = await request<Wire>('/v1/sdk/audit', {}, {
          limit: q?.limit,
          offset: q?.offset,
          run_id: q?.runId,
        }, opts);
        return {
          entries: ((w.entries as Wire[]) ?? []).map((e): SdkAuditEntry => ({
            id: String(e.id ?? ''),
            ts: typeof e.ts === 'number' ? e.ts : null,
            actor: e.actor == null ? null : String(e.actor),
            runId: e.runId == null && e.run_id == null ? null : String(e.runId ?? e.run_id),
            callId: e.callId == null && e.call_id == null ? null : String(e.callId ?? e.call_id),
            tool: e.tool == null ? null : String(e.tool),
            decision: String(e.decision ?? ''),
            reason: e.reason == null ? null : String(e.reason),
            initiator: e.initiator == null ? null : String(e.initiator),
            source: e.source == null ? null : String(e.source),
            sha256: e.sha256 == null ? null : String(e.sha256),
          })),
          total: typeof w.total === 'number' ? w.total : null,
          limit: typeof w.limit === 'number' ? w.limit : null,
          offset: typeof w.offset === 'number' ? w.offset : null,
        };
      },
      sessions: async (q, opts) => {
        const w = await request<Wire>('/v1/sdk/sessions', {}, {
          archived: q?.archived ? 'true' : undefined,
          assistant: q?.assistant,
          status: q?.status,
          limit: q?.limit,
        }, opts);
        return {
          sessions: ((w.sessions as Wire[]) ?? []).map((s) => ({
            id: String(s.id ?? ''),
            window: String(s.window ?? ''),
            kind: String(s.kind ?? ''),
            title: s.title == null ? null : String(s.title),
            status: String(s.status ?? ''),
            lastActivityAt: typeof s.lastActivityAt === 'number' ? s.lastActivityAt : null,
            messageCount: typeof s.messageCount === 'number' ? s.messageCount : null,
            parent: s.parent == null || typeof s.parent !== 'object'
              ? null
              : {
                  sessionId: String((s.parent as Wire).sessionId ?? ''),
                  atMessage: String((s.parent as Wire).atMessage ?? ''),
                },
            archived: s.archived === true,
          })),
        };
      },
      sessionUsage: async (sessionId, opts) => {
        const w = await request<Wire>(
          `/v1/sdk/sessions/${encodeURIComponent(sessionId)}/usage`, {}, undefined, opts);
        return {
          ...mapUsageTotals(w),
          sessionId: String(w.sessionId ?? sessionId),
          runs: typeof w.runs === 'number' ? w.runs : null,
        };
      },
      assistantUsage: async (opts) => {
        const w = await request<Wire>('/v1/sdk/usage/assistants', {}, undefined, opts);
        return {
          assistants: ((w.assistants as Wire[]) ?? []).map((row): SdkAssistantUsageRow => ({
            ...mapUsageTotals(row),
            assistant: String(row.assistant ?? ''),
            runs: typeof row.runs === 'number' ? row.runs : 0,
          })),
        };
      },
      patchSession: async (sessionId, input, opts) => {
        const wire: Record<string, unknown> = { ...input };
        for (const k of Object.keys(wire)) if (wire[k] === undefined) delete wire[k];
        const w = await request<Wire>(
          `/v1/sdk/sessions/${encodeURIComponent(sessionId)}`,
          { method: 'PATCH', body: JSON.stringify(wire), headers: { 'content-type': 'application/json' } },
          undefined, opts);
        return { id: String(w.id ?? sessionId), updated: w.updated === true };
      },
      forkSession: async (sessionId, input, opts) => {
        const wire: Record<string, unknown> = { ...input };
        for (const k of Object.keys(wire)) if (wire[k] === undefined) delete wire[k];
        const w = await request<Wire>(
          `/v1/sdk/sessions/${encodeURIComponent(sessionId)}/fork`,
          json('POST')(wire), undefined, opts);
        return {
          id: String(w.id ?? ''),
          parentSessionId: String(w.parentSessionId ?? sessionId),
          atMessage: w.atMessage == null ? null : String(w.atMessage),
          key: w.key == null ? null : String(w.key),
          childSessionId: w.childSessionId == null ? null : String(w.childSessionId),
          state: String(w.state ?? '') as SdkForkResult['state'],
        };
      },
      run: async (input, opts) => {
        const wire: Record<string, unknown> = { ...input };
        for (const k of Object.keys(wire)) if (wire[k] === undefined) delete wire[k];
        const w = await request<Wire>('/v1/sdk/runs', json('POST')(wire), undefined, opts);
        return {
          id: String(w.id ?? ''),
          to: String(w.to ?? ''),
          state: String(w.state ?? ''),
          createdAt: typeof w.createdAt === 'number' ? w.createdAt : null,
        };
      },
      delegations: async (q, opts) => {
        const w = await request<Wire>('/v1/sdk/delegations', {},
          { parent_run_id: q?.parentRunId }, opts);
        return {
          delegations: ((w.delegations as Wire[]) ?? []).map(mapSdkDelegation),
        };
      },
      delegate: async (runId, input, opts) => {
        const wire: Record<string, unknown> = { ...input };
        for (const k of Object.keys(wire)) if (wire[k] === undefined) delete wire[k];
        const w = await request<Wire>(
          `/v1/sdk/runs/${encodeURIComponent(runId)}/delegations`,
          json('POST')(wire), undefined, opts);
        return {
          id: String(w.id ?? ''),
          to: String(w.to ?? ''),
          state: String(w.state ?? ''),
          createdAt: typeof w.createdAt === 'number' ? w.createdAt : null,
        };
      },
      cancelRun: async (runId, opts) => {
        const w = await request<Wire>(
          `/v1/sdk/runs/${encodeURIComponent(runId)}/cancel`,
          json('POST')({}), undefined, opts);
        return { id: String(w.id ?? runId), cancelled: w.cancelled === true };
      },
      handoffs: async (q, opts) => {
        const w = await request<Wire>('/v1/sdk/handoffs', {},
          { status: q?.status }, opts);
        return { handoffs: ((w.handoffs as Wire[]) ?? []).map(mapSdkHandoff) };
      },
      createHandoff: async (input, opts) => {
        const wire: Record<string, unknown> = {
          to: input.to,
          prompt: input.prompt,
          from_agent: input.fromAgent,
          run_id: input.runId,
        };
        for (const k of Object.keys(wire)) if (wire[k] === undefined) delete wire[k];
        const w = await request<Wire>('/v1/sdk/handoffs', json('POST')(wire), undefined, opts);
        return mapSdkHandoff(w);
      },
      resolveHandoff: async (id, accept, reason, opts) => {
        const w = await request<Wire>(
          `/v1/sdk/handoffs/${encodeURIComponent(id)}/${accept ? 'accept' : 'decline'}`,
          json('POST')(reason != null && reason !== '' ? { reason } : {}), undefined, opts);
        return mapSdkHandoff(w);
      },
      rules: async (q, opts) => {
        const w = await request<Wire>('/v1/sdk/rules', {},
          { directory: q?.directory }, opts);
        return {
          root: w.root == null ? null : String(w.root),
          rules: ((w.rules as Wire[]) ?? []).map((r): SdkRule => ({
            path: String(r.path ?? ''),
            name: String(r.name ?? ''),
            sizeBytes: typeof r.sizeBytes === 'number' ? r.sizeBytes : null,
            mtimeMs: typeof r.mtimeMs === 'number' ? r.mtimeMs : null,
            source: String(r.source ?? ''),
          })),
        };
      },
      usage: async (runId, opts) => {
        const w = await request<Wire>(
          `/v1/sdk/runs/${encodeURIComponent(runId)}/usage`, {}, undefined, opts);
        const num = (v: unknown): number | null =>
          typeof v === 'number' && !Number.isNaN(v) ? v : null;
        return {
          runId: String(w.runId ?? runId),
          sessionId: w.sessionId == null ? null : String(w.sessionId),
          model: w.model == null ? null : String(w.model),
          inputTokens: num(w.inputTokens),
          outputTokens: num(w.outputTokens),
          cacheReadTokens: num(w.cacheReadTokens),
          cacheCreationTokens: num(w.cacheCreationTokens),
          totalCostUsd: num(w.totalCostUsd),
          durationMs: num(w.durationMs),
          durationApiMs: num(w.durationApiMs),
          numTurns: num(w.numTurns),
          contextFill: num(w.contextFill),
          modelUsage: w.modelUsage ?? null,
        };
      },
      checkpoints: async (runId, opts) => {
        const w = await request<Wire>(
          `/v1/sdk/runs/${encodeURIComponent(runId)}/checkpoints`, {}, undefined, opts);
        return {
          checkpoints: ((w.checkpoints as Wire[]) ?? []).map((c): SdkCheckpoint => ({
            id: String(c.id ?? ''),
            runId: String(c.runId ?? runId),
            callId: c.callId == null ? null : String(c.callId),
            tool: c.tool == null ? null : String(c.tool),
            root: c.root == null ? null : String(c.root),
            createdAt: c.createdAt == null ? null : String(c.createdAt),
            files: ((c.files as Wire[]) ?? []).map((f): SdkCheckpointFile => ({
              path: String(f.path ?? ''),
              sha256: f.sha256 == null ? null : String(f.sha256),
              size: typeof f.size === 'number' ? f.size : null,
              mtime: typeof f.mtime === 'number' ? f.mtime : null,
              existed: typeof f.existed === 'boolean' ? f.existed : null,
              ...(f.excluded != null ? { excluded: String(f.excluded) } : {}),
              ...(f.skipped != null ? { skipped: String(f.skipped) } : {}),
            })),
          })),
        };
      },
      rewind: async (runId, checkpointId, opts) => {
        const w = await request<Wire>(
          `/v1/sdk/runs/${encodeURIComponent(runId)}/checkpoints/${encodeURIComponent(checkpointId)}/rewind`,
          json('POST')({}), undefined, opts);
        return {
          callId: String(w.callId ?? w.call_id ?? ''),
          tool: w.tool == null ? null : String(w.tool),
          input: w.input,
          parentCallId: (w.parentCallId ?? w.parent_call_id) == null
            ? null : String(w.parentCallId ?? w.parent_call_id),
          state: String(w.state ?? 'awaiting') as SdkConfirmation['state'],
          requestedAt: typeof w.requestedAt === 'number'
            ? w.requestedAt
            : (typeof w.requested_at === 'number' ? w.requested_at : null),
        };
      },
    },

    mcp: {
      servers: async (opts) => {
        const w = await request<Wire>('/v1/mcp/servers', {}, undefined, opts);
        return {
          configured: w.configured === true,
          error: w.error == null ? null : String(w.error),
          servers: ((w.servers as Wire[]) ?? []).map(mapMcpServer),
        };
      },
      call: async (name, input, opts) => {
        const wire: Record<string, unknown> = {
          tool: input.tool,
          arguments: input.arguments,
          request_id: input.requestId,
        };
        for (const k of Object.keys(wire)) if (wire[k] === undefined) delete wire[k];
        return request<McpCallResponse>(
          `/v1/mcp/servers/${encodeURIComponent(name)}/call`,
          json('POST')(wire), undefined, opts);
      },
    },

    prompts: async (opts) => {
      const w = await request<Wire>('/v1/prompts', {}, undefined, opts);
      return {
        prompts: ((w.prompts as Wire[]) ?? []).map((p) => ({
          name: String(p.name ?? ''),
          path: p.path == null ? null : String(p.path),
          source: p.source == null ? undefined : String(p.source) as Ai2PromptFile['source'],
          id: p.id == null ? undefined : String(p.id),
          updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : undefined,
        })),
      };
    },
    createPrompt: async (input, opts) =>
      mapSdkSavedPrompt(await request<Wire>('/v1/prompts', json('POST')(input), undefined, opts)),
    updatePrompt: async (id, input, opts) => {
      const wire: Record<string, unknown> = { ...input };
      for (const k of Object.keys(wire)) if (wire[k] === undefined) delete wire[k];
      return mapSdkSavedPrompt(await request<Wire>(
        `/v1/prompts/${encodeURIComponent(id)}`,
        { method: 'PATCH', body: JSON.stringify(wire), headers: { 'content-type': 'application/json' } },
        undefined, opts));
    },
    deletePrompt: async (id, opts) => {
      const w = await request<Wire>(`/v1/prompts/${encodeURIComponent(id)}`,
        { method: 'DELETE' }, undefined, opts);
      return { id: String(w.id ?? id), deleted: w.deleted === true };
    },

    neuPlugins: {
      list: async (opts) => {
        const w = await request<Wire>('/v1/neu/plugins', {}, undefined, opts);
        return {
          plugins: ((w.plugins as Wire[]) ?? []).map(mapNeuPlugin),
          recovery: w.recovery === true,
          sources: ((w.sources as Wire[]) ?? []).map((s) => ({
            source: String(s.source ?? ''),
            path: String(s.path ?? ''),
          })),
        };
      },
      setEnabled: async (id, enabled, opts) => {
        const w = await request<Wire>(`/v1/neu/plugins/${encodeURIComponent(id)}/toggle`,
          json('POST')({ enabled }), undefined, opts);
        return mapNeuPlugin((w.plugin as Wire | undefined) ?? w);
      },
      setRowEnabled: async (id, rowId, enabled, opts) => {
        const w = await request<Wire>(
          `/v1/neu/plugins/${encodeURIComponent(id)}/rows/${encodeURIComponent(rowId)}/toggle`,
          json('POST')({ enabled }), undefined, opts);
        return mapNeuPlugin((w.plugin as Wire | undefined) ?? w);
      },
    },
  };
}

function mapNeuPlugin(w: Wire): NeuPluginEntry {
  const rows = Array.isArray(w.rows) ? (w.rows as Wire[]).map((r) => ({
    rowId: String(r.id ?? r.rowId ?? r.row_id ?? ''),
    slot: String(r.slot ?? ''),
    title: r.title == null ? null : String(r.title),
    enabled: r.enabled === true,
  })) : null;
  const rawErrors = Array.isArray(w.errors) ? w.errors : null;
  const rawPermissions = Array.isArray(w.permissions) ? w.permissions : null;
  const rawContributes = typeof w.contributes === 'object' && w.contributes != null
    ? w.contributes as Record<string, unknown>
    : null;
  return {
    id: String(w.id ?? ''),
    version: w.version == null ? null : String(w.version),
    title: w.title == null ? null : String(w.title),
    description: w.description == null ? null : String(w.description),
    icon: w.icon == null ? null : String(w.icon),
    kind: String(w.source ?? w.kind ?? '') as NeuPluginEntry['kind'],
    status: String(w.status ?? '') as NeuPluginEntry['status'],
    enabled: w.enabled === true,
    overriddenBy: w.overriddenBy == null ? null : String(w.overriddenBy),
    errors: rawErrors == null ? null : rawErrors.map(String),
    permissions: rawPermissions == null ? null : rawPermissions.map(String),
    contributes: rawContributes == null ? null : Object.fromEntries(
      Object.entries(rawContributes).map(([slot, ids]) => [slot, Array.isArray(ids) ? ids.map(String) : []]),
    ),
    rows,
    clientEntry: w.clientEntry == null ? null : String(w.clientEntry),
    clientHash: w.clientHash == null ? null : String(w.clientHash),
    hasHostEntry: typeof w.hasHostEntry === 'boolean' ? w.hasHostEntry : null,
  };
}

/** Суммы учёта (host `_USAGE_SUM_KEYS` + model/contextFill): отсутствующее
 *  у SDK — null, не 0. Используется и сессией, и разбивкой по ассистентам. */
function mapUsageTotals(w: Wire): SdkUsageTotals {
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  return {
    inputTokens: num(w.inputTokens),
    outputTokens: num(w.outputTokens),
    cacheReadTokens: num(w.cacheReadTokens),
    cacheCreationTokens: num(w.cacheCreationTokens),
    totalCostUsd: num(w.totalCostUsd),
    durationMs: num(w.durationMs),
    durationApiMs: num(w.durationApiMs),
    numTurns: num(w.numTurns),
    model: w.model == null ? null : String(w.model),
    contextFill: num(w.contextFill),
    modelUsage: w.modelUsage ?? null,
  };
}

function mapSdkDelegation(w: Wire): SdkDelegation {
  return {
    id: String(w.id ?? ''),
    parentRunId: w.parentRunId == null ? null : String(w.parentRunId),
    agent: w.agent == null ? null : String(w.agent),
    label: w.label == null ? null : String(w.label),
    state: w.state == null ? null : String(w.state),
    createdAt: typeof w.createdAt === 'number' ? w.createdAt : null,
    durationMs: typeof w.durationMs === 'number' ? w.durationMs : null,
    summary: w.summary == null ? null : String(w.summary),
    summaryPath: w.summaryPath == null ? null : String(w.summaryPath),
  };
}

function mapSdkHandoff(w: Wire): SdkHandoff {
  return {
    id: String(w.id ?? ''),
    from: w.from == null ? null : String(w.from),
    to: String(w.to ?? ''),
    prompt: String(w.prompt ?? ''),
    runId: w.runId == null ? null : String(w.runId),
    status: String(w.status ?? 'pending') as SdkHandoff['status'],
    reason: w.reason == null ? null : String(w.reason),
    createdAt: typeof w.createdAt === 'number' ? w.createdAt : null,
    resolvedAt: typeof w.resolvedAt === 'number' ? w.resolvedAt : null,
  };
}

function mapMcpServer(w: Wire): McpServer {
  return {
    name: String(w.name ?? ''),
    transport: w.transport == null ? null : String(w.transport),
    command: w.command == null ? null : String(w.command),
    args: Array.isArray(w.args) ? w.args.map(String) : [],
    tools: Array.isArray(w.tools)
      ? (w.tools as Wire[]).map((t) => ({ name: String(t.name ?? '') }))
      : null,
    envKeys: Array.isArray(w.envKeys) ? w.envKeys.map(String) : [],
    status: String(w.status ?? ''),
    error: w.error == null ? null : String(w.error),
  };
}

function mapSdkSavedPrompt(w: Wire): SdkSavedPrompt {
  return {
    id: String(w.id ?? ''),
    title: String(w.title ?? ''),
    body: String(w.body ?? ''),
    createdAt: typeof w.createdAt === 'number' ? w.createdAt : null,
    updatedAt: typeof w.updatedAt === 'number' ? w.updatedAt : null,
  };
}

const BUS_SESSION_STATUSES = new Set(['idle', 'busy', 'locked', 'unknown']);
const BUS_SESSION_KINDS = new Set(['desktop', 'tui', 'cloud']);

function mapBusSession(w: Wire): BusSession {
  return {
    id: String(w.id ?? ''),
    window: String(w.window ?? ''),
    title: String(w.title ?? ''),
    kind: (BUS_SESSION_KINDS.has(w.kind as string) ? w.kind : 'unknown') as BusSession['kind'],
    status: (BUS_SESSION_STATUSES.has(w.status as string) ? w.status : 'unknown') as BusSession['status'],
    lastActivityAt: typeof w.lastActivityAt === 'number' ? w.lastActivityAt : null,
  };
}

function mapFsRequest(w: Wire): FsWriteRequest {
  return {
    id: String(w.id),
    runId: String(w.run_id),
    root: String(w.root),
    path: String(w.path),
    op: String(w.op ?? 'write'),
    size: Number(w.size ?? 0),
    sha256: String(w.sha256 ?? ''),
    preview: String(w.preview ?? ''),
    status: String(w.status ?? 'pending') as FsRequestStatus,
    createdAt: Number(w.created_at ?? 0),
    resolvedAt: w.resolved_at == null ? null : Number(w.resolved_at),
  };
}

function mapTelegramState(w: Wire): Ai2TelegramState {
  return {
    status: String(w.status ?? 'error') as Ai2TelegramState['status'],
    authStep: String(w.auth_step ?? 'none') as Ai2TelegramState['authStep'],
    error: w.error == null ? null : String(w.error),
  };
}

function mapTelegramChat(w: Wire): Ai2TelegramChat {
  return {
    chatId: String(w.chat_id ?? ''),
    title: String(w.title ?? ''),
    lastText: String(w.last_text ?? ''),
    lastTs: Number(w.last_ts ?? 0),
    unread: Number(w.unread ?? 0),
  };
}

function mapTelegramMessage(w: Wire): Ai2TelegramMessage {
  return {
    messageId: String(w.message_id ?? ''),
    chatId: String(w.chat_id ?? ''),
    fromMe: Boolean(w.from_me),
    text: String(w.text ?? ''),
    ts: Number(w.ts ?? 0),
  };
}
