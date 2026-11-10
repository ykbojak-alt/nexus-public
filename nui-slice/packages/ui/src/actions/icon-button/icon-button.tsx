import type { ButtonHTMLAttributes } from 'react';
import { NexusIcon, type NexusIconName } from '@nexus/icons';
import styles from './icon-button.module.css';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: NexusIconName;
  /** Required: icon buttons carry no visible text — the label is the a11y name. */
  'aria-label': string;
  variant?: 'secondary' | 'ghost';
  size?: 'sm' | 'md';
}

export function IconButton({ icon, variant = 'ghost', size = 'md', className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      className={[styles.root, styles[variant], styles[size], className].filter(Boolean).join(' ')}
      data-testid="icon-button"
      {...rest}
    >
      <NexusIcon name={icon} size={size === 'sm' ? 14 : 16} />
    </button>
  );
}
