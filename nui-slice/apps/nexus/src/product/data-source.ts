'use client';

import type {
  AgentSpec,
  ApiKeyInfo,
  ApprovalDecision,
  ApprovalRequest,
  InstagramAccountType,
  InstagramApiSource,
  InstagramApiState,
  InstagramApiStatus,
  InstagramComment,
  InstagramWebSource,
  InstagramWebState,
  ModelInfo,
  MemoryGraphData,
  MemoryItem,
  MemorySearchHit,
  MemoryStructure,
  MissionGraphData,
  ModelRouterData,
  NexusMission,
  PluginInfo,
  PresetInfo,
  PromptFileRef,
  RunControlState,
  RunDetail,
  RunEventView,
  RunPlan,
  RunStatus,
  RunSummary,
  SystemMetrics,
  UsageSummary,
  CalendarAgendaItem,
  GeneratedImage,
  PickedDocument,
  ServiceIntegration,
  SocialAgentState,
  TelegramMessage,
  TelegramSource,
  TelegramState,
  TelegramStatus,
  UnrealSceneEvent,
  UnrealSceneHostState,
  WebhookDelivery,
  WebhookRow,
  YouTubeHit,
  SocialAccount,
  SocialHubState,
  SocialPost,
  SocialSource,
  YouTubeVideo,
  YouTubeCommentRow,
  XTweet,
  XMention,
} from '@nexus/mock-data';
import type { HandoffLink, PresenceEntry } from '@nexus/patterns';
import type { NoirClient } from '../integrations/noir/api/client';
import { createLazyNoirClient } from '../integrations/noir/api/lazy-client';
import { createAi2DataSource } from '../integrations/ai2/adapters/product-data-source';
import type { OpenCodeSeam } from '../integrations/opencode/seam';
import type { CraftSeam } from '../integrations/craft/seam';
import { createLazySeam } from './lazy-seam';
import { useEffect, useState } from 'react';

/**
 * Product data seam (task file §5): screens consume ONLY this interface.
 * Today it is backed by deterministic fixtures; Window-1 adapters replace
 * the implementation behind the same signatures — no screen changes.
 */

export interface StartRunInput {
  task: string;
  config: string;
  agent?: string | null;
  project?: string | null;
  /** Server model id — the user's local default (`profile.defaultModelId`);
   *  `default`/null defers to the server's env model (AI2 contract). */
  model?: string | null;
  /** Grant `memory_search` for this run (M2). The host validator requires
   *  `project` alongside — callers send both fields or neither. */
  useMemory?: boolean;
  /** fs-access dispatch: declared filesystem policy (roots + mode). Sent
   *  only when the user declared roots — absent keeps host workdir-only
   *  default. With a policy the host hides `python` (boundary variant 1). */
  fsPolicy?: import('../integrations/ai2/contracts/fs').FsPolicy;
  /** Wave XI — режим композитора ('agent'|'ask'|'plan') из профиля. На провод
   *  не уходит: RunIn хоста `extra="forbid"` и поля mode не имеет (W1 seam
   *  pending) — адаптеры обязаны не слать его на сервер. */
  mode?: import('../integrations/ai2/contracts/copilot').ComposerMode;
  /** Idempotency key: one per user click, reused across retries of the same
   *  attempt so the adapter can tell a retry from a fresh click. Generated
   *  here (UI zone); the adapter sends it as Idempotency-Key header. */
  idempotencyKey?: string;
}

/**
 * VIII V3-3 — снапшот данных для 3D-панелей Runtime на сцене UE
 * (поля — по §11 unreal-scene-bridge-contract). null = seam упал/пуст:
 * «нет данных», сцена панель не рисует. Никаких синтетических значений.
 */
export interface UnrealScenePanelData {
  agents: AgentSpec[] | null;
  presence: PresenceEntry[] | null;
  runs: RunSummary[] | null;
  metrics: SystemMetrics | null;
  models: ModelInfo[] | null;
  usage: UsageSummary | null;
  /** epoch s — момент сборки снапшота (свежесть для сцены). */
  collectedAt: number;
}

/** W1-143 `/v1/chat/compact` outcomes. A 200 may also say no compaction was needed. */
export interface ChatCompactSuccess {
  compacted: true;
  compactId: string;
  threadId: string;
  summary: string;
  coversMessageIds: string[];
  keptMessageIds: string[];
  createdAt: string;
}

export interface ChatCompactNoop {
  compacted: false;
  reason: string;
  threadId: string;
  coversMessageIds: string[];
  keptMessageIds: string[];
}

export type ChatCompactResult = ChatCompactSuccess | ChatCompactNoop;

export type ChatCompactInput = (
  | { runIds: string[]; thread?: string }
  | { runIds?: never; thread: string }
) & {
  maxTokens?: number;
  maxMessages?: number;
  keepTokens?: number;
};

/** W1-139 auto-compactor status and W1 threshold config. */
export interface ChatCompactionStatus {
  sessionId: string;
  /** null — хост не сообщает состояния авто-компакта (нет компактора и
   *  durable-записи); блок session при этом всё равно может присутствовать. */
  compaction: string | null;
  triggered?: boolean;
  reason?: string;
  usedTokens?: number;
  thresholdTokens?: number;
  usageMethod?: string;
  compactId?: string;
  /** W1-173 блок `session` — протухание сессии по TTL (expired/ttl/reason). */
  session?: import('../integrations/ai2/contracts/chat-compaction').Ai2ChatSessionExpiry;
}

export interface ChatCompactionConfig {
  windowTokens: number | null;
  reserveTokens: number;
  keepTokens: number;
  thresholdTokens: number | null;
}

export type ChatCompactAction = (input: ChatCompactInput) => Promise<ChatCompactResult>;

/** W3-143: одна запись страницы GET /v1/chat/history. Message-entry уже
 *  разобрана до runId/part — id на wire это `<run_id>:task|answer`. */
export interface ChatHistoryMessage {
  kind: 'message';
  /** Полный host id сообщения (`<run>:task|answer`) — курсор и дедуп. */
  id: string;
  runId: string;
  part: 'task' | 'answer';
  role: 'user' | 'assistant';
  text: string | null;
  createdAt: number | null;
}

export interface ChatHistoryCompact {
  kind: 'compact';
  id: string;
  summary: string;
  coversMessageIds: string[];
  createdAt: string | null;
}

export type ChatHistoryEntry = ChatHistoryMessage | ChatHistoryCompact;

export interface ChatHistoryPage {
  sessionId: string;
  /** Хронологический порядок (старые → новые) — wire newest-first уже
   *  перевёрнут адаптером. */
  entries: ChatHistoryEntry[];
  hasMore: boolean;
  /** Host-курсор следующей (более старой) страницы. */
  nextCursor: string | null;
}

export interface ChatHistoryQuery {
  beforeId?: string;
  limit?: number;
  /** effective=1 — компакт-ноды вместо покрытых сообщений. */
  effective?: boolean;
}

