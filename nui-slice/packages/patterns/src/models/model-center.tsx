import type { ModelInfo } from '@nexus/mock-data';
import type { PatternState } from '../agents/agent-types';
import { modelFreeLabel } from './model-map';
import styles from './models.module.css';

export interface ModelCenterProps {
  models: ModelInfo[];
  state?: PatternState;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  title?: string;
}

/**
 * Model center — registry of known model ids. `free: null` renders as an
 * honest unknown, never a fabricated price claim.
 * Заголовок секции — `h2`: паттерн стоит непосредственно под `h1` экрана
 * (models/settings), `h3` давал axe heading-order (пропуск уровня).
 */
export function ModelCenter({ models, state = 'ready', selectedId, onSelect, title = 'Модели' }: ModelCenterProps) {
  return (
    <section className={styles.root} data-state={state} data-testid="model-center" aria-label={title}>
      <h2 className={styles.title}>{title}</h2>
      {state === 'loading' && <p className={styles.muted}>Загрузка моделей…</p>}
      {state === 'error' && <p className={styles.muted}>Реестр моделей недоступен.</p>}
      {state === 'empty' && <p className={styles.muted}>Модели не зарегистрированы.</p>}
      {(state === 'ready' || state === 'stale') && (
        <ul className={styles.list}>
          {models.map((m) => {
            const f = modelFreeLabel(m.free);
            return (
              <li key={m.id}>
                <button
                  type="button"
                  className={styles.row}
                  data-selected={selectedId === m.id}
                  onClick={() => onSelect?.(m.id)}
                >
                  <span className={styles.rowMain}>
                    <span className={styles.rowName}>{m.label}</span>
                    <span className={styles.rowSub}>{m.id}</span>
                  </span>
                  {m.isDefault && <span className={styles.tag}>default</span>}
                  <span className={styles.tag} data-free={f.state}>{f.text}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
