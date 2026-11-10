/**
 * NEWF E2 — живой мост к nexus-core.
 *
 * РўРѕС‚ Р¶Рµ РёРЅС‚РµСЂС„РµР№СЃ, С‡С‚Рѕ Сѓ mockHcBridge РёР· newf.tsx, РЅРѕ Р·Р° СЂРµР°Р»СЊРЅС‹Рј API:
 *   GET  {base}/api/core/spaces|terminals|machines|agents
 *   GET  {base}/api/core/screen/<term>   вЂ” СЃСЂРµР· СЌРєСЂР°РЅР° (core read)
 *   GET  {base}/v1/roster.json          вЂ” СЂРѕСЃС‚РµСЂ (seam QODER)
 *   POST {base}/api/core/send            {term, text}
 *   POST {base}/api/core/keys            {term, keys[]}
 *   GET  {base}/api/core/events          вЂ” SSE (status/attention/done)
 *   GET  {base}/api/deck/*               вЂ” farm-ростер (status/agents/terminals/machines/events)
 *   (legacy opt-in: prefix '/api/bus' доступен явно, НЕ по умолчанию)
 *
 * Р§РµСЃС‚РЅР°СЏ РЅРµРґРѕСЃС‚СѓРїРЅРѕСЃС‚СЊ: Р»СЋР±РѕР№ РѕС‚РєР°Р· СЃРµС‚Рё вЂ” BridgeUnavailable, СЌРєСЂР°РЅ
 * РїРѕРјРµС‡Р°РµС‚ РґР°РЅРЅС‹Рµ offline Рё РќР• РїРѕРґСЃС‚Р°РІР»СЏРµС‚ РјРѕРєРё (СЃРїРµРєР° workflow-seams).
 */

import { seatFromLabels } from './newf-roles';

export interface LiveSpace { id: string; name: string; machine: string }
/** Детали спейса (GET /api/core/spaces/detail): счётчики и члены. */
export interface LiveSpaceDetail {
  id: string;
  terms: number;
  live: number;
  labels: string[];
  members: string[];
}
/** Диагностика ядра (GET /api/core/diag). */
export interface CoreDiag {
  ts: number;
  version: string;
  uptime_s: number;
  health: { pump_alive: boolean; drain_alive: boolean };
  stats: { sent: number; failed: number; dead: number; pending: number };
  terminals: { live: number; total: number; exited: number; states: Record<string, number> };
  spaces: number;
  alerts: { rules: number; history_count: number };
  config: { pump_interval_s: number | null; rate_limit: number | null; scrollback_maxlen: number };
  events_total: number;
}
/** Лёгкая сводка терминала (GET /api/core/terminals/summary). */
export interface TermSummary {
  name: string;
  space: string;
  state: string;
  lastLine: string;
  lastActivityTs?: number;
}
/** Правило алерта (GET /api/core/alert-rules). */
export interface AlertRuleEntry {
  idx: number;
  pattern: string;
  action: string;
  disabled: boolean;
  runtime: boolean;
}
/** Запись истории алертов (GET /api/core/alerts). */
export interface AlertHistoryEntry {
  ts?: number;
  term?: string;
  ruleIdx?: number;
  pattern?: string;
  action?: string;
  line?: string;
}
/** Активный share-токен (GET /api/core/shares). token — префикс. */
export interface ShareEntry {
  token: string;
  term: string;
  scopes: string[];
  expiresAt: number;
  expired: boolean;
  hits: number;
}
/** Ответ создания share (POST /api/core/share). */
export interface ShareCreated {
  token: string;
  term: string;
  scopes: string[];
  expiresAt: number;
  viewUrl: string;
}
/** Запись input-log (GET /api/core/terminal/{term}/input-log). */
export interface InputLogEntry {
  ts?: number;
  text: string;
  enter: boolean;
}
export interface LiveTerminal {
  address: string;
  label: string;
  spaceId?: string;
  tab?: string;
  state: 'working' | 'idle' | 'blocked' | 'done' | 'error' | 'archived' | 'exited';
  agent?: string;
  machine?: string;
  /** РњРµСЃС‚Рѕ СЂРѕСЏ РёР· Р»РµР№Р±Р»Р° `newf.seat` (СЃРј. newf-roles). */
  seat?: string;
  /** РђРґСЂРµСЃ СЂРѕРґРёС‚РµР»СЏ РґР»СЏ СЃСѓР±Р°РіРµРЅС‚РѕРІ (С‚РµСЂРјРёРЅР°Р» Р·Р°РїСѓС‰РµРЅ Р°РіРµРЅС‚РѕРј С‡РµСЂРµР· run). */
  parent?: string;
  /** Р Р°Р·РјРµСЂ PTY-РіСЂРёРґР° (nexus-core to_dict; Сѓ bus-С‚РµСЂРјРёРЅР°Р»РѕРІ РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚). */
  cols?: number;
  rows?: number;
  /** unix-СЃРµРєСѓРЅРґС‹ СЃРѕР·РґР°РЅРёСЏ (core to_dict.created_at; SPARK #536). */
  createdAt?: number;
  /** unix-СЃРµРєСѓРЅРґС‹ Р·Р°РІРµСЂС€РµРЅРёСЏ (core to_dict.exited_at; SPARK #536). */
  exitedAt?: number;
  /** W2: attention-бейдж (событие attention → true; сброс при фокусе). */
  attention?: boolean;
  /** W6: терминал умрёт вместе с родителем (core to_dict.die_with_parent). */
  dieWithParent?: boolean;
  /** W11: labels терминала (для бейджей). */
  labels?: Record<string, string>;
  /** UI-FIX: текущий заголовок из title-событий SSE (sanitized). */
  title?: string;
}
export interface LiveAgent { id: string; name: string; terminal: string; status: LiveTerminal['state']; seat?: string; parent?: string; app?: string; turn?: number; machine?: string; cwd?: string; labels?: Record<string, string>; title?: string }
export interface LiveScreen { term: string; screen: string }

/** Информация о ядре (GET /api/core/server). Поле state - состояние
 *  процесса ядра (running/starting/stopped/unknown). */
export interface CoreServerInfo {
  version: string;
  uptime_s: number;
  state: string;
  startedAt?: number;
  pid?: number;
  host?: string;
}

/**
 * PKG-B1: сводка фермы (GET /api/deck/status). Канонический источник
 * здоровья Deck-моста: connected=false → мост жив, но ферма/ядро не
 * подключены → честный offline + HonestEmpty.
 */
export interface DeckStatus {
  connected: boolean;
  eventsConnected: boolean;
  version: string;
  lastError: string;
  uptimeS: number;
  terminals: number;
  machines: number;
  eventsSeq: number;
  session: string;
}

/** Нормализация ответа /api/deck/status (плоский или {status:{…}}). */
export function normalizeDeckStatus(raw: unknown): DeckStatus {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const nested = (data.status && typeof data.status === 'object' ? data.status : {}) as Record<string, unknown>;
  const pick = (key: string): unknown => nested[key] ?? data[key];
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    connected: pick('connected') === true,
    eventsConnected: pick('events_connected') === true,
    version: typeof pick('version') === 'string' ? String(pick('version')) : '',
    lastError: typeof pick('last_error') === 'string' ? String(pick('last_error')) : '',
    uptimeS: num(pick('uptime_s')),
    terminals: num(pick('terminals')),
    machines: num(pick('machines')),
    eventsSeq: num(pick('events_seq')),
    session: typeof pick('session') === 'string' ? String(pick('session')) : '',
  };
}

/** Строка «агент» из /api/deck/agents → LiveAgent (рабочий статус агента —
 *  поле agent_state; state="live" — только признак присутствия). */
export function deckAgentToLive(raw: Record<string, unknown>): LiveAgent {
  const rawAgentState = raw.agent_state != null ? String(raw.agent_state) : undefined;
  const rawSessionState = String(raw.state ?? 'idle');
  const rawState = rawAgentState ?? (rawSessionState === 'live' ? 'idle' : rawSessionState);
  const KNOWN: LiveTerminal['state'][] = ['working', 'idle', 'blocked', 'done', 'error', 'archived', 'exited'];
  const state = (KNOWN.includes(rawState as LiveTerminal['state']) ? rawState : 'idle') as LiveTerminal['state'];
  const labels = (raw.labels && typeof raw.labels === 'object' ? raw.labels : {}) as Record<string, unknown>;
  return {
    id: String(raw.address ?? ''),
    name: String(raw.name ?? labels.agent ?? labels.where ?? raw.address ?? ''),
    terminal: String(raw.address ?? ''),
    status: state,
    seat: raw.seat != null ? String(raw.seat) : undefined,
    parent: raw.parent != null ? String(raw.parent) : undefined,
    app: raw.app != null ? String(raw.app) : undefined,
    turn: typeof raw.turn === 'number' ? raw.turn : undefined,
    machine: raw.machine != null ? String(raw.machine) : undefined,
    cwd: raw.cwd != null ? String(raw.cwd) : undefined,
    labels: Object.keys(labels).length > 0 ? Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, String(v)])) : undefined,
  };
}

/** Запись машины из /api/deck/machines → MachineRecord (поля host/session/
 *  state/version; since_ms/transport отсутствуют → честный 0/'—'). */
export function deckMachineFromRaw(raw: Record<string, unknown>): MachineRecord {
  const labels = (raw.labels && typeof raw.labels === 'object' ? raw.labels : {}) as Record<string, unknown>;
  return {
    name: String(raw.name ?? ''),
    host: raw.host != null ? String(raw.host) : raw.target != null ? String(raw.target) : '',
    target: raw.target != null ? String(raw.target) : undefined,
    transport: '',
    state: String(raw.state ?? 'unknown'),
    since_ms: 0,
    why: raw.last_error != null ? String(raw.last_error) : null,
    labels: Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, String(v)])),
  };
}

/** Р РµР·СѓР»СЊС‚Р°С‚ РѕС†РµРЅРєРё Р°РіРµРЅС‚Р° (core /api/core/ratings, #373). */
export interface RatingEntry { task: string; score: number; ts: number; note?: string }
export interface AgentRatings { score: number; updated_ts: number; history: RatingEntry[] }
export interface RatingsClient {
  fetchAll(): Promise<Record<string, AgentRatings>>;
}

/** РЎРѕР±С‹С‚РёРµ СЃСѓРїРµСЂРІРёР·РѕСЂР° (RFC-001 В§18): seq РјРѕРЅРѕС‚РѕРЅРЅС‹Р№, ts вЂ” unix-СЃРµРєСѓРЅРґС‹. */
export interface LiveEvent {
  seq: number;
  type: string;
  ts?: number;
  /** UI-WAVE flat events: method/terminal/data из params (плоский payload). */
  method?: string;
  terminal?: string;
  data?: unknown;
  [key: string]: unknown;
}

export class BridgeUnavailable extends Error {
  constructor(message: string) { super(message); this.name = 'BridgeUnavailable'; }
}

/** Р¤Р°С‚Р°Р»СЊРЅР°СЏ РєР»Р°СЃСЃРёС„РёРєР°С†РёСЏ HTTP-РѕС‚РєР°Р·Р° С€РІР° (QODER #476 В§1.3). */
export type BridgeFailureKind =
  | 'unavailable'   // СЃРµС‚СЊ/timeout/5xx/404-С‚РµРєСЃС‚ (СЂРѕСѓС‚ РЅРµ Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅ)
  | 'not_found'     // 404 + JSON {error}
  | 'denied'        // 401/403
  | 'disabled'      // 503 (С‚РѕРєРµРЅ РЅРµ РЅР°СЃС‚СЂРѕРµРЅ, approvals cap, remote)
  | 'unsupported'   // 501
  | 'conflict';     // 409

/**
 * РћС‚РєР°Р· HTTP-С€РІР° СЃРѕ СЃС‚Р°С‚СѓСЃРѕРј Рё СЂР°Р·РѕР±СЂР°РЅРЅС‹Рј С‚РµР»РѕРј. РќР°СЃР»РµРґСѓРµС‚ BridgeUnavailable:
 * СЃСѓС‰РµСЃС‚РІСѓСЋС‰РёРµ РїРѕС‚СЂРµР±РёС‚РµР»Рё (instanceof) РїСЂРѕРґРѕР»Р¶Р°СЋС‚ СЂР°Р±РѕС‚Р°С‚СЊ; СЃРѕРѕР±С‰РµРЅРёРµ
 * СЃРѕС…СЂР°РЅСЏРµС‚ С„РѕСЂРјР°С‚ `bridge <status>: <bodyвЂ¦>` (РїР°СЂСЃРёС‚ makeRatingsClient).
 */
