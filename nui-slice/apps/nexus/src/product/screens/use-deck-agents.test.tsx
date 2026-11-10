import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDeckAgents } from './use-deck-agents';

const STATUS = { connected: true, events_connected: false, version: '0.1.18', uptime_s: 5, terminals: 6, machines: 1, events_seq: 100, session: 'nx-deck' };
const AGENTS = { agents: [{ address: 't3', name: 'AGENT-A', state: 'working', agent_state: 'working', turn: 7, machine: 'local' }] };

const encoder = new TextEncoder();
const sseFrame = (data: unknown) => `event:nx\ndata:${JSON.stringify(data)}\n\n`;
const nxEvent = (params: Record<string, unknown>, envelopeSeq = 1) => ({
  seq: envelopeSeq, ts: Date.now(),
  event: { method: 'event', params },
});

/** fetch-роутер: json-эндпоинты + /events как живой SSE-поток. */
function mockFetch(routes: {
  status?: unknown; agents?: unknown; eventsFrames?: unknown[]; eventsStatus?: number;
}) {
  const calls: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/api/deck/events')) {
      const status = routes.eventsStatus ?? 200;
      if (status !== 200) return new Response('nf', { status });
      const frames = (routes.eventsFrames ?? []).map((f) => encoder.encode(sseFrame(f)));
      const stream = new ReadableStream<Uint8Array>({
        start(c) { for (const f of frames) c.enqueue(f); /* поток остаётся открытым */ },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    const body = url.includes('/status') ? routes.status : url.includes('/agents') ? routes.agents : undefined;
    if (body === undefined) return new Response('nf', { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return { fn, calls };
}

describe('useDeckAgents', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('snapshot → conn ok + agents, same-origin относительные URL', async () => {
    const { fn, calls } = mockFetch({ status: STATUS, agents: AGENTS });
    vi.stubGlobal('fetch', fn);
    const { result } = renderHook(() => useDeckAgents(''));
    await waitFor(() => expect(result.current.conn).toBe('ok'));
    expect(result.current.agents).toHaveLength(1);
    expect(result.current.agents?.[0].address).toBe('t3');
    // Same-origin гарантия: относительные пути, без hostname (Caddy :4436→:4433).
    expect(calls).toContain('/api/deck/status');
    expect(calls).toContain('/api/deck/agents');
    expect(calls.every((u) => u.startsWith('/api/deck/'))).toBe(true);
  });

  it('connected=false → offline, agents не фабрикуются как live', async () => {
    const { fn } = mockFetch({ status: { ...STATUS, connected: false }, agents: AGENTS });
    vi.stubGlobal('fetch', fn);
    const { result } = renderHook(() => useDeckAgents(''));
    await waitFor(() => expect(result.current.conn).toBe('offline'));
  });

  it('status fetch fail → offline + error, agents=null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net down'); }));
    const { result } = renderHook(() => useDeckAgents(''));
    await waitFor(() => expect(result.current.conn).toBe('offline'));
    expect(result.current.error).toBe('net down');
    expect(result.current.agents).toBeNull();
  });

  it('SSE: params.seq in-order + envelope seq огромный → НЕТ resync (envelope игнорируется)', async () => {
    const live = { ...STATUS, events_connected: true };
    const { fn, calls } = mockFetch({
      status: live, agents: AGENTS,
      eventsFrames: [nxEvent({ type: 'title', seq: 101, terminal: 't3', data: {} }, 999999)],
    });
    vi.stubGlobal('fetch', fn);
    const { result } = renderHook(() => useDeckAgents(''));
    await waitFor(() => expect(result.current.sseLive).toBe(true), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 600)); // окно для возможного resync (debounce 250ms)
    const statusCalls = calls.filter((u) => u.includes('/status')).length;
    expect(statusCalls).toBe(1); // только начальный snapshot — envelope seq не триггернул
  });

  it('SSE: params.seq gap (title) → forced resync; params.seq — единственный драйвер', async () => {
    const live = { ...STATUS, events_connected: true };
    const { fn, calls } = mockFetch({
      status: live, agents: AGENTS,
      // lastSeq seeded = 100; params.seq=105 → пропуск 101..104 → resync.
      // envelope seq=2 крошечный — если бы читался envelope, тоже resync,
      // но case выше доказывает что envelope игнорируется.
      eventsFrames: [nxEvent({ type: 'title', seq: 105, terminal: 't3', data: {} }, 2)],
    });
    vi.stubGlobal('fetch', fn);
    const { result } = renderHook(() => useDeckAgents(''));
    await waitFor(() => expect(result.current.sseLive).toBe(true), { timeout: 3000 });
    await waitFor(() => {
      const statusCalls = calls.filter((u) => u.includes('/status')).length;
      expect(statusCalls).toBeGreaterThanOrEqual(2);
    }, { timeout: 3000 });
  });

  it('SSE: method=missed → resync', async () => {
    const live = { ...STATUS, events_connected: true };
    const { fn, calls } = mockFetch({
      status: live, agents: AGENTS,
      eventsFrames: [{ seq: 7, ts: Date.now(), event: { method: 'missed', params: { seq: 100 } } }],
    });
    vi.stubGlobal('fetch', fn);
    const { result } = renderHook(() => useDeckAgents(''));
    await waitFor(() => expect(result.current.sseLive).toBe(true), { timeout: 3000 });
    await waitFor(() => {
      expect(calls.filter((u) => u.includes('/status')).length).toBeGreaterThanOrEqual(2);
    }, { timeout: 3000 });
  });
});
