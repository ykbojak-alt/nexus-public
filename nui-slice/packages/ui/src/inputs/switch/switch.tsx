import type { ButtonHTMLAttributes } from 'react';
import styles from './switch.module.css';

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  'aria-label': string;
}

/** role=switch toggle (spec §14: semantic primitives, not styled divs). */
export function Switch({ checked, onCheckedChange, className, ...rest }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={[styles.root, className].filter(Boolean).join(' ')}
      data-checked={checked || undefined}
      data-testid="switch"
      onClick={() => onCheckedChange(!checked)}
      {...rest}
    >
      <span className={styles.thumb} aria-hidden="true" />
    </button>
  );
}
