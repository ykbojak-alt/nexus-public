import type { CSSProperties, ReactNode } from 'react';
import styles from '../surfaces.module.css';

export interface FloatingPanelProps {
  className?: string;
  children?: ReactNode;
  /** Position via anchor coordinates; visual chrome from depth.overlay tokens. */
  style?: CSSProperties;
  label?: string;
}

export function FloatingPanel({className,  children, style, label }: FloatingPanelProps) {
  return (
    <div className={[styles.floatingPanel, className].filter(Boolean).join(' ')} role="dialog" aria-label={label} style={style}>
      {children}
    </div>
  );
}