export class BridgeHttpError extends BridgeUnavailable {
  readonly status: number;
  readonly kind: BridgeFailureKind;
  readonly body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'BridgeHttpError';
    this.status = status;
    this.body = body;
    this.kind = classify(status, body);
  }
}

function classify(status: number, body: unknown): BridgeFailureKind {
  if (status === 404) {
    // РЅРµР·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅРЅС‹Р№ СЂРѕСѓС‚ в†’ plain-text "Not Found"; СЂРµСЃСѓСЂСЃ в†’ JSON {error}
    if (typeof body === 'string') return 'unavailable';
    return 'not_found';
  }
  if (status === 401 || status === 403) return 'denied';
  if (status === 503) return 'disabled';
  if (status === 501) return 'unsupported';
  if (status === 409) return 'conflict';
  return 'unavailable';
}

/* ---------- files (QODER #475 В§2.1, #476 В§1.2) ---------- */

/** РЎРѕСЃС‚РѕСЏРЅРёРµ РѕС‚РІРµС‚Р° С„Р°Р№Р»РѕРІРѕРіРѕ seam'Р°. РќР• СЃРјРµС€РёРІР°С‚СЊ СЃ HTTP-СЃС‚Р°С‚СѓСЃРѕРј. */
export type FileScopeState =
  | 'ok'            // 200, РµСЃС‚СЊ Р·Р°РїРёСЃРё
  | 'empty'         // 200, Р·Р°РїРёСЃРµР№ РЅРµС‚ (Р»РµРіРёС‚РёРјРЅР°СЏ РїСѓСЃС‚Р°СЏ РїР°РїРєР°)
  | 'not_found'     // 404 + JSON {error}: РїСѓС‚СЊ/С„Р°Р№Р» РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚
  | 'out_of_scope'  // 403: Р·Р° РїСЂРµРґРµР»Р°РјРё sandbox-РєРѕСЂРЅСЏ РґРµРјРѕРЅР°
  | 'unsupported'   // 501: remote-РјР°С€РёРЅР° РІ N3 РЅРµ С‡РёС‚Р°РµС‚СЃСЏ
  | 'unavailable';  // СЂРѕСѓС‚ РЅРµ Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅ / СЃРµС‚СЊ / 503

export interface FileEntry {
  path: string;           // РєР°Рє РІРµСЂРЅСѓР» СЃРµСЂРІРµСЂ (СЃРј. РїСЂРёРјРµС‡Р°РЅРёРµ РїСЂРѕ СЃРµРїР°СЂР°С‚РѕСЂС‹)
  kind: 'dir' | 'file' | 'other';
  size?: number;
  mtime?: number;         // unix-СЃРµРєСѓРЅРґС‹
}

export interface FileListResult {
  state: FileScopeState;
  cwd: string;
  entries: FileEntry[];
  truncated: boolean;
  /** РўРѕР»СЊРєРѕ РїСЂРё state !== 'ok'/'empty' вЂ” С‚РµРєСЃС‚ СЃРµСЂРІРµСЂР°, Р±РµР· РґРѕРґСѓРјС‹РІР°РЅРёСЏ. */
  detail?: string;
}

export interface FileReadResult {
  state: FileScopeState;
  path?: string;
  content?: string;
  lines?: number;
  total_lines?: number;
  offset: number;
  limit: number | null;
  detail?: string;
}

export interface FileCapabilities {
  list(path?: string, opts?: { depth?: number; limit?: number; machine?: string }):
    Promise<FileListResult>;
  read(path: string, opts?: { offset?: number; limit?: number; machine?: string }):
    Promise<FileReadResult>;
}

/* ---------- changes (QODER #475 В§2.3, #476 В§1.2) ---------- */

export type ChangesState =
  | 'clean' | 'dirty' | 'not_a_repository'
  | 'git_unavailable' | 'out_of_scope' | 'unsupported' | 'unavailable';

export interface ChangeEntry {
  path: string;
  /** РЎС‹СЂРѕР№ porcelain XY Р±РµР· РёРЅС‚РµСЂРїСЂРµС‚Р°С†РёРё: 'M ', 'AM', '??', 'R ' Рё С‚.Рґ. */
  xy: string;
  index: string;      // X РѕРґРЅРёРј СЃРёРјРІРѕР»РѕРј
  worktree: string;   // Y РѕРґРЅРёРј СЃРёРјРІРѕР»РѕРј
  note?: string;      // С„РёРєСЃРёСЂРѕРІР°РЅРЅР°СЏ С‚Р°Р±Р»РёС†Р° РёР· #475 В§2, null РµСЃР»Рё РЅРµ РѕРїРёСЃР°РЅ
}

export interface ChangesResult {
  state: ChangesState;
  cwd: string;
  branch?: string;
  entries: ChangeEntry[];
  truncated: boolean;
  detail?: string;
}

export interface ChangesCapabilities {
  list(cwd?: string, limit?: number): Promise<ChangesResult>;
}

/* ---------- machines (QODER #475 В§2.4, #476 В§1.2) ---------- */

/** РЎС…РµРјР° РІР°Р»РёРґР°С†РёРё, Р·РµСЂРєР°Р»РёС‚ machine_registry.py:45/:48-50. */
export interface MachineSchema {
  name_pattern: string;     // '^[a-z0-9_-]{1,32}$'
  host_pattern: string;     // '^(?:[A-Za-z0-9]|\\[)[A-Za-z0-9._@:\\[\\]_-]{0,253}$'
  transports: string[];     // ['local', 'ssh']
  host_default_to_name: boolean;  // СЃРµРіРѕРґРЅСЏ true: api.py:471 `host or name`
  source: 'server' | 'embedded';
}

export const EMBEDDED_SCHEMA: MachineSchema = {
  name_pattern: '^[a-z0-9_-]{1,32}$',
  host_pattern: '^(?:[A-Za-z0-9]|\\[)[A-Za-z0-9._@:\\[\\]_-]{0,253}$',
  transports: ['local', 'ssh'],
  host_default_to_name: true,
  source: 'embedded',
};

export interface MachineRecord {
  name: string; host: string; transport: string; state: string;
  since_ms: number; why?: string | null;
  /** UI-FIX (QODER): deck-мост /api/deck/machines отдаёт host как `target`. */
  target?: string;
  /** machine_registry.py:76/:86 вЂ” РїРѕР»СЏ РµСЃС‚СЊ РІ СЂРµРµСЃС‚СЂРµ Рё РІ to_dict.
   *  NOTE #475: СЃРїРёСЃРѕРє /api/core/machines РќР• РѕС‚РґР°С‘С‚ labels (Р±Р»РѕРєРµСЂ). */
  labels: Record<string, string>;
}

export interface MachineCapabilities {
  schema(): Promise<MachineSchema>;
  list(): Promise<MachineRecord[]>;
  get(name: string): Promise<{ found: false } | { found: true; machine: MachineRecord }>;
}

/** #564: launcher-реестр программ (GET /api/core/programs, #551b). */
export interface ProgramEntry {
  id: string;
  title: string;
  cmd: string | string[];
  cwd?: string | null;
  available: boolean;
  resolved?: string | null;
}

/** W9: детальная карточка машины (GET /api/core/machines?detail=1). */
export interface MachineDetail {
  name: string;
  host?: string;
  transport?: string;
  state?: string;
  since_ms?: number;
  why?: string | null;
  labels?: Record<string, string>;
  uptime_s?: number;
  terminals?: number;
  metrics?: { cpu?: number; mem?: number; uptime_s?: number };
}

/** W14: запись worktree (GET /api/core/worktrees). */
export interface WorktreeEntry {
  main: boolean;
  name: string;
  path: string;
  branch?: string | null;
  head?: string;
  detached?: boolean;
  bare?: boolean;
  locked?: boolean;
  prunable?: boolean;
  /** SPARK W5: пока нет в API — бейдж появляется, когда появится поле. */
  status?: 'clean' | 'dirty' | 'failed' | string;
}

/** W15: audit-лента (GET /api/core/audit). */
export interface AuditEntry {
  seq?: number;
  ts?: number;
  action?: string;
  decision?: string;
  outcome?: string;
  agent?: string;
  term?: string;
  body?: unknown;
  /** W54: subject/detail из gate-entry (action.subject/detail). */
  subject?: string;
  detail?: string;
  hash?: string;
}
export interface AuditResult {
  entries: AuditEntry[];
  total: number;
}
/** W54: результат verify цепи (GET /api/core/audit/verify). */
export interface AuditVerifyResult {
  ok: boolean;
  verified?: boolean;
  detail?: string | null;
  brokenAt?: number | null;
}

/** W16: мета-данные записи .cast (GET /api/core/recordings). */
export interface RecordingMeta {
  id: string;
  term: string;
  path: string;
}

/** W17: шаблон workspace (workspace-templates.json). */
export interface WorkspaceTemplate {
  name: string;
  terms: { name: string; command?: string[]; cwd?: string; labels?: Record<string, string> }[];
}

/** W20: approval-запрос (GET /api/core/approvals). */
export interface ApprovalEntry {
  approval_id: string;
  status: string;
  subject?: string;
  action?: string;
  reason?: string;
  ts?: number;
  /** W36: dual-control метаданные (mutations: required_approvals/decided_by). */
  dualControl?: boolean;
  requiredApprovals?: number;
  decidedBy?: string[];
  expiresAt?: number;
}

