/**
 * Product view-model contracts — docs/product/view-model-contracts.md.
 * Transport-free boundary: screens, patterns and fixtures consume these
 * shapes; Window-1 adapters map raw AI-2 JSON onto them later.
 */
import type { DataFreshness, NexusGraphEdge, NexusGraphNode } from '@nexus/patterns/graphs/types';

export type { DataFreshness, NexusGraphEdge, NexusGraphNode };

// 1. Run / process ------------------------------------------------------------

export type RunStatus = 'running' | 'done' | 'error' | 'cancelled' | 'timeout';
export type StopReason =
  | 'done' | 'cancelled' | 'timeout' | 'dep_failed'
  | `budget: ${string}` | `error: ${string}` | (string & {});

export interface RunSummary {
  runId: string;
  taskText: string;
  config: string;
  status: RunStatus;
  stopReason: StopReason | null;
  agent: string | null;
  parent: string | null;
  /** Retry-chain link — wire `retry_of`; a retried run shares the root thread. */
  retryOf?: string | null;
  project: string | null;
  /** Server model id when the source knows it (mock stores the requested
   *  input; live /v1/runs record does not report it — stays undefined).
   *  Never guessed by the shell. */
  model?: string | null;
  costUsd: number | null;
  createdAt: number;
  finishedAt: number | null;
  /** Request flag `use_memory` as the source knows it — the mock records
   *  the input verbatim; the live run record doesn't report it (stays
   *  undefined). The flag means the tool was GRANTED, never that it ran —
   *  actual retrieval shows up only as `tool_call: memory_search` events. */
  useMemory?: boolean | null;
}

export interface RunResultView extends RunSummary {
  answer: string | null;
  score: number | null;
  verified: boolean | null;
  durationS: number | null;
  usage: { modelCalls: number; toolCalls: number; tokens: number; costUsd: number };
}

export interface RunEventView {
  seq: number;
  type: string;
  role: string | null;
  ts: number;
  body: unknown;
}

/**
 * Run detail — composed view (run + persisted events + final result).
 * `result` is null while the run is live or when the result endpoint has
 * nothing stored; `events` is the persisted log only — never fabricated.
 */
export interface RunDetail {
  run: RunSummary;
  result: RunResultView | null;
  events: RunEventView[];
}

/** Server vocab — GET /v1/processes ps(); do NOT rename. */
export type ProcessState = 'new' | 'ready' | 'running' | 'blocked' | 'done' | 'failed' | 'cancelled';

export interface ProcessRow {
  pid: number;
  runId: string | null;
  task: string;
  state: ProcessState;
  depth: number;
  parentPid: number | null;
}

// 2. Mission ----------------------------------------------------------------

export interface NexusMissionStep {
  id: string;
  label: string;
  state: 'pending' | 'active' | 'done' | 'failed' | 'skipped';
  agentId: string | null;
  startedAt: number | null;
  endedAt: number | null;
}

export interface MissionOutput {
  id: string;
  label: string;
  kind: 'answer' | 'artifact' | 'report';
  runId: string | null;
}

export interface NexusMission {
  id: string;
  title: string;
  state: 'queued' | 'active' | 'done' | 'failed' | 'cancelled';
  steps: NexusMissionStep[];
  outputs: MissionOutput[];
  agents: string[];
  freshness: DataFreshness;
}

export interface MissionGraphData {
  nodes: NexusGraphNode[];
  edges: NexusGraphEdge[];
}

// 3. Memory / knowledge ------------------------------------------------------

export interface MemoryItem {
  id: number;
  project: string;
  text: string;
  createdAt: number;
}

export interface MemorySearchHit extends MemoryItem {
  score: number;
}

export interface MemoryStructure {
  project: string;
  total: number;
  perDay: { day: string; count: number }[];
  sources: { name: string; count: number }[];
}

export interface MemoryGraphData {
  nodes: NexusGraphNode[];
  edges: NexusGraphEdge[];
}

// 4. Models / router ---------------------------------------------------------

export interface ModelInfo {
  id: string;
  label: string;
  free: boolean | null;
  isDefault: boolean;
}

export interface PresetInfo {
  name: string;
  description: string | null;
  flags: Record<string, boolean>;
  isDefault: boolean;
}

export interface ModelRouterData {
  nodes: NexusGraphNode[];
  edges: NexusGraphEdge[];
}

// 5. Registry / settings -----------------------------------------------------