export interface ProductDataSource {
  /** Раздел «Соц. Сети»: оператор AGENT-A; публикация возможна только через approval. */
  social?: SocialSource;
  listPresets(): Promise<PresetInfo[]>;
  listModels(): Promise<ModelInfo[]>;
  listAgents(): Promise<AgentSpec[]>;
  /**
   * Agent registry management — /v1/agents (create/patch/delete named
   * specs the runtime applies to `agent`-assigned runs and spawn_agent
   * children). Optional: mock keeps listAgents but never fabricates
   * registry writes — absent seam → management controls `unavailable`.
   */
  agents?: {
    get(name: string): Promise<import('../integrations/ai2/contracts/agents').Ai2Agent>;
    create(input: import('../integrations/ai2/contracts/agents').CreateAgentInput): Promise<import('../integrations/ai2/contracts/agents').Ai2Agent>;
    update(name: string, patch: import('../integrations/ai2/contracts/agents').PatchAgentInput): Promise<import('../integrations/ai2/contracts/agents').Ai2Agent>;
    delete(name: string): Promise<void>;
  };
  /** Recent runs for history/briefing — newest first.
   *  `parent` filters to children of a run (host `?parent=` — verified wire).
   *  `agent: null` = runs WITHOUT an agent (the wire cannot express it — the
   *  live adapter filters client-side; the mock does the same, so both
   *  sources answer the same set). `agent: undefined` = no agent filter. */
  listRuns(opts?: { since?: number; limit?: number; agent?: string | null; parent?: string; status?: RunStatus; offset?: number }): Promise<RunSummary[]>;
  /** Live presence per registry spec — server process vocab verbatim. */
  listPresence(): Promise<PresenceEntry[]>;
  /** Delegation chain between agents (parent → child runs). */
  listHandoffs(): Promise<HandoffLink[]>;
  /** Mission constellation graph — W4 NexusGraphData shape. */
  getMissionGraph(): Promise<MissionGraphData>;
  /** Mission list — newest/active first. */
  listMissions(): Promise<NexusMission[]>;
  /**
   * Known projects — derived, not an endpoint (missing-api §2.1): union of
   * run+memory project values over the fetched window. May be incomplete
   * under pagination; sources that can't derive it leave it undefined and
   * screens hide the switcher rather than fabricating "all".
   */
  listProjects?(): Promise<string[]>;
  /** Project memory items — newest first (GET /v1/memory, project-scoped). */
  listMemory(project?: string): Promise<MemoryItem[]>;
  /** Scoped memory search (POST /v1/memory/search, project-scoped). */
  searchMemory(query: string, project?: string): Promise<MemorySearchHit[]>;
  /** W1-143 POST /v1/chat/compact; may compact an explicit set of run IDs. */
  chatCompact?: ChatCompactAction;
  /** W1-139 GET /v1/chat/compaction-status?session_id=<root-run-id>. */
  getChatCompactionStatus?(sessionId: string): Promise<ChatCompactionStatus | null>;
  /** W1-140 GET /v1/chat/compaction-config; unknown window stays null. */
  getChatCompactionConfig?(): Promise<ChatCompactionConfig>;
  /** W3-143 GET /v1/chat/history — cursor-пагинация треда (root run id).
   *  Опциональный seam: без него лента показывает только snapshot+live. */
  getChatHistory?(threadId: string, q?: ChatHistoryQuery): Promise<ChatHistoryPage>;
  /** Client-computed structure — recent window only (missing-api §2.5). */
  getMemoryStructure(): Promise<MemoryStructure>;
  /** Memory knowledge graph — W4 NexusGraphData-compatible shape. */
  getMemoryGraph(): Promise<MemoryGraphData>;
  /** Router graph — W4 NexusGraphData-compatible shape. */
  getModelRouter(): Promise<ModelRouterData>;
  /** Usage/cost summary (GET /v1/usage). */
  getUsage(): Promise<UsageSummary>;
  /** Plugin registry (GET /v1/plugins). */
  listPlugins(): Promise<PluginInfo[]>;
  /**
   * PATCH /v1/plugins/{name} — optional until an adapter wires it; when absent
   * the screen disables the toggle (honest read-only), never fakes the write.
   */
  updatePlugin?(name: string, patch: { active?: boolean }): Promise<PluginInfo | null>;
  /** Webhooks + recent deliveries (GET /v1/webhooks). */
  listWebhooks(): Promise<WebhookRow[]>;
  listWebhookDeliveries(): Promise<WebhookDelivery[]>;
  /**
   * Webhook write-path (POST /v1/webhooks) — optional until W1 wires it.
   * The secret is returned exactly once at creation; callers surface it
   * with a (mock) marker and never re-list it. When absent the screen
   * hides the create form.
   */
  createWebhook?(input: { url: string; events: string[] }): Promise<{ webhook: WebhookRow; secret: string }>;
  /** PATCH-style toggle (active flag). Optional — mock covers the write. */
  updateWebhook?(webhookId: string, patch: { active?: boolean }): Promise<WebhookRow | null>;
  /** DELETE /v1/webhooks/{id}. Optional — same policy. */
  deleteWebhook?(webhookId: string): Promise<void>;
  /** System metrics + component health (GET /v1/metrics + /v1/health). */
  getMetrics(): Promise<SystemMetrics>;
  /** API keys — whole list, no pagination (missing-api §2.4). */
  listApiKeys(): Promise<ApiKeyInfo[]>;
  /**
   * Key write-path (POST/DELETE /v1/keys) — optional until an adapter wires it.
   * The secret is returned exactly once at creation (wire field `key`);
   * callers surface it once and never re-list it. When absent the screen
   * hides key management controls.
   */
  createApiKey?(input: { name: string; scopes: string[] }): Promise<{ key: ApiKeyInfo; secret: string }>;
  /** DELETE /v1/keys/{id} → 204 (idempotent server-side). */
  revokeApiKey?(keyId: string): Promise<void>;
  /**
   * Run detail — run + persisted events + stored result (backlog #2).
   * Optional until W1 wires `runs.get/events/result`; when absent the
   * /run screen renders `data-state="unavailable"`, not a stub of data.
   * Resolves null when the runId is unknown to the source.
   */
  getRunDetail?(runId: string): Promise<RunDetail | null>;
  /**
   * Approval queue (plan/approval lifecycle, O7) — optional until W1 wires a
   * real approval endpoint. When absent the UI marks the queue
   * `data-state="unavailable"`; it never implies an empty queue.
   */
  listApprovals?(opts?: { runId?: string; status?: ApprovalRequest['status'] }): Promise<ApprovalRequest[]>;
  /** Approve/deny a pending request; null when the id is unknown or already decided. */
  respondApproval?(approvalId: string, decision: ApprovalDecision): Promise<ApprovalRequest | null>;
  /**
   * YouTube Data API search (media-playback contract). Optional until W1
   * wires the provider adapter — when absent the screen marks search
   * `unavailable` instead of fabricating results. Mock returns the
   * deterministic `youtubeHits` fixture labeled as mock on screen.
   */
  searchYouTube?(query: string): Promise<YouTubeHit[]>;
  startRun(input: StartRunInput): Promise<RunSummary>;
  cancelRun(runId: string): Promise<void>;
  /**
   * Host capabilities — GET /v1/capabilities (W1-05 contract). Optional for
   * non-AI-2 sources; when absent screens assume every optional feature is
   * unknown → unavailable, never silently present. The feature map is what
   * decides whether an optional seam SHOULD exist on a live source.
   */
  getCapabilities?(): Promise<import('../integrations/ai2/contracts/capabilities').Ai2Capabilities>;
  /**
   * Pre-start plan preview (O7/W3-02) — optional until W1 wires a planner
   * endpoint. When absent the plan card marks `data-state="unavailable"`;
   * the composer still works without it. The plan is what the runtime
   * DECLARES it will do — never hidden model reasoning.
   */
  previewRunPlan?(input: StartRunInput): Promise<RunPlan>;
  /**
   * Remote image generation (INT-23) — POST /v1/images/generate on live;
   * the host owns provider keys, the shell never sees secrets. Gate
   * availability via `getCapabilities().features.imageGen` when present;
   * absent seam → `unavailable`, never a fabricated call.
   */
  generateImage?(input: { prompt: string; model?: string; enrich?: boolean }): Promise<GeneratedImage>;
  /**
   * INT-24 — NOIR player surface (noir_bot `/api/*`). The value is the typed
   * client itself: `session.create(initData)` → `withToken(token)` →
   * `player.*`/`actions.*`. Session creation needs Telegram Mini App
   * initData on live — a desktop host cannot mint it, so the screen offers
   * the honest input and renders `unavailable` when the seam is absent.
   */
  noir?: import('../integrations/noir/api/client').NoirClient;
  /**
   * Run controls (O7/W3-04/05) — optional until W1 wires pause/resume/
   * replay. Unavailable actions carry a reason; the UI disables them and
   * never presents a no-op. `replay` means event-stream replay from seq 0 —
   * it never re-executes the task or repeats external side effects.
   */
  getRunControls?(runId: string): Promise<RunControlState>;
  pauseRun?(runId: string): Promise<RunControlState | null>;
  resumeRun?(runId: string): Promise<RunControlState | null>;
  replayRun?(runId: string): Promise<RunControlState | null>;
  /** Checkpoint persistence — optional; absent/unsupported → unavailable with reason, never a no-op button. */
  checkpointRun?(runId: string): Promise<RunControlState | null>;
  /**
   * Retry — creates a NEW run with the same input (new runId); the original
   * stays in history unchanged. Only valid on terminal runs.
   */
  retryRun?(runId: string): Promise<RunSummary | null>;
  /** SSE-shaped replay; returns unsubscribe. */
  streamRun(
    runId: string,
    handlers: {
      fromSeq?: number;
      onEvent: (e: RunEventView) => void;
      onEnd: (status: RunStatus) => void;
      onGap?: (paused: boolean) => void;
      /** Ephemeral token chunk (model_delta — no seq, not a stored event);
       *  screens accumulate it as the live answer draft. Mock streams emit
       *  stored events only, so it simply never fires there. */
      onDelta?: (text: string) => void;
    },
  ): () => void;
  /**
   * Telegram client boundary (telegram-runtime-window contract) — typed
   * operations only, never raw TDLib calls. Optional until W1 ships the
   * adapter; when absent the screen marks the section `unavailable`.
   */
  telegram?: TelegramSource;
  /**
   * Instagram — two INDEPENDENT integrations (instagram contract): `web`
   * is a managed-window lifecycle, `api` the Graph API client. They share
   * no session, tokens or state; either may be absent → `unavailable`.
   */
  instagram?: {
    web?: InstagramWebSource;
    api?: InstagramApiSource;
  };
  /**
   * Service integrations catalog (runtime-service-integrations contract).
   * Optional until W1 wires real OAuth/native adapters; mock simulates
   * connects only for entries flagged `connectable`.
   */
  services?: {
    list(): Promise<ServiceIntegration[]>;
    connect(id: string): Promise<ServiceIntegration | null>;
    disconnect(id: string): Promise<ServiceIntegration | null>;
    /** Read-only agenda — only when the calendar entry is connected. */
    calendarAgenda?(): Promise<CalendarAgendaItem[]>;
    /** Picker-selected docs — only when the docs entry is connected. */
    pickedDocuments?(): Promise<PickedDocument[]>;
  };
  /**
   * Unreal 3D companion scene (unreal-runtime-scene-integration) — optional
   * until W1 wires the host: DesktopBridge `unreal_scene_state()` /
   * `unreal_scene_open()` js_api methods + `unreal-scene.state` events.
   * When absent the Runtime scene tab renders `data-state="unavailable"`.
   */
  unrealScene?: {
    getState(): Promise<UnrealSceneHostState>;
    /**
     * Ask the host to open the scene window. Resolves to the HOST-REPORTED
     * state — it must not return `connected` before the loopback handshake,
     * and the UI never upgrades the status on its own. The profile persona
     * (agent-scene S3) is supplied by the adapter, not this call.
     */
    open(): Promise<UnrealSceneHostState>;
    /**
     * VIII V1.4: смена персоны живой сцены без перезапуска — host шлёт
     * WS-команду `set-active`; `{sent:false,…}` = канала нет или значение
     * вне закрытого словаря (сцена не переключилась). Rejects только
     * когда сам seam недоступен.
     */
    setActive?(assistant: string): Promise<{ sent: boolean; state: UnrealSceneHostState }>;
    /** Push subscription; absent = the UI polls getState() only. */
    subscribe?(onState: (state: UnrealSceneHostState) => void): () => void;
    /**
     * Обратные события сцены `unreal-scene.event` (VII V3-1): клик по
     * портрету, возврат, ошибка карты — verbatim push; без источника
     * событий seam может отсутствовать, UI показывает только пришедшее.
     */
    subscribeEvents?(onEvent: (event: UnrealSceneEvent) => void): () => void;
    /**
     * VII V3-4 / VIII V3-3: снапшот данных для 3D-панелей Runtime.
     * Собирается из реальных seam'ов; seam упал/отсутствует → поле null
     * («нет данных» — сцена не рисует панель). Поля — только по §11
     * контракта unreal-scene-bridge-contract.
     */
    getPanelData?(): Promise<UnrealScenePanelData>;
  };
  /**
   * W3-11 — local worker status (host `/v1/worker/status`, W1-07..09).
   * Absent seam → `unavailable`; `down` is an honest answer, not a failure.
   */
  workerStatus?(): Promise<import('../integrations/ai2/contracts/worker').Ai2WorkerStatus>;
  /**
   * Local worker lifecycle + ops (local-agent dispatch W3): launch grant,
   * bounded ops, revoke/shutdown — host `/v1/worker/*`, single worker per
   * server. Absent seam → the whole worker block renders `unavailable`;
   * no mock ever fabricates workspace authority.
   */
  worker?: {
    launch(input: import('../integrations/ai2/contracts/worker').WorkerLaunchInput): Promise<import('../integrations/ai2/contracts/worker').Ai2WorkerLaunched>;
    status(): Promise<import('../integrations/ai2/contracts/worker').Ai2WorkerStatus>;
    /** One bounded op (read/list/stat/search/diff/write/checkpoint/rollback/list_checkpoints/exec);
     *  result shape is op-specific and arrives verbatim from the host. */
    request(input: import('../integrations/ai2/contracts/worker').WorkerRequestInput): Promise<unknown>;
    revoke(): Promise<import('../integrations/ai2/contracts/worker').Ai2WorkerStatus>;
    shutdown(): Promise<import('../integrations/ai2/contracts/worker').Ai2WorkerStatus>;
  };
  /**
   * W1 voice — host TTS (GET /v1/voice/voices + POST /v1/voice/tts).
   * The host renders the voice with Fish Audio (AGENT-A, облако); the
   * shell never fabricates audio. Absent seam → `unavailable`. The mock
   * implements it with a deterministic tone WAV, honestly not speech.
   */
  voice?: {
    voices(): Promise<import('../integrations/ai2/contracts/voice').Ai2Voice[]>;
    /** Host STT status (faster-whisper): supported flag + verbatim reason. */
    stt(): Promise<import('../integrations/ai2/contracts/voice').Ai2SttStatus>;
    speak(text: string, voiceId?: string): Promise<{ audio: Blob; voice: string; mime: string; cached?: boolean }>;
    /** Audio blob (what the mic recorded — webm/ogg/wav) → transcript text. */
    transcribe(audio: Blob): Promise<import('../integrations/ai2/contracts/voice').Ai2Transcript>;
  };
  /**
   * Fs-access seam (fs-access dispatch, /v1/fs/*): path validation and
   * scoped write-requests. The boundary lives in the host — a source that
   * cannot reach it leaves the seam absent and the regulator renders
   * `unavailable`; no mock ever fabricates file access.
   */
  fs?: {
    /** POST /v1/fs/validate — ok + canonical path, or ok:false + verbatim reason. */
    validate(path: string): Promise<import('../integrations/ai2/contracts/fs').FsValidateResult>;
    /** GET /v1/fs/requests — newest first; resolves 409 by re-reading the ticket. */
    requests(query?: { status?: import('../integrations/ai2/contracts/fs').FsRequestStatus; runId?: string }): Promise<import('../integrations/ai2/contracts/fs').FsWriteRequest[]>;
    /** POST .../approve — host executes the deferred write; 410 expired, 409 resolved. */
    approve(requestId: string): Promise<import('../integrations/ai2/contracts/fs').FsWriteRequest>;
    /** POST .../deny — file untouched; resolved event lands in the run trace. */
    deny(requestId: string): Promise<import('../integrations/ai2/contracts/fs').FsWriteRequest>;
  };
  /**
   * Wave XI W1 — шина окон NEU (/v1/bus/*): сессии окон Devin
   * (windows.json + inbox/outbox) и делегация задач через send.ps1.
   * Отправка — реальный побочный эффект на хосте (Devin-сессия пишет в
   * outbox); session_locked → state 'locked'. Шина не настроена → хост
   * отвечает 503 с причиной; источник без шины оставляет seam отсутствующим —
   * экран показывает `unavailable`, мок не имитирует живые окна.
   */
  bus?: {
    /** GET /v1/bus/sessions — Session[] по контракту волны XI. */
    listSessions(): Promise<import('../integrations/ai2/contracts/bus').BusSession[]>;
    /** POST /v1/bus/delegations — Delegation; state 'queued'/'sent'/'locked'. */
    delegateTask(input: import('../integrations/ai2/contracts/bus').DelegateTaskInput): Promise<import('../integrations/ai2/contracts/bus').BusDelegation>;
    /** GET /v1/bus/delegations/{id} — Delegation; 404 → reject. */
    getDelegation(id: string): Promise<import('../integrations/ai2/contracts/bus').BusDelegation>;
    /**
     * XIV — GET /v1/bus/overview (bus-overview-contract.md): W1–W5 таблица
     * + хвост watch.log. status 'unknown' — каталог шины не настроен на
     * хосте: экран показывает честный пустой «нет данных у хоста».
     */
    overview?(): Promise<import('../integrations/ai2/contracts/bus').BusOverview>;
  };
  /**
   * OpenCode integration (opencode-integration-spec.md): агент-рантайм,
   * сессии, инструменты, права, MCP, плагины, команды/скиллы, модели,
   * worktrees. Опционален: сервис не запущен / URL не задан → seam
   * отсутствует, экраны показывают honest `unavailable`, мок не имитирует.
   */
  opencode?: {
    /** GET /api/info — health + версия сервиса. */
    info(): Promise<{ version: string; healthy: boolean }>;
    /** Список сессий OpenCode. */
    listSessions(): Promise<{ id: string; title?: string; directory?: string }[]>;
    /** Список моделей/провайдеров. */
    listModels(): Promise<{ id: string; name: string; provider?: string }[]>;
    /** Список MCP-серверов из конфига OpenCode. */
    listMcpServers(): Promise<{ name: string; url?: string; connected?: boolean }[]>;
    /** Список команд/скиллов. */
    listCommands(): Promise<{ id: string; label: string }[]>;
  };
  /**
   * NEXUS CRAFT (packages/bridge/MVP_PLAN.md): управление SolidCraft через
   * craft-bridge по same-origin proxy /api/craft — bearer остаётся на
   * сервере, клиент без креденшелов. Seam привязан к origin приложения,
   * а не к выбору AI2-источника: недоступность моста приходит как честная
   * ошибка fetch → экран показывает `unavailable`, мок не имитирует.
   */
  craft?: CraftSeam;
  /**
   * Wave XI W3 — каталог prompt-файлов библиотеки (источник: docs/prompts,
   * если появится). Опционален: без seam'а раздел «Промпты» честно пишет
   * «нет данных» — каталога в репо пока нет и хост-эндпоинта нет.
   */
  listPrompts?(): Promise<PromptFileRef[]>;
  /**
   * Wave XII/XIV — подтверждения инструментов SDK-канала (контракт
   * docs/product/sdk-confirm-contract.md draft 0.2; предшественник —
   * sdk-tool-confirmation-contract.md). Маршруты на хосте есть, но за
   * флагом AI2_SDK_ENABLED: 503 с причиной — честный «хост не ответил».
   * Источник без seam'ов оставляет карточку read-only.
   *
   * GET /v1/sdk/runs/{id}/confirmations → открытые карточки (awaiting +
   * deferred) — восстановление состояния после перезагрузки ленты.
   */
  listToolConfirmations?(runId: string): Promise<import('../integrations/ai2/contracts/sdk').SdkConfirmation[]>;
  /**
   * POST …/confirmations/{callId} {decision: allow|deny|defer, reason?}.
   * defer не закрывает карточку — ответ {resolved:false,state:'deferred'},
   * таймаут хоста продолжает действовать; поздний allow/deny — тем же вызовом.
   */
  respondToolConfirmation?(
    runId: string,
    callId: string,
    decision: import('../integrations/ai2/contracts/sdk').SdkConfirmDecision,
    reason?: string,
  ): Promise<import('../integrations/ai2/contracts/sdk').SdkConfirmResult>;
  /** GET /v1/sdk/audit — decision history, null/unavailable is never faked. */
  sdkAudit?(query?: {
    limit?: number;
    offset?: number;
    runId?: string;
  }): Promise<import('../integrations/ai2/contracts/sdk').SdkAuditPage>;
  /**
   * Wave XIV — сессии агента SDK (sdk-sessions-contract.md, draft):
   * список/возобновление/ветвление/переименование/архив. Все маршруты за
   * AI2_SDK_ENABLED — без флага хост отвечает 503 с причиной verbatim;
   * источник без seam'а → панель «нет данных», список не выдумывается.
   */
  sdkSessions?: {
    /** GET /v1/sdk/sessions; фильтры хоста: archived/assistant/status/limit. */
    list(query?: import('../integrations/ai2/contracts/sdk').SdkSessionQuery): Promise<import('../integrations/ai2/contracts/sdk').SdkSession[]>;
    /** PATCH …/sessions/{id} — title и/или archived (хотя бы одно). */
    patch(sessionId: string, input: import('../integrations/ai2/contracts/sdk').SdkSessionPatch): Promise<{ id: string; updated: boolean }>;
    /** POST …/sessions/{id}/fork — ветка от сообщения; key — идемпотентность. */
    fork(sessionId: string, input: { task: string; atMessage?: string; key?: string }): Promise<import('../integrations/ai2/contracts/sdk').SdkForkResult>;
    /** POST /v1/sdk/runs {task, resume} — возобновление ленты сессии. */
    run(input: import('../integrations/ai2/contracts/sdk').SdkRunInput): Promise<import('../integrations/ai2/contracts/sdk').SdkRunHandle>;
    /** XV — GET …/sessions/{id}/usage: токены/стоимость сессии; null —
     *  «нет данных» (SDK не отдал), 404 — сессия неизвестна. */
    usage(sessionId: string): Promise<import('../integrations/ai2/contracts/sdk').SdkSessionUsage>;
  };
  /**
   * XV — учёт по ассистентам (задача W1 23, GET /v1/sdk/usage/assistants):
   * делегированные прогоны по agent, базис KPI-плиток /home. Пусто →
   * `assistants: []` (честный пустой); без seam'а — плитки «нет данных».
   */
  sdkAssistantUsage?(): Promise<import('../integrations/ai2/contracts/sdk').SdkAssistantUsage>;
  /**
   * Wave XIV — дерево делегаций SDK (sdk-delegations-contract.md, draft):
   * параллельные фоновые прогоны-потомки и кооперативная отмена. За
   * AI2_SDK_ENABLED — без флага 503 verbatim; источник без seam'а →
   * панель «нет данных», делегации не выдумываются.
   */
  sdkDelegations?: {
    /** GET /v1/sdk/delegations[?parent_run_id=] — дерево verbatim. */
    list(parentRunId?: string): Promise<import('../integrations/ai2/contracts/sdk').SdkDelegation[]>;
    /** POST /v1/sdk/runs/{id}/delegations — потомок с правами ≤ родителя. */
    delegate(runId: string, input: { task: string; agent?: string; label?: string }): Promise<import('../integrations/ai2/contracts/sdk').SdkRunHandle>;
    /** POST /v1/sdk/runs/{id}/cancel — стоп на следующем сообщении. */
    cancel(runId: string): Promise<{ id: string; cancelled: boolean }>;
  };
  /**
   * Wave XIV — хэндофы между ассистентами SDK (тот же контракт):
   * история персистентна (meta-sidecar), повторное решение → 409.
   */
  sdkHandoffs?: {
    /** GET /v1/sdk/handoffs[?status=] — история verbatim. */
    list(status?: 'pending' | 'accepted' | 'declined'): Promise<import('../integrations/ai2/contracts/sdk').SdkHandoff[]>;
    create(input: { to: string; prompt: string; fromAgent?: string; runId?: string }): Promise<import('../integrations/ai2/contracts/sdk').SdkHandoff>;
    /** POST …/accept|decline {reason?} — решение по pending-карточке. */
    resolve(id: string, accept: boolean, reason?: string): Promise<import('../integrations/ai2/contracts/sdk').SdkHandoff>;
  };
  /**
   * Wave XIV — правила проекта рабочего каталога (sdk-rules-contract.md,
   * draft): только метаданные файлов (AGENTS.md, .clinerules и др.) —
   * содержимое не исполняется и не возвращается. За AI2_SDK_ENABLED.
   */
  sdkRules?: {
    list(directory?: string): Promise<import('../integrations/ai2/contracts/sdk').SdkRulesResult>;
  };
  /**
   * Wave XIV — каталог MCP-серверов (mcp-servers-contract.md, draft).
   * Без SDK-флага: нет конфига → {configured:false, servers:[]}.
   * Вызов инструмента — только через канал подтверждений fs_requests:
   * первый POST создаёт заявку (awaiting_confirmation), исполнение —
   * повторным POST с requestId после approve на хосте.
   */
  mcpServers?: {
    list(): Promise<import('../integrations/ai2/contracts/mcp').McpCatalog>;
    call(name: string, input: import('../integrations/ai2/contracts/mcp').McpCallInput): Promise<import('../integrations/ai2/contracts/mcp').McpCallResponse>;
  };
  /**
   * Wave XIV — библиотека промптов (prompts-contract.md, draft):
   * GET /v1/prompts — файлы каталога (source:'file') + сохранённые
   * сценарии (source:'saved'); CRUD сохранённых за AI2_SDK_ENABLED.
   * Секретоподобный текст хост отклоняет 422 — не храним секреты.
   */
  prompts?: {
    list(): Promise<import('../integrations/ai2/contracts/sdk').SdkPromptEntry[]>;
    create(input: { title: string; body: string }): Promise<import('../integrations/ai2/contracts/sdk').SdkSavedPrompt>;
    update(id: string, input: { title?: string; body?: string }): Promise<import('../integrations/ai2/contracts/sdk').SdkSavedPrompt>;
    remove(id: string): Promise<{ id: string; deleted: boolean }>;
  };
  /**
   * Wave XIV — учёт прогона SDK (sdk-usage-checkpoints-contract.md,
   * draft): токены/стоимость с деревом делегаций; поля, которых SDK
   * не отдал, — null (в UI «нет данных», не ноль). 404 — прогон не SDK.
   */
  sdkRunUsage?(runId: string): Promise<import('../integrations/ai2/contracts/sdk').SdkRunUsage>;
  /**
   * Wave XIV — манифесты чекпоинтов прогона SDK + заявка на откат:
   * rewind открывает карточку подтверждения tool='rewind' (202) —
   * фактический откат только после allow через respondToolConfirmation.
   * Локального/оптимистичного восстановления нет.
   */
  sdkCheckpoints?: {
    list(runId: string): Promise<import('../integrations/ai2/contracts/sdk').SdkCheckpoint[]>;
    rewind(runId: string, checkpointId: string): Promise<import('../integrations/ai2/contracts/sdk').SdkRewindCard>;
  };
  /**
   * Wave XV — приёмочный шлюз сценария S1-S9 (W1, /v1/scenario/health):
   * каждый шаг — реальная проверка хоста со статусом verbatim
   * (ok|degraded|unavailable|error) и причиной. Пустой список —
   * честное «нет данных у хоста».
   */
  scenarioHealth?(): Promise<import('../integrations/ai2/contracts/system').ScenarioHealth>;
  /**
   * Wave XVI — инвентарь NEU-плагинов оболочки (neu-plugin-panels-spec.md
   * п.2.5, W1 `neu-plugin-host-contract.md`. Mock seam не объявляет →
   * честное «недоступно»; live использует фактический инвентарь хоста.
   * Переключатели бандла/строк для встроенных плагинов пишут локальный
   * патч (plugin-host), для хостовых бандлов идут сюда.
   */
  neuPlugins?: {
    list(): Promise<import('../integrations/ai2/contracts/neu-plugins').NeuPluginInventory>;
    setEnabled(id: string, enabled: boolean): Promise<import('../integrations/ai2/contracts/neu-plugins').NeuPluginEntry>;
    setRowEnabled(id: string, rowId: string, enabled: boolean): Promise<import('../integrations/ai2/contracts/neu-plugins').NeuPluginEntry>;
  };
}

