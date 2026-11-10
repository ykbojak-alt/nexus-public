import { AgentAvatar } from '../agent-avatar/agent-avatar';
import styles from '../ai.module.css';
import type { AgentRef } from '../types';

/** Compact persona identity — avatar + name; optional persona→theme disclaimer line. */
export function AgentIdentity({ agent, showNote, className }: { agent: AgentRef & { roleNote?: string }; showNote?: boolean; className?: string }) {
  return (
    <div data-testid="agent-identity" className={className}>
      <div className={styles.agentCardHead} style={{ gap: 'var(--nexus-space-2, 8px)' }}>
        <AgentAvatar agentId={agent.id} size={24} />
        <span className={styles.agentName} style={{ fontSize: '14px' }}>{agent.name}</span>
      </div>
      {showNote && agent.roleNote != null && <div className={styles.roleNote}>{agent.roleNote}</div>}
    </div>
  );
}
