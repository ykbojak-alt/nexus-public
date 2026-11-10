'use client';

/**
 * NEXUS CRAFT seam — клиент к craft-bridge через same-origin proxy
 * `/api/craft/*` (src/app/api/craft/[...path]/route.ts). Bearer-токен живёт
 * на сервере; клиент ходит без креденшелов. Недоступность моста → reject
 * с кодом ошибки прокси/бриджа: экраны показывают honest unavailable,
 * мок не имитирует живой контракт.
 *
 * Контракт: packages/bridge/MVP_PLAN.md §1; wire — docs/control-protocol.md.
 * Live shapes (commands registry, pending, ui.documents) до LIVE_PROBE —
 * ожидаемые, seam разворачивает только подтверждённые обёртки.
 */

/** Элемент реестра команд (ожидаемая форма engine.commands — до live probe). */
export interface CraftCommandInfo {
  id: string;
  label?: string;
  enabled?: boolean;
  tab?: string;
  panel?: string;
}

/** control.pending — connection-local состояние (protocol §pending). */
export type CraftPendingResult =
  | { pending: null }
  | { pending: number; method?: string; done: false }
  | { done: true; reply: unknown };

/** Исход POST /execute|/export|/design/new — 202 ≠ ошибка (MVP_PLAN §5). */
export type CraftExecOutcome =
  | { kind: 'done'; result: unknown }
  | { kind: 'running'; operation: { id: number; method: string }; poll: string }
  | { kind: 'busy' };

export interface CraftHealth {
  ok: boolean;
  service?: string;
  /** Присутствует при запросе `?upstream=1`; 'ok' — control-канал отвечает. */
  upstream?: 'ok' | 'down';
}

export interface CraftSeam {
  health(): Promise<CraftHealth>;
  inspect(): Promise<Record<string, unknown>>;
  listCommands(): Promise<CraftCommandInfo[]>;
  pending(): Promise<CraftPendingResult>;
  running(): Promise<unknown[]>;
  execute(command: string, params?: Record<string, unknown>): Promise<CraftExecOutcome>;
  exportFile(path: string): Promise<CraftExecOutcome>;
  designNew(): Promise<unknown>;
}

/** Ошибка seam: `code` — machine-код моста/прокси verbatim (unauthorized,
 *  adapter_busy, gateway_timeout, bridge_unreachable, bridge_not_configured…). */
export class CraftSeamError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
    public readonly status = 0,
  ) {
    super(message ?? code);
    this.name = 'CraftSeamError';
  }
}

/** > proxy 70s > bridge back-stop 65s: таймаут верхнего слоя — чистый back-stop. */
const DEFAULT_TIMEOUT_MS = 75_000;

interface WireBody {
  ok?: boolean;
  error?: string;
  result?: unknown;
  running?: boolean;
  operation?: { id: number; method: string };
  poll?: string;
  [key: string]: unknown;
}

async function callBridge(
  base: string,
  path: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ status: number; body: WireBody }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { accept: 'application/json', ...(init?.headers as Record<string, string>) },
    });
    const body = (await res.json().catch(() => null)) as WireBody | null;
    return { status: res.status, body: body ?? {} };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new CraftSeamError('gateway_timeout', 'proxy request timed out', 504);
    }
    throw new CraftSeamError('bridge_unreachable', e instanceof Error ? e.message : 'fetch failed', 502);
  } finally {
    clearTimeout(timer);
  }
}

function execOutcome(status: number, body: WireBody): CraftExecOutcome {
  if (status === 200 && body.ok === true) return { kind: 'done', result: body.result ?? null };
  if (status === 202 || body.running === true) {
    return {
      kind: 'running',
      operation: body.operation ?? { id: 0, method: '' },
      poll: typeof body.poll === 'string' ? body.poll : '/pending',
    };
  }
  if (status === 429 || body.error === 'adapter_busy') return { kind: 'busy' };
  throw new CraftSeamError(
    typeof body.error === 'string' ? body.error : `http_${status}`,
    undefined,
    status,
  );
}

function okResult(status: number, body: WireBody): unknown {
  if (status === 200 && body.ok === true) return body.result ?? null;
  if (status === 429 || body.error === 'adapter_busy') throw new CraftSeamError('adapter_busy', undefined, status);
  throw new CraftSeamError(
    typeof body.error === 'string' ? body.error : `http_${status}`,
    undefined,
    status,
  );
}

function unwrapCommands(result: unknown): CraftCommandInfo[] {
  const list = Array.isArray(result)
    ? result
    : Array.isArray((result as { commands?: unknown[] } | null)?.commands)
      ? (result as { commands: unknown[] }).commands
      : [];
  return list
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
    .map((c) => ({
      id: String(c.id ?? c.name ?? ''),
      label: typeof c.label === 'string' ? c.label : undefined,
      enabled: typeof c.enabled === 'boolean' ? c.enabled : undefined,
      tab: typeof c.tab === 'string' ? c.tab : undefined,
      panel: typeof c.panel === 'string' ? c.panel : undefined,
    }))
    .filter((c) => c.id.length > 0);
}

/** Same-origin seam: baseUrl по умолчанию — путь proxy внутри приложения. */
export function createCraftSeam(baseUrl = '/api/craft'): CraftSeam {
  const base = baseUrl.replace(/\/+$/, '');
  const post = (path: string, payload: unknown, timeoutMs?: number) =>
    callBridge(base, path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }, timeoutMs);

  return {
    async health() {
      const { status, body } = await callBridge(base, '/health?upstream=1');
      if (status === 200 && body.ok === true) {
        return { ok: true, service: typeof body.service === 'string' ? body.service : undefined,
          upstream: body.upstream === 'ok' || body.upstream === 'down' ? body.upstream : undefined };
      }
      throw new CraftSeamError(typeof body.error === 'string' ? body.error : `http_${status}`, undefined, status);
    },
    async inspect() {
      const { status, body } = await callBridge(base, '/inspect');
      return (okResult(status, body) ?? {}) as Record<string, unknown>;
    },
    async listCommands() {
      const { status, body } = await callBridge(base, '/commands');
      return unwrapCommands(okResult(status, body));
    },
    async pending() {
      const { status, body } = await callBridge(base, '/pending');
      return (okResult(status, body) ?? { pending: null }) as CraftPendingResult;
    },
    async running() {
      const { status, body } = await callBridge(base, '/status');
      const result = okResult(status, body) as { running?: unknown[] } | unknown[] | null;
      return Array.isArray(result) ? result : (result?.running ?? []);
    },
    async execute(command, params = {}) {
      const { status, body } = await post('/execute', { command, params });
      return execOutcome(status, body);
    },
    async exportFile(path) {
      const { status, body } = await post('/export', { command: 'file.export', params: { path } });
      return execOutcome(status, body);
    },
    async designNew() {
      const { status, body } = await post('/design/new', {});
      return okResult(status, body);
    },
  };
}
