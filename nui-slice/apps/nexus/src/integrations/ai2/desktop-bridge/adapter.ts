import { createBrowserBridge } from './browser';
import type {
  DesktopSystemMetrics,
  InstalledTool,
  InstalledToolLaunchResult,
  InstagramWebResult,
  NexusDesktopBridge,
  PywebviewApi,
} from './types';

/**
 * DesktopBridge adapter (Task 7).
 *
 * `window.pywebview.api` is injected by pywebview after DOMContentLoaded
 * and announced via the `pywebviewready` document event — it can arrive
 * after React mount, so getDesktopBridge waits up to `timeoutMs`.
 * Each method call degrades independently: absent method or rejection →
 * the browser-safe default (null for payloads, false for booleans).
 */

export interface GetDesktopBridgeOptions {
  /** How long to wait for pywebviewready before falling back. Default 1500ms. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 1500;
const READY_EVENT = 'pywebviewready';
/** DOM event the host dispatches via evaluate_js on every host-state
 *  transition (DesktopBridge._push_scene_state, bridge-contract §2). */
const SCENE_STATE_EVENT = 'unreal-scene.state';
const SCENE_EVENT_EVENT = 'unreal-scene.event';

function apiOf(): PywebviewApi | undefined {
  if (typeof window === 'undefined') return undefined;
  const api = window.pywebview?.api;
  // pywebview 6.x инжектит мост двумя evaluate_js: api.js создаёт
  // window.pywebview = {api:{}}, и только потом finish.js наполняет методы
  // (_createApi + pywebviewready). Пустой `api:{}` — ещё не мост: приняв его
  // за живой, мы резолвили bridge с нулём методов — is_frameless давал
  // fallback false (тайтлбар скрывался и кэш отравлялся '0'), а кнопки окна
  // молча no-op до конца страницы. Готовность = наличие хотя бы одного
  // метода — _createApi присваивает весь список атомарно.
  if (api == null || Object.keys(api).length === 0) return undefined;
  return api;
}

/** Synchronous capability check for browser actions that require user activation. */
export function hasDesktopBridge(): boolean {
  return apiOf() != null;
}

/** Wrap a python method: absent → fallback; rejection → fallback (logged). */
function call<T>(
  api: PywebviewApi | undefined,
  method: keyof PywebviewApi,
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

const INSTAGRAM_WEB_STATES = new Set(['closed', 'opening', 'open', 'unavailable', 'error']);
const IG_UNAVAILABLE: InstagramWebResult = { state: 'unavailable' };

/** Narrow the wire result — unknown state strings report as 'error',
 *  never silently mapped onto a fabricated lifecycle. */
function toInstagramWebResult(raw: unknown): InstagramWebResult {
  const state = (raw as { state?: unknown } | null)?.state;
  if (typeof state !== 'string') return IG_UNAVAILABLE;
  if (!INSTAGRAM_WEB_STATES.has(state)) return { state: 'error', detail: `unknown state: ${state}` };
  const detail = (raw as { detail?: unknown }).detail;
  return {
    state: state as InstagramWebResult['state'],
    detail: typeof detail === 'string' ? detail : null,
  };
}

function isInstalledTool(value: unknown): value is InstalledTool {
  if (value == null || typeof value !== 'object') return false;
  const tool = value as Record<string, unknown>;
  return typeof tool.id === 'string'
    && typeof tool.name === 'string'
    && typeof tool.status === 'string';
}

function toInstalledTools(raw: unknown): { tools: InstalledTool[] } | null {
  return Array.isArray(raw) && raw.every(isInstalledTool) ? { tools: raw } : null;
}

function toInstalledToolLaunchResult(raw: unknown): InstalledToolLaunchResult | null {
  if (raw == null || typeof raw !== 'object') return null;
  const result = raw as Record<string, unknown>;
  if (
    (result.id !== null && typeof result.id !== 'string')
    || typeof result.status !== 'string'
    || (result.reason != null && typeof result.reason !== 'string')
  ) return null;
  return result as InstalledToolLaunchResult;
}

/** Narrow the host payload: numbers stay numbers, missing fields become null.
 *  Invalid (non-numeric) values are replaced with null — never fabricated. */
function toSystemMetrics(raw: unknown): DesktopSystemMetrics | null {
  if (raw == null || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  return {
    cpu: num(m.cpu),
    ram: num(m.ram),
    disk: num(m.disk),
    uptime_s: num(m.uptime_s),
    processes: Array.isArray(m.processes)
      ? m.processes.slice(0, 50).map((p) => {
        const row = p as Record<string, unknown>;
        return {
          pid: typeof row.pid === 'number' ? row.pid : -1,
          name: typeof row.name === 'string' ? row.name : '',
          status: typeof row.status === 'string' ? row.status : null,
        };
      })
      : null,
  };
}

function createPywebviewBridge(api: PywebviewApi): NexusDesktopBridge {
  return {
    available: true,
    appInfo: () => call(api, 'app_info', [], null),
    pickImage: () => call(api, 'pick_image', [], null),
    saveText: (filename, text) => call(api, 'save_text', [filename, text], null),
    openBrowser: (url) => call(api, 'open_browser', [url], false),
    instagramWebState: () => call(api, 'instagram_web_state', [], null).then(toInstagramWebResult),
    instagramWebOpen: () => call(api, 'instagram_web_open', [], null).then(toInstagramWebResult),
    instagramWebClose: () => call(api, 'instagram_web_close', [], null).then(toInstagramWebResult),
    listInstalledTools: async () => {
      if (typeof api.list_installed_tools !== 'function') return null;
      return toInstalledTools(await api.list_installed_tools());
    },
    openInstalledTool: async (toolId) => {
      if (typeof api.open_installed_tool !== 'function') return null;
      return toInstalledToolLaunchResult(await api.open_installed_tool(toolId));
    },
    systemMetrics: async () => {
      if (typeof api.system_metrics !== 'function') return null;
      return toSystemMetrics(await api.system_metrics());
    },
    unrealSceneState: () => call(api, 'unreal_scene_state', [], null),
    // Positional (theme, assistant): keep legacy arg counts so hosts
    // predating NEXUS_SCENE_ASSISTANT still see the old call shape.
    unrealSceneOpen: (theme, assistant) =>
      call(api, 'unreal_scene_open',
        assistant != null ? [theme ?? null, assistant]
          : theme != null ? [theme] : [], null),
    unrealSceneSetActive: (assistant) =>
      call(api, 'unreal_scene_set_active', [assistant], null),
    // Python→JS push: the host dispatches a DOM CustomEvent through
    // evaluate_js — subscribing is a plain window listener here.
    unrealSceneSubscribe: (onState) => {
      const handler = (ev: Event) => {
        const detail = (ev as CustomEvent<unknown>).detail;
        if (detail != null && typeof detail === 'object') {
          onState(detail as Parameters<typeof onState>[0]);
        }
      };
      window.addEventListener(SCENE_STATE_EVENT, handler);
      return () => window.removeEventListener(SCENE_STATE_EVENT, handler);
    },
    // Обратные события сцены (VII V3-1): тот же evaluate_js-канал,
    // payload verbatim — поля события словарь хоста, не UI.
    unrealSceneEvents: (onEvent) => {
      const handler = (ev: Event) => {
        const detail = (ev as CustomEvent<unknown>).detail;
        if (detail != null && typeof detail === 'object') {
          onEvent(detail as Parameters<typeof onEvent>[0]);
        }
      };
      window.addEventListener(SCENE_EVENT_EVENT, handler);
      return () => window.removeEventListener(SCENE_EVENT_EVENT, handler);
    },
    setTitle: (title) => call(api, 'set_title', [title], false),
    setFullscreen: (on) => call(api, 'set_fullscreen', [on], false),
    toggleFullscreen: () => call(api, 'toggle_fullscreen', [], false),
    minimize: () => call(api, 'minimize', [], false),
    closeWindow: () => call(api, 'close_window', [], false),
    setBounds: (x, y, width, height) => call(api, 'set_bounds', [x, y, width, height], false),
    toggleMaximize: () => call(api, 'toggle_maximize', [], null),
    notify: (title, message) => call(api, 'notify', [title, message], false),
    isFrameless: () => call(api, 'is_frameless', [], false),
    setWindowOpacity: (alpha) => call(api, 'set_window_opacity', [alpha], false),
    getWindowOpacity: () => call(api, 'get_window_opacity', [], null),
    emit: (name, payload) => call(api, 'emit', [name, payload], false),
  };
}

/** Синхронный вариант: мост только если api уже инжектирован — иначе null.
 *  Нужен, чтобы хром окна (тайтлбар) рендерился с первого кадра без
 *  async-детекта при перемонтировании шелла (full-page nav). */
export function getDesktopBridgeSync(): NexusDesktopBridge | null {
  const api = apiOf();
  return api ? createPywebviewBridge(api) : null;
}

/** Ленивый мост: api читается в момент вызова каждого метода, а не при
 *  создании. Позволяет рендерить хром окна до завершения async-детекта:
 *  до инъекции pywebview.api вызовы возвращают fallback, после — работают.
 *  `available` отражает детект на момент создания и не меняется —
 *  живая замена приходит через getDesktopBridge/setBridge. */
export function getDesktopBridgeLazy(): NexusDesktopBridge {
  const lazyCall = <T>(method: keyof PywebviewApi, args: unknown[], fallback: T): Promise<T> =>
    call(apiOf(), method, args, fallback);
  return {
    available: apiOf() != null,
    appInfo: () => lazyCall('app_info', [], null),
    pickImage: () => lazyCall('pick_image', [], null),
    saveText: (filename, text) => lazyCall('save_text', [filename, text], null),
    openBrowser: (url) => lazyCall('open_browser', [url], false),
    instagramWebState: () => lazyCall('instagram_web_state', [], null).then(toInstagramWebResult),
    instagramWebOpen: () => lazyCall('instagram_web_open', [], null).then(toInstagramWebResult),
    instagramWebClose: () => lazyCall('instagram_web_close', [], null).then(toInstagramWebResult),
    listInstalledTools: async () => {
      const api = apiOf();
      if (typeof api?.list_installed_tools !== 'function') return null;
      return toInstalledTools(await api.list_installed_tools());
    },
    openInstalledTool: async (toolId) => {
      const api = apiOf();
      if (typeof api?.open_installed_tool !== 'function') return null;
      return toInstalledToolLaunchResult(await api.open_installed_tool(toolId));
    },
    systemMetrics: async () => {
      const api = apiOf();
      if (typeof api?.system_metrics !== 'function') return null;
      return toSystemMetrics(await api.system_metrics());
    },
    unrealSceneState: () => lazyCall('unreal_scene_state', [], null),
    unrealSceneOpen: (theme, assistant) =>
      lazyCall('unreal_scene_open',
        assistant != null ? [theme ?? null, assistant]
          : theme != null ? [theme] : [], null),
    unrealSceneSetActive: (assistant) =>
      lazyCall('unreal_scene_set_active', [assistant], null),
    unrealSceneSubscribe: (onState) => {
      const handler = (ev: Event) => {
        const detail = (ev as CustomEvent<unknown>).detail;
        if (detail != null && typeof detail === 'object') {
          onState(detail as Parameters<typeof onState>[0]);
        }
      };
      window.addEventListener(SCENE_STATE_EVENT, handler);
      return () => window.removeEventListener(SCENE_STATE_EVENT, handler);
    },
    unrealSceneEvents: (onEvent) => {
      const handler = (ev: Event) => {
        const detail = (ev as CustomEvent<unknown>).detail;
        if (detail != null && typeof detail === 'object') {
          onEvent(detail as Parameters<typeof onEvent>[0]);
        }
      };
      window.addEventListener(SCENE_EVENT_EVENT, handler);
      return () => window.removeEventListener(SCENE_EVENT_EVENT, handler);
    },
    setTitle: (title) => lazyCall('set_title', [title], false),
    setFullscreen: (on) => lazyCall('set_fullscreen', [on], false),
    toggleFullscreen: () => lazyCall('toggle_fullscreen', [], false),
    minimize: () => lazyCall('minimize', [], false),
    closeWindow: () => lazyCall('close_window', [], false),
    setBounds: (x, y, width, height) => lazyCall('set_bounds', [x, y, width, height], false),
    toggleMaximize: () => lazyCall('toggle_maximize', [], null),
    notify: (title, message) => lazyCall('notify', [title, message], false),
    isFrameless: () => lazyCall('is_frameless', [], false),
    setWindowOpacity: (alpha) => lazyCall('set_window_opacity', [alpha], false),
    getWindowOpacity: () => lazyCall('get_window_opacity', [], null),
    emit: (name, payload) => lazyCall('emit', [name, payload], false),
  };
}

/**
 * Async detection of the desktop bridge.
 *
 * Waits up to `options.timeoutMs` (default 1500 ms) for the `pywebviewready`
 * DOM event, then returns either a live bridge (if pywebview is present)
 * or a safe browser‑only fallback (available = false). The result is
 * memoized for the lifetime of the page.
 */
export async function getDesktopBridge(
  options: GetDesktopBridgeOptions = {},
): Promise<NexusDesktopBridge> {
  // Already injected? Use it immediately.
  const live = apiOf();
  if (live != null) return createPywebviewBridge(live);

  // Otherwise wait for the ready event.
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ready = await new Promise<boolean>((resolve) => {
    let settled = false;
    // document может отсутствовать (node-контур тестов без jsdom) или быть
    // уже разобранным, когда срабатывает timeout — доступ только через doc.
    const doc = typeof document !== 'undefined' ? document : null;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timer);
      doc?.removeEventListener(READY_EVENT, listener);
      resolve(ok);
    };
    // pywebviewready летит на document (evaluate_js хоста); пустой api:{} —
    // ещё не готовность, поэтому на событие перепроверяем apiOf, а не верим.
    const listener = () => { if (apiOf() != null) done(true); };
    doc?.addEventListener(READY_EVENT, listener);
    // api.js и finish.js могут доехать без события вовсе — опрашиваем api
    // каждые 50 мс внутри окна ожидания.
    const poll = setInterval(() => { if (apiOf() != null) done(true); }, 50);
    const timer = setTimeout(() => done(false), timeoutMs);
  });
  if (ready) {
    const refreshed = apiOf();
    if (refreshed != null) return createPywebviewBridge(refreshed);
  }
  // No pywebview after timeout → fall back to browser‑only bridge.
  return createBrowserBridge();
}