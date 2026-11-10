import type { DataFreshness } from '@nexus/ui';
import type { UsageSummary } from '@nexus/mock-data';
import type { PatternState } from '../agents/agent-types';
import styles from './models.module.css';

export interface ModelPerformanceProps {
  usage: UsageSummary | null;
  state?: PatternState;
  freshness?: DataFreshness;
  title?: string;
}

/**
 * Model/preset performance — honest arithmetic from /v1/usage: runs, cost,
 * derived $/run. No latency or success-rate invention (server doesn't send
 * per-config rates — only totals and breakdown).
 */
export function ModelPerformance({ usage, state = 'ready', freshness, title = 'Использование' }: ModelPerformanceProps) {
  return (
    <section
      className={styles.root}
      data-state={state}
      data-freshness={freshness}
      data-testid="model-performance"
      aria-label={title}
    >
      <h3 className={styles.title}>{title}</h3>
      {state === 'loading' && <p className={styles.muted}>Загрузка статистики…</p>}
      {state === 'error' && <p className={styles.muted}>Статистика недоступна.</p>}
      {state === 'empty' && <p className={styles.muted}>За период запусков нет.</p>}
      {(state === 'ready' || state === 'stale') && usage && (
        <>
          <p className={styles.muted}>
            {usage.period}: {usage.runsTotal} запусков · ${usage.costUsd.toFixed(2)} ·
            {' '}timeout {usage.runsTimeout} · ошибок {usage.runsFailed} · отменено {usage.runsCancelled}
          </p>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Пресет</th>
                <th className={styles.th}>Запусков</th>
                <th className={styles.th}>Стоимость</th>
                <th className={styles.th}>$/запуск</th>
              </tr>
            </thead>
            <tbody>
              {usage.breakdown.map((b) => (
                <tr key={b.config}>
                  <td className={styles.td}><span className={styles.rowName}>{b.config}</span></td>
                  <td className={styles.td}>{b.runs}</td>
                  <td className={styles.td}>${b.costUsd.toFixed(2)}</td>
                  <td className={styles.td}>{b.runs > 0 ? `$${(b.costUsd / b.runs).toFixed(3)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
