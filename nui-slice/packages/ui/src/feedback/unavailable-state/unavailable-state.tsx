import type { ReactNode } from 'react';
import { NexusIcon, type NexusIconName } from '@nexus/icons';
import type { GlassTone } from '../../surfaces/glass-bars/glass-surface';
import styles from '../feedback.module.css';

export interface UnavailableStateProps {
  className?: string;
  /** Что недоступно — по-русски, по факту («Голосовой канал», «Лента прогонов»). */
  title?: string;
  /** Честная причина недоступности — источник данных, а не выдумка:
   *  «источник не отвечает», «runtime не вернул данные». Без неё — ничего. */
  reason?: string;
  /** Подсказка — что можно сделать / когда появится. */
  hint?: string;
  icon?: NexusIconName;
  action?: ReactNode;
  /** Persona tint of icon/title via [data-persona] → personaText.*. */
  tone?: GlassTone;
  /** 'panel' — centered block for an unavailable region; 'inline' — one
   *  line inside a populated panel; 'full' — fills the route region. Both keep role="status" (polite). */
  variant?: 'panel' | 'inline' | 'full';
}

/**
 * «Нет данных» — источник недоступен (в отличие от EmptyState «данные есть,
 * записей нет»). Никогда не показывает «0», «—» или выдуманную причину:
 * без reason рендерится только заголовок. Вежливое оповещение role="status".
 */
export function UnavailableState({
  className, title = 'Недоступно', reason, hint, icon = 'status.offline',
  action, tone, variant = 'panel',
}: UnavailableStateProps) {
  if (variant === 'inline') {
    return (
      <p className={[styles.stateHint, styles.stateHintUnavailable, className].filter(Boolean).join(' ')}
        data-state="unavailable" data-persona={tone} data-testid="unavailable-state" role="status">
        {title}
        {reason != null && <> — {reason}</>}
        {hint != null && <> ({hint})</>}
        {action}
      </p>
    );
  }
  return (
    <div className={[styles.statePanel, variant === 'full' ? styles.statePanelFull : undefined, className].filter(Boolean).join(' ')}
      data-state="unavailable" data-persona={tone} data-testid="unavailable-state" role="status">
      <span className={styles.stateIcon}><NexusIcon name={icon} size="var(--nexus-icon-slot-feature)" /></span>
      <h3 className={styles.stateTitle}>{title}</h3>
      {reason != null && <p className={styles.stateReason}>{reason}</p>}
      {hint != null && <p className={styles.stateBody}>{hint}</p>}
      {action}
    </div>
  );
}
