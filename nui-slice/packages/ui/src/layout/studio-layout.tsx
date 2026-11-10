import type { ReactNode } from 'react';
import styles from './layout.module.css';

/** Studio archetype (spec §8): Image/Video/Document studios — 9+3 split. */
export function StudioLayout({className,  primary, secondary }: { className?: string; primary: ReactNode; secondary?: ReactNode }) {
  return (
    <div className={[styles.grid12, className].filter(Boolean).join(' ')} data-layout="studio">
      <div className={styles.studioPrimary}>{primary}</div>
      {secondary != null && <div className={styles.studioSecondary}>{secondary}</div>}
    </div>
  );
}
