import { NexusIcon } from '@nexus/icons';
import styles from '../actions.module.css';

export interface CommandTriggerProps {
  className?: string;
  label?: string;
  shortcut?: string;   // display hint, e.g. "Ctrl K"
  onClick: () => void;
}

/** Button that opens the command palette; shows the kbd shortcut hint. */
export function CommandTrigger({className,  label = 'Search commands', shortcut = 'Ctrl K', onClick }: CommandTriggerProps) {
  return (
    <button type="button" className={[styles.commandTrigger, className].filter(Boolean).join(' ')} data-testid="command-trigger" onClick={onClick}>
      <NexusIcon name="nav.search" size="var(--nexus-icon-size-sm)" />
      <span>{label}</span>
      <kbd className={styles.kbd}>{shortcut}</kbd>
    </button>
  );
}