export interface NewfBridge {
  spaces(): Promise<LiveSpace[]>;
  terminals(): Promise<LiveTerminal[]>;
  agents(): Promise<LiveAgent[]>;
  screen(term: string): Promise<string>;
  send(term: string, text: string): Promise<void>;
  keys(term: string, keys: string[]): Promise<void>;
  /** W41: отправить строку с Enter (POST /api/core/send {term, text, enter:true}). */
  sendLine?(term: string, text: string): Promise<void>;
  /** W41: отправить сырой текст БЕЗ Enter (посимвольно/raw; enter:false). */
  sendRaw?(term: string, text: string): Promise<void>;
  /** W41: SSE-поток экрана терминала (GET /api/core/terminal/{term}/stream). */
  screenStream?(term: string, onScreen: (screen: string, seq: number) => void, onError?: (error: string) => void): () => void;
  /** W47: убить терминал (POST /api/core/kill {term}). */
  kill?(term: string): Promise<void>;
  /** W55: персистентное переименование (POST /api/core/terminal/{term}/rename {new_name}). */
  renameTerminal?(term: string, newName: string): Promise<{ address: string }>;
  /** W55: labels терминала (GET/POST /api/core/terminal/{term}/labels). */
  terminalLabels?(term: string, labels?: Record<string, string>): Promise<Record<string, string>>;
  /** Core-only capability. The bus bridge does not expose terminal spawning. */
  run?(args: { name?: string; command: string[]; parent?: string; labels?: Record<string, string> }): Promise<{ address: string }>;
  /**
   * Core-only capability (#552/#557): вставка текста БЕЗ Enter (POST /api/core/put
   * {term, text}) — для paste и многострочных вставок в живой ввод.
   */
  put?(term: string, text: string): Promise<void>;
  /** #564: launcher-реестр (GET /api/core/programs). 404/офлайн → [] честно. */
  programs?(): Promise<ProgramEntry[]>;
  /** #564: spawn из реестра (POST /api/core/run-program {program, name?, cwd?}). */
  runProgram?(program: string, opts?: { name?: string; cwd?: string }): Promise<{ address: string }>;
  /** #564: URL transcript dump (GET /api/core/terminal/<name>/dump). */
  dumpUrl?(term: string): string;
  /** W3: spawn child терминала (POST /api/core/terminal/<name>/spawn-child). */
  spawnChild?(parent: string, opts?: { command?: string[]; name?: string; cwd?: string }): Promise<{ address: string }>;
  /** W3: restart терминала (POST /api/core/terminal/<term>/restart). */
  restart?(term: string): Promise<{ ok: boolean }>;
  /** W5: capabilities-реестр (GET /api/core/capabilities). 404/офлайн → {} честно. */
  capabilities?(): Promise<{ version?: string; endpoints: Record<string, boolean> }>;
  /** W9: детальные машины (GET /api/core/machines?detail=1). 404 → [] честно. */
  machinesDetail?(): Promise<MachineDetail[]>;
  /** W10: send-file (POST /api/core/terminal/<name>/send-file {path|content, name?, send?}). */
  sendFile?(name: string, body: { path?: string; content?: string; name?: string; send?: boolean }): Promise<{ ok: boolean }>;
  /** W11: labels терминала (POST /api/core/terminal/<term>/labels {labels}). */
  setLabels?(term: string, labels: Record<string, string>): Promise<{ ok: boolean }>;
  /** W13: clone терминала (POST /api/core/terminal/<name>/clone {name?}). */
  cloneTerminal?(name: string, opts?: { name?: string }): Promise<{ address: string }>;
  /** W14: worktrees (GET /api/core/worktrees?repo=). 404 → [] честно. */
  worktrees?(repo?: string): Promise<WorktreeEntry[]>;
  /** W15: audit-лента (GET /api/core/audit?action=&limit=). 404 → пусто честно. */
  audit?(opts?: { action?: string; limit?: number }): Promise<AuditResult>;
  /** W54: проверка цепи audit (GET /api/core/audit/verify). */
  auditVerify?(): Promise<AuditVerifyResult>;
  /** W16: записи сессий (GET /api/core/recordings). 404 → [] честно. */
  recordings?(): Promise<RecordingMeta[]>;
  /** W17: шаблоны workspace (GET /api/core/workspace/templates). 404 → [] честно. */
  workspaceTemplates?(): Promise<WorkspaceTemplate[]>;
  /** W17: спавн workspace-шаблона (POST /api/core/workspace/spawn {name}). */
  workspaceSpawn?(name: string): Promise<{ created: string[]; terminals: string[] }>;
  /** W18: batch-операции (POST /api/core/batch {action, terms}). */
  batch?(opts: { action: 'kill' | 'respawn'; terms: string[] }): Promise<{ results: Record<string, { ok: boolean; error?: string }> }>;
  /** W19: snapshot терминала (POST /api/core/terminal/<name>/snapshot). */
  snapshot?(name: string): Promise<{ path: string }>;
  /** W19: restore snapshot (POST /api/core/terminal/<name>/restore-snapshot {file}). */
  restoreSnapshot?(name: string, file: string): Promise<{ ok: boolean }>;
  /** W20: approval-список (GET /api/core/approvals). 404 → [] честно. */
  approvals?(): Promise<ApprovalEntry[]>;
  /** W20/W36/W56: approve/deny (identity — header X-AEGIS-Key; 202 → pending-голос). */
  approvalDecide?(id: string, approved: boolean, adminToken?: string): Promise<{
    ok: boolean;
    pending?: boolean;
    decidedBy?: string[];
    requiredApprovals?: number;
  }>;
  /** W29: заметка терминала (POST /api/core/terminal/<term>/note {text}). */
  setNote?(term: string, text: string): Promise<{ ok: boolean }>;
  /** W30: archive терминала (POST /api/core/terminal/<term>/archive). */
  archive?(term: string): Promise<{ ok: boolean }>;
  /** W31: глубины send-очередей (GET /api/core/send-queues). {address: depth}. */
  sendQueues?(): Promise<Record<string, number>>;
  /** W31: flush send-очереди терминала (DELETE /api/core/send-queue/<term>). */
  flushSendQueue?(term: string): Promise<{ term: string; cleared: number }>;
  /** W32: детали спейсов (GET /api/core/spaces/detail): terms/live/members. */
  spacesDetail?(): Promise<LiveSpaceDetail[]>;
  /** W33: выборочные события после since (GET /api/core/events/since?since=&limit=). */
  eventsSince?(since: number, limit?: number): Promise<{ events: LiveEvent[]; cursor: number; total_seen: number }>;
  /** W34: диагностика ядра (GET /api/core/diag). */
  diag?(): Promise<CoreDiag>;
  /** W35: лёгкая сводка терминалов (GET /api/core/terminals/summary). */
  terminalsSummary?(): Promise<{ count: number; terminals: TermSummary[] }>;
  /** W37: правила алертов (GET /api/core/alert-rules). */
  alertRules?(): Promise<{ rules: AlertRuleEntry[]; count: number }>;
  /** W37: toggle правила (POST /api/core/alert-rules/{idx}/toggle {enabled}). */
  alertToggle?(idx: number, enabled: boolean): Promise<{ idx: number; disabled: boolean }>;
  /** W37: история алертов (GET /api/core/alerts?limit=). */
  alerts?(opts?: { limit?: number }): Promise<{ alerts: AlertHistoryEntry[]; count: number; rules_loaded: number }>;
  /** W38: создать share (POST /api/core/share {term, scopes, ttl_s}). */
  shareCreate?(term: string, opts: { scopes?: string[]; ttlS?: number }): Promise<ShareCreated>;
  /** W38: список активных шаров (GET /api/core/shares). */
  shares?(): Promise<ShareEntry[]>;
  /** W38: отозвать share (DELETE /api/core/share/{token}; полный токен). */
  shareRevoke?(token: string): Promise<{ revoked: boolean }>;
  /** W39: входные вводы терминала (GET /api/core/terminal/{term}/input-log). */
  inputLog?(term: string, limit?: number): Promise<{ term: string; entries: InputLogEntry[]; count: number }>;
  /**
   * Core-only capability (#552/#548): resize терминала (cols×rows).
   * Endpoint `/api/core/terminal/<name>/resize` может ещё не быть зарегистрирован —
   * при 404/501 метод отдаёт честный BridgeHttpError, UI не падает.
   */
  resize?(name: string, cols: number, rows: number): Promise<void>;
  /**
   * Core-only capability: РїРѕРґРїРёСЃРєР° РЅР° SSE-РїРѕС‚РѕРє /events (replay РїРѕ Last-Event-ID
   * РґРµР»Р°РµС‚ СЃР°Рј EventSource РїСЂРё reconnect). Р’РѕР·РІСЂР°С‰Р°РµС‚ С„СѓРЅРєС†РёСЋ РѕС‚РїРёСЃРєРё.
   * onEvent Р·РѕРІС‘С‚СЃСЏ РЅР° РєР°Р¶РґРѕРµ СЃРѕР±С‹С‚РёРµ; onError вЂ” РїСЂРё РѕР±СЂС‹РІРµ РїРѕС‚РѕРєР°.
   */
  streamEvents?(onEvent: (event: LiveEvent) => void, onError?: (error: string) => void, types?: string[]): () => void;
  /** Core-only capability: РѕС†РµРЅРєРё Р°РіРµРЅС‚РѕРІ (#373). РњРѕР¶РµС‚ РѕС‚СЃСѓС‚СЃС‚РІРѕРІР°С‚СЊ (404 в†’ undefined). */
  ratings?: RatingsClient;
  /** Core-only: С„Р°Р№Р»С‹ (list/read, #407). */
  files?: FileCapabilities;
  /** Core-only: git-СЃС‚Р°С‚СѓСЃ СЂР°Р±РѕС‡РµРіРѕ РґРµСЂРµРІР° (#407). */
  changes?: ChangesCapabilities;
  /** Core-only: СЂРµРµСЃС‚СЂ РјР°С€РёРЅ (schema/list/get, #407). */
  machines?: MachineCapabilities;
  /** Core-only: информация о ядре (GET /api/core/server). Используется
   *  панелью статуса ядра на /deck. */
  server?(): Promise<CoreServerInfo>;
  /** Deck-only: сводка фермы (GET /api/deck/status). Используется
   *  DeckScreen (PKG-B1): connected=false → честный offline. */
  deck?(): Promise<DeckStatus>;
}

export const DEFAULT_BASE = '';

/** Edge fallback is read-only. Mutating requests stay on the same-origin host. */
export const EDGE_API_BASE = 'https://backend.example.invalid';

function edgeFallbackUrl(url: string, init?: RequestInit): string | undefined {
  if (typeof window === 'undefined' || (init?.method ?? 'GET').toUpperCase() !== 'GET') return undefined;
  try {
    const request = new URL(url, window.location.href);
    const currentOrigin = window.location.origin;
    const edgeOrigin = new URL(EDGE_API_BASE).origin;
    if (request.origin !== currentOrigin || request.origin === edgeOrigin) return undefined;
    if (!/^\/api\/(?:core|deck)\//.test(request.pathname)) return undefined;
    return `${EDGE_API_BASE}${request.pathname}${request.search}`;
  } catch {
    return undefined;
  }
}

/** Same-origin first; a read-only edge retry is used only when that host fails. */
export async function fetchBridgeApi(url: string, init?: RequestInit): Promise<Response> {
  const fallbackUrl = edgeFallbackUrl(url, init);
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (!fallbackUrl) throw error;
    return fetch(fallbackUrl, init);
  }
  if (response.ok || !fallbackUrl) return response;
  try {
    const fallback = await fetch(fallbackUrl, init);
    return fallback.ok ? fallback : response;
  } catch {
    return response;
  }
}

async function getJson<T>(url: string, opts?: { structured?: boolean }): Promise<T> {
  let res: Response;
  try {
    res = await fetchBridgeApi(url, { cache: 'no-store' });
  } catch (error) {
    throw new BridgeUnavailable(`bridge unreachable: ${error instanceof Error ? error.message : 'network'}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (opts?.structured) {
      let parsed: unknown = body;
      try { parsed = JSON.parse(body); } catch { /* С‚РµРєСЃС‚ СЂРѕСѓС‚Р° */ }
      throw new BridgeHttpError(res.status, `bridge ${res.status}: ${body.slice(0, 160)}`, parsed);
    }
    throw new BridgeUnavailable(`bridge ${res.status}: ${body.slice(0, 160)}`);
  }
  return (await res.json()) as T;
}

async function postJson<T = never>(url: string, body: unknown, expectJson = false, structured = false): Promise<T | void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new BridgeUnavailable(`bridge unreachable: ${error instanceof Error ? error.message : 'network'}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (structured) {
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* текст роута */ }
      throw new BridgeHttpError(res.status, `bridge ${res.status}: ${text.slice(0, 160)}`, parsed);
    }
    throw new BridgeUnavailable(`bridge ${res.status}: ${text.slice(0, 160)}`);
  }
  if (!expectJson) return;
  try {
    return await res.json() as T;
  } catch {
    throw new BridgeUnavailable('bridge returned invalid JSON');
  }
}