/** Wave XI — handoff-кнопка спеки агента ({label, agent, prompt, send}):
 *  продолжение под ответом, аналог «Start Implementation» у Copilot plan. */
export interface AgentHandoff {
  label: string;
  agent: string;
  prompt: string;
  /** true = отправить целевому агенту сразу, false = подставить в композитор. */
  send: boolean;
}

export interface AgentSpec {
  name: string;
  description: string | null;
  config: string | null;
  capabilities: string[];
  maxCostUsd: number | null;
  /** Host-owned список продолжений (волна XI); отсутствует на хостах до миграции. */
  handoffs?: AgentHandoff[];
}

export interface PluginInfo {
  name: string;
  url: string;
  active: boolean;
  signed: boolean;
  hasSecret: boolean;
}

export interface WebhookRow {
  webhookId: string;
  url: string;
  events: string[];
  active: boolean;
}

export interface WebhookDelivery {
  deliveryId: string;
  event: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  lastCode: number | null;
  lastError: string | null;
  ts: number;
}

/**
 * Approval request — a run paused on a human decision (plan/approval
 * lifecycle, O7). Wire shape mirrors what an AI-2 approval endpoint would
 * emit: the action is server/action vocab verbatim, `scope` names the
 * requested capability grant; null = scope not disclosed by the runtime.
 */
export interface ApprovalRequest {
  approvalId: string;
  runId: string;
  action: string;
  scope: string | null;
  detail: string;
  /** Mirrors Ai2ApprovalStatus — expired/revoked arrive decided-side, never actionable. */
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'revoked';
  requestedAt: number;
  decidedAt: number | null;
  /** Grant expiry (epoch s); null = the request does not expire. */
  expiresAt?: number | null;
  /** Decision linkage — which event seq raised the gate. */
  eventSeq?: number | null;
}

export type ApprovalDecision = 'approve' | 'deny';

/**
 * Pre-start plan card (O7/W3-02) — what the runtime SAYS it will do before
 * the run starts: goal, stages, assigned agents/tools, declared limits.
 * Mock derives this deterministically from run input + preset/agent
 * fixtures; a real planner endpoint is a W1 contract (missing-api §2.8).
 * This is never hidden model reasoning — only declared steps.
 */
export interface RunPlan {
  goal: string;
  stages: { id: string; label: string; agent: string | null }[];
  /** Declared workspace scope — the `project` the run binds to; null when unspecified. */
  workspace: string | null;
  /** Tool/capability grants the plan declares (from AgentSpec.capabilities). */
  tools: string[];
  limits: { maxCostUsd: number | null; maxDurationS: number | null };
  /** True when declared tools include grants that gate on human approval. */
  approvalsPlanned: boolean;
}

/**
 * Run controls state (O7/W3-04/05) — pause/resume/replay availability as
 * reported by the runtime. An unavailable action carries a host/UI reason;
 * the UI disables it and never presents a no-op.
 * `paused` is a control flag — the run keeps its `running` status until a
 * terminal/heartbeat says otherwise.
 */
export interface RunControlState {
  paused: boolean;
  pause: { available: boolean; reason: string | null };
  resume: { available: boolean; reason: string | null };
  replay: { available: boolean; reason: string | null };
  /** Persisted checkpoints — unsupported hosts report unavailable+reason. */
  checkpoint: { available: boolean; reason: string | null };
  /** Retry = a NEW run with the same input, never a mutation of this one. */
  retry: { available: boolean; reason: string | null };
}

/**
 * Unreal 3D companion scene — host lifecycle vocabulary
 * (unreal-runtime-scene-integration §Lifecycle). `connected` may only ever
 * be reported by the host after the loopback handshake; the UI never
 * asserts it locally.
 */
export type UnrealSceneStatus =
  | 'not-installed' | 'starting' | 'connected' | 'stale' | 'disconnected' | 'error'
  /** Fail-safe: enum/поле вне известной схемы — никогда не читать как healthy. */
  | 'unknown';

/** Snapshot provenance — `mock` states always render a DEMO badge on screen. */
export type UnrealSceneSource = 'live' | 'mock';

