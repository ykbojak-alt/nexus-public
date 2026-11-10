import { StatusBadge, type NexusStatus } from '../../feedback/status-badge/status-badge';
import type { PermissionModeKind } from '../types';
import styles from '../runtime.module.css';

const MODE_STATUS: Record<PermissionModeKind, NexusStatus> = {
  'observe': 'info',
  'approve-each': 'warning',
  'autonomy-scope': 'executing',
};

export const PERMISSION_MODE_LABELS: Record<PermissionModeKind, string> = {
  'observe': 'Observe',
  'approve-each': 'Approve each action',
  'autonomy-scope': 'Autonomy within scope',
};

const MODE_DESCRIPTIONS: Record<PermissionModeKind, string> = {
  'observe': 'Reads files in the granted workspace and shows results.',
  'approve-each': 'Asks before every write or command.',
  'autonomy-scope': 'Acts within granted roots and limits; expanding scope stops the session.',
};

export interface PermissionModeProps {
  className?: string;
  mode: PermissionModeKind;
  /** Show the contract description under the badge. */
  showDescription?: boolean;
}

/** Displays the active Runtime permission mode — one of the three contract
 *  modes. Selection is composed from Select/Radio by the consumer; this
 *  component only renders the honest mode state. */
export function PermissionMode({ className, mode, showDescription }: PermissionModeProps) {
  return (
    <span className={[styles.permissionMode, className].filter(Boolean).join(' ')}
      data-mode={mode} data-testid="permission-mode">
      <StatusBadge status={MODE_STATUS[mode]} label={PERMISSION_MODE_LABELS[mode]} />
      {showDescription === true && (
        <span className={styles.permissionDescription}>{MODE_DESCRIPTIONS[mode]}</span>
      )}
    </span>
  );
}
