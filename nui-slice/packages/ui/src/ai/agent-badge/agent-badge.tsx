import { AgentAvatar } from '../agent-avatar/agent-avatar';
import styles from '../ai.module.css';
import type { AgentRef } from '../types';

export function AgentBadge({className,  agent, status }: { className?: string; agent: AgentRef; status?: 'online' | 'busy' | 'idle' | 'offline' | 'error' }) {
  return (
    <span className={[styles.badge, className].filter(Boolean).join(' ')} data-testid="agent-badge">
      <AgentAvatar agentId={agent.id} size={20} status={status} />
      <span>{agent.name}</span>
    </span>
  );
}