export interface UnrealSceneHostState {
  status: UnrealSceneStatus;
  /** null until the host has reported a source (never implied by status). */
  source: UnrealSceneSource | null;
  /**
   * Host-provided reason for not-installed / error / disconnected — the UI
   * shows it verbatim and never invents one.
   */
  reason: string | null;
  /** Host clock (epoch s) of the last state change; null = no report yet. */
  lastUpdated: number | null;
  /** Bridge protocol version negotiated at handshake; null until connected. */
  protocolVersion: number | null;
  /**
   * nexus-scene-v1 (W1 S3): активный ассистент сцены
   * (arch|mech|alice|codex|forge). null — хост поля не сообщил;
   * fallback «пусто/неизвестно → alice» — правило хоста, не UI.
   */
  activeAssistant: string | null;
  /**
   * VII V3-3: карта, открытая хостом (`/Game/Maps/...`). null — не
   * сообщена; «карта не найдена» — это `error` + `reason` хоста verbatim,
   * а не отдельный статус.
   */
  activeMap: string | null;
}

/**
 * Обратное событие сцены `unreal-scene.event` (VII V3-1): клик по портрету,
 * возврат из сцены, ошибка загрузки карты и т.п. `type` — открытый словарь
 * хоста: неизвестные типы передаются verbatim, не отбрасываются.
 */
export interface UnrealSceneEvent {
  type: string;
  assistant?: string | null;
  map?: string | null;
  detail?: unknown;
  /** host clock (epoch s); null/отсутствует — время не сообщено. */
  ts?: number | null;
}

/**
 * VII V3-3: канон assistant → карта по инвентарю карт W1
 * (2026-10-15-agent-scenes-assets). FORGE — главный `StartScene`;
 * `SelectScene` не существует, в таблицу не входит. Выбор карты — право
 * хоста; таблица справочная (ожидаемая карта), не routing из UI.
 */
export const SCENE_MAP_BY_ASSISTANT: Readonly<Record<string, string>> = {
  arch: '/Game/Maps/StartScene_Arch',
  mech: '/Game/Maps/StartScene_Mech',
  alice: '/Game/Maps/StartScene_Alice',
  codex: '/Game/Maps/StartScene_Codex',
  forge: '/Game/Maps/StartScene',
};

// 6. System / metrics --------------------------------------------------------

export interface SystemMetrics {
  cpuPct: number | null;
  ramPct: number | null;
  diskPct: number | null;
  gpuPct: number | null;
  uptimeS: number | null;
  /** Worker processes the host pool is running right now
   *  (`pool.processes_active`). A host that does not report the pool leaves it
   *  unset — the ALICE core then draws one hoop instead of implying a count. */
  processesActive?: number | null;
  counters: {
    modelCalls: number;
    toolCalls: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
  };
  health: { component: string; status: 'ok' | 'warn' | 'error'; detail: string | null }[];
  freshness: DataFreshness;
}

export interface UsageSummary {
  period: string;
  runsTotal: number;
  runsSucceeded: number;
  runsFailed: number;
  runsCancelled: number;
  runsTimeout: number;
  runsRunning: number;
  costUsd: number;
  breakdown: { config: string; runs: number; costUsd: number }[];
}

/** API key row — GET /v1/keys response item (key_view). Secret never present. */
export interface ApiKeyInfo {
  keyId: string;
  name: string;
  scopes: string[];
  /** Displayed prefix — full key is never returned by the server. */
  prefix: string;
  status: 'active' | 'revoked' | 'expired';
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
}

// 7. Product shell -----------------------------------------------------------

export type ThemeId = 'nexus' | 'alice' | 'mech' | 'forge' | 'codex' | 'arch' | (string & {});
export type Density = 'calm' | 'standard' | 'dense';
export type PageState = 'loading' | 'ready' | 'empty' | 'error' | 'stale' | 'offline';

export interface AgentIdentity {
  id: ThemeId;
  name: string;
  themeId: ThemeId;
  description: string;
  /**
   * Presentation focus tags (welcome/agent-select filter chips) — persona
   * metadata, not host-reported runtime capabilities.
   */
  focus: readonly string[];
  /** Runtime-role truth disclaimer — persona is presentation only. */
  roleNote: string;
}

/** Interface depth levels (runtime-interface-levels-concept): navigation/detail depth, never permissions. */
export type UiLevel = 'simple' | 'professional' | 'team';

/** Wave XI — режим композитора по контракту Copilot (W1): agent/ask/plan. */
export type ComposerMode = 'agent' | 'ask' | 'plan';

