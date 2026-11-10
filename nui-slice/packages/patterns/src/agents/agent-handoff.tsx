import { StatusBadge } from '@nexus/ui';
import type { HandoffLink, PatternState } from './agent-types';
import { RUN_STATUS_LABELS, runStatusBadge } from './status-map';
import styles from './agents.module.css';

export interface AgentHandoffProps {
  links: HandoffLink[];
  state?: PatternState;
  title?: string;
}

/**
 * Handoff chain — who delegated work to whom (parent → child runs).
 * `from === null` renders as "оператор" — the honest origin, not a fake agent.
 */
export function AgentHandoff({ links, state = 'ready', title = 'Передачи' }: AgentHandoffProps) {
  const sorted = [...links].sort((a, b) => a.ts - b.ts);
  return (
    <section className={styles.root} data-state={state} data-testid="agent-handoff" aria-label={title}>
      <h3 className={styles.title}>{title}</h3>
      {state === 'loading' && <p className={styles.muted}>Загрузка цепочки…</p>}
      {state === 'error' && <p className={styles.muted}>Цепочка недоступна.</p>}
      {state === 'empty' && <p className={styles.muted}>Передач между агентами не было.</p>}
      {(state === 'ready' || state === 'stale') && (
        <ol className={styles.chain}>
          {sorted.map((l) => (
            <li key={l.id} className={styles.link}>
              <span className={styles.linkAgent}>{l.from ?? 'оператор'}</span>
              <span className={styles.linkArrow} aria-hidden="true">→</span>
              <span className={styles.linkAgent}>{l.to}</span>
              <span className={styles.linkMeta}>
                <StatusBadge status={runStatusBadge(l.status)} label={RUN_STATUS_LABELS[l.status]} />
                <span>{l.task}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
