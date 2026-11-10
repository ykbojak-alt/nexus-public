import type { ReactNode } from 'react';
import styles from '../navigation.module.css';

export function Sidebar({className,  header, children, footer }: { className?: string; header?: ReactNode; children?: ReactNode; footer?: ReactNode }) {
  return (
    <nav className={[styles.sidebar, className].filter(Boolean).join(' ')} data-testid="sidebar" aria-label="Primary">
      {header != null && <div>{header}</div>}
      {children}
      {footer != null && <div style={{ marginTop: 'auto' }}>{footer}</div>}
    </nav>
  );
}
