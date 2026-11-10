import type { AgentSpec } from '@nexus/mock-data';
import type { PatternState } from '../agents/agent-types';
import styles from './settings.module.css';

export interface AgentRegistryPanelProps {
  agents: AgentSpec[];
  state?: PatternState;
  title?: string;
}

/**
 * Agents section (legacy S12) — registry facts verbatim: name, description,
 * config, capabilities, cost cap. Read-only; `null` renders '—' / 'без лимита',
 * never fabricated.
 */
export function AgentRegistryPanel({ agents, state = 'ready', title = 'Реестр агентов' }: AgentRegistryPanelProps) {
  return (
    <section className={styles.root} data-state={state} data-testid="agent-registry-panel" aria-label={title}>
      <h3 className={styles.title}>{title}</h3>
      {state === 'loading' && <p className={styles.muted}>Загрузка реестра…</p>}
      {state === 'error' && <p className={styles.muted}>Реестр агентов недоступен.</p>}
      {state === 'empty' && <p className={styles.muted}>Агенты не зарегистрированы.</p>}
      {(state === 'ready' || state === 'stale') && (
        <ul className={styles.list}>
          {agents.map((a) => (
            <li key={a.name} className={styles.toolRow}>
              <span className={styles.rowMain}>
                <span className={styles.rowName}>{a.name}</span>
                <span className={styles.rowSub} data-null={a.description == null}>{a.description ?? '—'}</span>
              </span>
              <dl className={styles.facts}>
                <dt>Конфиг</dt><dd>{a.config ?? '—'}</dd>
                <dt>Лимит</dt><dd>{a.maxCostUsd != null ? `$${a.maxCostUsd.toFixed(2)}` : 'без лимита'}</dd>
              </dl>
              {a.capabilities.length > 0 && (
                <span className={styles.capChips} aria-label="Возможности">
                  {a.capabilities.map((c) => <span key={c} className={styles.capChip}>{c}</span>)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
