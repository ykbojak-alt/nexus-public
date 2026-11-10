import { NexusIcon, type NexusIconName } from '@nexus/icons';
import styles from '../ai.module.css';
import type { AgentPresenceKind } from '../types';

const KNOWN = ['nexus', 'alice', 'mech', 'forge', 'codex', 'arch'] as const;
function iconFor(id: string): NexusIconName {
  return (KNOWN as readonly string[]).includes(id) ? `agent.${id}` as NexusIconName : 'agent.nexus';
}

export interface AgentAvatarProps {
  className?: string;
  agentId: string;
  size?: number;
  status?: AgentPresenceKind;
  label?: string;
}

/** Persona mark inside a token-driven disc; status shown via border, not text. */
export function AgentAvatar({className,  agentId, size = 32, status, label }: AgentAvatarProps) {
  return (
    <span
      className={[styles.avatar, className].filter(Boolean).join(' ')}
      data-status={status !== 'offline' && status !== 'idle' ? status : undefined}
      style={{ width: size, height: size }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <NexusIcon name={iconFor(agentId)} size={Math.round(size * 0.6)} />
    </span>
  );
}