const MOCK_LATENCY_MS = 60;

function soon<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS, value));
}

let mockCounter = 2000;

/**
 * Perf XVI W1: бочка `@nexus/mock-data` вне eager-графа app-shell — до неё
 * дотягивался shared-бандл `/_not-found` (~90 КБ). Фикстуры грузятся
 * первым вызовом любого mock-метода; все методы и так Promise-возвращающие,
 * поэтому наблюдаемое поведение не меняется. На live-хосте промис не
 * создаётся вовсе. Mutable-сторы засеваются здесь же, один раз.
 */
type MockData = typeof import('@nexus/mock-data');
let mockInit: Promise<MockData> | null = null;
function loadMock(): Promise<MockData> {
  mockInit ??= import('@nexus/mock-data').then((m) => {
    mockWebhookRows = [...m.webhooks];
    mockPluginRows = [...m.plugins];
    mockApiKeyRows = [...m.apiKeys];
    mockApprovalRows = [...m.approvals];
    return m;
  });
  return mockInit;
}

/** Mutable mock webhook store — writes persist for the session (deterministic). */
let mockWebhookRows: WebhookRow[] = [];
let mockWebhookCounter = 100;
/** Deterministic stand-in for a 4xx: the legacy endpoint refuses writes. */
const MOCK_WEBHOOK_REJECT_URL = 'old.invalid';

