import { StatusBadge, type NexusStatus } from '../../feedback/status-badge/status-badge';
import type { LocalSessionState } from '../types';

const MAP: Record<LocalSessionState, NexusStatus> = {
  idle: 'offline',
  starting: 'syncing',
  running: 'executing',
  paused: 'paused',
  stopping: 'syncing',
  stopped: 'complete',
  unavailable: 'warning',
  error: 'error',
};

export const SESSION_STATE_LABELS: Record<LocalSessionState, string> = {
  idle: 'Idle',
  starting: 'Starting',
  running: 'Running',
  paused: 'Paused',
  stopping: 'Stopping',
  stopped: 'Stopped',
  unavailable: 'Unavailable',
  error: 'Error',
};

export interface SessionStatusProps {
  className?: string;
  state: LocalSessionState;
  label?: string;
}

/** Local worker/session lifecycle rendered via the canonical status
 *  dictionary. Unavailable/unknown host state is shown as unavailable —
 *  never implied to be running. */
export function SessionStatus({ className, state, label }: SessionStatusProps) {
  return (
    <StatusBadge status={MAP[state]} label={label ?? SESSION_STATE_LABELS[state]} className={className}
      data-testid="session-status" />
  );
}
