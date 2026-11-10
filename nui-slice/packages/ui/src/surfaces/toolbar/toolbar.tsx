import type { ReactNode } from 'react';
import styles from '../surfaces.module.css';

export interface ToolbarProps {
  className?: string;
  children?: ReactNode;
  label?: string;
  /** Rail-style tool columns (FORGE workspace rail) use 'vertical'. */
  orientation?: 'horizontal' | 'vertical';
}

export function Toolbar({ className, children, label, orientation = 'horizontal' }: ToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      aria-orientation={orientation}
      data-orientation={orientation}
      className={[styles.toolbar, className].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  );
}

export function ToolbarGroup({ className, children }: { className?: string; children?: ReactNode }) {
  return <div className={[styles.toolbarGroup, className].filter(Boolean).join(' ')}>{children}</div>;
}

export function ToolbarSeparator({ orientation = 'vertical' }: { orientation?: 'vertical' | 'horizontal' }) {
  return <div className={styles.toolbarSeparator} role="separator" aria-orientation={orientation} />;
}

export function ToolbarSpacer() {
  return <div className={styles.toolbarSpacer} aria-hidden="true" />;
}
