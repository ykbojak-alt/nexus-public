/**
 * Мост десктоп-приложения шины (W7).
 *
 * Тонкая обёртка над `window.pywebview.api` приложения
 * `tools/bus_desktop/bridge.py`. Мост инжектится pywebview после
 * DOMContentLoaded и объявляется событием `pywebviewready` — здесь тот же
 * поздний bind, что в `adapter.ts` продукта AI-2: ждём событие и параллельно
 * опрашиваем api каждые 50 мс (pywebview может не доставить событие вовсе).
 *
 * Существующий `NexusDesktopBridge` намеренно НЕ расширяется: он про продукт
 * AI-2, а инвентарь `scripts/desktop-smoke-auto.py` сверяет его набор
 * методов. Здесь отдельный контракт с префиксом `bus_`.
 *
 * Деградация у каждого метода своя: нет метода или отказ → безопасное
 * значение (null для чтений, false для действий). Страница отдельно
 * проверяет `available`, чтобы отличить «моста нет» от «пустой шины».
 */

// ── типы данных шины (зеркало tools/bus_desktop/service.py) ─────────────────

export interface BusCard {
  name: string;
  ageMin: number;
  size: number;
  path: string;
}

/** Событие LOCKED: сессия окна открыта в интерфейсе — очередь не разойдётся. */
export interface BusLockedInfo {
  at: string;
  ageMin: number | null;
  task: string;
  event: string;
  reason: string;
}

export interface BusWindowSummary {
  id: string;
  session: string;
  title: string;
  kind: string;
  state: string;
  task: string;
  ageMin: number | null;
  sendPid: number | null;
  model: string;
  guardReason: string | null;
  queue: BusCard[];
  queueCount: number;
  held: BusCard[];
  heldCount: number;
  sent: number;
  sentArchive: number;
  outbox: number;
  inbox: number | null;
  oldestAgeMin: number | null;
  locked: BusLockedInfo | null;
  /** Наблюдаемое состояние окна от bus-observe (observed.json); null — сторож не видит окно. */
  observed?: 'busy' | 'idle' | 'dead' | 'unknown' | (string & {}) | null;
  /** С какого момента окно в текущем observed-состоянии. */
  observedSince?: string | null;
  /** Последняя доставка (delivery). Нулевая — доставлено, ненулево — срыв с деталями. */
  lastDelivery: { delivery: string; ts: string } | null;
  /** Флаг расхождения файлового состояния окна и наблюдаемого состояния. */
  divergence?: { flag: string } | null;
  /** Последний переход окна любого kind (observed/file/delivery/wake…). */
  lastTransition?: { ts: string; kind: string; event: string } | null;
}

/** Запись журнала переходов наблюдаемого слоя (events.jsonl). */
export interface BusEvent {
  ts: string;
  window: string;
  /** observed | file | delivery | wake | watch */
  kind: string;
  event: string;
  detail?: string;
}

export type BusHealthState = 'ok' | 'empty' | 'empty_after_rotation' | 'counter_mismatch';

export interface BusHealthWindow {
  window: string;
  sent: number;
  archive: number;
  reported: number | null;
  state: BusHealthState;
  detail: string;
}

export interface BusHealth {
  windows: BusHealthWindow[];
  totalSent: number;
  totalArchive: number;
  state: string;
}

export interface BusPolicy {
  blocking: boolean;
  message: string;
  source: string;
  error?: string;
}

export interface BusModelEntry {
  window: string;
  model: string;
  source: 'default' | 'override';
  error?: string;
}

export interface BusOutboxReply {
  window: string;
  name: string;
  ageMin: number;
  size: number;
  kind: string;
  task: string;
  path: string;
}

export interface BusCardText {
  window: string;
  name: string;
  path?: string;
  text: string;
  truncated: boolean;
  /** Мост не бросает, а отдаёт {"error": "..."} — читатель проверяет errOf. */
  error?: string;
}

export interface BusReplyText {
  window: string;
  name: string;
  text: string;
  truncated: boolean;
  /** Ошибка вместо данных (см. BusCardText.error). */
  error?: string;
}

