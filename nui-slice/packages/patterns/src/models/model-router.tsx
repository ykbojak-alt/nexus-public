import type { DataFreshness } from '@nexus/ui';
import type { ModelRouterData } from '@nexus/mock-data';
import type { PatternState } from '../agents/agent-types';
import { routerRows } from './model-map';
import styles from './models.module.css';

export interface ModelRouterProps {
  data: ModelRouterData | null;
  state?: PatternState;
  freshness?: DataFreshness;
  title?: string;
}

/**
 * Model router — tabular view of the same truth the W4 graph draws:
 * preset → role → model edges. `fallback` edges listed and marked.
 */
export function ModelRouter({ data, state = 'ready', freshness, title = 'Маршрутизация' }: ModelRouterProps) {
  const rows = data ? routerRows(data) : [];
  return (
    <section
      className={styles.root}
      data-state={state}
      data-freshness={freshness}
      data-testid="model-router"
      aria-label={title}
    >
      <h3 className={styles.title}>{title}</h3>
      {state === 'loading' && <p className={styles.muted}>Загрузка маршрутов…</p>}
      {state === 'error' && <p className={styles.muted}>Маршруты недоступны.</p>}
      {state === 'empty' && <p className={styles.muted}>Маршрутов нет.</p>}
      {(state === 'ready' || state === 'stale') && (
        <ul className={styles.list}>
          {rows.map((r) => (
            <li key={r.preset} className={styles.routeRow}>
              <span className={styles.rowName}>{r.preset}</span>
              <span className={styles.routeChain}>
                {r.roles.length > 0 ? r.roles.join(' → ') : '—'}
              </span>
              {r.fallbacks.map((f) => (
                <span key={`${f.from}-${f.to}`} className={styles.fallback}>
                  fallback: {f.from} → {f.to}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