export interface UserProfile {
  name: string;
  themeId: ThemeId;
  density: Density;
  agentId: ThemeId;
  surfaces: Record<string, boolean>;
  osNotifications: boolean;
  uiLevel?: UiLevel;
  favoritePrompts: { id: string; text: string }[];
  /** Client-side default picks (no server write API — missing-api-list). */
  defaultPreset?: string | null;
  defaultModelId?: string | null;
  /** Runtime defaults (wave-7): agent for new runs; null/undefined → auto. */
  defaultRunAgent?: string | null;
  /** Voice for AGENT-A answers (voice id from /v1/voice/voices); null → host default. */
  voiceSpeakerId?: string | null;
  /** Speak run answers automatically when the voice seam is supported. */
  voiceAutoSpeak?: boolean;
  /** Left sections sidebar collapsed (topbar toggle). */
  navCollapsed?: boolean;
  /** Три состояния левой панели (приоритет 16.10): полная, узкая полоса
   *  иконок (~56px), всё скрыто. Чтение: navMode ?? (navCollapsed ?
   *  'hidden' : 'full') — старый флаг мапится на 'hidden'. */
  navMode?: 'full' | 'strip' | 'hidden';
  /** Ask the host to grant `memory_search` on new runs (project corpus).
   *  Default ON — host corpus seeded via tools/seed_memory.py (M1) and a
   *  live retrieval run verified (M3). */
  useMemory?: boolean;
  /** Memory project for `use_memory` runs; empty/`'ai2'` → host default. */
  memoryProject?: string;
  /** fs-access dispatch: filesystem mode the user declared for new runs.
   *  `read_only` → host turns writes into approval requests; `read_write`
   *  → writes execute (subject to per-root access + deny-list). Enforced
   *  host-side; this field only feeds `fs_policy` in the run payload. */
  fsMode?: 'read_only' | 'read_write';
  /** Declared fs roots for new runs (id is the model-visible handle).
   *  Paths are validated via `ds.fs.validate` before being stored. */
  fsRoots?: { id: string; path: string }[];
  /** Режим композитора (волна XI): agent — выполнить задачу, ask — ответить
   *  вопросом, plan — план без исполнения. Уходит в startRun.mode. */
  composerMode?: ComposerMode;
  /** Operator token for RAE daemon POST via Caddy (X-Nexus-Op header).
   *  Stored locally in localStorage nexus.opToken, synced from profile. */
  raeOpToken?: string;
  /** Token for TPlayer engine proxy via Caddy (X-Nexus-TPlayer header).
   *  Stored locally in localStorage nexus.tplayer.token, synced from profile. */
  tplayerToken?: string;
  /** Непрозрачность окна NUE в процентах (10–100): регулятор в шапке,
   *  применяется через desktop-мост (Win32 layered). Отсутствует = 100. */
  windowOpacity?: number;
  /** Модульные бары оболочки NUE: у каждого края — режим (полная/тонкая/
   *  закрыта), сторона и запомненный размер. Отсутствующие поля = дефолты:
   *  шапка сверху, подсказки снизу, рейл слева, док справа. Перемещение
   *  бара на занятый край меняет бары местами — конфликтов сторон нет. */
  bars?: {
    top?: { mode?: 'full' | 'slim' | 'hidden'; side?: 'top' | 'bottom'; height?: number | null; position?: { x: number; y: number } | null };
    bottom?: { mode?: 'full' | 'slim' | 'hidden'; side?: 'bottom' | 'top'; height?: number | null; position?: { x: number; y: number } | null };
    nav?: { side?: 'left' | 'right'; width?: number | null; position?: { x: number; y: number } | null };
    dock?: { side?: 'left' | 'right'; position?: { x: number; y: number } | null };
  };
}

/** Prompt-файл каталога Library (волна XI): имя и путь verbatim от seam'а. */
export interface PromptFileRef {
  name: string;
  path: string;
}

// 8. Media playback ----------------------------------------------------------

/** YouTube Data API `search.list` item subset — verbatim field names. */
export interface YouTubeHit {
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
}

// 9. Telegram client (TDLib adapter boundary — telegram-runtime-window contract)

/** Adapter `getStatus` vocabulary — verbatim, do not rename. */
export type TelegramStatus =
  | 'disconnected' | 'authorizing' | 'connected' | 'reconnecting'
  | 'locked' | 'unavailable' | 'error';

/** Current authorization input the adapter is waiting for. */
export type TelegramAuthStep = 'none' | 'phone' | 'code' | 'password';

