import type { ReactNode } from 'react';
import styles from './layout.module.css';

/** Intelligence archetype (spec §8): Runtime / Memory / Knowledge — 7+5 split. */
export function IntelligenceLayout({className,  primary, secondary }: { className?: string; primary: ReactNode; secondary?: ReactNode }) {
  return (
    <div className={[styles.grid12, className].filter(Boolean).join(' ')} data-layout="intelligence">
      <div className={styles.intelligencePrimary}>{primary}</div>
      {secondary != null && <div className={styles.intelligenceSecondary}>{secondary}</div>}
    </div>
  );
}
