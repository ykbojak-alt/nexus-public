import type { NexusStatus } from '@nexus/ui';
import type { ProcessState, RunStatus } from '@nexus/mock-data';
import type { AgentRosterItem } from './agent-types';

/** Semantic status → StatusBadge vocab. Runtime truth only — persona never maps here. */
export function runStatusBadge(status: RunStatus): NexusStatus {
  switch (status) {
    case 'running': return 'executing';
    case 'done': return 'complete';
    case 'error': return 'error';
    case 'cancelled': return 'paused';
    case 'timeout': return 'warning';
  }
}

export function processStateBadge(state: ProcessState): NexusStatus {
  switch (state) {
    case 'new': return 'info';
    case 'ready': return 'waiting';
    case 'running': return 'executing';
    case 'blocked': return 'warning';
    case 'done': return 'complete';
    case 'failed': return 'error';
    case 'cancelled': return 'paused';
  }
}

export function presenceBadge(status: NonNullable<AgentRosterItem['status']>): NexusStatus {
  switch (status) {
    case 'active': return 'active';
    case 'blocked': return 'warning';
    case 'offline': return 'offline';
    case 'idle': return 'waiting';
  }
}

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  running: 'идёт',
  done: 'завершён',
  error: 'ошибка',
  cancelled: 'отменён',
  timeout: 'просрочен',
};

export const PROCESS_STATE_LABELS: Record<ProcessState, string> = {
  new: 'новый',
  ready: 'готов',
  running: 'идёт',
  blocked: 'блокирован',
  done: 'завершён',
  failed: 'упал',
  cancelled: 'отменён',
};
