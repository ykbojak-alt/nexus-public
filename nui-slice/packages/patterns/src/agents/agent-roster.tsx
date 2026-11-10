import { StatusBadge } from '@nexus/ui';
import type { AgentRosterItem, PatternState } from './agent-types';
import { presenceBadge } from './status-map';
import styles from './agents.module.css';

const PRESENCE_LABELS: Record<NonNullable<AgentRosterItem['status']>, string> = {
  idle: 'свободен',
  active: 'активен',
  blocked: 'заблокирован',
  offline: 'не в сети',
};

export interface AgentRosterProps {
  items: AgentRosterItem[];
  state?: PatternState;
  selectedName?: string | null;
  /** Selection is a callback — the pattern never navigates or fetches (plan §C-14). */
  onSelect?: (name: string) => void;
  title?: string;
}

/**
 * Agent roster — registry specs with optional live-presence overlay.
 * `name` is the runtime spec (role truth), never a persona label.
 */
export function AgentRoster({ items, state = 'ready', selectedName, onSelect, title = 'Агенты' }: AgentRosterProps) {
  return (
    <section className={styles.root} data-state={state} data-testid="agent-roster" aria-label={title}>
      <h3 className={styles.title}>{title}</h3>
      {state === 'loading' && <p className={styles.muted}>Загрузка реестра…</p>}
      {state === 'error' && <p className={styles.muted}>Не удалось загрузить реестр.</p>}
      {state === 'empty' && <p className={styles.muted}>Агенты не зарегистрированы.</p>}
      {(state === 'ready' || state === 'stale') && (
        <ul
          className={styles.list}
          role="listbox"
          aria-label="Реестр агентов"
          onKeyDown={(e) => {
            // Listbox keyboard contract: arrows/Home/End move DOM focus
            // between options; Enter/Space activate natively (buttons).
            const moves: Record<string, number> = {
              ArrowDown: 1, ArrowUp: -1,
            };
            const options = Array.from(
              e.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'),
            );
            if (options.length === 0) return;
            const current = options.indexOf(document.activeElement as HTMLElement);
            if (e.key === 'Home' || e.key === 'End') {
              e.preventDefault();
              options[e.key === 'Home' ? 0 : options.length - 1].focus();
              return;
            }
            const step = moves[e.key];
            if (step == null) return;
            e.preventDefault();
            const next = current < 0
              ? (step > 0 ? 0 : options.length - 1)
              : (current + step + options.length) % options.length;
            options[next].focus();
          }}
        >
          {items.map((a) => (
            // role=none removes the li from the AT tree so the option's
            // required parent is the listbox itself (NQ-026 axe fix).
            <li key={a.name} role="none">
              <button
                type="button"
                role="option"
                aria-selected={selectedName === a.name}
                className={styles.row}
                data-selected={selectedName === a.name}
                onClick={() => onSelect?.(a.name)}
              >
                <span className={styles.rowMain}>
                  <span className={styles.rowName}>{a.name}</span>
                  <span className={styles.rowSub} title={a.activeTask ?? a.description ?? a.config ?? undefined}>
                    {a.activeTask ?? a.description ?? a.config ?? '—'}
                  </span>
                </span>
                {a.status && <StatusBadge status={presenceBadge(a.status)} label={PRESENCE_LABELS[a.status] ?? a.status} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