async function deleteJson<T = never>(url: string, expectJson = false, structured = false): Promise<T | void> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'DELETE' });
  } catch (error) {
    throw new BridgeUnavailable(`bridge unreachable: ${error instanceof Error ? error.message : 'network'}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (structured) {
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* текст роута */ }
      throw new BridgeHttpError(res.status, `bridge ${res.status}: ${text.slice(0, 160)}`, parsed);
    }
    throw new BridgeUnavailable(`bridge ${res.status}: ${text.slice(0, 160)}`);
  }
  if (!expectJson) return;
  try {
    return await res.json() as T;
  } catch {
    throw new BridgeUnavailable('bridge returned invalid JSON');
  }
}

/** РќРѕСЂРјР°Р»РёР·Р°С†РёСЏ СЃС‚СЂРѕРєРё (hc ls / core to_dict) в†’ LiveTerminal. */
function normalizeTerminal(raw: Record<string, unknown>): LiveTerminal {
  // supervisor states 'exited'/'lost' РЅРµ РІС…РѕРґСЏС‚ РІ LiveTerminal-union
  // (newf.tsx LIVE_STATES РёС… СЃРѕР·РЅР°С‚РµР»СЊРЅРѕ РѕС‚С„РёР»СЊС‚СЂРѕРІС‹РІР°РµС‚ РёР· СЃРѕР±С‹С‚РёР№) вЂ”
  // СЃРІРѕРґРёРј Рє Р±Р»РёР¶Р°Р№С€РёРј РёР·РІРµСЃС‚РЅС‹Рј: exitedв†’done, lostв†’error. РРЅР°С‡Рµ
  // РјС‘СЂС‚РІС‹Рµ С‚РµСЂРјРёРЅР°Р»С‹ РѕС‚РѕР±СЂР°Р¶Р°Р»РёСЃСЊ Р±С‹ РєР°Рє 'idle' (#536).
  // 'archived' — штатное состояние core (handle_archive): сохраняем как есть.
  // deck-терминалы несут объект status:{state,app}; обычные — строку.
  const rawStatus = raw.status && typeof raw.status === 'object' ? raw.status as Record<string, unknown> : undefined;
  const rawState = String(rawStatus?.state ?? raw.status ?? raw.state ?? 'idle');
  // 'lost' → error; 'exited' сохраняется как есть (UI-WAVE: отдельный статус
  // с собственным визуалом — dim).
  const state = (rawState === 'lost' ? 'error' : rawState) as LiveTerminal['state'];
  const labels = (raw.labels && typeof raw.labels === 'object' ? raw.labels : {}) as Record<string, unknown>;
  // role = РёРґРµРЅС‚РёС„РёРєР°С‚РѕСЂ СѓР·Р»Р° (ROLE-5); agent вЂ” РїСЂРѕС†РµСЃСЃ, РєРѕС‚РѕСЂС‹Рј РѕРЅ
  // РїРѕРґРЅСЏС‚ (devin/pwsh.exe). Р”Р»СЏ Р·РІР°РЅРёР№ СЂРѕСЏ Р±РµСЂС‘Рј СЂРѕР»СЊ.
  const role = raw.role != null ? String(raw.role) : undefined;
  const agent = role ?? raw.agent ?? labels.agent ?? labels.persona ?? undefined;
  return {
    address: String(raw.address ?? raw.term ?? ''),
    label: String(raw.name ?? agent ?? raw.address ?? ''),
    spaceId: (raw.space ?? labels['nx.space']) != null ? String(raw.space ?? labels['nx.space']) : undefined,
    tab: (raw.tab ?? labels['nx.tab']) != null ? String(raw.tab ?? labels['nx.tab']) : undefined,
    state: ['working', 'idle', 'blocked', 'done', 'error', 'archived', 'exited'].includes(state) ? state : 'idle',
    agent: agent != null ? String(agent) : undefined,
    machine: raw.machine != null ? String(raw.machine) : (raw.address != null && String(raw.address).includes('/') ? String(raw.address).split('/')[0] : undefined),
    seat: role ?? seatFromLabels(labels),
    parent: raw.parent != null ? String(raw.parent) : undefined,
    cols: Number.isFinite(raw.cols) ? Number(raw.cols) : undefined,
    rows: Number.isFinite(raw.rows) ? Number(raw.rows) : undefined,
    createdAt: Number.isFinite(raw.created_at) ? Number(raw.created_at) : undefined,
    exitedAt: Number.isFinite(raw.exited_at) ? Number(raw.exited_at) : undefined,
    dieWithParent: raw.die_with_parent === true,
    // deck-терминалы шлют notify=true (заметил/требует внимания) → attention.
    attention: raw.notify === true || raw.attention === true,
    labels: Object.keys(labels).length > 0 ? Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, String(v)])) : undefined,
  };
}

/** СЂРѕР·РґР°С‘С‚ РєР»РёРµРЅС‚ Рє Р±СЌРєРµРЅРґСѓ. prefix: '/api/core' (nexus-core, дефолт) РёР»Рё '/api/deck' (farm-ростер). */
export function createLiveBridge(base: string = DEFAULT_BASE, prefix = '/api/core'): NewfBridge {
  const api = (path: string) => `${base.replace(/\/$/, '')}${prefix}${path}`;
  return {
    async spaces() {
      const data = await getJson<unknown>(api('/spaces'));
      const list = Array.isArray(data) ? data : (data as { spaces?: unknown[] }).spaces ?? [];
      return (list as Record<string, unknown>[]).map((s) => ({
        id: String(s.id ?? s.name ?? ''),
        name: String(s.name ?? s.id ?? ''),
        machine: String(s.machine ?? s.host ?? ''),
      }));
    },
    async terminals() {
      const data = await getJson<unknown>(api('/terminals'));
      const list = Array.isArray(data) ? data : (data as { terminals?: unknown[] }).terminals ?? [];
      return (list as Record<string, unknown>[]).map(normalizeTerminal);
    },
    async agents() {
      const terms = await this.terminals();
      return terms.filter((t) => t.agent).map((t) => ({
        id: t.address,
        name: t.agent!,
        terminal: t.address,
        status: t.state,
        seat: t.seat,
        parent: t.parent,
      }));
    },
    async screen(term) {
      // nexus-core screen-СЂРѕСѓС‚ РѕРґРЅРѕСЃРµРіРјРµРЅС‚РЅС‹Р№ ({term}); Р°РґСЂРµСЃ local/t1
      // РїРµСЂРµРґР°С‘Рј РіРѕР»С‹Рј РёРјРµРЅРµРј вЂ” get_terminal СЂРµР·РѕР»РІРёС‚ РєРѕСЂРѕС‚РєСѓСЋ С„РѕСЂРјСѓ.
      // /api/bus РѕСЃС‚Р°РІР»СЏРµРј РїРѕР»РЅС‹Р№ Р°РґСЂРµСЃ РєР°Рє РµСЃС‚СЊ.
      const name = prefix === '/api/core' ? (term.split('/').pop() ?? term) : term;
      const data = await getJson<LiveScreen>(api(`/screen/${encodeURIComponent(name)}`));
      return data.screen ?? '';
    },
    async send(term, text) {
      await postJson(api('/send'), { term, text });
    },
    async sendLine(term, text) {
      await postJson(`${api('/send')}`, { term, text, enter: true });
    },
    async sendRaw(term, text) {
      await postJson(api('/send'), { term, text, enter: false });
    },
    async keys(term, keys) {
      await postJson(api('/keys'), { term, keys });
    },
    screenStream(term, onScreen, onError) {
      // Per-terminal SSE: event "screen" → {term, seq, screen}; heartbeat ": ping".
      // W57: exited/404/EOF → стоп (не крутим retry вечно).
      const name = prefix === '/api/core' ? (term.split('/').pop() ?? term) : term;
      const url = `${api(`/terminal/${encodeURIComponent(name)}/stream`)}`;
      const controller = new AbortController();
      let closed = false;
      let stopped = false;
      let retry: ReturnType<typeof setTimeout> | undefined;
      const stop = () => { stopped = true; if (retry) clearTimeout(retry); };
      const connect = async () => {
        try {
          const res = await fetchBridgeApi(url, {
            cache: 'no-store',
            signal: controller.signal,
          });
          if (!res.ok) {
            // 404 = терминал ушёл (exited/lost) — retry не нужен
            stop();
            onError?.(`stream ${res.status}`);
            return;
          }
          if (!res.body) throw new Error('stream: empty body');
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          let finished = false;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) { finished = true; break; }
            buf += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf('\n\n')) !== -1) {
              const raw = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              const lines = raw.split('\n');
              const event = lines.find((l) => l.startsWith('event:'))?.slice(6).trim() ?? 'message';
              const dataLine = lines.find((l) => l.startsWith('data:'));
              if (!dataLine) continue;
              const payload = dataLine.slice(5).trim();
              if (event === 'screen') {
                try {
                  const parsed = JSON.parse(payload) as { seq?: number; screen?: string };
                  if (typeof parsed.screen === 'string') onScreen(parsed.screen, parsed.seq ?? 0);
                } catch { /* пропустить битый кадр */ }
              }
            }
          }
          if (!closed && !stopped) {
            // EOF без ошибки — reconnect (keepalive-разрыв)
            retry = setTimeout(connect, 2000);
          }
        } catch {
          if (!closed && !stopped) {
            onError?.('stream error');
            retry = setTimeout(connect, 2000);
          }
        }
      };
      void connect();
      return () => {
        closed = true;
        stop();
        controller.abort();
      };
    },
    async kill(term) {
      await postJson(api('/kill'), { term });
    },
    ratings: makeRatingsClient(base),
  };
}

/** Ratings-РєР»РёРµРЅС‚ (core /api/core/ratings С‡РµСЂРµР· РјРѕСЃС‚ РёР»Рё РЅР°РїСЂСЏРјСѓСЋ). */
function makeRatingsClient(base: string): RatingsClient {
  const coreApi = (path: string) => `${base.replace(/\/$/, '')}${path}`;
  return {
    async fetchAll() {
      try {
        const data = await getJson<unknown>(coreApi('/api/core/ratings'));
        // РљРѕРЅС‚СЂР°РєС‚ #373: РїР»РѕСЃРєР°СЏ РєР°СЂС‚Р° {agent_id:{score,history}}; СЂРµР°Р»СЊРЅС‹Р№
        // core (SPARK #387) РѕР±РѕСЂР°С‡РёРІР°РµС‚ РІ {ratings:{...}} вЂ” РїСЂРёРЅРёРјР°РµРј РѕР±Р°.
        const map = data && typeof data === 'object'
          ? (data as { ratings?: unknown }).ratings ?? data
          : {};
        return (map && typeof map === 'object' ? map : {}) as Record<string, AgentRatings>;
      } catch (error) {
        // #373: API РІ СЂР°Р·СЂР°Р±РѕС‚РєРµ (SPARK #387) вЂ” РѕС‚СЃСѓС‚СЃС‚РІРёРµ СЂРѕСѓС‚Р° РЅРµ СЂРѕРЅСЏРµС‚
        // live-СЌРєСЂР°РЅ; UI РєРѕСЂСЂРµРєС‚РЅРѕ СЃРєСЂС‹РІР°РµС‚ СЂРµР№С‚РёРЅРіРё (RatingsState.error).
        if (error instanceof BridgeUnavailable && /^bridge [45]\d\d/.test(error.message)) {
          return {};
        }
        throw error;
      }
    },
  };
}

/** N4 backend: NewfBridge core routes use the current host with read-only edge fallback. */
/**
 * Создаёт клиент к nexus-core (/api/core/*).
 *
 * Дефолтная база — **same-origin** (пустая строка). GET-запросы к /api/core/*
 * и /api/deck/* могут перейти на публичный read-only edge только при ошибке
 * текущего хоста; мутации остаются на same-origin.
 */
export function createCoreBridge(base?: string): NewfBridge {
  const resolvedBase = base ?? '';
  const bridge = createLiveBridge(resolvedBase, '/api/core');
  const coreApi = (path: string) => `${resolvedBase.replace(/\/$/, '')}${path}`;

  const files: FileCapabilities = {
    async list(path = '.', opts = {}) {
      const params = new URLSearchParams({ path });
      if (opts.depth !== undefined) params.set('depth', String(opts.depth));
      if (opts.limit !== undefined) params.set('limit', String(opts.limit));
      if (opts.machine) params.set('machine', opts.machine);
      try {
        const data = await getJson<unknown>(coreApi(`/api/core/file/list?${params}`), { structured: true });
        const entry = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
        const entries = (Array.isArray(entry.entries) ? entry.entries : []) as Record<string, unknown>[];
        return {
          state: (entry.state as FileScopeState | undefined)
            ?? (entries.length === 0 ? 'empty' as const : 'ok' as const),
          cwd: String(entry.cwd ?? entry.path ?? path),
          entries: entries.map((e) => ({
            path: String(e.path ?? ''),
            kind: e.kind === 'dir' || e.kind === 'file' || e.kind === 'other'
              ? e.kind as FileEntry['kind'] : 'file',
            // SPARK #506 GAP2: backend file_ops.list() РѕС‚РґР°С‘С‚ РїРѕР»Рµ `bytes`
            // (st.st_size РґР»СЏ С„Р°Р№Р»Р°, None РґР»СЏ РєР°С‚Р°Р»РѕРіР°) вЂ” `e.size` Р·РґРµСЃСЊ РІСЃРµРіРґР°
            // Р±С‹Р»Рѕ undefined. Р§РёС‚Р°РµРј `bytes`.
            size: typeof e.bytes === 'number' ? e.bytes : undefined,
            mtime: typeof e.mtime_ms === 'number' ? e.mtime_ms / 1000 : undefined,
          })),
          truncated: Boolean(entry.truncated),
        };
      } catch (error) {
        return errorToFileResult(error);
      }
    },
    async read(path, opts = {}) {
      const params = new URLSearchParams({ path });
      if (opts.offset !== undefined) params.set('offset', String(opts.offset));
      if (opts.limit !== undefined) params.set('limit', String(opts.limit));
      if (opts.machine) params.set('machine', opts.machine);
      try {
        const data = await getJson<unknown>(coreApi(`/api/core/file/read?${params}`), { structured: true });
        const entry = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
        return {
          state: (entry.state as FileScopeState | undefined) ?? 'ok',
          path: entry.path != null ? String(entry.path) : undefined,
          content: entry.content != null ? String(entry.content) : undefined,
          lines: typeof entry.lines === 'number' ? entry.lines : undefined,
          total_lines: typeof entry.total_lines === 'number' ? entry.total_lines : undefined,
          offset: typeof entry.offset === 'number' ? entry.offset : 1,
          limit: typeof entry.limit === 'number' ? entry.limit : null,
          detail: entry.detail != null ? String(entry.detail) : undefined,
        };
      } catch (error) {
        const base = { state: 'unavailable' as const, offset: 1, limit: null as number | null };
        if (error instanceof BridgeHttpError) {
          if (error.kind === 'not_found') return { ...base, state: 'not_found' as const, detail: detailOf(error) };
          if (error.kind === 'denied') return { ...base, state: 'out_of_scope' as const, detail: detailOf(error) };
          if (error.kind === 'unsupported') return { ...base, state: 'unsupported' as const, detail: detailOf(error) };
          if (error.kind === 'disabled') return { ...base, detail: detailOf(error) };
        }
        return { ...base, detail: error instanceof Error ? error.message : undefined };
      }
    },
  };

  const changes: ChangesCapabilities = {
    async list(cwd, limit) {
      const params = new URLSearchParams();
      if (cwd) params.set('cwd', cwd);
      if (limit !== undefined) params.set('limit', String(limit));
      try {
        const data = await getJson<unknown>(coreApi(`/api/core/changes?${params}`), { structured: true });
        const entry = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
        const entries = (Array.isArray(entry.changes) ? entry.changes : []) as Record<string, unknown>[];
        return {
          state: (entry.state as ChangesState | undefined)
            ?? (entries.length === 0 ? 'clean' as const : 'dirty' as const),
          cwd: String(entry.cwd ?? cwd ?? ''),
          branch: entry.branch != null ? String(entry.branch) : undefined,
          entries: entries.map((e) => {
            const xy = String(e.xy ?? e.status ?? '');
            return {
              path: String(e.path ?? ''),
              xy,
              index: xy.slice(0, 1),
              worktree: xy.slice(1, 2),
              note: e.note != null ? String(e.note) : undefined,
            };
          }),
          truncated: Boolean(entry.truncated),
          detail: entry.detail != null ? String(entry.detail) : undefined,
        };
      } catch (error) {
        if (error instanceof BridgeHttpError) {
          return {
            state: error.kind === 'unsupported' ? 'unsupported' as const
              : error.kind === 'not_found' ? 'unavailable' as const
              : error.kind === 'denied' ? 'out_of_scope' as const
              : error.kind === 'disabled' ? 'git_unavailable' as const
              : 'unavailable' as const,
            cwd: cwd ?? '',
            entries: [],
            truncated: false,
            detail: detailOf(error),
          };
        }
        return {
          state: 'unavailable' as const, cwd: cwd ?? '', entries: [], truncated: false,
          detail: error instanceof Error ? error.message : undefined,
        };
      }
    },
  };

  const machines: MachineCapabilities = {
    async schema() {
      try {
        const data = await getJson<unknown>(coreApi('/api/core/machines/schema'), { structured: true });
        const entry = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
        if (typeof entry.name_pattern === 'string' && typeof entry.host_pattern === 'string') {
          const transports = Array.isArray(entry.transports)
            ? (entry.transports as unknown[]).map(String)
            : ['local', 'ssh'];
          return {
            name_pattern: entry.name_pattern,
            host_pattern: entry.host_pattern,
            transports,
            host_default_to_name: Boolean(entry.host_default_to_name),
            source: 'server' as const,
          };
        }
      } catch {
        // СЂРѕСѓС‚ РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚ в†’ embedded fallback СЃ С‡РµСЃС‚РЅРѕР№ РїРѕРјРµС‚РєРѕР№ РёСЃС‚РѕС‡РЅРёРєР°
      }
      return EMBEDDED_SCHEMA;
    },
    async list() {
      const data = await getJson<unknown>(coreApi('/api/core/machines'), { structured: true });
      const entry = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
      const rawMachines = entry.machines;
      if (rawMachines && typeof rawMachines === 'object' && !Array.isArray(rawMachines)) {
        return Object.entries(rawMachines as Record<string, unknown>).map(([name, raw]) => machineFromRaw(name, raw));
      }
      if (Array.isArray(rawMachines)) {
        return (rawMachines as Record<string, unknown>[]).map((raw) => machineFromRaw(String(raw.name ?? ''), raw));
      }
      return [];
    },
    async get(name) {
      try {
        const data = await getJson<unknown>(coreApi(`/api/core/machines/${encodeURIComponent(name)}`), { structured: true });
        const entry = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
        return { found: true as const, machine: machineFromRaw(name, entry) };
      } catch (error) {
        if (error instanceof BridgeHttpError && error.kind === 'not_found') {
          return { found: false as const };
        }
        throw error;
      }
    },
  };

  /**
   * #517: Р°РіРµРЅС‚С‹ С‡РёС‚Р°СЋС‚СЃСЏ СЃ Р¶РёРІРѕРіРѕ /api/core/agents (address/name/state/
   * attention/labels/parent). Р•СЃР»Рё СЂРѕСѓС‚ РЅРµ Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅ РёР»Рё РѕС‚РІРµС‡Р°РµС‚
   * HTTP-РѕС€РёР±РєРѕР№ вЂ” С‡РµСЃС‚РЅС‹Р№ fallback: РїСЂРѕРёР·РІРѕРґРЅС‹Рµ РѕС‚ С‚РѕР»СЊРєРѕ С‡С‚Рѕ РїСЂРѕС‡РёС‚Р°РЅРЅС‹С…
   * /terminals (С‚Рµ Р¶Рµ Р¶РёРІС‹Рµ РґР°РЅРЅС‹Рµ, РЅРµ РјРѕРє).
   */
  const agentsFromTerminals = async (): Promise<LiveAgent[]> => {
    const terms = await bridge.terminals();
    return terms.filter((t) => t.agent).map((t) => ({
      id: t.address,
      name: t.agent!,
      terminal: t.address,
      status: t.state,
      seat: t.seat,
      parent: t.parent,
    }));
  };
  async function agents(): Promise<LiveAgent[]> {
    try {
      const data = await getJson<unknown>(coreApi('/api/core/agents'), { structured: true });
      const list = Array.isArray(data) ? data : (data as { agents?: unknown[] }).agents ?? [];
      return (list as Record<string, unknown>[]).map((raw) => {
        const term = normalizeTerminal({
          address: raw.address,
          name: raw.name,
          status: raw.state,
          labels: raw.labels,
          parent: raw.parent,
        });
        return {
          id: String(raw.address ?? ''),
          name: String(raw.name ?? term.label ?? ''),
          terminal: String(raw.address ?? ''),
          status: term.state,
          seat: term.seat,
          parent: term.parent,
        };
      });
    } catch {
      // Р РѕСѓС‚ /agents РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚ РёР»Рё РѕС‚РґР°Р» HTTP-РѕС€РёР±РєСѓ вЂ” С‡РµСЃС‚РЅС‹Р№ fallback
      // РЅР° РїСЂРѕРёР·РІРѕРґРЅС‹Рµ РѕС‚ Р¶РёРІС‹С… /terminals (С‚Рµ Р¶Рµ РґР°РЅРЅС‹Рµ СЃСѓРїРµСЂРІРёР·РѕСЂР°,
      // РЅРµ РјРѕРє). РЎРµС‚РµРІРѕР№ СЃР±РѕР№ РІРЅСѓС‚СЂРё fallback-РІС‹Р·РѕРІР° РІСЃРїР»С‹РІС‘С‚ РєР°Рє
      // BridgeUnavailable РёР· terminals(), РЅРµ РїСЂРѕРіР»Р°С‚С‹РІР°РµС‚СЃСЏ.
      return agentsFromTerminals();
    }
  }

  return {
    ...bridge,
    agents,
    files,
    changes,
    machines,
    // W55: персистентное переименование (полный адрес machine/name; route .+).
    async renameTerminal(term, newName) {
      const response = await postJson<{ address?: unknown }>(
        `${coreApi('/api/core/terminal')}/${encodeURIComponent(term)}/rename`, { new_name: newName }, true, true);
      const address = response && typeof response === 'object' && typeof response.address === 'string'
        ? response.address
        : term;
      return { address };
    },
    // W55: labels (GET без labels → читаем; POST с labels → пишем).
    async terminalLabels(term, labels) {
      const bare = term.split('/').pop() ?? term;
      if (labels === undefined) {
        const data = await getJson<unknown>(`${coreApi('/api/core/terminal')}/${encodeURIComponent(bare)}/labels`, { structured: true });
        const o = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
        const raw = o.labels && typeof o.labels === 'object' ? o.labels : {};
        return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v)]));
      }
      await postJson(`${coreApi('/api/core/terminal')}/${encodeURIComponent(bare)}/labels`, { labels }, false, true);
      return labels;
    },
    async run(args) {
      const body = args.name ? args : { ...args, name: 'ui-' + (args.parent ?? 'term').replace(/[^a-z0-9_-]+/gi, '-') + '-' + Date.now().toString(36) };
      const response = await postJson<{ address?: unknown }>(coreApi('/api/core/run'), body, true);
      const address = response && typeof response === 'object' && 'address' in response
        ? response.address
        : undefined;
      if (typeof address !== 'string' || address.length === 0) {
        throw new BridgeUnavailable('core run response is missing terminal address');
      }
      return { address };
    },
    // #552/#548: resize терминала (cols×rows). Endpoint может ещё не быть
    // зарегистрирован — честный BridgeHttpError (404/501) вместо падения.
    async resize(name, cols, rows) {
      // Как в screen(): core-роут односегментный — голое имя терминала
      const bare = name.split('/').pop() ?? name;
      await postJson(`${coreApi('/api/core/terminal')}/${encodeURIComponent(bare)}/resize`, { cols, rows }, false, true);
    },
    // #557: paste через put (без Enter — семантика SPARK).
    async put(term, text) {
      await postJson(coreApi('/api/core/put'), { term, text });
    },
    // #564: launcher-реестр.
    async programs() {
      try {
        const data = await getJson<unknown>(coreApi('/api/core/programs'), { structured: true });
        const list = (data && typeof data === 'object' ? data : {}) as { programs?: unknown[] };
        if (!Array.isArray(list.programs)) return [];
        return list.programs.map((p) => {
          const r = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
          return {
            id: String(r.id ?? ''),
            title: String(r.title ?? r.id ?? ''),
            cmd: r.cmd as string | string[],
            cwd: r.cwd != null ? String(r.cwd) : null,
            available: r.available !== false,
            resolved: r.resolved != null ? String(r.resolved) : null,
          };
        });
      } catch {
        // офлайн/404 → честный пустой список (fallback только custom command)
        return [];
      }
    },
    // #564: spawn из реестра.
    async runProgram(program, opts = {}) {
      const body: Record<string, unknown> = { program };
      if (opts.name) body.name = opts.name;
      if (opts.cwd) body.cwd = opts.cwd;
      const response = await postJson<{ address?: unknown }>(coreApi('/api/core/run-program'), body, true, true);
      const address = response && typeof response === 'object' && 'address' in response
        ? response.address
        : undefined;
      if (typeof address !== 'string' || address.length === 0) {
        throw new BridgeUnavailable('core run-program response is missing terminal address');
      }
      return { address };
    },
    dumpUrl(term) {
      const bare = term.split('/').pop() ?? term;
      return `${coreApi('/api/core/terminal')}/${encodeURIComponent(bare)}/dump`;
    },
    // W3: spawn child (parent → новый терминал).
    async spawnChild(parent, opts = {}) {
      const bare = parent.split('/').pop() ?? parent;
      const body: Record<string, unknown> = { command: opts.command ?? ['cmd.exe'] };
      if (opts.name) body.name = opts.name;
      if (opts.cwd) body.cwd = opts.cwd;
      const response = await postJson<{ address?: unknown }>(
        `${coreApi('/api/core/terminal')}/${encodeURIComponent(bare)}/spawn-child`, body, true, true);
      const address = response && typeof response === 'object' && 'address' in response
        ? response.address
        : undefined;
      if (typeof address !== 'string' || address.length === 0) {
        throw new BridgeUnavailable('core spawn-child response is missing terminal address');
      }
      return { address };
    },
    // W3: restart терминала.
    async restart(term) {
      const bare = term.split('/').pop() ?? term;
      await postJson(`${coreApi('/api/core/terminal')}/${encodeURIComponent(bare)}/restart`, { term: bare }, false, true);
      return { ok: true };
    },
    // W5: capabilities-реестр.
    async capabilities() {
      try {
        const data = await getJson<unknown>(coreApi('/api/core/capabilities'), { structured: true });
        const endpoints = (data && typeof data === 'object' ? data : {}) as { endpoints?: unknown };
        const raw = endpoints.endpoints && typeof endpoints.endpoints === 'object' ? endpoints.endpoints : {};
        const out: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(raw)) out[k] = v !== false;
        return { endpoints: out };
      } catch {
        return { endpoints: {} };
      }
    },
    // W10: send-file (file-drop → терминал).
    async sendFile(name, body) {
      const bare = name.split('/').pop() ?? name;
      await postJson(`${coreApi('/api/core/terminal')}/${encodeURIComponent(bare)}/send-file`, body, false, true);
      return { ok: true };
    },
    // W11/W55: labels терминала (полный адрес machine/name — route .+).
    async setLabels(term, labels) {
      await postJson(`${coreApi('/api/core/terminal')}/${encodeURIComponent(term)}/labels`, { labels }, false, true);
      return { ok: true };
    },
    // W13/W55: clone терминала (полный адрес machine/name).
    async cloneTerminal(name, opts = {}) {
      const body = opts.name ? { name: opts.name } : {};
      const response = await postJson<{ address?: unknown }>(
        `${coreApi('/api/core/terminal')}/${encodeURIComponent(name)}/clone`, body, true, true);
      const address = response && typeof response === 'object' && 'address' in response
        ? response.address
        : undefined;
      if (typeof address !== 'string' || address.length === 0) {
        throw new BridgeUnavailable('core clone response is missing terminal address');
      }
      return { address };
    },
    // W14: worktrees (список).
    async worktrees(repo = 'D:/<repo>') {
      try {
        const data = await getJson<unknown>(`${coreApi('/api/core/worktrees')}?repo=${encodeURIComponent(repo)}`, { structured: true });
        const list = (data && typeof data === 'object' ? data : {}) as { worktrees?: unknown[] };
        if (!Array.isArray(list.worktrees)) return [];
        return list.worktrees.map((w) => {
          const r = (w && typeof w === 'object' ? w : {}) as Record<string, unknown>;
          return {
            main: r.main === true,
            name: String(r.name ?? ''),
            path: String(r.path ?? ''),
            branch: r.branch != null ? String(r.branch) : null,
            head: r.head != null ? String(r.head) : undefined,
            detached: r.detached === true,
            bare: r.bare === true,
            locked: r.locked === true,
            prunable: r.prunable === true,
            status: r.status != null ? String(r.status) : undefined,
          };
        });
      } catch {
        return [];
      }
    },
    // W15: audit-лента.
    async audit(opts = {}) {
      const params = new URLSearchParams();
      if (opts.action) params.set('action', opts.action);
      if (opts.limit !== undefined) params.set('limit', String(opts.limit));
      const qs = params.toString();
      const data = await getJson<unknown>(`${coreApi('/api/core/audit')}${qs ? `?${qs}` : ''}`, { structured: true });
      const r = (data && typeof data === 'object' ? data : {}) as { entries?: unknown[]; total?: unknown };
      const entries = (Array.isArray(r.entries) ? r.entries : []).map((e) => {
        const x = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;
        return {
          seq: typeof x.seq === 'number' ? x.seq : undefined,
          ts: typeof x.ts === 'number' ? x.ts : undefined,
          action: x.action != null ? String(x.action) : undefined,
          decision: x.decision != null ? String(x.decision) : undefined,
          outcome: x.outcome != null ? String(x.outcome) : undefined,
          agent: x.agent != null ? String(x.agent) : undefined,
          term: x.term != null ? String(x.term) : undefined,
          body: x.body,
          subject: x.subject != null ? String(x.subject) : undefined,
          detail: x.detail != null ? String(x.detail) : undefined,
          hash: x.hash != null ? String(x.hash) : undefined,
        };
      });
      return { entries, total: typeof r.total === 'number' ? r.total : entries.length };
    },
    // W54: проверка цепи audit.
    async auditVerify() {
      const data = await getJson<unknown>(coreApi('/api/core/audit/verify'), { structured: true });
      const o = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
      return {
        ok: o.ok === true,
        verified: typeof o.verified === 'boolean' ? o.verified : undefined,
        detail: o.detail != null ? String(o.detail) : null,
        brokenAt: typeof o.broken_at === 'number' ? o.broken_at : null,
      };
    },
    // W16: записи .cast.
    async recordings() {
      try {
        const data = await getJson<unknown>(coreApi('/api/core/recordings'), { structured: true });
        const list = (data && typeof data === 'object' ? data : {}) as { recordings?: unknown[] };
        if (!Array.isArray(list.recordings)) return [];
        return list.recordings.map((r) => {
          const x = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
          return { id: String(x.id ?? ''), term: String(x.term ?? ''), path: String(x.path ?? '') };
        });
      } catch {
        return [];
      }
    },
    // W17: шаблоны workspace.
    async workspaceTemplates() {
      try {
        const data = await getJson<unknown>(coreApi('/api/core/workspace/templates'), { structured: true });
        const list = (data && typeof data === 'object' ? data : {}) as { templates?: unknown[] };
        if (!Array.isArray(list.templates)) return [];
        return list.templates.map((t) => {
          const r = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>;
          const terms = (Array.isArray(r.terms) ? r.terms : []).map((s) => {
            const x = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
            return {
              name: String(x.name ?? ''),
              command: Array.isArray(x.command) ? (x.command as unknown[]).map(String) : ['cmd.exe'],
              cwd: x.cwd != null ? String(x.cwd) : undefined,
              labels: x.labels && typeof x.labels === 'object' ? x.labels as Record<string, string> : undefined,
            };
          });
          return { name: String(r.name ?? ''), terms };
        });
      } catch {
        return [];
      }
    },
    // W17: спавн workspace-шаблона.
    async workspaceSpawn(name) {
      const response = await postJson<{ created?: unknown; terminals?: unknown }>(
        coreApi('/api/core/workspace/spawn'), { name }, true, true);
      const created = (Array.isArray(response?.created) ? response.created : []) as unknown[];
      const terminals = (Array.isArray(response?.terminals) ? response.terminals : []) as unknown[];
      return { created: created.map(String), terminals: terminals.map(String) };
    },
    // W18: batch-операции.
    async batch({ action, terms }) {
      const response = await postJson<{ results?: unknown }>(
        coreApi('/api/core/batch'), { action, terms }, true, true);
      const results = (response?.results && typeof response.results === 'object'
        ? response.results
        : {}) as Record<string, { ok: boolean; error?: string }>;
      return { results };
    },
    // W19: snapshot терминала.
    async snapshot(name) {
      const bare = name.split('/').pop() ?? name;
      const response = await postJson<{ path?: unknown }>(
        `${coreApi('/api/core/terminal')}/${encodeURIComponent(bare)}/snapshot`, {}, true, true);
      const path = response?.path;
      if (typeof path !== 'string' || path.length === 0) {
        throw new BridgeUnavailable('core snapshot response is missing path');
      }
      return { path };
    },
    // W19: restore snapshot.
    async restoreSnapshot(name, file) {
      const bare = name.split('/').pop() ?? name;
      await postJson(`${coreApi('/api/core/terminal')}/${encodeURIComponent(bare)}/restore-snapshot`, { file }, false, true);
      return { ok: true };
    },
    // W20: approval-список (gate approvals + mutation-записи с dual-control).
    async approvals() {
      try {
        const data = await getJson<unknown>(coreApi('/api/core/approvals'), { structured: true });
        const raw = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
        const gateList = (Array.isArray(data) ? data : (raw.approvals ?? [])) as Record<string, unknown>[];
        const mutationList = (!Array.isArray(data) && Array.isArray(raw.mutations) ? raw.mutations : []) as Record<string, unknown>[];
        const gate = gateList.map((r) => ({
          approval_id: String(r.approval_id ?? r.id ?? ''),
          status: String(r.status ?? 'pending'),
          subject: r.subject != null ? String(r.subject) : undefined,
          action: r.action != null ? String(r.action) : undefined,
          reason: r.reason != null ? String(r.reason) : undefined,
          ts: typeof r.ts === 'number' ? r.ts : undefined,
        }));
        const mutations = mutationList.map((r) => ({
          approval_id: String(r.approval_id ?? r.id ?? ''),
          status: String(r.status ?? 'pending'),
          subject: r.subject != null ? String(r.subject) : undefined,
          action: r.action != null ? String(r.action) : undefined,
          dualControl: r.dual_control === true,
          requiredApprovals: typeof r.required_approvals === 'number' ? r.required_approvals : 1,
          decidedBy: Array.isArray(r.decided_by) ? (r.decided_by as unknown[]).map(String) : [],
          expiresAt: typeof r.expires_at === 'number' ? r.expires_at : undefined,
        }));
        return [...gate, ...mutations];
      } catch {
        return [];
      }
    },
    // W20/W36: approve/deny (identity — header X-AEGIS-Key; без токена бэк вернёт 401/503).
    async approvalDecide(id, approved, adminToken) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (adminToken) headers['X-AEGIS-Key'] = adminToken;
      let res: Response;
      try {
        res = await fetch(`${coreApi('/api/core/approvals')}/${encodeURIComponent(id)}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ approved }),
        });
      } catch (error) {
        throw new BridgeUnavailable(`bridge unreachable: ${error instanceof Error ? error.message : 'network'}`);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let parsed: unknown = text;
        try { parsed = JSON.parse(text); } catch { /* текст роута */ }
        throw new BridgeHttpError(res.status, `bridge ${res.status}: ${text.slice(0, 160)}`, parsed);
      }
      // W56: 202 = голос принят, approval ещё pending (vote 1/2) — НЕ completed.
      if (res.status === 202) {
        let body: { status?: string; decided_by?: unknown; required_approvals?: unknown } = {};
        try { body = await res.json() as typeof body; } catch { /* нет тела */ }
        return {
          ok: false,
          pending: body.status === 'pending',
          decidedBy: Array.isArray(body.decided_by) ? (body.decided_by as unknown[]).map(String) : undefined,
          requiredApprovals: typeof body.required_approvals === 'number' ? body.required_approvals : undefined,
        };
      }
      return { ok: true };
    },
    // W29: заметка терминала.
    async setNote(term, text) {
      const bare = term.split('/').pop() ?? term;
      await postJson(`${coreApi('/api/core/terminal')}/${encodeURIComponent(bare)}/note`, { text }, false, true);
      return { ok: true };
    },
    // W30: archive терминала.
    async archive(term) {
      const bare = term.split('/').pop() ?? term;
      await postJson(`${coreApi('/api/core/terminal')}/${encodeURIComponent(bare)}/archive`, {}, false, true);
      return { ok: true };
    },
    // W31: глубины send-очередей (GET /api/core/send-queues).
    async sendQueues() {
      const data = await getJson<unknown>(coreApi('/api/core/send-queues'), { structured: true });
      const queues = (data && typeof data === 'object' ? (data as { queues?: unknown }).queues : {}) as Record<string, unknown>;
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(queues ?? {})) {
        if (typeof v === 'number') out[k] = v;
      }
      return out;
    },
    // W32: детали спейсов (GET /api/core/spaces/detail).
    async spacesDetail() {
      const data = await getJson<unknown>(coreApi('/api/core/spaces/detail'), { structured: true });
      const list = Array.isArray(data) ? data : (data as { spaces?: unknown[] }).spaces ?? [];
      return (list as Record<string, unknown>[]).map((s) => ({
        id: String(s.id ?? s.name ?? ''),
        terms: typeof s.terms === 'number' ? s.terms : 0,
        live: typeof s.live === 'number' ? s.live : 0,
        labels: Array.isArray(s.labels) ? (s.labels as unknown[]).map(String) : [],
        members: Array.isArray(s.members) ? (s.members as unknown[]).map(String) : [],
      }));
    },
    // W33: события после since (GET /api/core/events/since).
    async eventsSince(since, limit = 200) {
      const params = new URLSearchParams({ since: String(since), limit: String(limit) });
      const data = await getJson<unknown>(`${coreApi('/api/core/events/since')}?${params}`, { structured: true });
      const events = (Array.isArray(data) ? data : (data as { events?: unknown[] }).events ?? []) as Record<string, unknown>[];
      const cursor = (data && typeof data === 'object' && typeof (data as { cursor?: unknown }).cursor === 'number')
        ? (data as { cursor: number }).cursor
        : since;
      const totalSeen = (data && typeof data === 'object' && typeof (data as { total_seen?: unknown }).total_seen === 'number')
        ? (data as { total_seen: number }).total_seen
        : 0;
      return { events: events as LiveEvent[], cursor, total_seen: totalSeen };
    },
    // W34: диагностика ядра (GET /api/core/diag).
    async diag() {
      const data = await getJson<unknown>(coreApi('/api/core/diag'), { structured: true });
      const o = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
      const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
      const health = (o.health && typeof o.health === 'object' ? o.health : {}) as Record<string, unknown>;
      const stats = (o.stats && typeof o.stats === 'object' ? o.stats : {}) as Record<string, unknown>;
      const terminals = (o.terminals && typeof o.terminals === 'object' ? o.terminals : {}) as Record<string, unknown>;
      const states = (terminals.states && typeof terminals.states === 'object' ? terminals.states : {}) as Record<string, unknown>;
      const alerts = (o.alerts && typeof o.alerts === 'object' ? o.alerts : {}) as Record<string, unknown>;
      const config = (o.config && typeof o.config === 'object' ? o.config : {}) as Record<string, unknown>;
      return {
        ts: num(o.ts),
        version: typeof o.version === 'string' ? o.version : '',
        uptime_s: num(o.uptime_s),
        health: {
          pump_alive: health.pump_alive === true,
          drain_alive: health.drain_alive === true,
        },
        stats: {
          sent: num(stats.sent),
          failed: num(stats.failed),
          dead: num(stats.dead),
          pending: num(stats.pending),
        },
        terminals: {
          live: num(terminals.live),
          total: num(terminals.total),
          exited: num(terminals.exited),
          states: Object.fromEntries(Object.entries(states).map(([k, v]) => [k, num(v)])),
        },
        spaces: num(o.spaces),
        alerts: { rules: num(alerts.rules), history_count: num(alerts.history_count) },
        config: {
          pump_interval_s: config.pump_interval_s != null && typeof config.pump_interval_s === 'number' ? config.pump_interval_s : null,
          rate_limit: config.rate_limit != null && typeof config.rate_limit === 'number' ? config.rate_limit : null,
          scrollback_maxlen: num(config.scrollback_maxlen),
        },
        events_total: num(o.events_total),
      };
    },
    // W35: лёгкая сводка терминалов (GET /api/core/terminals/summary).
    async terminalsSummary() {
      const data = await getJson<unknown>(`${coreApi('/api/core/terminals/summary')}?limit=500`, { structured: true });
      const list = (Array.isArray(data) ? data : (data as { terminals?: unknown[] }).terminals ?? []) as Record<string, unknown>[];
      const terms = list.map((t) => ({
        name: typeof t.name === 'string' ? t.name : '',
        space: typeof t.space === 'string' ? t.space : '',
        state: typeof t.state === 'string' ? t.state : 'idle',
        lastLine: typeof t.last_line === 'string' ? t.last_line : '',
        lastActivityTs: typeof t.last_activity_ts === 'number' && Number.isFinite(t.last_activity_ts) ? t.last_activity_ts : undefined,
      }));
      const count = (data && typeof data === 'object' && typeof (data as { count?: unknown }).count === 'number')
        ? (data as { count: number }).count
        : terms.length;
      return { count, terminals: terms };
    },
    // W37: правила алертов (GET /api/core/alert-rules).
    async alertRules() {
      const data = await getJson<unknown>(coreApi('/api/core/alert-rules'), { structured: true });
      const list = (Array.isArray(data) ? data : (data as { rules?: unknown[] }).rules ?? []) as Record<string, unknown>[];
      const rules = list.map((r) => ({
        idx: typeof r.idx === 'number' ? r.idx : 0,
        pattern: typeof r.pattern === 'string' ? r.pattern : '',
        action: typeof r.action === 'string' ? r.action : 'notify',
        disabled: r.disabled === true,
        runtime: r.runtime === true,
      }));
      const count = (data && typeof data === 'object' && typeof (data as { count?: unknown }).count === 'number')
        ? (data as { count: number }).count
        : rules.length;
      return { rules, count };
    },
    // W37: toggle правила (POST /api/core/alert-rules/{idx}/toggle {enabled}).
    async alertToggle(idx, enabled) {
      const response = await postJson<{ idx?: unknown; disabled?: unknown }>(
        `${coreApi('/api/core/alert-rules')}/${encodeURIComponent(String(idx))}/toggle`, { enabled }, true, true);
      return {
        idx: typeof response?.idx === 'number' ? response.idx : idx,
        disabled: response?.disabled === true,
      };
    },
    // W37: история алертов (GET /api/core/alerts?limit=).
    async alerts(opts) {
      const params = new URLSearchParams({ limit: String(opts?.limit ?? 50) });
      const data = await getJson<unknown>(`${coreApi('/api/core/alerts')}?${params}`, { structured: true });
      const o = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
      const list = (Array.isArray(data) ? data : (o.alerts ?? [])) as Record<string, unknown>[];
      const alerts = list.map((a) => ({
        ts: typeof a.ts === 'number' ? a.ts : undefined,
        term: a.term != null ? String(a.term) : undefined,
        ruleIdx: typeof a.rule_idx === 'number' ? a.rule_idx : undefined,
        pattern: typeof a.pattern === 'string' ? a.pattern : undefined,
        action: typeof a.action === 'string' ? a.action : undefined,
        line: typeof a.line === 'string' ? a.line : undefined,
      }));
      return {
        alerts,
        count: typeof o.count === 'number' ? o.count : alerts.length,
        rules_loaded: typeof o.rules_loaded === 'number' ? o.rules_loaded : 0,
      };
    },
    // W38: создать share (POST /api/core/share {term, scopes, ttl_s}).
    async shareCreate(term, opts) {
      const data = await postJson<{ token?: unknown; term?: unknown; scopes?: unknown; expires_at?: unknown; view_url?: unknown }>(
        coreApi('/api/core/share'),
        {
          term,
          scopes: opts.scopes ?? ['screen', 'dump', 'info'],
          ttl_s: opts.ttlS ?? 3600,
        },
        true,
        true,
      );
      return {
        token: typeof data?.token === 'string' ? data.token : '',
        term: typeof data?.term === 'string' ? data.term : term,
        scopes: Array.isArray(data?.scopes) ? (data.scopes as unknown[]).map(String) : [],
        expiresAt: typeof data?.expires_at === 'number' ? data.expires_at : 0,
        viewUrl: typeof data?.view_url === 'string' ? data.view_url : '',
      };
    },
    // W38: список активных шаров (GET /api/core/shares).
    async shares() {
      const data = await getJson<unknown>(coreApi('/api/core/shares'), { structured: true });
      const list = (Array.isArray(data) ? data : (data as { shares?: unknown[] }).shares ?? []) as Record<string, unknown>[];
      return list.map((s) => ({
        token: typeof s.token === 'string' ? s.token : '',
        term: typeof s.term === 'string' ? s.term : '',
        scopes: Array.isArray(s.scopes) ? (s.scopes as unknown[]).map(String) : [],
        expiresAt: typeof s.expires_at === 'number' ? s.expires_at : 0,
        expired: s.expired === true,
        hits: typeof s.hits === 'number' ? s.hits : 0,
      }));
    },
    // W38: отозвать share (DELETE /api/core/share/{token}; полный токен).
    async shareRevoke(token) {
      await deleteJson(`${coreApi('/api/core/share')}/${encodeURIComponent(token)}`, false, true);
      return { revoked: true };
    },
    // W39: входные вводы терминала (GET /api/core/terminal/{term}/input-log).
    async inputLog(term, limit = 50) {
      const bare = term.split('/').pop() ?? term;
      const params = new URLSearchParams({ limit: String(limit) });
      const data = await getJson<unknown>(`${coreApi('/api/core/terminal')}/${encodeURIComponent(bare)}/input-log?${params}`, { structured: true });
      const o = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
      const entries = (Array.isArray(data) ? data : (o.entries ?? [])) as Record<string, unknown>[];
      return {
        term: typeof o.term === 'string' ? o.term : term,
        entries: entries.map((e) => ({
          ts: typeof e.ts === 'number' ? e.ts : undefined,
          text: typeof e.text === 'string' ? e.text : '',
          enter: e.enter === true,
        })),
        count: typeof o.count === 'number' ? o.count : entries.length,
      };
    },
    // W31: flush send-очереди (DELETE /api/core/send-queue/<term>).
    async flushSendQueue(term) {
      const bare = term.split('/').pop() ?? term;
      const response = await deleteJson<{ term?: unknown; cleared?: unknown }>(
        `${coreApi('/api/core/send-queue')}/${encodeURIComponent(bare)}`, true, true);
      return {
        term: typeof response?.term === 'string' ? response.term : term,
        cleared: typeof response?.cleared === 'number' ? response.cleared : 0,
      };
    },
    // W9: детальные машины (?detail=1).
    async machinesDetail() {
      try {
        const data = await getJson<unknown>(coreApi('/api/core/machines?detail=1'), { structured: true });
        const list = Array.isArray(data) ? data : (data as { machines?: unknown[] }).machines ?? [];
        return list.map((m) => {
          const r = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>;
          const labels = (r.labels && typeof r.labels === 'object' ? r.labels : {}) as Record<string, unknown>;
          const metrics = (r.metrics && typeof r.metrics === 'object' ? r.metrics : {}) as Record<string, unknown>;
          return {
            name: String(r.name ?? ''),
            host: r.host != null ? String(r.host) : undefined,
            transport: r.transport != null ? String(r.transport) : undefined,
            state: r.state != null ? String(r.state) : undefined,
            since_ms: typeof r.since_ms === 'number' ? r.since_ms : undefined,
            why: r.why != null ? String(r.why) : null,
            labels: Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, String(v)])),
            uptime_s: typeof r.uptime_s === 'number' ? r.uptime_s : undefined,
            terminals: typeof r.terminals === 'number' ? r.terminals : undefined,
            metrics: Object.keys(metrics).length > 0
              ? { cpu: Number(metrics.cpu), mem: Number(metrics.mem), uptime_s: Number(metrics.uptime_s) }
              : undefined,
          };
        });
      } catch {
        return [];
      }
    },
    // Информация о ядре (GET /api/core/server). Ответ может приходить как
    // плоским объектом, так и в обёртке {server: {...}} — читаем оба.
    async server() {
      const data = await getJson<unknown>(coreApi('/api/core/server'), { structured: true });
      const o = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
      const nested = (o.server && typeof o.server === 'object' ? o.server : {}) as Record<string, unknown>;
      const pick = (rec: Record<string, unknown>, key: string): unknown => rec[key] ?? o[key];
      return {
        version: String(pick(nested, 'version') ?? ''),
        uptime_s: typeof pick(nested, 'uptime_s') === 'number' ? pick(nested, 'uptime_s') as number : 0,
        state: String(pick(nested, 'state') ?? 'unknown'),
        startedAt: typeof pick(nested, 'started_at') === 'number' ? pick(nested, 'started_at') as number : undefined,
        pid: typeof pick(nested, 'pid') === 'number' ? pick(nested, 'pid') as number : undefined,
        host: pick(nested, 'host') != null ? String(pick(nested, 'host')) : undefined,
      };
    },
    streamEvents(onEvent, onError, types) {
      // РЎРµСЂРІРµСЂ С€Р»С‘С‚ `event: <type>` Р‘Р•Р— `id:` вЂ” EventSource.onmessage С‚Р°РєРёРµ
      // РєР°РґСЂС‹ РЅРµ РґРѕСЃС‚Р°РІРёС‚, Р° Last-Event-ID РЅРµ РІРѕСЃСЃС‚Р°РЅРѕРІРёС‚СЃСЏ. Р§РёС‚Р°РµРј РїРѕС‚РѕРє
      // fetch'РµРј Рё СЂРµР·СЋРјРёРј РїРѕ seq РёР· JSON-РїРѕР»РµР·РЅРѕР№ РЅР°РіСЂСѓР·РєРё.
      const params = new URLSearchParams();
      if (types && types.length > 0) params.set('types', types.join(','));
      const qs = params.toString();
      const resolved = base ?? '';
      const url = `${resolved.replace(/\/$/, '')}/api/core/events${qs ? `?${qs}` : ''}`;
      const controller = new AbortController();
      let closed = false;
      let lastSeq = 0;
      let retry: ReturnType<typeof setTimeout> | undefined;
      /** РџРѕСЃС‚РѕСЏРЅРЅС‹Р№ РѕС‚РєР°Р· (СЂРѕСѓС‚ РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚ / РїСѓСЃС‚РѕР№ РѕС‚РІРµС‚) вЂ” СЂРµС‚СЂР°Р№ РЅРµ РїРѕРјРѕР¶РµС‚. */
      const permanent = (message: string) => {
        const error = new Error(message);
        (error as { permanent?: boolean }).permanent = true;
        return error;
      };
      const connect = async () => {
        try {
          const res = await fetchBridgeApi(url, {
            cache: 'no-store',
            headers: lastSeq > 0 ? { 'Last-Event-ID': String(lastSeq) } : {},
            signal: controller.signal,
          });
          if (!res.ok) throw permanent(`events ${res.status}`);
          if (!res.body) throw permanent('events: empty body');
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let cut: number;
            while ((cut = buf.indexOf('\n\n')) >= 0) {
              const frame = buf.slice(0, cut);
              buf = buf.slice(cut + 2);
              const data = frame.split('\n')
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.slice(5).replace(/^ /, ''))
                .join('\n');
              if (!data) continue;
              try {
                const parsed = JSON.parse(data) as LiveEvent;
                if (typeof parsed.seq === 'number') lastSeq = Math.max(lastSeq, parsed.seq);
                onEvent(parsed);
              } catch {
                // Р±РёС‚С‹Р№ РєР°РґСЂ РїРѕС‚РѕРєР° РїСЂРѕРїСѓСЃРєР°РµРј
              }
            }
          }
          if (!closed) throw new Error('events stream ended');
        } catch (error) {
          if (closed) return;
          onError?.(error instanceof Error ? error.message : 'events stream interrupted');
          // РџРѕСЃС‚РѕСЏРЅРЅС‹Р№ РѕС‚РєР°Р· (404: СЂРѕСѓС‚ РЅРµ Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅ, РїСѓСЃС‚РѕРµ С‚РµР»Рѕ) вЂ”
          // СЂРµС‚СЂР°РёС‚СЊ Р±РµСЃСЃРјС‹СЃР»РµРЅРЅРѕ; СЃРµС‚РµРІС‹Рµ РѕР±СЂС‹РІС‹/5xx вЂ” СЂРµС‚СЂР°РёРј РєР°Рє SSE.
          if ((error as { permanent?: boolean }).permanent) return;
          retry = setTimeout(() => void connect(), 2000);
        }
      };
      void connect();
      return () => {
        closed = true;
        if (retry !== undefined) clearTimeout(retry);
        controller.abort();
      };
    },
  };
}

