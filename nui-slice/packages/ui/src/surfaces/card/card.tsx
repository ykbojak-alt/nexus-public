import type { HTMLAttributes, ReactNode } from 'react';
import styles from '../surfaces.module.css';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  interactive?: boolean;
  padding?: string;
}

/** Glass card — visual props come from glass-panel tokens only. */
export function Card({ children, interactive, padding, className, style, ...rest }: CardProps) {
  return (
    <div
      className={[styles.card, className].filter(Boolean).join(' ')}
      data-interactive={interactive || undefined}
      style={{ padding: padding ?? 'var(--nexus-space-5, 20px)', ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}