export interface TelegramState {
  status: TelegramStatus;
  authStep: TelegramAuthStep;
  /** Verbatim adapter error text, secret-free. */
  error: string | null;
}

export interface TelegramChat {
  chatId: string;
  title: string;
  lastText: string;
  lastTs: number;
  unread: number;
}

export interface TelegramMessage {
  messageId: string;
  chatId: string;
  fromMe: boolean;
  text: string;
  ts: number;
}

/** Typed adapter boundary — UI never calls TDLib or host commands directly. */
export interface TelegramSource {
  getState(): Promise<TelegramState>;
  /** Advance the auth state machine; fields are consumed for the current
   *  `authStep` only. Credentials never leave the adapter seam. */
  startAuth(input: { phone?: string; code?: string; password?: string }): Promise<TelegramState>;
  listChats(): Promise<TelegramChat[]>;
  getHistory(chatId: string): Promise<TelegramMessage[]>;
  /** Explicit user-initiated send only. */
  sendText(chatId: string, text: string): Promise<TelegramMessage>;
  logout(): Promise<TelegramState>;
  /** Mock-only: deterministic status switch for offline/reconnecting/locked/
   *  error demos. Absent on live adapters. */
  setMockState?(status: TelegramStatus): Promise<TelegramState>;
}

// 10. Instagram — two independent integrations (instagram-runtime-window contract)

/** Managed Web window lifecycle — Runtime's own truth only. */
export type InstagramWebState = 'closed' | 'opening' | 'open' | 'unavailable' | 'error';

/** API client connection vocabulary — verbatim. */
export type InstagramApiStatus =
  | 'not-connected' | 'connecting' | 'needs-permission' | 'connected'
  | 'limited-account-type' | 'permission-revoked' | 'rate-limited'
  | 'offline' | 'unavailable' | 'error';

export type InstagramAccountType = 'business' | 'creator' | 'consumer';

export interface InstagramAccount {
  handle: string;
  accountType: InstagramAccountType;
  /** Granted Meta permissions — verbatim scope names. */
  grantedScopes: string[];
}

export interface InstagramApiState {
  status: InstagramApiStatus;
  account: InstagramAccount | null;
  error: string | null;
}

export interface InstagramMedia {
  mediaId: string;
  caption: string;
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  ts: number;
}

export interface InstagramComment {
  commentId: string;
  mediaId: string;
  from: string;
  text: string;
  ts: number;
}

export interface InstagramDmThread {
  threadId: string;
  withHandle: string;
  lastText: string;
  ts: number;
}

/** Instagram API adapter boundary — typed operations, OAuth lives behind it. */
export interface InstagramApiSource {
  getState(): Promise<InstagramApiState>;
  /** Begin Meta OAuth flow for the chosen account type. Consumer accounts
   *  resolve `limited-account-type`, never `connected`. */
  connect(input: { accountType: InstagramAccountType }): Promise<InstagramApiState>;
  disconnect(): Promise<InstagramApiState>;
  listMedia(): Promise<InstagramMedia[]>;
  listComments(mediaId: string): Promise<InstagramComment[]>;
  listDmThreads(): Promise<InstagramDmThread[]>;
  /** Explicit, user-confirmed comment write (preview shown by UI first). */
  postComment(mediaId: string, text: string): Promise<InstagramComment>;
  setMockState?(status: InstagramApiStatus): Promise<InstagramApiState>;
}

/** Managed web window boundary — lifecycle only, never page content. */
export interface InstagramWebSource {
  getState(): Promise<{ state: InstagramWebState }>;
  /** Open or focus the single managed window — repeated calls focus. */
  open(): Promise<{ state: InstagramWebState }>;
  close(): Promise<{ state: InstagramWebState }>;
  setMockState?(state: InstagramWebState): Promise<{ state: InstagramWebState }>;
}

// 11. Service integrations catalog (runtime-service-integrations contract)

/** Access path — mirrors ui ServiceAccessMode vocab (structural, no dep). */
export type ServiceAccessModeKind = 'web' | 'api' | 'native-app' | 'business-api';

/** Per-card connection vocabulary — verbatim contract §Правила 7. */
export type ServiceConnState =
  | 'not-connected' | 'opening' | 'connected' | 'needs-review'
  | 'needs-permission' | 'read-only' | 'write-confirmation-required'
  | 'rate-limited' | 'region-unavailable' | 'revoked' | 'error' | 'mock';