/**
 * PKG-B1: клиент к ростеру фермы /api/deck/* (GET-only, side-effect-free).
 *
 * — status: /api/deck/status (connected/events_connected/version/uptime_s/…);
 * — agents/terminals/machines: /api/deck/{agents,terminals,machines};
 * — SSE-события: /api/deck/events (event:"nx", data{seq,ts,event{method,
 *   params{type,terminal,data,seq}}});
 * — /api/core/* остаётся для server/screen/screenStream (read-only).
 *
 * Дефолтная база — same-origin (пустая строка); при недоступности GET API
 * допустим резервный read-only запрос через edge. Для тестов — передать base.
 */
export function createDeckBridge(base?: string): NewfBridge {
  const resolvedBase = base ?? '';
  const deckApi = (path: string) => `${resolvedBase.replace(/\/$/, '')}/api/deck${path}`;
  const coreApi = (path: string) => `${resolvedBase.replace(/\/$/, '')}${path}`;
  const core = createCoreBridge(resolvedBase);

  return {
    ...core,
    // Статус фермы: канонический источник connected/events.
    async deck() {
      const data = await getJson<unknown>(deckApi('/status'), { structured: true });
      return normalizeDeckStatus(data);
    },
    // Основной roster для Deck-экрана.
    async agents() {
      const data = await getJson<unknown>(deckApi('/agents'), { structured: true });
      const list = (data && typeof data === 'object' && Array.isArray((data as { agents?: unknown }).agents)
        ? (data as { agents: unknown[] }).agents : []) as Record<string, unknown>[];
      return list.map(deckAgentToLive);
    },
    async terminals() {
      const data = await getJson<unknown>(deckApi('/terminals'), { structured: true });
      const list = (data && typeof data === 'object' && Array.isArray((data as { terminals?: unknown }).terminals)
        ? (data as { terminals: unknown[] }).terminals : []) as Record<string, unknown>[];
      return list.map(normalizeTerminal);
    },
    machines: {
      schema: core.machines!.schema,
      async list() {
        const data = await getJson<unknown>(deckApi('/machines'), { structured: true });
        const list = (data && typeof data === 'object' && Array.isArray((data as { machines?: unknown }).machines)
          ? (data as { machines: unknown[] }).machines : []) as Record<string, unknown>[];
        return list.map(deckMachineFromRaw);
      },
      get: core.machines!.get,
    },
    // Информация о ядре — из /api/core/server (остаётся за core-роутом).
    async server() {
      const data = await getJson<unknown>(coreApi('/api/core/server'), { structured: true });
      const o = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
      return {
        version: typeof o.version === 'string' ? o.version : '',
        uptime_s: typeof o.uptime_s === 'number' ? o.uptime_s : 0,
        state: typeof o.state === 'string' ? o.state : 'unknown',
        startedAt: typeof o.started_at === 'number' ? o.started_at : undefined,
        pid: typeof o.pid === 'number' ? o.pid : undefined,
        host: o.host != null ? String(o.host) : undefined,
      };
    },
    // Read-only экран терминала (GET /api/core/terminal/{t}/stream).
    screenStream(term, onScreen, onError) {
      const name = term.split('/').pop() ?? term;
      const url = `${coreApi('/api/core/terminal')}/${encodeURIComponent(name)}/stream`;
      const controller = new AbortController();
      let closed = false;
      let stopped = false;
      let retry: ReturnType<typeof setTimeout> | undefined;
      const stop = () => { stopped = true; if (retry) clearTimeout(retry); };
      const connect = async () => {
        try {
          const res = await fetchBridgeApi(url, { cache: 'no-store', signal: controller.signal });
          if (!res.ok) {
            // 404 = терминал ушёл (exited/lost) — retry не нужен.
            stop();
            onError?.(`stream ${res.status}`);
            return;
          }
          if (!res.body) throw new Error('stream: empty body');
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf('\n\n')) !== -1) {
              const raw = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              const lines = raw.split('\n');
              const event = lines.find((l) => l.startsWith('event:'))?.slice(6).trim() ?? 'message';
              const dataLine = lines.find((l) => l.startsWith('data:'));
              if (!dataLine) continue;
              const payload = dataLine.slice(5).trim();
              if (event === 'screen') {
                try {
                  const parsed = JSON.parse(payload) as { seq?: number; screen?: string };
                  if (typeof parsed.screen === 'string') onScreen(parsed.screen, parsed.seq ?? 0);
                } catch { /* битый кадр */ }
              }
            }
          }
          if (!closed && !stopped) retry = setTimeout(connect, 2000);
        } catch {
          if (!closed && !stopped) {
            onError?.('stream error');
            retry = setTimeout(connect, 2000);
          }
        }
      };
      void connect();
      return () => { closed = true; stop(); controller.abort(); };
    },
    // Deck-SSE: event "nx" → data {seq,ts,event{method,params{type,…}}}.
    streamEvents(onEvent, onError) {
      const url = `${deckApi('/events')}`;
      const controller = new AbortController();
      let closed = false;
      let retry: ReturnType<typeof setTimeout> | undefined;
      const connect = async () => {
        try {
          const res = await fetchBridgeApi(url, { cache: 'no-store', signal: controller.signal });
          if (!res.ok) {
            onError?.(`deck events ${res.status}`);
            if (res.status === 404) return; // роут не зарегистрирован — ретраев нет
            retry = setTimeout(() => void connect(), 2000);
            return;
          }
          if (!res.body) throw new Error('deck events: empty body');
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let cut: number;
            while ((cut = buf.indexOf('\n\n')) >= 0) {
              const frame = buf.slice(0, cut);
              buf = buf.slice(cut + 2);
              const data = frame.split('\n')
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.slice(5).replace(/^ /, ''))
                .join('\n');
              if (!data) continue;
              try {
                const parsed = JSON.parse(data) as Record<string, unknown>;
                const inner = (parsed.event && typeof parsed.event === 'object' ? parsed.event : {}) as Record<string, unknown>;
                const params = (inner.params && typeof inner.params === 'object' ? inner.params : {}) as Record<string, unknown>;
                const type = params.type != null ? String(params.type)
                  : typeof inner.method === 'string' ? inner.method
                  : typeof parsed.type === 'string' ? parsed.type : '';
                const seq = typeof params.seq === 'number' ? params.seq
                  : typeof parsed.seq === 'number' ? parsed.seq : 0;
                onEvent({
                  seq,
                  type,
                  ts: typeof parsed.ts === 'number' ? parsed.ts : undefined,
                  method: typeof inner.method === 'string' ? inner.method : undefined,
                  terminal: typeof params.terminal === 'string' ? params.terminal : (typeof parsed.terminal === 'string' ? parsed.terminal : undefined),
                  address: typeof parsed.address === 'string' ? parsed.address : (typeof params.address === 'string' ? params.address : undefined),
                  machine: typeof parsed.machine === 'string' ? parsed.machine : (typeof params.machine === 'string' ? params.machine : undefined),
                  term: typeof parsed.term === 'string' ? parsed.term : (typeof params.term === 'string' ? params.term : undefined),
                  state: typeof parsed.state === 'string' ? parsed.state : (typeof params.state === 'string' ? params.state : undefined),
                  data: params.data && typeof params.data === 'object' ? params.data : undefined,
                  raw: parsed,
                });
              } catch { /* битый кадр */ }
            }
          }
          if (!closed) throw new Error('deck events stream ended');
        } catch (error) {
          if (closed) return;
          onError?.(error instanceof Error ? error.message : 'deck events interrupted');
          retry = setTimeout(() => void connect(), 2000);
        }
      };
      void connect();
      return () => {
        closed = true;
        if (retry !== undefined) clearTimeout(retry);
        controller.abort();
      };
    },
  };
}

