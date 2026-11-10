'use client';

/**
 * PHASE-C (docs/farm/PHASE-C-AGENT-CHIP-SPEC.md §3, §5) — slim data-hook для
 * agent-status chip. НЕ импортирует newf-live.ts (1957 строк — shared chunk).
 *
 * Поток: snapshot GET /api/deck/status + /api/deck/agents → SSE
 * /api/deck/events (event:"nx", data{seq,ts,event{method,params}}) →
 * poll 30с пока SSE не жив (events_connected=false / обрывы / offline-retry).
 *
 * Same-origin: base='' по умолчанию → относительные '/api/deck/...' — Caddy
 * на SPA-origin проксирует их на backend (CORS не нужен). base параметр —
 * только для тестов/демо с явным URL.
 *
 * Seq-space: lastSeq живёт ТОЛЬКО в params.seq ядра (core seq-space).
 * Envelope seq (data.seq, per-SSE-session) игнорируется. Seed —
 * status.events_seq из каждого snapshot; missed/gap/restart → resync.
 *
 * Честность: connected=false или сетевой отказ → conn='offline', agents
 * НЕ фабрикуются. 'title'-шум игнорируется; 'missed'/reconnect → resync.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const deckApi = (base: string, p: string) => `${base.replace(/\/$/, '')}/api/deck${p}`;

export interface DeckAgent {
  address: string;
  name: string;
  state: string;
  app?: string;
  agent_state?: string;
  agent_msg?: string;
  turn?: number;
  machine?: string;
  [key: string]: unknown;
}

export interface DeckStatus {
  connected: boolean;
  events_connected: boolean;
  version: string;
  uptime_s: number;
  terminals: number;
  machines: number;
  events_seq: number;
  session: string;
}

export type DeckConn = 'checking' | 'ok' | 'offline';

export interface DeckAgentsData {
  conn: DeckConn;
  status: DeckStatus | null;
  agents: DeckAgent[] | null; // null = ещё не читали, [] = честный пустой roster
  /** SSE жив — события идут; false = poll-режим. */
  sseLive: boolean;
  /** Идёт фоновое обновление (silent refetch по SSE). */
  refreshing: boolean;
  /** Последняя ошибка опроса (для HonestEmpty-подписи). */
  error: string | null;
  /** Ручной resync (missed/reconnect/первичный). */
  refresh: () => void;
}

const TIMEOUT_MS = 8000;
const POLL_MS = 30000;
/** Типы событий, требующие silent refetch; title/heartbeat — шум. */
const RELEVANT = new Set(['status', 'turn', 'created', 'finished', 'lost', 'removed', 'labels']);

function normStatus(raw: unknown): DeckStatus | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const s = (o.status && typeof o.status === 'object' ? o.status : o) as Record<string, unknown>;
  if (typeof s.connected !== 'boolean') return null;
  return {
    connected: s.connected,
    events_connected: s.events_connected === true,
    version: typeof s.version === 'string' ? s.version : '',
    uptime_s: typeof s.uptime_s === 'number' ? s.uptime_s : 0,
    terminals: typeof s.terminals === 'number' ? s.terminals : 0,
    machines: typeof s.machines === 'number' ? s.machines : 0,
    events_seq: typeof s.events_seq === 'number' ? s.events_seq : 0,
    session: typeof s.session === 'string' ? s.session : '',
  };
}

function normAgents(raw: unknown): DeckAgent[] {
  const list = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === 'object' && Array.isArray((raw as { agents?: unknown }).agents)
        ? (raw as { agents: unknown[] }).agents
        : []);
  return (list as Record<string, unknown>[]).map((a) => ({
    address: String(a.address ?? ''),
    name: String(a.name ?? a.address ?? ''),
    state: String(a.state ?? a.agent_state ?? 'unknown'),
    app: a.app != null ? String(a.app) : undefined,
    agent_state: a.agent_state != null ? String(a.agent_state) : undefined,
    agent_msg: a.agent_msg != null ? String(a.agent_msg) : undefined,
    turn: typeof a.turn === 'number' ? a.turn : undefined,
    machine: a.machine != null ? String(a.machine) : undefined,
  }));
}

