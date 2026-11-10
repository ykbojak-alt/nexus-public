import type { ReactNode } from 'react';
import styles from './kbd.module.css';

export type KbdSize = 'sm' | 'md';

export interface KbdProps {
  /** Key or key-combination to render (e.g. "Ctrl+B", "Esc"). */
  children: ReactNode;
  /** Visual density. Defaults to "sm". */
  size?: KbdSize;
  className?: string;
}

/** Inline keyboard key hint — mono font, tokenized chrome; use inside Tooltip
 *  next to the action label to surface a real binding. */
export function Kbd({ children, size = 'sm', className }: KbdProps) {
  return (
    <kbd
      className={[styles.root, styles[size], className].filter(Boolean).join(' ')}
      data-kbd={size}
    >
      {children}
    </kbd>
  );
}
