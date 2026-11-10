import type { ReactNode } from 'react';
import { Button } from '../../actions/button/button';
import { StatusBadge, type NexusStatus } from '../../feedback/status-badge/status-badge';
import styles from '../runtime.module.css';

/**
 * Managed external window lifecycle (Runtime contract, e.g. Telegram /
 * Instagram windows). These are NEXUS-owned states only — provider account,
 * session, unread or message state is never representable here by design.
 */
export type RuntimeWindowState = 'closed' | 'opening' | 'open' | 'unavailable' | 'error';

export interface RuntimeLauncherProps {
  className?: string;
  /** Provider identity shown verbatim, e.g. 'Telegram', 'Instagram'. */
  name: string;
  /** Window lifecycle state — Runtime's own truth. */
  state?: RuntimeWindowState;
  /** Failure reason for unavailable/error — shown verbatim, never invented. */
  reason?: string;
  /** Open or focus the managed window. Repeat activation focuses — callers
   *  must not spawn duplicate windows. */
  onOpen?: () => void;
  /** Fallback action: open the official site in the external browser.
   *  Rendered only for unavailable/error when provided. */
  onOpenExternal?: () => void;
  /** Provider glyph; decorative unless labelled. */
  icon?: ReactNode;
}

const STATE_STATUS: Record<RuntimeWindowState, NexusStatus> = {
  closed: 'offline',
  opening: 'syncing',
  open: 'online',
  unavailable: 'warning',
  error: 'error',
};

const STATE_LABEL: Record<RuntimeWindowState, string> = {
  closed: 'Closed',
  opening: 'Opening',
  open: 'Open',
  unavailable: 'Unavailable',
  error: 'Error',
};

/** Accessible launcher for a managed external window (open/focus action +
 *  honest lifecycle state). Holds no provider internals — only Runtime state. */
export function RuntimeLauncher({
  className, name, state = 'closed', reason, onOpen, onOpenExternal, icon,
}: RuntimeLauncherProps) {
  const failed = state === 'unavailable' || state === 'error';
  return (
    <div className={[styles.launcher, className].filter(Boolean).join(' ')}
      data-state={state} data-testid="runtime-launcher">
      {icon != null && <span className={styles.launcherIcon} aria-hidden="true">{icon}</span>}
      <div className={styles.launcherBody}>
        <div className={styles.launcherHead}>
          <span className={styles.launcherName}>{name}</span>
          <StatusBadge status={STATE_STATUS[state]} label={STATE_LABEL[state]} />
        </div>
        {failed && reason != null && <p className={styles.launcherReason}>{reason}</p>}
      </div>
      <div className={styles.launcherActions}>
        {failed && onOpenExternal != null && (
          <Button variant="ghost" size="sm" onClick={onOpenExternal}>
            Open in browser
          </Button>
        )}
        <Button
          variant={state === 'closed' ? 'primary' : 'ghost'}
          size="sm"
          onClick={onOpen}
          disabled={onOpen == null || state === 'opening' || failed}
          loading={state === 'opening'}
        >
          {state === 'open' ? 'Focus' : 'Open'}
        </Button>
      </div>
    </div>
  );
}
