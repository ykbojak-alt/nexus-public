import type { ReactNode } from 'react';
import styles from './layout.module.css';

/** Command archetype (spec §8): Mission Control / Security / System / Router — 8+4 split. */
export function CommandLayout({className,  primary, secondary }: { className?: string; primary: ReactNode; secondary?: ReactNode }) {
  return (
    <div className={[styles.grid12, className].filter(Boolean).join(' ')} data-layout="command">
      <div className={styles.commandPrimary}>{primary}</div>
      {secondary != null && <div className={styles.commandSecondary}>{secondary}</div>}
    </div>
  );
}