/** Mutable mock plugin store — toggles persist for the session. */
let mockPluginRows: PluginInfo[] = [];

/** Mutable mock key store — same policy; `key-02` stands in for "key in use". */
let mockApiKeyRows: ApiKeyInfo[] = [];
let mockApiKeyCounter = 100;
const MOCK_KEY_IN_USE = 'key-02';

/** Mutable mock approval store — decisions persist for the session. */
let mockApprovalRows: ApprovalRequest[] = [];

/**
 * Mock run-controls state — runs the mock knows as still alive: the
 * hydrated fixture runner + every run created via startRun this session.
 * Paused ids stop the mock stream emitter (isPaused flag), not the status.
 */
const mockLiveRunIds = new Set<string>(['run-1042']);
const mockPausedRunIds = new Set<string>();
/** Runs created this session via startRun/retryRun — retry needs the input. */
const mockCreatedRuns = new Map<string, RunSummary>();
/**
 * Отменённые прогоны: id → epoch s отмены. Мок исполняет отмену — иначе
 * кнопка «Отменить» была бы no-op: прогон остался бы «running», поток
 * продолжал бы течь и controls предлагали бы паузу. Фикстуры не мутируются —
 * факт отмены накладывается на вид прогона (mockRunView).
 */
const mockCancelledRuns = new Map<string, number>();

/** Прогон по id в любом состоянии мока: создан в сессии | фикстура | история. */
function mockFindRun(m: MockData, runId: string): RunSummary | null {
  return mockCreatedRuns.get(runId)
    ?? Object.values(m.runStates).find((r) => r.runId === runId)
    ?? m.runHistory.find((r) => r.runId === runId)
    ?? null;
}

/** Вид прогона с учётом отмены: отменённый прогон — терминальный. */
function mockRunView(run: RunSummary): RunSummary {
  const at = mockCancelledRuns.get(run.runId);
  if (at == null) return run;
  return { ...run, status: 'cancelled', stopReason: 'cancelled', finishedAt: run.finishedAt ?? at };
}

/**
 * Deterministic plan derivation (mock-first W3-02): stages follow the
 * preset's REAL `flags` (planner/critic/arbiter/subagents), tools come from
 * the chosen AgentSpec.capabilities + the memory flag; limits reuse
 * AgentSpec.maxCostUsd. Unknown agent → stages still render, tools stay
 * empty and the card says the runtime assigns them.
 */
