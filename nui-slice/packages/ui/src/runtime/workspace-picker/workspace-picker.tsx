import { Button } from '../../actions/button/button';
import { IconButton } from '../../actions/icon-button/icon-button';
import { StatusBadge, type NexusStatus } from '../../feedback/status-badge/status-badge';
import type { WorkspaceRootState } from '../types';
import styles from '../runtime.module.css';

export interface WorkspaceRoot {
  /** Display path/label the user granted — never invented by the caller. */
  path: string;
  state?: WorkspaceRootState;
}

const STATE_STATUS: Record<WorkspaceRootState, NexusStatus> = {
  granted: 'online',
  pending: 'syncing',
  revoked: 'warning',
  unavailable: 'error',
};

export interface WorkspacePickerProps {
  className?: string;
  /** Granted workspace roots; empty renders the ungranted state. */
  roots?: WorkspaceRoot[];
  /** Opens the system folder picker (host-side); never accepts arbitrary paths. */
  onPick?: () => void;
  /** Revoke/remove a granted root. */
  onRemove?: (path: string) => void;
}

/** Granted workspace roots — shows nothing until the user grants access via
 *  the host picker; a root that loses access is shown as revoked/unavailable,
 *  never silently dropped. */
export function WorkspacePicker({ className, roots = [], onPick, onRemove }: WorkspacePickerProps) {
  return (
    <div className={[styles.workspacePicker, className].filter(Boolean).join(' ')} data-testid="workspace-picker">
      {roots.length === 0 && (
        <p className={styles.workspaceEmpty}>No workspace granted — the agent cannot see local files until you pick a folder.</p>
      )}
      {roots.length > 0 && (
        <ul className={styles.workspaceList}>
          {roots.map((root) => {
            const state = root.state ?? 'granted';
            return (
              <li key={root.path} className={styles.workspaceRow} data-state={state}>
                <span className={styles.workspacePath} title={root.path}>{root.path}</span>
                <StatusBadge status={STATE_STATUS[state]} label={state} />
                {onRemove != null && state === 'granted' && (
                  <IconButton icon="act.close" aria-label={`Remove ${root.path}`} onClick={() => onRemove(root.path)} />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {onPick != null && (
        <Button variant="secondary" size="sm" onClick={onPick}>Choose folder…</Button>
      )}
    </div>
  );
}
