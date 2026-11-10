import type { MemoryItem } from '@nexus/mock-data';
import type { PatternState } from '../agents/agent-types';
import styles from './memory.module.css';

export interface MemoryInspectorProps {
  item: MemoryItem | null;
  state?: PatternState;
  /** DELETE /v1/memory/{id} — callback, pattern never fetches. */
  onDelete?: (id: number) => void;
  /** UTC seconds epoch → display string; injected so tests stay deterministic. */
  formatTs?: (ts: number) => string;
  title?: string;
}

const defaultFmt = (ts: number) => new Date(ts * 1000).toLocaleString('ru-RU');

/**
 * Memory inspector — read + delete only. The edit affordance is absent on
 * purpose: server has no PATCH /v1/memory/{id} (missing-api-list §2.2) and
 * the UI must not pretend otherwise.
 */
export function MemoryInspector({ item, state = 'ready', onDelete, formatTs = defaultFmt, title = 'Запись' }: MemoryInspectorProps) {
  return (
    <section className={styles.root} data-state={state} data-testid="memory-inspector" aria-label={title}>
      <h3 className={styles.title}>{title}</h3>
      {state === 'loading' && <p className={styles.muted}>Открытие записи…</p>}
      {state === 'error' && <p className={styles.muted}>Запись недоступна.</p>}
      {(state === 'empty' || (state === 'ready' && item == null)) && (
        <p className={styles.muted}>Выберите запись слева или из графа.</p>
      )}
      {(state === 'ready' || state === 'stale') && item && (
        <>
          <p className={styles.itemText}>{item.text}</p>
          <dl className={styles.facts}>
            <dt>ID</dt>
            <dd>#{item.id}</dd>
            <dt>Проект</dt>
            <dd>{item.project}</dd>
            <dt>Создана</dt>
            <dd>{formatTs(item.createdAt)}</dd>
          </dl>
          <div className={styles.formRow}>
            {onDelete && (
              <button type="button" className={styles.danger} onClick={() => onDelete(item.id)}>
                Удалить запись
              </button>
            )}
            <span className={styles.muted}>Редактирование не поддерживается API памяти.</span>
          </div>
        </>
      )}
    </section>
  );
}