function deriveMockPlan(m: MockData, input: StartRunInput): RunPlan {
  const preset = m.presets.find((p) => p.name === input.config);
  const flags = preset?.flags ?? {};
  const stages: RunPlan['stages'] = [];
  if (flags.planner) stages.push({ id: 'plan', label: 'План', agent: null });
  stages.push({ id: 'exec', label: 'Исполнение', agent: input.agent ?? null });
  if (flags.subagents) stages.push({ id: 'subagents', label: 'Суб-агенты', agent: null });
  if (flags.critic) stages.push({ id: 'critic', label: 'Критика', agent: null });
  if (flags.arbiter) stages.push({ id: 'arbiter', label: 'Арбитраж', agent: null });
  const spec = input.agent != null ? m.agents.find((a) => a.name === input.agent) : undefined;
  const tools = [...(spec?.capabilities ?? []), ...(flags.memory ? ['memory'] : [])];
  const approvalsPlanned = tools.some(
    (t) => t.includes('write') || t === 'shell' || t === 'files' || t === 'spawn_agent',
  );
  return {
    goal: input.task,
    stages,
    workspace: input.project ?? 'nexus',
    tools,
    limits: { maxCostUsd: spec?.maxCostUsd ?? null, maxDurationS: null },
    approvalsPlanned,
  };
}

function mockStartRun(input: StartRunInput): RunSummary {
  const run: RunSummary = {
    runId: `run-${++mockCounter}`,
    taskText: input.task,
    config: input.config,
    status: 'running',
    stopReason: null,
    agent: input.agent ?? null,
    parent: null,
    project: input.project ?? 'nexus',
    model: input.model ?? null,
    // Request flag recorded verbatim — the mock never fakes retrieval
    // events, so the UI can't claim memory actually ran from this.
    useMemory: input.useMemory ?? null,
    costUsd: null,
    createdAt: Math.floor(Date.now() / 1000),
    finishedAt: null,
  };
  mockLiveRunIds.add(run.runId);
  mockCreatedRuns.set(run.runId, run);
  return run;
}

function mockRunControls(m: MockData, runId: string): RunControlState | null {
  const live = mockLiveRunIds.has(runId);
  const paused = mockPausedRunIds.has(runId);
  // Известный прогон: живой/паузный в этой сессии, созданный здесь, отменённый
  // здесь или фикстурный из истории. Отменённый остаётся известным (retry).
  const known = live
    || paused
    || mockCreatedRuns.has(runId)
    || mockCancelledRuns.has(runId)
    || m.runHistory.some((r) => r.runId === runId);
  if (!known) return null;
  return {
    paused,
    pause: live && !paused
      ? { available: true, reason: null }
      : { available: false, reason: paused ? 'Прогон уже на паузе' : 'Прогон не выполняется' },
    resume: paused
      ? { available: true, reason: null }
      : { available: false, reason: live ? 'Прогон не на паузе' : 'Прогон не выполняется' },
    replay: { available: true, reason: null },
    // The mock keeps no checkpoints — honest unsupported with a reason,
    // matching the contract "unavailable, never a no-op".
    checkpoint: {
      available: false,
      reason: 'Мок-рантайм не сохраняет чекпоинты',
    },
    retry: live
      ? { available: false, reason: 'Прогон ещё выполняется' }
      : { available: true, reason: null },
  };
}

/** Deterministic fixture for the mock voice seam — 300ms 440Hz sine,
 *  PCM16 mono 24kHz WAV. Real playable bytes, honestly NOT speech. */
function mockToneWavBlob(): Blob {
  const rate = 24000;
  const n = Math.floor(rate * 0.3);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const text = (s: string, off: number) => { for (let i = 0; i < s.length; i++) bytes[off + i] = s.charCodeAt(i); };
  text('RIFF', 0); v.setUint32(4, 36 + n * 2, true); text('WAVE', 8);
  text('fmt ', 12); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  text('data', 36); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000), true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

let noirMockPromise: Promise<NoirClient> | null = null;

/** Ленивый NOIR-мок (perf XVI W1, INT-24): детерминированный мир и сцены
 *  грузятся первым вызовом — в shared-бандл его фикстуры не попадают. */
const loadNoirMock = () =>
  (noirMockPromise ??= import('../integrations/noir/api/mock-transport').then((m) =>
    m.createNoirMockClient(),
  ));

/**
 * Live social source backed by RAE daemon (:5682).
 * Only used when NEXT_PUBLIC_RAE_LIVE=1 is set.
 * Does its own availability check on first use.
 */
function createSocialSource(): SocialSource {
  // Check if live RAE source is requested
  const raeLive = process.env.NEXT_PUBLIC_RAE_LIVE === '1';

  if (raeLive) {
    // Live RAE source грузится лениво (perf): модуль live-source не
    // попадает в shared-чанк, пока флаг не включён и запрос не сделан.
    return createLazySeam(() =>
      import('./social/live-source').then((m) => m.createLiveSocialSource()),
    );
  }

  // Mock source (default)
  return createMockSocial();
}

