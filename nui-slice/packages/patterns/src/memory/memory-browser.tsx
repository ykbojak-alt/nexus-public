import type { DataFreshness } from '@nexus/ui';
import type { MemoryItem, MemorySearchHit, MemoryStructure } from '@nexus/mock-data';
import type { PatternState } from '../agents/agent-types';
import styles from './memory.module.css';

export interface MemoryBrowserProps {
  items: MemoryItem[];
  state?: PatternState;
  /** Search mode — pass hits + the query that produced them. */
  query?: string | null;
  onSearch?: (query: string) => void;
  /** Client-computed structure — recent window only (missing-api §2.5). */
  structure?: MemoryStructure | null;
  freshness?: DataFreshness;
  selectedId?: number | null;
  onSelect?: (id: number) => void;
  title?: string;
}

function isHit(item: MemoryItem): item is MemorySearchHit {
  return typeof (item as MemorySearchHit).score === 'number';
}

/**
 * Memory browser — item list with optional scoped search and an honest
 * "recent window" structure summary. Selection is a callback only.
 */
export function MemoryBrowser({
  items, state = 'ready', query, onSearch, structure, freshness, selectedId, onSelect, title = 'Память',
}: MemoryBrowserProps) {
  const searching = query != null && query.length > 0;
  return (
    <section
      className={styles.root}
      data-state={state}
      data-freshness={freshness}
      data-testid="memory-browser"
      aria-label={title}
    >
      <div className={styles.head}>
        <h3 className={styles.title}>{title}</h3>
        {onSearch && (
          <input
            className={styles.search}
            type="search"
            placeholder="Поиск по памяти…"
            defaultValue={query ?? ''}
            aria-label="Поиск по памяти"
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSearch((e.target as HTMLInputElement).value);
            }}
          />
        )}
      </div>
      {structure && !searching && (
        <p className={styles.muted} data-testid="memory-structure">
          {structure.project}: {structure.total} записей · окно {structure.perDay.map((d) => `${d.day} — ${d.count}`).join(', ')}
          {' · '}источники {structure.sources.map((s) => `${s.name} ${s.count}`).join(', ')}
        </p>
      )}
      {state === 'loading' && <p className={styles.muted}>Чтение памяти…</p>}
      {state === 'error' && <p className={styles.muted}>Память недоступна.</p>}
      {state === 'empty' && (
        <p className={styles.muted}>{searching ? `По запросу «${query}» ничего нет.` : 'Записей нет.'}</p>
      )}
      {(state === 'ready' || state === 'stale') && (
        <ul className={styles.list} tabIndex={0}>
          {items.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className={styles.row}
                data-selected={selectedId === m.id}
                onClick={() => onSelect?.(m.id)}
              >
                <span className={styles.rowMain}>
                  <span className={styles.rowText}>{m.text}</span>
                  <span className={styles.rowSub}>
                    #{m.id} · {m.project}
                    {isHit(m) ? ` · score ${m.score.toFixed(2)}` : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
