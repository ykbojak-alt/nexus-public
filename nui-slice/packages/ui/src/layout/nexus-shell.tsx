import type { ReactNode } from 'react';
import styles from './layout.module.css';

export interface NexusShellProps {
  className?: string;
  density?: 'calm' | 'standard' | 'dense';
  topbar?: ReactNode;
  sidebar?: ReactNode;
  inspector?: ReactNode;
  rail?: ReactNode;
  children?: ReactNode;
}

/**
 * Canonical application shell (spec §8): topbar + sidebar + workspace +
 * inspector + bottom rail on a CSS grid. Empty regions collapse
 * (data-no-*) instead of leaving reserved whitespace.
 */
export function NexusShell({className,  density = 'standard', topbar, sidebar, inspector, rail, children }: NexusShellProps) {
  return (
    <div
      className={[styles.shell, className].filter(Boolean).join(' ')}
      data-testid="nexus-shell"
      data-density={density}
      data-no-sidebar={sidebar == null || undefined}
      data-no-inspector={inspector == null || undefined}
    >
      {topbar != null && <div className={styles.topbar}>{topbar}</div>}
      {sidebar != null && <div className={styles.sidebar}>{sidebar}</div>}
      <main className={styles.workspace}>{children}</main>
      {inspector != null && <aside className={styles.inspector}>{inspector}</aside>}
      {rail != null && <div className={styles.rail}>{rail}</div>}
    </div>
  );
}
