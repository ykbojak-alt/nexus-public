import type { ReactNode } from 'react';
import { Card } from '../../surfaces/card/card';
import { Skeleton } from '../../feedback/skeleton/skeleton';
import { ErrorState } from '../../feedback/error-state/error-state';
import { MemoryState } from '../memory-state/memory-state';
import { AgentAvatar } from '../agent-avatar/agent-avatar';
import { AgentStatus } from '../agent-status/agent-status';
import { ToolBadge } from '../tool-badge/tool-badge';
import styles from '../ai.module.css';
import type { AgentPresenceKind, AgentRef } from '../types';

export type AgentCardState = 'loading' | 'ready' | 'error' | 'stale';

export interface AgentCardProps {
  className?: string;
  agent: AgentRef & { description?: string; roleNote?: string };
  status?: AgentPresenceKind;
  capabilities?: string[];
  /** Runtime-console metrics slot (tok/s, Sparkline) — real observed data only. */
  metrics?: ReactNode;
  actions?: ReactNode;
  /** data-state contract: loading renders skeleton, error an honest error state,
   *  stale marks the card — never fake content. */
  state?: AgentCardState;
  onRetry?: () => void;
}

/** Persona card — description + role disclaimer kept visually distinct (persona ≠ runtime role). */
export function AgentCard({ className, agent, status, capabilities, metrics, actions, state = 'ready', onRetry }: AgentCardProps) {
  if (state === 'loading') {
    return (
      <Card className={[styles.agentCard, className].filter(Boolean).join(' ')} data-state="loading">
        <div className={styles.agentCardHead}>
          <Skeleton circle height={40} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Skeleton height={14} width="55%" />
            <Skeleton height={11} width="80%" />
          </div>
        </div>
      </Card>
    );
  }
  if (state === 'error') {
    return (
      <Card className={[styles.agentCard, className].filter(Boolean).join(' ')}>
        <ErrorState title={`${agent.name} недоступен`} onRetry={onRetry} />
      </Card>
    );
  }
  return (
    <Card className={[styles.agentCard, className].filter(Boolean).join(' ')} data-state={state !== 'ready' ? state : undefined}>
      <div className={styles.agentCardHead}>
        <AgentAvatar agentId={agent.id} size={40} status={status} />
        <div style={{ flex: 1 }}>
          <h3 className={styles.agentName}>{agent.name}</h3>
          {agent.description != null && <p className={styles.agentDesc}>{agent.description}</p>}
        </div>
        {state === 'stale' && <MemoryState freshness="stale" />}
        {status != null && <AgentStatus status={status} label={false} />}
        {actions}
      </div>
      {capabilities != null && capabilities.length > 0 && (
        <div className={styles.caps}>
          {capabilities.map((c) => <ToolBadge key={c} name={c} />)}
        </div>
      )}
      {metrics != null && <div className={styles.agentMetrics}>{metrics}</div>}
      {agent.roleNote != null && <div className={styles.roleNote}>{agent.roleNote}</div>}
    </Card>
  );
}
