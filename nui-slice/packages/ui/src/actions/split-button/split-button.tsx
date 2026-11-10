import { NexusIcon } from '@nexus/icons';
import { ActionMenu, type ActionMenuItem } from '../action-menu/action-menu';
import styles from '../actions.module.css';

export interface SplitButtonProps {
  className?: string;
  label: string;
  onClick: () => void;
  menuLabel?: string;
  items?: ActionMenuItem[];
  onAction?: (id: string) => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}

/** Primary action + adjacent menu of secondary actions. */
export function SplitButton({className,  label, onClick, menuLabel, items = [], onAction, variant = 'primary', disabled }: SplitButtonProps) {
  return (
    <span className={[styles.split, className].filter(Boolean).join(' ')} data-variant={variant} data-testid="split-button">
      <button type="button" className={styles.splitMain} disabled={disabled} onClick={onClick}>
        {label}
      </button>
      <ActionMenu
        trigger={<span className={styles.splitToggle} style={{ pointerEvents: 'none' }}><NexusIcon name="act.chevron" size="var(--nexus-icon-size-sm)" /></span>}
        triggerLabel={menuLabel ?? `${label} options`}
        items={items}
        onAction={onAction ?? (() => { })}
      />
    </span>
  );
}
