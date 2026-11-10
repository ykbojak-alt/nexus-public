'use client';

/**
 * W33: Events-feed панель — дискретный трей событий core.
 *
 * Поллинг GET /api/core/events/since?since=<cursor>&limit=N каждые pollMs
 * (2с по умолчанию); cursor двигается на max(ts) выбранных событий.
 * Кнопки: pause/resume и clear (очистить трей, cursor сохраняется).
 */

import { useEffect, useRef, useState } from 'react';
import type { LiveEvent, NewfBridge } from './newf-live';
import styles from './newf-agents-panel.module.css';

export interface EventsPanelProps {
  bridge: NewfBridge;
  /** Интервал опроса, мс (default 2000). */
  pollMs?: number;
  /** limit на запрос (default 100). */
  limit?: number;
  /** Ограничение трея (default 200). */
  maxEvents?: number;
}

type FeedState = 'loading' | 'ok' | 'offline';

/** unix-секунды → HH:MM:SS (локально). */
export function fmtEventTime(ts?: number): string {
  if (!ts || !Number.isFinite(ts)) return '—';
  return new Date(ts * 1000).toTimeString().slice(0, 8);
}

export function EventsPanel({ bridge, pollMs = 2000, limit = 100, maxEvents = 200 }: EventsPanelProps) {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [state, setState] = useState<FeedState>('loading');
  const cursorRef = useRef(0);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => { cancelled.current = true; };
  }, []);

  useEffect(() => {
    if (!bridge.eventsSince) { setState('offline'); return; }
    let inflight = false;
    const tick = async () => {
      if (paused || inflight) return;
      inflight = true;
      try {
        const res = await bridge.eventsSince!(cursorRef.current, limit);
        if (cancelled.current) return;
        if (res.events.length > 0) {
          setEvents((prev) => [...res.events, ...prev].slice(0, maxEvents));
          if (res.cursor > cursorRef.current) cursorRef.current = res.cursor;
        }
        setState('ok');
      } catch {
        if (!cancelled.current) setState('offline');
      } finally {
        inflight = false;
      }
    };
    void tick();
    const id = setInterval(() => void tick(), pollMs);
    return () => clearInterval(id);
  }, [bridge, paused, limit, pollMs, maxEvents]);

  if (!bridge.eventsSince) {
    return (
      <section className={styles.group} role="region" aria-label="Events" data-testid="events-panel">
        <h3 className={styles.groupTitle}>EVENTS</h3>
        <p className={styles.empty}>eventsSince отсутствует</p>
      </section>
    );
  }

  return (
    <section className={styles.group} role="region" aria-label="Events" data-testid="events-panel">
      <h3 className={styles.groupTitle}>
        EVENTS
        <span className={styles.groupCount} data-testid="ev-count">{events.length}</span>
      </h3>
      <div className={styles.evControls}>
        <button
          type="button"
          className={styles.filterChip}
          data-testid="ev-pause"
          aria-pressed={paused}
          onClick={() => setPaused((v) => !v)}
        >
          {paused ? '▶ пуск' : '⏸ пауза'}
        </button>
        <button
          type="button"
          className={styles.filterChip}
          data-testid="ev-clear"
          onClick={() => setEvents([])}
        >
          🧹 clear
        </button>
        <span className={`${styles.conn} ${state === 'ok' ? styles.connOk : state === 'offline' ? styles.connBad : styles.connDim}`} role="status">
          {state === 'ok' ? 'live' : state === 'offline' ? 'offline' : 'loading…'}
        </span>
      </div>
      {events.length === 0 ? (
        <p className={styles.empty}>no events</p>
      ) : (
        <ul className={styles.list}>
          {events.map((ev, i) => (
            <li key={`${ev.type}-${ev.ts}-${i}`} className={styles.badge} data-testid={`ev-row-${i}`}>
              <span className={styles.evType} data-testid={`ev-type-${i}`}>{String(ev.type ?? 'event')}</span>
              <span className={styles.evTime} data-testid={`ev-time-${i}`}>{fmtEventTime(typeof ev.ts === 'number' ? ev.ts : undefined)}</span>
              <span className={styles.evTerm} data-testid={`ev-term-${i}`}>
                {ev.address != null ? String(ev.address) : ev.term != null ? String(ev.term) : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default EventsPanel;