const mockSource: ProductDataSource = {
  social: createSocialSource(),
  listPresets: async () => soon((await loadMock()).presets),
  listModels: async () => soon((await loadMock()).modelsList),
  listAgents: async () => soon((await loadMock()).agents),
  listRuns: async (opts) => {
    const m = await loadMock();
    const all = [
      ...[...mockCreatedRuns.values()].reverse(),
      m.runStates.running,
      ...m.runHistory,
    ];
    const since = opts?.since ?? 0;
    const rows = all.filter(
      (r) => r.createdAt >= since && (opts?.agent === undefined || r.agent === opts.agent)
        && (opts?.parent === undefined || r.parent === opts.parent)
        && (opts?.status === undefined || r.status === opts.status),
    );
    return soon(rows.slice(opts?.offset ?? 0, (opts?.offset ?? 0) + (opts?.limit ?? 50)).map(mockRunView));
  },
  listPresence: async () => soon((await loadMock()).agentPresence),
  listHandoffs: async () => soon((await loadMock()).agentHandoffs),
  getMissionGraph: async () => soon((await loadMock()).missionGraph),
  listMissions: async () => {
    const m = await loadMock();
    return soon([m.missions.active, m.missions.done, m.missions.failed]);
  },
  listProjects: async () => {
    const m = await loadMock();
    return soon([...new Set([
      ...[...Object.values(m.runStates), ...m.runHistory].map((r) => r.project),
      ...m.memoryItems.map((it) => it.project),
    ].filter((p): p is string => p != null))].sort());
  },
  listMemory: async (project) => {
    const m = await loadMock();
    return soon(project == null ? m.memoryItems : m.memoryItems.filter((it) => it.project === project));
  },
  searchMemory: async (query, project) => {
    const m = await loadMock();
    const q = query.trim().toLowerCase();
    if (!q) return soon([]);
    // Deterministic fixture: substring match over items; curated score when
    // the fixture defines one, else a fixed mock score. Real adapter POSTs
    // {query, k} and trusts the server score verbatim.
    const curated = new Map(m.memorySearch.map((h) => [h.id, h.score]));
    return soon(
      m.memoryItems
        .filter((it) => (project == null || it.project === project) && it.text.toLowerCase().includes(q))
        .map((it) => ({ ...it, score: curated.get(it.id) ?? 0.5 })),
    );
  },
  // История ленты (W3-143). На живом хосте она приходит из /v1/chat/history,
  // а мок-источник её не отдавал — из-за чего в демо-режиме лента была пуста:
  // ни сообщений, ни оконных пузырей (draggable), ни ветки эха. Мок отдаёт
  // историю в том же виде, что и хост (id = <run>:task|answer) и постранично:
  // страницы идут от новых к старым, курсор — id самой старой записи страницы,
  // `beforeId` — курсор хоста («верни то, что старше»). Без постраничности
  // нечего проверять в догрузке (scroll-anchor при prepend, W5-117).
  getChatHistory: async (threadId, q) => {
    const m = await loadMock();
    const runs = [m.runStates.running, ...m.runHistory];
    // Записи — от новых к старым (createdAt убывает).
    const all: ChatHistoryEntry[] = [];
    for (const r of [...runs].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))) {
      const createdAt = r.createdAt ?? null;
      all.push({
        kind: 'message',
        id: `${r.runId}:task`,
        runId: r.runId,
        part: 'task',
        role: 'user',
        text: r.taskText,
        createdAt,
      });
      all.push({
        kind: 'message',
        id: `${r.runId}:answer`,
        runId: r.runId,
        part: 'answer',
        role: 'assistant',
        text: m.runResults.done.answer,
        createdAt: createdAt != null ? createdAt + 1 : null,
      });
    }
    const limit = q?.limit != null && q.limit > 0 ? q.limit : 50;
    // Размер страницы мока — 10 записей: как у хоста с малым page size.
    // Так лента догружается постранично (иначе первой страницы хватает на
    // весь объём и догрузку нечего проверять).
    const pageSize = Math.min(limit, 10);
    const before = q?.beforeId;
    // `all` — от новых к старым. Курсор `beforeId` — id записи, до которой
    // берём: страница — записи СТАРШЕ него (в `all` — правее его позиции).
    const cursorIdx = before == null ? -1 : all.findIndex((e) => e.id === before);
    const start = before == null ? 0 : cursorIdx < 0 ? all.length : cursorIdx + 1;
    const pageNewestFirst = all.slice(start, start + pageSize);
    // Контракт продукта: записи хронологически (старые → новые).
    const entries = [...pageNewestFirst].reverse();
    // Курсор следующей страницы — id самой старой записи текущей.
    const nextCursor = pageNewestFirst.length > 0 ? pageNewestFirst[pageNewestFirst.length - 1].id : null;
    return { sessionId: threadId, entries, hasMore: start + pageNewestFirst.length < all.length, nextCursor };
  },
  getMemoryStructure: async () => soon((await loadMock()).memoryStructure),
  getMemoryGraph: async () => soon((await loadMock()).memoryGraph),
  getModelRouter: async () => soon((await loadMock()).modelRouter),
  getUsage: async () => soon((await loadMock()).usage),
  listPlugins: async () => {
    const m = await loadMock();
    return soon(m.plugins.map((p) => mockPluginRows.find((r) => r.name === p.name) ?? p));
  },
  updatePlugin: async (name, patch) => {
    await loadMock();
    const cur = mockPluginRows.find((p) => p.name === name);
    if (!cur) return soon(null);
    // Deterministic stand-in for a 4xx: unsigned plugins refuse activation.
    if (patch.active === true && cur.signed === false) {
      return Promise.reject(new Error('mock: 422 — unsigned plugin refuses activation'));
    }
    const next = { ...cur, ...patch };
    mockPluginRows = mockPluginRows.map((p) => (p.name === name ? next : p));
    return soon(next);
  },
  listWebhooks: async () => {
    await loadMock();
    return soon([...mockWebhookRows]);
  },
  listWebhookDeliveries: async () => soon((await loadMock()).webhookDeliveries),
  createWebhook: async (input) => {
    await loadMock();
    if (input.url.includes(MOCK_WEBHOOK_REJECT_URL)) {
      return Promise.reject(new Error('mock: 422 — url refused by runtime'));
    }
    const webhook: WebhookRow = {
      webhookId: `wh-mock-${++mockWebhookCounter}`,
      url: input.url,
      events: [...input.events],
      active: true,
    };
    mockWebhookRows = [...mockWebhookRows, webhook];
    return soon({ webhook, secret: `whsec_mock_${mockWebhookCounter} (mock)` });
  },
  updateWebhook: async (webhookId, patch) => {
    await loadMock();
    const cur = mockWebhookRows.find((w) => w.webhookId === webhookId);
    if (!cur) return soon(null);
    if (cur.url.includes(MOCK_WEBHOOK_REJECT_URL)) {
      return Promise.reject(new Error('mock: 422 — legacy endpoint refuses writes'));
    }
    const next = { ...cur, ...patch };
    mockWebhookRows = mockWebhookRows.map((w) => (w.webhookId === webhookId ? next : w));
    return soon(next);
  },
  deleteWebhook: async (webhookId) => {
    await loadMock();
    mockWebhookRows = mockWebhookRows.filter((w) => w.webhookId !== webhookId);
    return soon(undefined);
  },
  getMetrics: async () => soon((await loadMock()).metrics.healthy),
  listApiKeys: async () => {
    await loadMock();
    return soon([...mockApiKeyRows]);
  },
  createApiKey: async (input) => {
    await loadMock();
    const key: ApiKeyInfo = {
      keyId: `key-mock-${++mockApiKeyCounter}`,
      name: input.name,
      scopes: [...input.scopes],
      prefix: `ai2_k_mk${mockApiKeyCounter}`,
      status: 'active',
      createdAt: 1_700_000_000 + mockApiKeyCounter, // fixed epoch — deterministic
      expiresAt: null,
      revokedAt: null,
    };
    mockApiKeyRows = [key, ...mockApiKeyRows];
    return soon({ key, secret: `ai2_sk_mock_${mockApiKeyCounter} (mock)` });
  },
  revokeApiKey: async (keyId) => {
    await loadMock();
    if (keyId === MOCK_KEY_IN_USE) {
      return Promise.reject(new Error('mock: 409 — key in use'));
    }
    const cur = mockApiKeyRows.find((k) => k.keyId === keyId);
    if (!cur) return soon(undefined); // idempotent — server re-revoke is 204
    const next: ApiKeyInfo = { ...cur, status: 'revoked', revokedAt: 1_700_000_000 };
    mockApiKeyRows = mockApiKeyRows.map((k) => (k.keyId === keyId ? next : k));
    return soon(undefined);
  },
  getRunDetail: async (runId) => {
    const m = await loadMock();
    const run = mockFindRun(m, runId);
    if (!run) return soon(null);
    const detail = m.runDetails[runId];
    return soon({ run: mockRunView(run), result: detail?.result ?? null, events: detail?.events ?? [] });
  },
  searchYouTube: async (query) => {
    const m = await loadMock();
    const q = query.trim().toLowerCase();
    const hits = m.youtubeHits.filter(
      (h) => h.title.toLowerCase().includes(q) || h.channelTitle.toLowerCase().includes(q),
    );
    return soon(hits);
  },
  startRun: (input) => {
    const run = mockStartRun(input);
    return soon(run);
  },
  // Отмена исполняется моком: прогон становится терминальным (cancelled),
  // поток останавливается, controls перестают предлагать паузу. Контракт
  // тот же, что у живого хоста: неизвестный id → 404, не «running» → 409.
  cancelRun: async (runId) => {
    const m = await loadMock();
    const run = mockFindRun(m, runId);
    if (run == null) return Promise.reject(new Error(`mock: 404 — unknown run ${runId}`));
    if (mockRunView(run).status !== 'running') {
      return Promise.reject(new Error(`mock: 409 — run ${runId} is not running`));
    }
    mockCancelledRuns.set(runId, Math.floor(Date.now() / 1000));
    mockPausedRunIds.delete(runId);
    mockLiveRunIds.delete(runId);
    return soon(undefined);
  },
  listApprovals: async (opts) => {
    await loadMock();
    return soon(
      mockApprovalRows.filter(
        (a) => (opts?.runId == null || a.runId === opts.runId) && (opts?.status == null || a.status === opts.status),
      ),
    );
  },
  respondApproval: async (approvalId, decision) => {
    await loadMock();
    const cur = mockApprovalRows.find((a) => a.approvalId === approvalId);
    if (cur == null || cur.status !== 'pending') return soon(null);
    const next: ApprovalRequest = {
      ...cur,
      status: decision === 'approve' ? 'approved' : 'denied',
      decidedAt: Math.floor(Date.now() / 1000),
    };
    mockApprovalRows = mockApprovalRows.map((a) => (a.approvalId === approvalId ? next : a));
    return soon(next);
  },
  streamRun: (_runId, { fromSeq, onEvent, onEnd, onGap }) => {
    // Perf XVI W1: поток собирается после ленивой загрузки фикстур — до
    // резолва эмиттер молчит, отписка гасит старт. События и раньше шли
    // с 140 ms интервалом — микротики ожидания не меняют поведение.
    let unsubscribe: () => void = () => {};
    let cancelled = false;
    let ended = false;
    void loadMock().then((m) => {
      if (cancelled) return;
      // Отмена прогона обрывает поток: события больше не текут, а финал
      // приходит как 'cancelled' (иначе эмиттер дописал бы 'done' поверх
      // отменённого прогона — UI показывал бы неверный статус).
      const stop = () => {
        if (ended) return;
        ended = true;
        unsubscribe();
        onEnd('cancelled');
      };
      unsubscribe = m.createMockStream(
        m.runEventStream,
        { fromSeq, intervalMs: 140, gapAtSeq: undefined, gapMs: 1200, isPaused: () => mockPausedRunIds.has(_runId) },
        (e) => {
          if (mockCancelledRuns.has(_runId)) { stop(); return; }
          onEvent(e);
        },
        (status) => {
          if (ended) return;
          ended = true;
          onEnd(mockCancelledRuns.has(_runId) ? 'cancelled' : status);
        },
        onGap,
      );
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  },
  previewRunPlan: async (input) => soon(deriveMockPlan(await loadMock(), input)),
  getRunControls: async (runId) => {
    const c = mockRunControls(await loadMock(), runId);
    return c == null
      ? Promise.reject(new Error(`mock: unknown run ${runId}`))
      : soon(c);
  },
  pauseRun: async (runId) => {
    const m = await loadMock();
    const cur = mockRunControls(m, runId);
    if (cur == null || !cur.pause.available) return soon(null);
    mockPausedRunIds.add(runId);
    return soon(mockRunControls(m, runId));
  },
  resumeRun: async (runId) => {
    const m = await loadMock();
    const cur = mockRunControls(m, runId);
    if (cur == null || !cur.resume.available) return soon(null);
    mockPausedRunIds.delete(runId);
    return soon(mockRunControls(m, runId));
  },
  replayRun: async (runId) => {
    const m = await loadMock();
    const cur = mockRunControls(m, runId);
    if (cur == null || !cur.replay.available) return soon(null);
    // Replay = the client resubscribes the deterministic stream from seq 0 —
    // no state mutation, no re-execution of the task.
    return soon(cur);
  },
  checkpointRun: async (runId) => {
    const m = await loadMock();
    const cur = mockRunControls(m, runId);
    if (cur == null || !cur.checkpoint.available) return soon(null);
    return soon(cur); // unreachable today — mock reports unavailable
  },
  retryRun: async (runId) => {
    const m = await loadMock();
    const cur = mockRunControls(m, runId);
    if (cur == null || !cur.retry.available) return soon(null);
    const src = mockCreatedRuns.get(runId)
      ?? [...Object.values(m.runStates), ...m.runHistory].find((r) => r.runId === runId);
    if (src == null) return soon(null);
    // Retry = «тот же вход»: задача, пресет, агент, проект, модель и признак
    // памяти. Раньше модель и память терялись — повтор стартовал с дефолтной
    // моделью и без памяти, т.е. это был не тот же прогон.
    return soon(mockStartRun({
      task: src.taskText,
      config: src.config,
      agent: src.agent,
      project: src.project ?? undefined,
      model: src.model,
      useMemory: src.useMemory ?? undefined,
    }));
  },
  telegram: createMockTelegram(),
  // fs-access: seam намеренно ОТСУТСТВУЕТ в mock — диспетч: любое mock-state,
  // изображающее доступ к ФС, — FAIL; регулятор честно рендерит unavailable.
  instagram: { web: createMockInstagramWeb(), api: createMockInstagramApi() },
  services: createMockServices(),
  unrealScene: createMockUnrealScene(),
  // INT-23 — deterministic placeholder (no provider calls): the prompt seeds
  // the gradient, `model` honestly says mock. `costUsd` stays null — a mock
  // does not invent prices either.
  generateImage: async (input) => {
    const hue = [...input.prompt].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},60%,45%)"/><stop offset="1" stop-color="hsl(${(hue + 80) % 360},55%,25%)"/></linearGradient></defs><rect width="512" height="512" fill="url(#g)"/></svg>`;
    const imageB64 = btoa(svg); // SVG payload is ASCII-only
    return soon<GeneratedImage>({
      imageB64,
      mime: 'image/svg+xml',
      bytes: svg.length,
      model: 'mock-image',
      costUsd: null,
      prompt: input.prompt,
      enrichedPrompt: null,
      enriched: false,
    });
  },
  // INT-24 — deterministic in-memory NOIR world (sessions, irreversible
  // story choices, travel, finite store stock) from integrations/noir.
  // Ленивый прокси: мир подгружается первым вызовом — вне shared-бандла.
  noir: createLazyNoirClient(loadNoirMock),
  // W3-11 — mock host reports the honest not-launched answer; a mock never
  // claims a worker is up.
  workerStatus: () => soon({ state: 'down' as const, launched: false }),
  // W1 voice — mock seam mirrors the live surface (catalog + speak), but
  // emits a deterministic tone WAV instead of speech; the fixture marks the
  // single voice AGENT-A unavailable like a host without AI2_FISH_API_KEY.
  voice: {
    voices: () =>
      soon([
        // AGENT-A на облачном Fish Audio — reason verbatim, как у хоста без ключа
        { id: 'fish', engine: 'fish', label: 'AGENT-A', labelEn: 'AGENT-A', available: false, reason: 'нет AI2_FISH_API_KEY (бесплатный ключ: fish.audio → API Keys)' },
      ]),
    speak: (text, voiceId) => {
      if (!text.trim()) return Promise.reject(new Error('mock: 422 — empty: нечего озвучивать'));
      if (voiceId != null && voiceId !== 'fish') {
        return Promise.reject(new Error(`mock: 422 — unknown_voice: ${voiceId}`));
      }
      return soon({ audio: mockToneWavBlob(), voice: 'fish', mime: 'audio/wav' });
    },
    stt: () => soon({ supported: true, reason: null, model: 'mock-whisper:fixture' }),
    // deterministic fixture transcript — the bytes are real, the text is
    // canned (no decoder in the mock; honestly labelled by the source)
    transcribe: (audio) =>
      audio.size === 0
        ? Promise.reject(new Error('mock: 422 — empty: пустое аудио'))
        : soon({
          text: 'Проверь статус прогонов',
          language: 'ru',
          languageProbability: 1,
          durationS: Math.round((audio.size / 16000) * 100) / 100,
          model: 'mock-whisper:fixture',
        }),
  },
  // Wave XI W3 — prompt-файлы библиотеки: каталога docs/prompts в репо нет,
  // поэтому мок отвечает честным пустым списком (экран: «нет данных»).
  listPrompts: () => soon<PromptFileRef[]>([]),
};

