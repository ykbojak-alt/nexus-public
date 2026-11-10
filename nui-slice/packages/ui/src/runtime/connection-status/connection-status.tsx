import { StatusBadge, type NexusStatus } from '../../feedback/status-badge/status-badge';
import type { ProviderConnectionState } from '../types';

const MAP: Record<ProviderConnectionState, NexusStatus> = {
  disconnected: 'offline',
  authorizing: 'syncing',
  connected: 'online',
  reconnecting: 'waiting',
  locked: 'warning',
  unavailable: 'warning',
  error: 'error',
};

export const CONNECTION_STATE_LABELS: Record<ProviderConnectionState, string> = {
  disconnected: 'Disconnected',
  authorizing: 'Authorizing',
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  locked: 'Locked',
  unavailable: 'Unavailable',
  error: 'Error',
};

export interface ConnectionStatusProps {
  className?: string;
  /** Adapter-reported connection state — verbatim vocabulary. */
  state: ProviderConnectionState;
  label?: string;
}

/** Provider account-connection status (Telegram/DM adapter lifecycle)
 *  rendered via the canonical status dictionary. Unavailable/locked are
 *  surfaced as warnings with the adapter's reason shown by the caller —
 *  never implied connected. */
export function ConnectionStatus({ className, state, label }: ConnectionStatusProps) {
  return (
    <StatusBadge status={MAP[state]} label={label ?? CONNECTION_STATE_LABELS[state]} className={className}
      data-testid="connection-status" />
  );
}
