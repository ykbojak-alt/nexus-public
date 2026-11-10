'use client';

import { useId, type ReactNode } from 'react';
import styles from '../surfaces.module.css';

export function Section({className,  title, actions, children }: { className?: string; title: string; actions?: ReactNode; children?: ReactNode }) {
  const titleId = useId();
  return (
    <section className={[styles.section, className].filter(Boolean).join(' ')} aria-labelledby={titleId}>
      <div className={styles.sectionHeader}>
        <h2 id={titleId} className={styles.sectionTitle}>{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
