import type { ReactNode } from 'react';
import { NexusIcon } from '@nexus/icons';
import { Button } from '../../actions/button/button';
import type { GlassTone } from '../../surfaces/glass-bars/glass-surface';
import styles from '../feedback.module.css';

export interface ErrorStateProps {
  className?: string;
  title?: string;
  body?: string;
  onRetry?: () => void;
  retryLabel?: string;
  action?: ReactNode;
  /** Persona tint of icon via [data-persona] → personaText.*. */
  tone?: GlassTone;
  /** 'panel' — centered alert block for a failed region; 'inline' — a single
   *  alert line inside a populated panel; 'full' — fills the whole route region. Both keep role="alert". */
  variant?: 'panel' | 'inline' | 'full';
}

export function ErrorState({ className, title = 'Что-то пошло не так', body, onRetry, retryLabel = 'Повторить', action, tone, variant = 'panel' }: ErrorStateProps) {
  const retry = action ?? (onRetry != null && (
    <Button type="button" variant="ghost" size="sm" onClick={onRetry}>{retryLabel}</Button>
  ));
  if (variant === 'inline') {
    return (
      <p className={[styles.stateHint, styles.stateHintError, className].filter(Boolean).join(' ')}
        data-tone="error" data-persona={tone} data-testid="error-state" data-state="error" role="alert">
        {title}
        {body != null && <> — {body}</>}
        {retry}
      </p>
    );
  }
  return (
    <div className={[styles.statePanel, variant === 'full' ? styles.statePanelFull : undefined, className].filter(Boolean).join(' ')} data-tone="error" data-persona={tone} data-testid="error-state" data-state="error" role="alert">
      <span className={styles.stateIcon}><NexusIcon name="status.warn" size="var(--nexus-icon-slot-feature)" /></span>
      <h3 className={styles.stateTitle}>{title}</h3>
      {body != null && <p className={styles.stateBody}>{body}</p>}
      {retry}
    </div>
  );
}
