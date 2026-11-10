'use client';

import { Skeleton } from '@nexus/ui';
import styles from './skeleton-panel.module.css';

/**
 * UI-5: скелетон вместо спиннера на тяжёлых экранах. Бары повторяют
 * форму контента панели (две строки 14px + две 12px), а не вращаются —
 * perceived speed: каркас виден сразу, без диффузии «точки».
 * role="status" + подсказка (визуально скрыта) сохраняют озвучивание
 * скринридерами, как у LoadingState.
 */
export function PanelSkeleton({ hint }: { hint: string }) {
  return (
    <div className={styles.panel} role="status" data-testid="panel-skeleton">
      <span className={styles.srOnly}>{hint}</span>
      <Skeleton height={14} width="86%" />
      <Skeleton height={14} width="64%" />
      <Skeleton height={12} width="72%" />
      <Skeleton height={12} width="47%" />
    </div>
  );
}
