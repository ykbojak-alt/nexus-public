import { AgentAvatar } from '../agent-avatar/agent-avatar';
import styles from '../ai.module.css';
import type { AgentPresenceKind as Presence, AgentRef } from '../types';

export interface PresenceEntry { agent: AgentRef; status: Presence }

/** Overlapping avatar stack of present agents. */
export function AgentPresence({className,  agents, size = 24 }: { className?: string; agents: PresenceEntry[]; size?: number }) {
  return (
    <span className={[styles.stack, className].filter(Boolean).join(' ')} role="list" aria-label="Active agents" data-testid="agent-presence">
      {agents.map(({ agent, status }) => (
        <span role="listitem" key={agent.id}>
          <AgentAvatar agentId={agent.id} size={size} status={status} label={`${agent.name} — ${status}`} />
        </span>
      ))}
    </span>
  );
}
