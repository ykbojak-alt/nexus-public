import { StatusBadge, type NexusStatus } from '../../feedback/status-badge/status-badge';
import type { AgentStatusKind } from '../types';

const MAP: Record<AgentStatusKind, NexusStatus> = {
  active: 'active',
  working: 'executing',
  idle: 'waiting',
  blocked: 'warning',
  offline: 'offline',
};

/** Runtime truth rendered via the canonical status dictionary — never a persona claim. */
export function RuntimeStatus({className,  status, label }: { className?: string; status: AgentStatusKind; label?: string }) {
  return <StatusBadge status={MAP[status]} label={label ?? status} className={className} />;
}
