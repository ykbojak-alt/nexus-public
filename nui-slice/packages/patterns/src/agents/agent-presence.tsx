import type { DataFreshness } from '@nexus/ui';
import { StatusBadge } from '@nexus/ui';
import type { PresenceEntry, PatternState } from './agent-types';
import { PROCESS_STATE_LABELS, processStateBadge } from './status-map';
import styles from './agents.module.css';

export interface AgentPresenceProps {
  entries: PresenceEntry[];
  state?: PatternState;
  freshness?: DataFreshness;
  title?: string;
}

/**
 * Agent presence — who is doing what right now (live processes).
 * `state` is the server process vocab verbatim — runtime truth.
 */
export function AgentPresence({ entries, state = 'ready', freshness, title = 'Присутствие' }: AgentPresenceProps) {
  return (
    <section
      className={styles.root}
      data-state={state}
      data-freshness={freshness}
      data-testid="agent-presence"
      aria-label={title}
    >
      <h3 className={styles.title}>{title}</h3>
      {state === 'loading' && <p className={styles.muted}>Опрос процессов…</p>}
      {state === 'error' && <p className={styles.muted}>Процессы недоступны.</p>}
      {state === 'empty' && <p className={styles.muted}>Нет активных агентов.</p>}
      {(state === 'ready' || state === 'stale') && (
        <ul className={styles.list}>
          {entries.map((e) => (
            <li key={`${e.agent}-${e.runId ?? 'idle'}`} className={styles.rowSub} title={`${e.agent} — ${e.task}`}>
              <StatusBadge status={processStateBadge(e.state)} label={PROCESS_STATE_LABELS[e.state]} />{' '}
              <span className={styles.rowName}>{e.agent}</span>{' '}
              <span className={styles.muted}>{e.task}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
