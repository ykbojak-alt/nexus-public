import type { ReactNode } from 'react';
import { NexusIcon, type NexusIconName } from '@nexus/icons';
import type { GlassTone } from '../../surfaces/glass-bars/glass-surface';
import styles from '../feedback.module.css';

export interface EmptyStateProps {
  className?: string;
  title: string;
  body?: string;
  /** Честная причина пустоты («под фильтром ничего нет», «история ещё не
   *  собиралась») — строкой под body. Никогда не «0» и не «—». */
  reason?: string;
  icon?: NexusIconName;
  action?: ReactNode;
  /** Persona tint of icon via [data-persona] → personaText.*. */
  tone?: GlassTone;
  /** 'panel' — centered hero block for an empty region; 'inline' — a single
   *  hint line inside a populated panel (e.g. "no rows under this filter"); 'full' — fills the route region. */
  variant?: 'panel' | 'inline' | 'full';
}

export function EmptyState({ className, title, body, reason, icon, action, tone, variant = 'panel' }: EmptyStateProps) {
  if (variant === 'inline') {
    return (
      <p className={[styles.stateHint, className].filter(Boolean).join(' ')}
        data-testid="empty-state" data-state="empty" data-persona={tone} role="status">
        {title}
        {body != null && <> — {body}</>}
        {reason != null && <> ({reason})</>}
        {action}
      </p>
    );
  }
  return (
    <div className={[styles.statePanel, variant === 'full' ? styles.statePanelFull : undefined, className].filter(Boolean).join(' ')} data-testid="empty-state" data-state="empty" data-persona={tone} role="status">
      {icon != null && <span className={styles.stateIcon}><NexusIcon name={icon} size="var(--nexus-icon-slot-feature)" /></span>}
      <h3 className={styles.stateTitle}>{title}</h3>
      {body != null && <p className={styles.stateBody}>{body}</p>}
      {reason != null && <p className={styles.stateReason}>{reason}</p>}
      {action}
    </div>
  );
}