/**
 * Mock scene host — deterministic `not-installed`, mirroring the current
 * machine finding (no UnrealEditor.exe / bridge). `open()` answers with the
 * unchanged state like a refusing host; it can never fabricate `connected`
 * because the UI renders `source: 'mock'` as DEMO anyway.
 */
function createMockUnrealScene(): NonNullable<ProductDataSource['unrealScene']> {
  const state: UnrealSceneHostState = {
    status: 'not-installed',
    source: 'mock',
    reason: 'Unreal Editor и DesktopBridge-хост не установлены (демо)',
    lastUpdated: null,
    protocolVersion: null,
    activeAssistant: null,
    activeMap: null,
  };
  return {
    getState: () => soon({ ...state }),
    open: () => soon({ ...state }),
    // V1.4: демо-хост без сцены — sent:false честно (команде некуда идти).
    setActive: () => soon({ sent: false, state: { ...state } }),
    // VIII V3-3: демо-снапшот из тех же mock-seam'ов — панели сцены
    // получают согласованные с экранами данные (DEMO-семантика host state).
    getPanelData: async () => ({
      agents: await mockSource.listAgents(),
      presence: await mockSource.listPresence(),
      runs: await mockSource.listRuns(),
      metrics: await mockSource.getMetrics(),
      models: await mockSource.listModels(),
      usage: await mockSource.getUsage(),
      collectedAt: Math.floor(Date.now() / 1000),
    }),
  };
}

/** Deterministic mock Telegram adapter — the auth machine walks
 *  phone→code→password→connected; `setMockState` exposes every status for
 *  the offline/reconnecting/locked/error demo matrix. */
function createMockTelegram(): TelegramSource {
  let state: TelegramState = { status: 'disconnected', authStep: 'none', error: null };
  const sent: TelegramMessage[] = [];
  return {
    getState: () => soon({ ...state }),
    startAuth: (input) => {
      if (state.status === 'connected') return soon({ ...state });
      if (input.password != null) state = { status: 'connected', authStep: 'none', error: null };
      else if (input.code != null) state = { status: 'authorizing', authStep: 'password', error: null };
      else if (input.phone != null) state = { status: 'authorizing', authStep: 'code', error: null };
      return soon({ ...state });
    },
    listChats: async () => soon(state.status === 'connected' ? (await loadMock()).telegramChats : []),
    getHistory: async (chatId) => {
      const m = await loadMock();
      return soon(state.status === 'connected'
        ? [...(m.telegramHistory[chatId] ?? []), ...sent.filter((x) => x.chatId === chatId)]
        : []);
    },
    sendText: (chatId, text) => {
      const msg: TelegramMessage = {
        messageId: `sent-${sent.length + 1}`,
        chatId,
        fromMe: true,
        text,
        ts: Math.floor(Date.now() / 1000),
      };
      sent.push(msg);
      return soon(msg);
    },
    logout: () => {
      state = { status: 'disconnected', authStep: 'none', error: null };
      sent.length = 0;
      return soon({ ...state });
    },
    setMockState: (status: TelegramStatus) => {
      state = {
        status,
        authStep: 'none',
        error: status === 'error' ? 'mock: adapter error' : null,
      };
      return soon({ ...state });
    },
  };
}

/** Deterministic mock Instagram API adapter. business→[basic, comments],
 *  creator→[basic, comments, messages]; consumer→limited-account-type
 *  (contract: consumer is never simulated as connected). */
function createMockInstagramApi(): InstagramApiSource {
  let state: InstagramApiState = { status: 'not-connected', account: null, error: null };
  const posted: InstagramComment[] = [];
  const scopesOf = (m: MockData, t: InstagramAccountType) =>
    t === 'creator'
      ? [m.IG_SCOPE_BASIC, m.IG_SCOPE_COMMENTS, m.IG_SCOPE_MESSAGES]
      : [m.IG_SCOPE_BASIC, m.IG_SCOPE_COMMENTS];
  const connected = () => state.status === 'connected' && state.account != null;
  const has = (scope: string) => state.account?.grantedScopes.includes(scope) === true;
  return {
    getState: () => soon({ ...state }),
    connect: async ({ accountType }) => {
      const m = await loadMock();
      state = accountType === 'consumer'
        ? { status: 'limited-account-type', account: null, error: 'Instagram API обслуживает только Business/Creator аккаунты' }
        : {
          status: 'connected',
          account: { handle: '@nexus_official', accountType, grantedScopes: scopesOf(m, accountType) },
          error: null,
        };
      return soon({ ...state });
    },
    disconnect: () => {
      state = { status: 'not-connected', account: null, error: null };
      posted.length = 0;
      return soon({ ...state });
    },
    listMedia: async () => soon(connected() ? (await loadMock()).instagramMedia : []),
    listComments: async (mediaId) => {
      const m = await loadMock();
      return soon(connected() && has(m.IG_SCOPE_COMMENTS)
        ? [...(m.instagramComments[mediaId] ?? []), ...posted.filter((c) => c.mediaId === mediaId)]
        : []);
    },
    listDmThreads: async () => {
      const m = await loadMock();
      return soon(connected() && has(m.IG_SCOPE_MESSAGES) ? m.instagramDmThreads : []);
    },
    postComment: (mediaId, text) => {
      const c: InstagramComment = {
        commentId: `posted-${posted.length + 1}`,
        mediaId,
        from: '@nexus_official',
        text,
        ts: Math.floor(Date.now() / 1000),
      };
      posted.push(c);
      return soon(c);
    },
    setMockState: async (status: InstagramApiStatus) => {
      const m = await loadMock();
      state = {
        status,
        account: status === 'permission-revoked' && state.account != null
          ? { ...state.account, grantedScopes: [m.IG_SCOPE_BASIC] }
          : state.account,
        error: status === 'error' ? 'mock: adapter error' : null,
      };
      return soon({ ...state });
    },
  };
}

function createMockInstagramWeb(): InstagramWebSource {
  let state: InstagramWebState = 'closed';
  const wrap = () => soon({ state });
  return {
    getState: wrap,
    open: () => { state = 'open'; return wrap(); },
    close: () => { state = 'closed'; return wrap(); },
    setMockState: (s: InstagramWebState) => { state = s; return wrap(); },
  };
}

/** Mock services catalog — connectable entries toggle to `connected`
 *  (mock badge on screen); agenda/docs only flow while their entry is on. */
function createMockServices(): NonNullable<ProductDataSource['services']> {
  const overrides = new Map<string, ServiceIntegration['state']>();
  const current = (m: MockData) =>
    m.serviceIntegrations.map((s) =>
      overrides.has(s.id) ? { ...s, state: overrides.get(s.id)! } : s);
  const find = (m: MockData, id: string) => current(m).find((s) => s.id === id) ?? null;
  const connected = (id: string) => overrides.get(id) === 'connected';
  return {
    list: async () => {
      const m = await loadMock();
      return soon(current(m));
    },
    connect: async (id) => {
      const m = await loadMock();
      const entry = find(m, id);
      if (entry?.connectable === true) overrides.set(id, 'connected');
      return soon(find(m, id));
    },
    disconnect: async (id) => {
      const m = await loadMock();
      if (find(m, id) != null) overrides.set(id, 'not-connected');
      return soon(find(m, id));
    },
    calendarAgenda: async () => {
      const m = await loadMock();
      return soon(connected('google-calendar.api') ? m.calendarAgenda : []);
    },
    pickedDocuments: async () => {
      const m = await loadMock();
      return soon(connected('google-docs.api') ? m.pickedDocuments : []);
    },
  };
}

