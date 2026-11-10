'use client';

/**
 * W34: Diagnostics drawer — правый collapsible-drawer с диагностикой core.
 *
 * Автономен: слушает клавишу `d` (без модификаторов, не в input) и
 * CustomEvent `nexus:diag-toggle` (кнопка «Diag» в HealthPanel).
 * Данные — GET /api/core/diag (bridge.diag), поллинг каждые 2с пока открыт.
 */

import { useEffect, useRef, useState } from 'react';
import type { CoreDiag, NewfBridge } from './newf-live';
import styles from './newf-agents-panel.module.css';

export const DIAG_TOGGLE_EVENT = 'nexus:diag-toggle';
export const DIAG_POLL_MS = 2000;

export interface DiagDrawerProps {
  bridge: NewfBridge;
  pollMs?: number;
}

type LoadState = 'loading' | 'ok' | 'offline';

/** Возраст снапшота диагностики, сек (now − ts). */
export function diagAge(ts: number, now: number = Date.now() / 1000): string {
  if (!ts || !Number.isFinite(ts)) return '—';
  const age = Math.max(0, now - ts);
  if (age < 60) return `${Math.floor(age)}s`;
  if (age < 3600) return `${Math.floor(age / 60)}m`;
  return `${Math.floor(age / 3600)}h`;
}

export function DiagDrawer({ bridge, pollMs = DIAG_POLL_MS }: DiagDrawerProps) {
  const [open, setOpen] = useState(false);
  const [diag, setDiag] = useState<CoreDiag | null>(null);
  const [load, setLoad] = useState<LoadState>('loading');
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'd' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      setOpen((v) => !v);
    };
    const onToggle = () => setOpen((v) => !v);
    window.addEventListener('keydown', onKey);
    window.addEventListener(DIAG_TOGGLE_EVENT, onToggle as EventListener);
    return () => {
      cancelled.current = true;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(DIAG_TOGGLE_EVENT, onToggle as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!bridge.diag) { setLoad('offline'); return; }
    let inflight = false;
    const tick = async () => {
      if (inflight) return;
      inflight = true;
      try {
        const data = await bridge.diag!();
        if (cancelled.current) return;
        setDiag(data);
        setLoad('ok');
      } catch {
        if (!cancelled.current) setLoad('offline');
      } finally {
        inflight = false;
      }
    };
    void tick();
    const id = setInterval(() => void tick(), pollMs);
    return () => clearInterval(id);
  }, [open, bridge, pollMs]);

  if (!open) return null;

  const age = diag ? diagAge(diag.ts) : '—';
  const stale = diag !== null && Date.now() / 1000 - diag.ts > 15;

  return (
    <div className={styles.diagDrawer} data-testid="diag-drawer" role="dialog" aria-label="Diag">
      <header className={styles.diagHeader}>
        <h3 className={styles.groupTitle}>DIAG</h3>
        <button type="button" className={styles.filterChip} data-testid="diag-close" aria-label="Закрыть Diag" onClick={() => setOpen(false)}>×</button>
      </header>

      {load === 'offline' ? (
        <p className={styles.offline} role="alert">diag unavailable{diag ? ' · showing last snapshot' : ''}</p>
      ) : null}

      {/* health: pump/drain alive + age */}
      <section className={styles.group} aria-label="Health">
        <h4 className={styles.diagSectionTitle}>HEALTH</h4>
        <div className={styles.diagRow}>
          <span className={`${styles.healthCell} ${diag?.health.pump_alive ? styles.healthOk : styles.healthBad}`} data-testid="diag-pump">
            pump {diag ? (diag.health.pump_alive ? 'alive' : 'dead') : '…'} · age {age}
          </span>
          <span className={`${styles.healthCell} ${diag?.health.drain_alive ? styles.healthOk : styles.healthBad}`} data-testid="diag-drain">
            drain {diag ? (diag.health.drain_alive ? 'alive' : 'dead') : '…'} · age {age}
          </span>
        </div>
        {stale && <p className={styles.empty} data-testid="diag-stale">snapshot stale</p>}
      </section>

      {/* stats-сводка */}
      <section className={styles.group} aria-label="Stats">
        <h4 className={styles.diagSectionTitle}>STATS</h4>
        <div className={styles.diagRow}>
          <span className={styles.healthCell} data-testid="diag-stats">sent {diag?.stats.sent ?? '—'} · failed {diag?.stats.failed ?? '—'} · dead {diag?.stats.dead ?? '—'} · pending {diag?.stats.pending ?? '—'}</span>
          <span className={styles.healthCell} data-testid="diag-terminals">terminals {diag?.terminals.live ?? '—'} live / {diag?.terminals.total ?? '—'} total / {diag?.terminals.exited ?? '—'} exited</span>
          <span className={styles.healthCell} data-testid="diag-misc">spaces {diag?.spaces ?? '—'} · events {diag?.events_total ?? '—'}</span>
        </div>
      </section>

      {/* alerts-count */}
      <section className={styles.group} aria-label="Alerts">
        <h4 className={styles.diagSectionTitle}>ALERTS</h4>
        <span className={styles.healthCell} data-testid="diag-alerts">rules {diag?.alerts.rules ?? '—'} · history {diag?.alerts.history_count ?? '—'}</span>
      </section>

      {/* config-таблица (scroll) */}
      <section className={styles.group} aria-label="Config">
        <h4 className={styles.diagSectionTitle}>CONFIG</h4>
        <div className={styles.diagTableWrap}>
          <table className={styles.diagTable} data-testid="diag-config">
            <tbody>
              <tr><th>version</th><td>{diag?.version ?? '—'}</td></tr>
              <tr><th>uptime_s</th><td>{diag?.uptime_s ?? '—'}</td></tr>
              <tr><th>pump_interval_s</th><td>{diag?.config.pump_interval_s ?? '—'}</td></tr>
              <tr><th>rate_limit</th><td>{diag?.config.rate_limit ?? '—'}</td></tr>
              <tr><th>scrollback_maxlen</th><td>{diag?.config.scrollback_maxlen ?? '—'}</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default DiagDrawer;