export interface BusLogTail {
  name: string;
  lines: string[];
  total: number;
  /** Ошибка вместо данных (см. BusCardText.error). */
  error?: string;
}

/** Состояние дозора: работает ли, PID, uptime, автозапуск. */
export interface BusWatchdogState {
  running: boolean;
  pid: number | null;
  startedAt: string;
  uptimeSec: number | null;
  autostart: boolean;
  generatedAt: string;
  error: string;
}

export interface BusCrashEntry {
  name: string;
  size: number;
  ageMin: number;
  path: string;
}

export interface BusAuditEntry {
  ts: string;
  event: string;
  file: string;
  detail: string;
}

export interface BusSentHealthRow {
  window: string;
  sent: number;
  run: number;
  done: number;
  wait: number;
  lost: number;
  nolog: number;
  archive: number;
  oldest: string;
}

export interface BusSentHealth {
  ok: boolean;
  error: string;
  windows: BusSentHealthRow[];
  output: string;
}

export interface BusQueueAgeRow {
  loc: string;
  name: string;
  age: string;
  verdict: string;
  detail: string;
}

export interface BusQueueAge {
  ok: boolean;
  error: string;
  rows: BusQueueAgeRow[];
  output: string;
}

export interface BusRequeueLost {
  ok: boolean;
  error: string;
  counts: Record<string, number>;
  summary: string;
  rows: string[];
  applied: boolean;
}

export interface BusCleanReport {
  ok: boolean;
  error: string;
  dead: string[];
  lines: string[];
  applied: boolean;
}

export interface BusTraceReport {
  ok: boolean;
  error: string;
  output: string;
}

export interface BusExport {
  ok: boolean;
  error: string;
  text: string;
  count: number;
}

/** Результат действия: у скриптов шины ok/rc/stdout/stderr, у файловых — ok/error. */
export interface BusActionResult {
  ok?: boolean;
  error?: string;
  rc?: number;
  stdout?: string;
  stderr?: string;
  [key: string]: unknown;
}

export interface BusAppInfo {
  app: string;
  version: string;
  platform: string;
  desktop: boolean;
  pid: number | null;
  busDir: string;
}

export interface BusHostState {
  url: string;
  healthz: Record<string, unknown>;
  home: { reachable: boolean; status?: number; error: string };
  available: boolean;
}

export interface BusHostSession {
  [key: string]: unknown;
}

export interface BusStatusPayload {
  windows: BusWindowSummary[];
  health: BusHealth;
  policy: BusPolicy;
  generatedAt: number;
}

// ── контракт моста ─────────────────────────────────────────────────────────

