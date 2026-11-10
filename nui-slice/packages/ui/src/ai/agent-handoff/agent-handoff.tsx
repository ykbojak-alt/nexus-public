import { NexusIcon } from '@nexus/icons';
import { AgentAvatar } from '../agent-avatar/agent-avatar';
import styles from '../ai.module.css';
import type { AgentRef } from '../types';

/** Handoff edge between two personas — from → to + optional reason. */
export function AgentHandoff({className,  from, to, reason }: { className?: string; from: AgentRef; to: AgentRef; reason?: string }) {
  return (
    <div className={[styles.handoff, className].filter(Boolean).join(' ')} data-testid="agent-handoff">
      <AgentAvatar agentId={from.id} size={28} label={from.name} />
      <span className={styles.handoffArrow} aria-hidden="true"><NexusIcon name="act.chevron" size="var(--nexus-icon-size-sm)" /></span>
      <AgentAvatar agentId={to.id} size={28} label={to.name} />
      {reason != null && <span className={styles.handoffReason}>{reason}</span>}
    </div>
  );
}
