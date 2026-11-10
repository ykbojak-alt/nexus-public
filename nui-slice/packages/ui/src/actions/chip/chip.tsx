import type { ReactNode } from 'react';
import styles from '../actions.module.css';

export interface ChipProps {
  className?: string;
  children: ReactNode;
  /** Optional leading icon (decorative, aria-hidden). */
  icon?: ReactNode;
  /** Selected pill gets the accent tint; `text.accent` on `accent.primarySoft`
   * is a contracted ≥4.5:1 pair across all themes. */
  selected?: boolean;
  disabled?: boolean;
  /** With onSelect the chip is a toggle button (aria-pressed). Without it the
   * chip is a static tag pill — provenance/category labels, not a control. */
  onSelect?: () => void;
}

export function Chip({ className, children, icon, selected, disabled, onSelect }: ChipProps) {
  const cls = [styles.chip, className].filter(Boolean).join(' ');
  const iconSlot = icon != null && (
    <span className={styles.chipIcon} aria-hidden="true">{icon}</span>
  );
  if (onSelect == null) {
    return (
      <span className={cls} data-selected={selected} data-static="true">
        {iconSlot}
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      data-testid="chip"
      data-selected={selected}
      aria-pressed={selected === true}
      disabled={disabled}
      onClick={onSelect}
    >
      {iconSlot}
      {children}
    </button>
  );
}