/**
 * Соц-контур по умолчанию — ЧЕСТНЫЙ пустой. Здесь нет ни одного
 * выдуманного аккаунта/поста/задачи: без живого RAE-демона данные
 * отсутствуют, и экран показывает пустоту (0/0 подключено), а не
 * фиктивные карточки. Драфты через UI недоступны — это роль
 * планировщика RAE (python -m tools.rae.operator).
 */
function createMockSocial(): SocialSource {
  let mode: SocialSource['mode'] = 'stealth';
  const EMPTY_AGENT: SocialAgentState = {
    operator: 'AGENT-A',
    state: 'idle',
    currentTask: null,
    // Реальные роли фермы — не выдумка; задачи честно пусты без данных.
    subAgents: [
      { key: 'spark', task: null },
      { key: 'codex', task: null },
      { key: 'forge', task: null },
      { key: 'neo2', task: null },
    ],
  };
  const getState = async (): Promise<SocialHubState> => soon({
    agent: EMPTY_AGENT,
    accounts: [],
    mode,
    source: 'mock',
  });
  return {
    get mode() { return mode; },
    setMode: async (nextMode) => {
      mode = nextMode;
      return getState();
    },
    getState,
    listQueue: async () => soon([]),
    listApprovals: async () => soon([]),
    respondApproval: async () => soon(null),
    createDraft: async () => {
      throw new Error('Драфты создаются планировщиком RAE, не UI. Подключите живой RAE-демон.');
    },
    youtube: {
      listVideos: async () => soon([]),
      listComments: async () => soon([]),
    },
    x: {
      listTweets: async () => soon([]),
      listMentions: async () => soon([]),
    },
  };
}

/**
 * Live social source backed by RAE daemon (:5682).
 * Only used when NEXT_PUBLIC_RAE_LIVE=1 is set.
 */
let liveSocialSource: SocialSource | null = null;

async function getSocialSource(): Promise<SocialSource> {
  // Check if live RAE source is requested
  const raeLive = process.env.NEXT_PUBLIC_RAE_LIVE === '1';

  if (raeLive) {
    // Live RAE module грузится только при первом запросе (perf).
    const mod = await import('./social/live-source');
    liveSocialSource ??= mod.createLiveSocialSource();
    const available = await mod.isRaeAvailable();
    if (available) {
      return liveSocialSource;
    }
    // Fall through to mock if RAE is unavailable
  }

  // Mock source (default)
  return createMockSocial();
}

let liveSource: ProductDataSource | null = null;

/**
 * Perf (NUE-UI perf-budget dozhim): NUE gateway-auth вынесен в отдельный
 * ленивый модуль ./nue-gateway (getAi2ApiKey/setAi2ApiKey/registerNueKey/
 * createNueAuthFetch). Здесь остаётся только обёртка, которая догружает
 * модуль при первом фактическом fetch — shared-чанк /_not-found не тащит
 * auth-код до реального запроса. Потребители API ключа (mobile/lite/
 * settings-ai2-client-key) импортируют напрямую из ./nue-gateway.
 */
function createLazyNueAuthFetch(baseUrl: string): typeof fetch {
  let impl: typeof fetch | null = null;
  return (input, init) => {
    if (!impl) {
      return import('./nue-gateway').then((m) => {
        impl = m.createNueAuthFetch(baseUrl);
        return impl(input, init);
      });
    }
    return impl(input, init);
  };
}

type DataSourceKind = 'mock' | 'live';
type DataSourceConfigStatus = 'ready' | 'misconfigured';
type SourceSelection = DataSourceKind | 'misconfigured';

/**
 * Единый enum источника данных (NEO2-рекомендация): одно значение описывает
 * и выбор (mock/live), и ошибку конфигурации (misconfigured). Приложения
 * читают его через getDataSourceMode() — без пары (kind, configStatus).
 */
export type DataSourceMode = SourceSelection;

function isAi2Embedded(): boolean {
  // The AI-2 host mounts only ASSETS under /_nexus — document routes stay
  // `/…`. Detect the host by the bundle's own script/style URLs instead.
  return typeof document !== 'undefined' &&
    Boolean(document.querySelector('script[src*="/_nexus/"], link[href*="/_nexus/"]'));
}

function getConfiguredAi2BaseUrl(): string | null {
  const value = process.env.NEXT_PUBLIC_AI2_BASE_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function getSourceSelection(): SourceSelection {
  const forced = process.env.NEXT_PUBLIC_AI2_DATA_SOURCE;
  if (forced === 'mock') return 'mock';
  if (isAi2Embedded()) return 'live';
  if (forced !== 'live') return 'mock';
  return getConfiguredAi2BaseUrl() != null ? 'live' : 'misconfigured';
}

/** OpenCode seam доступен только при явном URL — проверка остаётся синхронной. */
function getOpenCodeSeamUrl(): string | undefined {
  try {
    const url = process.env?.NEXT_PUBLIC_OPENCODE_URL?.trim();
    return url ? url.replace(/\/$/, '') : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Perf (NUE-UI perf-budget dozhim): интеграции (opencode/craft/RAE) больше
 * не импортируются статически — они грузятся только при реальном обращении
 * к seam (lazy-сеам) или в live-ветке по первому запросу.
 */
function maybeOpenCodeSeam(): OpenCodeSeam | undefined {
  const url = getOpenCodeSeamUrl();
  if (!url) return undefined;
  return createLazySeam<OpenCodeSeam>(() =>
    import('../integrations/opencode/seam').then((m) => m.createOpenCodeSeam(url)),
  );
}

export function getDataSource(): ProductDataSource {
  // Live seam (Window-1 adapter, task-file §5): the AI-2 host serves the
  // static bundle under /_nexus → same-origin REST+SSE is reachable. The
  // dev server / Storybook stay on the deterministic mock unless live is
  // explicitly selected with a public host URL. A missing URL is reported as
  // misconfigured by getDataSourceConfigStatus() and keeps the deterministic mock.
  const sourceSelection = getSourceSelection();
  if (sourceSelection === 'live') {
    const baseUrl = isAi2Embedded() ? '' : getConfiguredAi2BaseUrl()!;
    liveSource ??= createAi2DataSource({
      // Preserve same-origin inside AI-2; use explicit host URL in web dev.
      baseUrl,
      fetchImpl: createLazyNueAuthFetch(baseUrl),
      // INT-24: NOIR host is a different origin — only when configured.
      noirBaseUrl: process.env.NEXT_PUBLIC_NOIR_BASE_URL || undefined,
    });
    // OpenCode integration (opencode-integration-spec.md, Фаза 0): seam
    // прикрепляется только при явном URL — иначе честный unavailable.
    if (liveSource.opencode === undefined) {
      liveSource.opencode = maybeOpenCodeSeam();
    }
    if (liveSource.craft === undefined) {
      liveSource.craft = createLazySeam<CraftSeam>(() =>
        import('../integrations/craft/seam').then((m) => m.createCraftSeam()),
      );
    }
    // Live social source - uses RAE daemon if NEXT_PUBLIC_RAE_LIVE=1
    if (liveSource.social === undefined) {
      liveSource.social = createSocialSource();
    }
    return liveSource;
  }
  // Craft seam не зависит от AI2-источника: /api/craft — route самого
  // приложения; в mock/dev мост может быть не поднят → honest unavailable.
  mockSource.craft ??= createLazySeam<CraftSeam>(() =>
    import('../integrations/craft/seam').then((m) => m.createCraftSeam()),
  );
  return mockSource;
}

/** Reports the selected source; invalid explicit live configuration is never
 *  presented as live. */
export function getDataSourceKind(): DataSourceKind {
  return getSourceSelection() === 'live' ? 'live' : 'mock';
}

/** Единый режим источника: 'mock' | 'live' | 'misconfigured' (NEO2). */
export function getDataSourceMode(): DataSourceMode {
  return getSourceSelection();
}

/** Единый словарь меток источника (P1-1): все поверхности используют его —
 *  никаких локальных «ДЕМО»/«mock»/«demo» вариаций. */
export function sourceModeLabel(mode: DataSourceMode | 'unknown' | null): string {
  if (mode === 'live') return 'LIVE';
  if (mode === 'misconfigured') return 'CONFIG';
  if (mode === 'mock') return 'MOCK';
  return 'SYNCING';
}

/** Separates explicit live configuration errors from the mock source used as
 *  a safe fallback. */
export function getDataSourceConfigStatus(): DataSourceConfigStatus {
  return getSourceSelection() === 'misconfigured' ? 'misconfigured' : 'ready';
}

/**
 * #418 (wave #418-2): mount-gated data source for screens/panels that read
 * seam *presence* at render time (KPI labels, empty-hints, loading-hints,
 * source badges, panel heads). getDataSource() branches on isAi2Embedded()
 * → document.querySelector('script[src*="/_nexus/"]'): at SSR/Node there is
 * no document → the deterministic MOCK source; after the AI-2 host mounts
 * the bundle under /_nexus the same call returns the LIVE source. A panel
 * that prints seam-presence text from that render-time value then differs
 * on the server vs. the first client frame → React hydration mismatch #418
 * (regression on /agents /library /data /settings; the top-bar badge was
 * already guarded in 11d64a89 but the screen/panel content was not).
 *
 * The hook returns the deterministic MOCK source on the server and the first
 * client frame, then the real source after mount. It re-exports the SAME
 * singleton getDataSource() returns post-mount, so `useAsyncValue([ds])`
 * deps stay stable and no refetch loop. Consumers that previously did
 * `useMemo(getDataSource, [])` for a seam-presence read swap to
 * `useDataSource()`. In tests the module mock provides `useDataSource`
 * returning the same stable object the mock's getDataSource returns.
 */
export function useDataSource(): ProductDataSource {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? getDataSource() : mockSource;
}