export interface BusBridge {
  /** Есть ли живой pywebview-мост. false → страница показывает заглушку. */
  available: boolean;
  appInfo(): Promise<BusAppInfo | null>;
  setTitle(title: string): Promise<boolean>;
  saveText(filename: string, text: string): Promise<string | null>;
  minimize(): Promise<boolean>;
  closeWindow(): Promise<boolean>;
  openBrowser(url: string): Promise<boolean>;
  notify(title: string, message: string): Promise<boolean>;
  isFrameless(): Promise<boolean>;
  busStatus(): Promise<BusStatusPayload | null>;
  busQueue(window?: string): Promise<{ window?: string; queue: BusCard[]; held: BusCard[] } | null>;
  busCard(window: string, name: string): Promise<BusCardText | null>;
  busOutbox(window?: string): Promise<{ replies: BusOutboxReply[]; error?: string } | null>;
  busReply(window: string, name: string): Promise<BusReplyText | null>;
  busPolicy(): Promise<BusPolicy | null>;
  busModels(): Promise<{ models: Record<string, BusModelEntry>; error?: string } | null>;
  busHealth(): Promise<BusHealth | null>;
  busLog(name: string, lines: number, contains: string): Promise<BusLogTail | null>;
  busCrashes(): Promise<{ crashes: BusCrashEntry[]; error?: string } | null>;
  busCrash(name: string): Promise<{ name: string; text: string; truncated: boolean; error?: string } | null>;
  busAudit(lines: number): Promise<{ entries: BusAuditEntry[]; error?: string } | null>;
busEvents(lines?: number): Promise<{ events: BusEvent[]; error?: string } | null>;
  busSentHealth(): Promise<BusSentHealth | null>;
  busQueueAge(): Promise<BusQueueAge | null>;
  busTrace(query: string, window?: string): Promise<BusTraceReport | null>;
  busExportOutbox(): Promise<BusExport | null>;
  busAddTask(window: string, text: string): Promise<BusActionResult | null>;
  busHold(window: string, name: string): Promise<BusActionResult | null>;
  busUnhold(window: string, name: string): Promise<BusActionResult | null>;
  busRemove(window: string, name: string): Promise<BusActionResult | null>;
  busDispatch(window: string, name: string, mode?: string): Promise<BusActionResult | null>;
  busDispatchText(window: string, text: string): Promise<{ ok: boolean; window: string; delivery: string; detail: string } | null>;
  busSetPolicy(blocking: boolean, message: string): Promise<BusActionResult | null>;
  busSetModel(window: string, model: string): Promise<BusActionResult | null>;
  busWatchdogStart(): Promise<BusActionResult | null>;
  busWatchdogStop: () => Promise<BusActionResult | null>;
  busWatchdogPassOnce: () => Promise<BusActionResult | null>;
  busWatchdogState: () => Promise<BusWatchdogState | null>;
  busModelGuard: () => Promise<BusActionResult | null>;
  busRequeueLost(apply: boolean, only?: string): Promise<BusRequeueLost | null>;
  busClean(execute: boolean): Promise<BusCleanReport | null>;
  busOutboxIndex(): Promise<BusActionResult | null>;
  busHostState: () => Promise<BusHostState | null>;
  busSessions(): Promise<{ sessions: BusHostSession[]; error?: string } | null>;
  busOverview(logTail?: number): Promise<{ overview: Record<string, unknown>; error?: string } | null>;
  busDelegation(id: string): Promise<{ delegation: Record<string, unknown>; error?: string } | null>;
  busObserve(): Promise<{ windows: Record<string, { observed?: string; since?: string; [k: string]: unknown }> } | null>;
}

// ── поздний bind ───────────────────────────────────────────────────────────

const READY_EVENT = 'pywebviewready';
const DEFAULT_TIMEOUT_MS = 1500;

type PywebviewBusApi = Record<string, (...args: unknown[]) => Promise<unknown>>;

function apiOf(): PywebviewBusApi | undefined {
  if (typeof window === 'undefined') return undefined;
  const api = (window as unknown as { pywebview?: { api?: Record<string, unknown> } }).pywebview?.api;
  // pywebview 6.x сначала создаёт пустой `api:{}` и только потом наполняет
  // его методами (atomic assign в _createApi). Пустой api — ещё не мост.
  if (api == null || Object.keys(api).length === 0) return undefined;
  return api as PywebviewBusApi;
}

/** Синхронная проверка наличия моста (для рендера хрома окна с первого кадра). */
export function hasBusBridge(): boolean {
  return apiOf() != null;
}

function call<T>(
  api: PywebviewBusApi | undefined,
  method: string,
  args: unknown[],
  fallback: T,
): Promise<T> {
  const fn = api?.[method] as ((...a: unknown[]) => Promise<T>) | undefined;
  if (typeof fn !== 'function') return Promise.resolve(fallback);
  try {
    return Promise.resolve(fn(...args)).catch(() => fallback);
  } catch {
    return Promise.resolve(fallback);
  }
}