async function getJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export function useDeckAgents(base = ''): DeckAgentsData {
  const [conn, setConn] = useState<DeckConn>('checking');
  const [status, setStatus] = useState<DeckStatus | null>(null);
  const [agents, setAgents] = useState<DeckAgent[] | null>(null);
  const [sseLive, setSseLive] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const pending = useRef(false);
  const lastSeq = useRef(0);
  const resyncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refresh = useCallback(async (silent = false) => {
    if (inFlight.current) { pending.current = true; return; }
    if (typeof document !== 'undefined' && document.hidden) return;
    inFlight.current = true;
    if (silent) setRefreshing(true); else setConn('checking');
    try {
      const [st, ag] = await Promise.all([getJson(deckApi(base, '/status')), getJson(deckApi(base, '/agents'))]);
      if (!mounted.current) return;
      const s = normStatus(st);
      setStatus(s);
      setAgents(normAgents(ag));
      setError(null);
      setConn(s == null || !s.connected ? 'offline' : 'ok');
      // Reseed seq-якоря из свежего snapshot — core seq-space.
      if (s != null && s.events_seq > 0) lastSeq.current = s.events_seq;
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : String(e));
        setConn('offline');
        if (!silent) { setStatus(null); setAgents(null); }
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setRefreshing(false);
      // Запрос пришёл во время полёта — один отложенный прогон (не теряем).
      if (pending.current) { pending.current = false; void refresh(true); }
    }
  }, [base]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll-fallback: работает только когда SSE не жив (или первый запуск).
  useEffect(() => {
    const tick = () => { if (!sseLive) void refresh(true); };
    const timer = setInterval(tick, POLL_MS);
    // Возврат на вкладку → один catch-up refetch ДАЖЕ при живом SSE
    // (за время сна буфер мог пропустить кадры; poll же молчит при sseLive).
    const onVis = () => { if (!document.hidden) void refresh(true); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVis); };
  }, [sseLive, refresh]);

  // SSE /api/deck/events: snapshot-seq → events; missed/reconnect → resync.
  useEffect(() => {
    if (conn !== 'ok' || status?.events_connected !== true) { setSseLive(false); return; }
    const ctrl = new AbortController();
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const scheduleResync = () => {
      if (resyncTimer.current) clearTimeout(resyncTimer.current);
      resyncTimer.current = setTimeout(() => void refresh(true), 250);
    };
    const connect = async () => {
      try {
        const res = await fetch(deckApi(base, '/events'), { cache: 'no-store', signal: ctrl.signal });
        if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
        if (mounted.current) setSseLive(true);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let cut: number;
          while ((cut = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, cut); buf = buf.slice(cut + 2);
            const data = frame.split('\n').filter((l) => l.startsWith('data:'))
              .map((l) => l.slice(5).replace(/^ /, '')).join('\n');
            if (!data) continue;
            try {
              const p = JSON.parse(data) as Record<string, unknown>;
              const inner = (p.event && typeof p.event === 'object' ? p.event : {}) as Record<string, unknown>;
              const params = (inner.params && typeof inner.params === 'object' ? inner.params : {}) as Record<string, unknown>;
              const method = typeof inner.method === 'string' ? inner.method : '';
              // Только params.seq — core seq-space. data.seq (envelope,
              // per-SSE-session) сознательно игнорируется (QODER review).
              const seq = typeof params.seq === 'number' ? params.seq : 0;
              if (method === 'missed') { scheduleResync(); continue; }
              if (seq > 0 && lastSeq.current > 0) {
                if (seq === lastSeq.current) continue;                    // дубль кадра
                if (seq < lastSeq.current || seq > lastSeq.current + 1) { // рестарт core / пропуск
                  lastSeq.current = seq;
                  scheduleResync();
                  continue;
                }
              }
              if (seq > lastSeq.current) lastSeq.current = seq;
              const type = typeof params.type === 'string' ? params.type : '';
              if (method === 'event' && RELEVANT.has(type)) scheduleResync();
            } catch { /* битый кадр */ }
          }
        }
        throw new Error('events stream ended');
      } catch {
        if (closed) return;
        if (mounted.current) setSseLive(false);
        retry = setTimeout(() => void connect(), 5000);
      }
    };
    void connect();
    return () => { closed = true; if (retry) clearTimeout(retry); if (resyncTimer.current) clearTimeout(resyncTimer.current); ctrl.abort(); };
  }, [conn, status?.events_connected, base, refresh]);

  useEffect(() => {
    mounted.current = true;
    void refresh(false);
    return () => { mounted.current = false; };
  }, [refresh]);

  return { conn, status, agents, sseLive, refreshing, error, refresh: () => void refresh(false) };
}