export interface ServiceIntegration {
  /** Stable id — provider + access path, e.g. 'google-calendar.api'. */
  id: string;
  /** Provider/product name verbatim. */
  name: string;
  mode: ServiceAccessModeKind;
  state: ServiceConnState;
  /** Granted/requested permission scope names — verbatim. */
  scopes: string[];
  /** Capability text from the contract row. */
  summary: string;
  /** Verbatim reason for blocked/needs-review/unavailable. */
  reason?: string;
  /** Official web entry point for the Open action. */
  webUrl?: string;
  /** Whether the mock source may simulate a connect for this entry. */
  connectable: boolean;
}

export interface CalendarAgendaItem {
  id: string;
  time: string;
  title: string;
  /** 'private' → details hidden per Calendar API rights. */
  visibility: 'visible' | 'private';
  source: string;
}

export interface PickedDocument {
  docId: string;
  name: string;
  meta: string;
  content: string;
}

/** INT-23 — generated image view (POST /v1/images/generate, camelCase).
 *  `costUsd` null = provider did not report a price — unknown is not zero.
 *  `enriched` true only when enrichment actually changed the prompt. */
export interface GeneratedImage {
  imageB64: string;
  mime: string;
  bytes: number;
  /** Model that produced the image (may differ from requested). */
  model: string;
  costUsd: number | null;
  prompt: string;
  enrichedPrompt: string | null;
  enriched: boolean;
}

/** 12. Social networks */
export type SocialNetworkId = 'telegram'|'instagram'|'youtube'|'x';
export type SocialAccountState = 'connected'|'not-connected'|'needs-permission'|'needs-review'|'rate-limited'|'error'|'unavailable';
export interface SocialAccount { network: SocialNetworkId; handle: string|null; state: SocialAccountState; followers: number|null; reason: string|null; }
export type SocialPostStatus = 'draft'|'scheduled'|'pending-approval'|'published'|'rejected';
export type SocialMediaKind = 'text'|'image'|'video';
export interface SocialPost { id: string; network: SocialNetworkId; text: string; media: SocialMediaKind; status: SocialPostStatus; scheduledAt: string|null; authorAgent: string|null; /** RAE-UI-GAPS: проверка/верификация поста (daemon /api/rae/items). */
  verified?: boolean; verifyReason?: string | null; findings?: { rule: string; severity: string; detail: string }[]; }
export interface SocialAgentState { operator: string; state: 'idle'|'drafting'|'scheduling'|'awaiting-approval'|'offline'; currentTask: string|null; subAgents: {key: string; task: string|null}[]; }
export interface SocialHubState {
  agent: SocialAgentState;
  accounts: SocialAccount[];
  /** Текущий режим подключения (stealth/open). В hub — чтобы UI читал его
   *  из асинхронного состояния, а не из ленивого SocialSource-сеама
   *  (свойства seam'а недоступны синхронно). */
  mode?: 'stealth' | 'open';
  /** Откуда взялось состояние: live — RAE, mock — честный пустой контур,
   *  mock-offline — RAE был запрошен, но недоступен (данных нет). */
  source?: 'live' | 'mock' | 'mock-offline';
}
export interface YouTubeVideo { videoId: string; title: string; publishedAt: string; views: number|null; comments: number|null; }
export interface YouTubeCommentRow { commentId: string; videoId: string; author: string; text: string; ts: number; }
export interface XTweet { tweetId: string; text: string; ts: number; likes: number|null; reposts: number|null; }
export interface XMention { mentionId: string; author: string; text: string; ts: number; }
export interface SocialSource {
  mode: 'stealth'|'open';
  setMode(mode: 'stealth'|'open'): Promise<SocialHubState>;
  getState(): Promise<SocialHubState>;
  listQueue(): Promise<SocialPost[]>;
  listApprovals(): Promise<SocialPost[]>;
  respondApproval(id: string, decision: 'approve'|'reject', reason?: string|null): Promise<SocialPost|null>;
  createDraft(input: {network: SocialNetworkId; text: string; media?: SocialMediaKind; scheduledAt?: string|null}): Promise<SocialPost>;
  youtube?: {listVideos(): Promise<YouTubeVideo[]>; listComments(videoId: string): Promise<YouTubeCommentRow[]>};
  x?: {listTweets(): Promise<XTweet[]>; listMentions(): Promise<XMention[]>};
}
