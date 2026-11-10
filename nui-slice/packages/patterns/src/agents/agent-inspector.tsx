import { StatusBadge } from '@nexus/ui';
import type { AgentRosterItem, AgentRunRow, PatternState } from './agent-types';
import { RUN_STATUS_LABELS, runStatusBadge } from './status-map';
import styles from './agents.module.css';

export interface AgentInspectorProps {
  agent: AgentRosterItem | null;
  /** Recent runs of this spec — adapter-supplied, may be absent while loading. */
  runs?: AgentRunRow[];
  /** Opens a run detail. Callback only — absent callback keeps rows inert. */
  onOpenRun?: (runId: string) => void;
  state?: PatternState;
  title?: string;
}

/**
 * Agent inspector — registry facts (capabilities, preset, cost cap) plus
 * recent runs. Persona tint is decorative only and never shown as a fact.
 */
export function AgentInspector({ agent, runs, onOpenRun, state = 'ready', title = 'Спека агента' }: AgentInspectorProps) {
  const showFacts = agent != null && (state === 'ready' || state === 'stale');
  return (
    <section className={styles.root} data-state={agent == null && state === 'ready' ? 'empty' : state} data-testid="agent-inspector" aria-label={title}>
      <h3 className={styles.title}>{title}</h3>
      {state === 'loading' && <p className={styles.muted}>Загрузка…</p>}
      {state === 'error' && <p className={styles.muted}>Не удалось загрузить спеку.</p>}
      {agent == null && state !== 'loading' && state !== 'error' && (
        <p className={styles.muted}>Выберите агента в реестре.</p>
      )}
      {showFacts && (
        <>
          <dl className={styles.facts}>
            <dt>Имя</dt><dd>{agent.name}</dd>
            {agent.description && (<><dt>Описание</dt><dd>{agent.description}</dd></>)}
            <dt>Пресет</dt><dd>{agent.config ?? '—'}</dd>
            <dt>Лимит</dt><dd>{agent.maxCostUsd != null ? `$${agent.maxCostUsd.toFixed(2)}` : 'без лимита'}</dd>
          </dl>
          {agent.capabilities.length > 0 && (
            <>
              <p className={styles.sectionLabel}>Возможности</p>
              <div className={styles.capabilities}>
                {agent.capabilities.map((c) => <span key={c} className={styles.cap}>{c}</span>)}
              </div>
            </>
          )}
          {runs != null && (
            <>
              <p className={styles.sectionLabel}>Недавние прогоны</p>
              {runs.length === 0 ? (
                <p className={styles.muted}>Прогонов этого агента нет.</p>
              ) : (
                <ul className={styles.list}>
                  {runs.map((r) => (
                    <li
                      key={r.runId}
                      className={styles.rowSub}
                      title={r.taskText + (r.costUsd != null ? ` · $${r.costUsd.toFixed(3)}` : '')}
                    >
                      {onOpenRun ? (
                        <button type="button" className={styles.runLink} onClick={() => onOpenRun(r.runId)}>
                          <StatusBadge status={runStatusBadge(r.status)} label={RUN_STATUS_LABELS[r.status]} />{' '}
                          {r.taskText}
                          {r.costUsd != null ? ` · $${r.costUsd.toFixed(3)}` : ''}
                        </button>
                      ) : (
                        <>
                          <StatusBadge status={runStatusBadge(r.status)} label={RUN_STATUS_LABELS[r.status]} />{' '}
                          {r.taskText}
                          {r.costUsd != null ? ` · $${r.costUsd.toFixed(3)}` : ''}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
