import type { DataFreshness } from '@nexus/ui';
import { StatusBadge } from '@nexus/ui';
import type { SystemMetrics } from '@nexus/mock-data';
import type { PatternState } from '../agents/agent-types';
import styles from './settings.module.css';

export interface SystemOverviewProps {
  metrics: SystemMetrics | null;
  state?: PatternState;
  freshness?: DataFreshness;
  title?: string;
}

const HEALTH_STATUS: Record<string, 'complete' | 'warning' | 'error'> = {
  ok: 'complete',
  warn: 'warning',
  error: 'error',
};

function fmtUptime(sec: number | null): string {
  if (sec == null) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}

function Meter({ label, pct }: { label: string; pct: number | null }) {
  return (
    <div className={styles.meter} data-testid={`meter-${label}`}>
      <span className={styles.meterLabel}>{label}</span>
      <span className={styles.meterTrack}>
        {pct != null && <span className={styles.meterFill} style={{ width: `${Math.min(100, pct)}%` }} />}
      </span>
      <span className={styles.meterValue}>{pct != null ? `${pct.toFixed(1)}%` : '—'}</span>
    </div>
  );
}

/**
 * System overview — live metrics with honest nulls (`gpuPct: null` → '—',
 * never 0) and per-component health rows with server detail verbatim.
 */
export function SystemOverview({ metrics, state = 'ready', freshness, title = 'Система' }: SystemOverviewProps) {
  const f = metrics?.freshness ?? freshness;
  return (
    <section
      className={styles.root}
      data-state={state}
      data-freshness={f}
      data-testid="system-overview"
      aria-label={title}
    >
      <h3 className={styles.title}>{title}</h3>
      {state === 'loading' && <p className={styles.muted}>Опрос метрик…</p>}
      {state === 'error' && <p className={styles.muted}>Метрики недоступны.</p>}
      {state === 'empty' && <p className={styles.muted}>Метрик нет.</p>}
      {(state === 'ready' || state === 'stale') && metrics && (
        <>
          <div className={styles.meters}>
            <Meter label="CPU" pct={metrics.cpuPct} />
            <Meter label="RAM" pct={metrics.ramPct} />
            <Meter label="Диск" pct={metrics.diskPct} />
            <Meter label="GPU" pct={metrics.gpuPct} />
          </div>
          <dl className={styles.facts}>
            <dt>Аптайм</dt>
            <dd>{fmtUptime(metrics.uptimeS)}</dd>
            <dt>Вызовы</dt>
            <dd>
              модели {metrics.counters.modelCalls} · инструменты {metrics.counters.toolCalls} ·
              {' '}токены {metrics.counters.tokensIn}↓/{metrics.counters.tokensOut}↑ · ${metrics.counters.costUsd.toFixed(2)}
            </dd>
          </dl>
          <ul className={styles.list}>
            {metrics.health.map((h) => (
              <li key={h.component} className={styles.healthRow}>
                <StatusBadge status={HEALTH_STATUS[h.status] ?? 'info'} label={h.status.toUpperCase()} />
                <span className={styles.rowName}>{h.component}</span>
                {h.detail && <span className={styles.muted}>{h.detail}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