function createBusBridge(api: PywebviewBusApi | undefined): BusBridge {
  const callWith = <T>(method: string, args: unknown[], fallback: T): Promise<T> =>
    call(api, method, args, fallback);
  return {
    available: api != null,
    appInfo: () => callWith('app_info', [], null),
    setTitle: (title) => callWith('set_title', [title], false),
    saveText: (filename, text) => callWith('save_text', [filename, text], null),
    minimize: () => callWith('minimize', [], false),
    closeWindow: () => callWith('close_window', [], false),
    openBrowser: (url) => callWith('open_browser', [url], false),
    notify: (title, message) => callWith('notify', [title, message], false),
    isFrameless: () => callWith('is_frameless', [], false),
    busStatus: () => callWith('bus_status', [], null),
    busQueue: (window) => callWith('bus_queue', window ? [window] : [], null),
    busCard: (window, name) => callWith('bus_card', [window, name], null),
    busOutbox: (window) => callWith('bus_outbox', window ? [window] : [], null),
    busReply: (window, name) => callWith('bus_reply', [window, name], null),
    busPolicy: () => callWith('bus_policy', [], null),
    busModels: () => callWith('bus_models', [], null),
    busHealth: () => callWith('bus_health', [], null),
    busLog: (name, lines, contains) => callWith('bus_log', [name, lines, contains], null),
    busCrashes: () => callWith('bus_crashes', [], null),
    busCrash: (name) => callWith('bus_crash', [name], null),
    busAudit: (lines) => callWith('bus_audit', [lines], null),
    busEvents: (lines) => callWith('bus_events', [lines ?? 60], null),
    busSentHealth: () => callWith('bus_sent_health', [], null),
    busQueueAge: () => callWith('bus_queue_age', [], null),
    busTrace: (query, window) => callWith('bus_trace', [query, window ?? ''], null),
    busExportOutbox: () => callWith('bus_export_outbox', [], null),
    busAddTask: (window, text) => callWith('bus_add_task', [window, text], null),
    busHold: (window, name) => callWith('bus_hold', [window, name], null),
    busUnhold: (window, name) => callWith('bus_unhold', [window, name], null),
    busRemove: (window, name) => callWith('bus_remove', [window, name], null),
    busDispatch: (window, name, mode) => callWith('bus_dispatch', [window, name, mode ?? 'dangerous'], null),
    busSetPolicy: (blocking, message) => callWith('bus_set_policy', [blocking, message], null),
    busSetModel: (window, model) => callWith('bus_set_model', [window, model], null),
    busWatchdogStart: () => callWith('bus_watchdog_start', [], null),
    busWatchdogStop: () => callWith('bus_watchdog_stop', [], null),
    busWatchdogPassOnce: () => callWith('bus_watchdog_pass_once', [], null),
    busWatchdogState: () => callWith('bus_watchdog_state', [], null),
    busModelGuard: () => callWith('bus_model_guard', [], null),
    busRequeueLost: (apply, only) => callWith('bus_requeue_lost', [apply, only ?? ''], null),
    busClean: (execute) => callWith('bus_clean', [execute], null),
    busOutboxIndex: () => callWith('bus_outbox_index', [], null),
    busHostState: () => callWith('bus_host_state', [], null),
    busSessions: () => callWith('bus_sessions', [], null),
    busOverview: (logTail) => callWith('bus_overview', [logTail ?? 10], null),
    busDelegation: (id) => callWith('bus_delegation', [id], null),
    busObserve: () => callWith('bus_observe', [], null),
    busDispatchText: (window, text) => callWith('bus_dispatch_text', [window, text], null),
  };
}

/**
 * Дождаться моста и вернуть его.
 *
 * Мост может прийти позже первого кадра (pywebview стартует свой runtime
 * асинхронно), поэтому ждём `pywebviewready` до timeout и параллельно
 * опрашиваем api. Если моста нет — возвращается мост с available=false:
 * страница покажет честную заглушку, а не пустые экраны.
 */
export async function getBusBridge(
  options: { timeoutMs?: number } = {},
): Promise<BusBridge> {
  const live = apiOf();
  if (live != null) return createBusBridge(live);

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ready = await new Promise<boolean>((resolve) => {
    let settled = false;
    const doc = typeof document !== 'undefined' ? document : null;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timer);
      doc?.removeEventListener(READY_EVENT, listener);
      resolve(ok);
    };
    const listener = () => { if (apiOf() != null) done(true); };
    doc?.addEventListener(READY_EVENT, listener);
    const poll = setInterval(() => { if (apiOf() != null) done(true); }, 50);
    const timer = setTimeout(() => done(false), timeoutMs);
  });
  if (ready) {
    const refreshed = apiOf();
    if (refreshed != null) return createBusBridge(refreshed);
  }
  return createBusBridge(undefined);
}
