'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './newf-nexuslink-panel.module.css';

export const NEXUSLINK_POLL_MS = 300;
export const NEXUSLINK_STATUS_URL = 'https://gateway.example.invalid/api/status';

type JsonRecord = Record<string, unknown>;
type GatewayState = 'loading' | 'online' | 'offline';

interface MetricRow {
  scope: string;
  ok: number;
  fail: number;
  avgMs: number | null;
  lastMs: number | null;
  ageS: number | null;
  note: string;
}

interface KeyHealthRow {
  provider: string;
  ready: boolean;
  benched: boolean;
  exhausted: boolean;
}

interface SlotHealthRow {
  slot: string;
  model: string;
  ready: number | null;
  benched: number | null;
  blocked: number | null;
  candidates: number | null;
  nextReadyInS: number | null;
  exhausted: boolean;
}

interface BlacklistRow {
  entry: string;
  reason: string;
  ttlS: number;
}

interface GatewaySnapshot {
  version: string;
  providers: number;
  slots: number;
  uptimeS: number;
  metrics: MetricRow[];
  keyHealth: KeyHealthRow[];
  slotHealth: SlotHealthRow[];
  blacklist: BlacklistRow[];
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function count(value: unknown): number {
  return Math.max(0, Math.floor(numeric(value) ?? 0));
}

function string(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseSnapshot(input: unknown): GatewaySnapshot {
  const root = record(input);
  if (!root || root.ok !== true) throw new Error('Ответ /api/status не содержит ok=true.');

  const metrics = array(root.metrics).flatMap((raw): MetricRow[] => {
    const row = record(raw);
    if (!row) return [];
    return [{
      scope: string(row.scope),
      ok: count(row.ok),
      fail: count(row.fail),
      avgMs: numeric(row.avg_ms),
      lastMs: numeric(row.last_ms),
      ageS: numeric(row.age_s),
      note: string(row.note),
    }];
  });

  const rawKeyHealth = array(root.keys_health);
  const keyHealth = rawKeyHealth.flatMap((raw): KeyHealthRow[] => {
    const row = record(raw);
    const provider = string(row?.provider).trim();
    if (!row || !provider) return [];
    return [{
      provider,
      ready: row.ready === true,
      benched: row.benched === true,
      exhausted: row.exhausted === true,
    }];
  });

  // Live gateway currently serves `slots_health`; the checked-out Rust source
  // has used `slot_health`. Accept both without inventing availability data.
  const rawSlotHealth = array(root.slots_health ?? root.slot_health);
  const slotHealth = rawSlotHealth.flatMap((raw): SlotHealthRow[] => {
    const row = record(raw);
    if (!row) return [];
    const slot = string(row.slot).trim();
    const model = string(row.model).trim();
    const label = slot || model;
    if (!label) return [];
    return [{
      slot: label,
      model,
      ready: numeric(row.ready),
      benched: numeric(row.benched),
      blocked: numeric(row.blocked),
      candidates: numeric(row.candidates),
      nextReadyInS: numeric(row.next_ready_in_s),
      exhausted: row.exhausted === true,
    }];
  });

  const blacklist = array(root.blacklist).flatMap((raw): BlacklistRow[] => {
    const row = record(raw);
    if (!row) return [];
    return [{
      // Kept only for internal classification; never rendered verbatim.
      entry: string(row.entry),
      reason: string(row.reason),
      ttlS: count(row.ttl_s),
    }];
  });

  return {
    version: string(root.version, '—'),
    providers: count(root.providers),
    slots: count(root.slots),
    uptimeS: count(root.uptime_s),
    metrics,
    keyHealth,
    slotHealth,
    blacklist,
  };
}

function duration(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function elapsed(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function latency(milliseconds: number | null): string {
  if (milliseconds === null) return '—';
  return milliseconds >= 1000 ? `${(milliseconds / 1000).toFixed(1)}s` : `${milliseconds}ms`;
}

function scopeParts(scope: string): { provider: string; model: string } {
  const [provider, model] = scope.split('|');
  return {
    provider: provider?.trim() || 'upstream',
    model: model?.trim() || 'model telemetry',
  };
}

function providerRows(snapshot: GatewaySnapshot) {
  if (snapshot.keyHealth.length > 0) {
    const grouped = new Map<string, { total: number; ready: number; benched: number; exhausted: number }>();
    for (const key of snapshot.keyHealth) {
      const counts = grouped.get(key.provider) ?? { total: 0, ready: 0, benched: 0, exhausted: 0 };
      counts.total += 1;
      if (key.ready) counts.ready += 1;
      if (key.benched) counts.benched += 1;
      if (key.exhausted) counts.exhausted += 1;
      grouped.set(key.provider, counts);
    }
    return [...grouped.entries()].map(([name, counts]) => ({ name, ...counts, requests: null as number | null }));
  }

  const grouped = new Map<string, { total: number; ready: number; benched: number; exhausted: number; requests: number }>();
  for (const metric of snapshot.metrics) {
    const { provider } = scopeParts(metric.scope);
    const row = grouped.get(provider) ?? { total: 0, ready: 0, benched: 0, exhausted: 0, requests: 0 };
    row.total += 1;
    row.requests += metric.ok + metric.fail;
    grouped.set(provider, row);
  }
  return [...grouped.entries()].map(([name, row]) => ({ ...row, name }));
}

function blacklistKind(entry: string): string {
  if (entry.startsWith('key|')) return 'key temporarily blocked';
  if (entry.startsWith('model|')) return 'model route temporarily blocked';
  return 'temporary block';
}

function safeReason(reason: string): string {
  const value = reason.toLowerCase();
  if (value.includes('429') || value.includes('rate')) return 'rate limit';
  if (value.includes('401') || value.includes('403') || value.includes('auth') || value.includes('key')) return 'auth / key failure';
  if (value.includes('402') || value.includes('quota') || value.includes('billing')) return 'quota / billing';
  if (value.includes('404')) return 'unavailable model route';
  return reason ? 'upstream failure' : 'reason unavailable';
}

function slotTone(slot: SlotHealthRow): 'ready' | 'waiting' | 'blocked' {
  if (slot.exhausted || (slot.ready === 0 && slot.benched === 0)) return 'blocked';
  if (slot.ready === 0 && (slot.benched ?? 0) > 0) return 'waiting';
  return 'ready';
}

function slotSummary(slot: SlotHealthRow): string {
  const parts: string[] = [];
  if (slot.ready !== null) parts.push(`${slot.ready} ready`);
  if (slot.benched !== null) parts.push(`${slot.benched} benched`);
  if (slot.blocked !== null) parts.push(`${slot.blocked} blocked`);
  if (slot.candidates !== null) parts.push(`${slot.candidates} candidates`);
  if (slot.nextReadyInS !== null) parts.push(`next in ${slot.nextReadyInS}s`);
  return parts.join(' · ') || 'availability detail unavailable';
}

function ProviderSection({ snapshot }: { snapshot: GatewaySnapshot }) {
  const providers = providerRows(snapshot);
  return (
    <section className={styles.section} aria-labelledby="nexuslink-providers-title">
      <header className={styles.sectionHeader}>
        <h2 id="nexuslink-providers-title">Providers</h2>
        <span className={styles.sectionCount}>{snapshot.providers} configured</span>
      </header>
      {providers.length === 0 ? (
        <p className={styles.empty}>No per-provider health or traffic rows are available.</p>
      ) : (
        <ul className={styles.list}>
          {providers.map((provider) => (
            <li className={styles.row} key={provider.name}>
              <span className={styles.dot} data-state={provider.ready > 0 ? 'ready' : provider.benched > 0 ? 'waiting' : 'unknown'} aria-hidden="true" />
              <span className={styles.rowMain}>
                <strong>{provider.name}</strong>
                <small>
                  {provider.requests === null
                    ? `${provider.ready}/${provider.total} ready · ${provider.benched} benched`
                    : `${provider.requests} observed requests · key health unavailable`}
                </small>
              </span>
              {provider.exhausted > 0 && <span className={styles.dangerText}>{provider.exhausted} exhausted</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function NewfNexusLinkPanel({ pollMs = NEXUSLINK_POLL_MS }: { pollMs?: number }) {
  const [snapshot, setSnapshot] = useState<GatewaySnapshot | null>(null);
  const [state, setState] = useState<GatewayState>('loading');
  const [error, setError] = useState<string | null>(null);
  const providerCount = useMemo(() => snapshot?.providers ?? 0, [snapshot]);

  useEffect(() => {
    let closed = false;
    let pending = false;
    let timer: number | undefined;
    let timeout: number | undefined;
    let controller: AbortController | undefined;

    const poll = async () => {
      if (pending || closed) return;
      pending = true;
      controller = new AbortController();
      timeout = window.setTimeout(() => controller?.abort(), 5000);
      try {
        const response = await fetch(NEXUSLINK_STATUS_URL, {
          method: 'GET',
          mode: 'cors',
          credentials: 'omit',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const next = parseSnapshot(await response.json());
        if (!closed) {
          setSnapshot(next);
          setState('online');
          setError(null);
        }
      } catch (cause) {
        if (!closed) {
          setState('offline');
          setError(cause instanceof Error ? cause.message : 'Network or CORS failure');
        }
      } finally {
        if (timeout !== undefined) window.clearTimeout(timeout);
        pending = false;
        if (!closed) timer = window.setTimeout(() => void poll(), pollMs);
      }
    };

    void poll();
    return () => {
      closed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      if (timeout !== undefined) window.clearTimeout(timeout);
      controller?.abort();
    };
  }, [pollMs]);

  const requestCount = snapshot?.metrics.reduce((total, row) => total + row.ok + row.fail, 0) ?? 0;
  const slotRows = snapshot?.slotHealth ?? [];
  const blacklist = snapshot?.blacklist ?? [];

  return (
    <section className={styles.page} aria-labelledby="nexuslink-page-title" data-testid="newf-nexuslink-panel">
      <header className={styles.hero}>
        <div>
          <p className={styles.kicker}>NEWF / GATEWAY TELEMETRY</p>
          <h1 id="nexuslink-page-title">NexusLink</h1>
          <p className={styles.endpoint}>{NEXUSLINK_STATUS_URL}</p>
        </div>
        <div className={styles.liveBadge} data-state={state} role="status">
          <span className={styles.dot} data-state={state === 'online' ? 'ready' : state === 'offline' ? 'blocked' : 'unknown'} aria-hidden="true" />
          {state === 'online' ? `online · v${snapshot?.version}` : state === 'loading' ? 'connecting…' : 'unavailable'}
        </div>
      </header>

      {state === 'loading' && !snapshot && <p className={styles.notice} role="status">Connecting to the public NexusLink status endpoint…</p>}
      {state === 'offline' && (
        <p className={styles.error} role="alert">
          Status endpoint unavailable: {error ?? 'request failed'}
          {snapshot ? ' · showing last successful snapshot' : ''}
        </p>
      )}

      {!snapshot ? (
        state === 'offline' && <section className={styles.unavailable} aria-label="Unavailable gateway status">
          <strong>No gateway snapshot</strong>
          <p>The panel does not substitute mock provider or request data.</p>
          <p className={styles.endpoint}>{NEXUSLINK_STATUS_URL}</p>
        </section>
      ) : (
        <>
          <section className={styles.metrics} aria-label="Gateway totals">
            <Summary label="PROVIDERS" value={providerCount} />
            <Summary label="REQUESTS" value={requestCount} />
            <Summary label="UPTIME" value={duration(snapshot.uptimeS)} />
            <Summary label="SLOTS" value={snapshot.slots} />
          </section>

          <div className={styles.columns}>
            <div className={styles.leftColumn}>
              <ProviderSection snapshot={snapshot} />
              <section className={styles.section} aria-labelledby="nexuslink-requests-title">
                <header className={styles.sectionHeader}>
                  <h2 id="nexuslink-requests-title">Requests</h2>
                  <span className={styles.sectionCount}>{requestCount} attempts</span>
                </header>
                {snapshot.metrics.length === 0 ? (
                  <p className={styles.empty}>No traffic yet — counters appear after the first request.</p>
                ) : (
                  <ul className={styles.list}>
                    {snapshot.metrics.map((metric, index) => {
                      const { provider, model } = scopeParts(metric.scope);
                      return (
                        <li className={styles.metricRow} key={`${metric.scope}-${index}`}>
                          <span className={styles.rowMain}>
                            <strong>{provider} · {model}</strong>
                            <small>{metric.ok} ok · {metric.fail} errors · avg {latency(metric.avgMs)} · last {latency(metric.lastMs)}</small>
                            {metric.note && <small className={styles.note}>{safeReason(metric.note)}</small>}
                          </span>
                          <time className={styles.age}>{elapsed(metric.ageS)}</time>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>

            <div className={styles.rightColumn}>
              <section className={styles.section} aria-labelledby="nexuslink-slots-title">
                <header className={styles.sectionHeader}>
                  <h2 id="nexuslink-slots-title">Slots</h2>
                  <span className={styles.sectionCount}>{slotRows.length || snapshot.slots} total</span>
                </header>
                {slotRows.length === 0 ? (
                  <p className={styles.empty}>Slot availability detail is not present in this response.</p>
                ) : (
                  <ul className={styles.list}>
                    {slotRows.map((slot) => (
                      <li className={styles.row} key={slot.slot} data-state={slotTone(slot)}>
                        <span className={styles.dot} data-state={slotTone(slot)} aria-hidden="true" />
                        <span className={styles.rowMain}>
                          <strong>{slot.slot}</strong>
                          <small>{slot.model ? `${slot.model} · ` : ''}{slotSummary(slot)}</small>
                        </span>
                        <span className={styles.slotState} data-state={slotTone(slot)}>
                          {slotTone(slot)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className={styles.section} aria-labelledby="nexuslink-blacklist-title">
                <header className={styles.sectionHeader}>
                  <h2 id="nexuslink-blacklist-title">Blacklist</h2>
                  <span className={styles.sectionCount}>{blacklist.length} active</span>
                </header>
                {blacklist.length === 0 ? (
                  <p className={styles.empty}>No active blacklist entries.</p>
                ) : (
                  <ul className={styles.list}>
                    {blacklist.map((entry, index) => (
                      <li className={styles.blacklistRow} key={`${entry.entry}-${index}`}>
                        <span className={styles.dot} data-state="blocked" aria-hidden="true" />
                        <span className={styles.rowMain}>
                          <strong>{blacklistKind(entry.entry)}</strong>
                          <small>{safeReason(entry.reason)}</small>
                        </span>
                        <span className={styles.ttl}>TTL {duration(entry.ttlS)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
          <footer className={styles.footer}>
            <span>Read-only status endpoint · no credentials sent</span>
            <span>poll target {pollMs}ms</span>
          </footer>
        </>
      )}
    </section>
  );
}

function Summary({ label, value }: { label: string; value: number | string }) {
  return (
    <div className={styles.summary}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default NewfNexusLinkPanel;
