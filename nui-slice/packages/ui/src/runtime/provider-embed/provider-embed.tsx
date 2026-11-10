import type { ReactNode } from 'react';
import { Button } from '../../actions/button/button';
import { StatusBadge, type NexusStatus } from '../../feedback/status-badge/status-badge';
import type { ProviderEmbedState } from '../types';
import styles from '../runtime.module.css';

const STATE_STATUS: Record<ProviderEmbedState, NexusStatus> = {
  idle: 'offline',
  loading: 'syncing',
  ready: 'online',
  blocked: 'warning',
  unavailable: 'warning',
  error: 'error',
};

export interface ProviderEmbedProps {
  className?: string;
  /** Provider identity shown verbatim — 'Yandex Music', 'YouTube'. */
  provider: string;
  state?: ProviderEmbedState;
  /** Verbatim reason for blocked/unavailable/error — shown as-is. */
  reason?: string;
  /** Fallback: open the official provider page in the external browser. */
  onOpenExternal?: () => void;
  /** The provider-owned surface (official iframe/player). NEXUS never paints
   *  fake controls over it — children are the provider's own UI. */
  children?: ReactNode;
}

/** Container for a provider-owned embed (Yandex Music iframe, YouTube IFrame
 *  player). Keeps the provider's name, branding and controls visible; renders
 *  honest container states and an external-browser fallback — never NEXUS-
 *  owned playback controls for remote content. */
export function ProviderEmbed({
  className, provider, state = 'idle', reason, onOpenExternal, children,
}: ProviderEmbedProps) {
  const failed = state === 'blocked' || state === 'unavailable' || state === 'error';
  return (
    <div className={[styles.providerEmbed, className].filter(Boolean).join(' ')}
      data-state={state} data-testid="provider-embed">
      <div className={styles.providerHead}>
        <span className={styles.providerName}>{provider}</span>
        <StatusBadge status={STATE_STATUS[state]} label={state} />
      </div>
      <div className={styles.providerBody}>
        {failed ? (
          <div className={styles.providerFallback} role="status">
            {reason != null && <p className={styles.providerReason}>{reason}</p>}
            {onOpenExternal != null && (
              <Button variant="secondary" size="sm" onClick={onOpenExternal}>
                Open {provider} in browser
              </Button>
            )}
          </div>
        ) : state === 'loading' ? (
          <div className={styles.providerFallback} role="status">Loading {provider}…</div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
