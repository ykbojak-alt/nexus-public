'use client';

/** Заглушка отложенной вкладки Runtime (выделено из runtime.tsx). */
import { EmptyState, GlassPanel } from '@nexus/ui';
import styles from '../screens.module.css';

export function PendingTab({ name }: { name: string }) {
  return (
    <GlassPanel className={styles.panel} data-state="empty" data-testid="tab-pending">
      <p className={styles.emptyTitle}>{name}</p>
      <EmptyState variant="inline" title="Вкладка в разработке — следующая за альфа-срезом." />
    </GlassPanel>
  );
}