function machineFromRaw(name: string, raw: unknown): MachineRecord {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const labels = (r.labels && typeof r.labels === 'object' ? r.labels : {}) as Record<string, unknown>;
  return {
    name: String(r.name ?? name ?? ''),
    host: String(r.host ?? ''),
    transport: String(r.transport ?? 'ssh'),
    state: String(r.state ?? 'unknown'),
    since_ms: typeof r.since_ms === 'number' ? r.since_ms : 0,
    why: r.why != null ? String(r.why) : null,
    labels: Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, String(v)])),
  };
}

function detailOf(error: BridgeHttpError): string | undefined {
  if (typeof error.body === 'string') return error.body;
  if (error.body && typeof error.body === 'object') {
    const e = error.body as { error?: unknown };
    if (typeof e.error === 'string') return e.error;
  }
  return error.message;
}

function errorToFileResult(error: unknown): FileListResult {
  const base: FileListResult = { state: 'unavailable', cwd: '', entries: [], truncated: false };
  if (error instanceof BridgeHttpError) {
    if (error.kind === 'not_found') return { ...base, state: 'not_found', detail: detailOf(error) };
    if (error.kind === 'denied') return { ...base, state: 'out_of_scope', detail: detailOf(error) };
    if (error.kind === 'unsupported') return { ...base, state: 'unsupported', detail: detailOf(error) };
    return { ...base, detail: detailOf(error) };
  }
  return { ...base, detail: error instanceof Error ? error.message : undefined };
}
