import { Button } from '../../actions/button/button';
import { ProgressBar } from '../../feedback/progress-bar/progress-bar';
import { StatusBadge, type NexusStatus } from '../../feedback/status-badge/status-badge';
import styles from '../runtime.module.css';

export interface JobControlProps {
  className?: string;
  /** Job/run label — verbatim id or task text. */
  label: string;
  status: NexusStatus;
  statusLabel?: string;
  /** 0..100; null/undefined → honest "прогресс не сообщается", not 0. */
  progress?: number | null;
  /** Capability gates from the host: absent capability → disabled control
   *  with the reason in title, never hidden mechanics. */
  canPause?: boolean;
  canCancel?: boolean;
  paused?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  pauseLabel?: string;
  resumeLabel?: string;
  cancelLabel?: string;
}

/** Job Control strip for the Runtime console: selected run's progress and
 *  the pause/resume/cancel affordances the host actually offers. Terminal
 *  status → controls off; missing progress → indeterminate bar. */
export function JobControl({ className, label, status, statusLabel, progress,
  canPause = false, canCancel = false, paused = false,
  onPause, onResume, onCancel,
  pauseLabel = 'Пауза', resumeLabel = 'Продолжить', cancelLabel = 'Стоп' }: JobControlProps) {
  const terminal = status === 'complete' || status === 'error' || status === 'offline';
  const pauseDisabled = !canPause || onPause == null || terminal;
  const resumeDisabled = onResume == null || terminal;
  const cancelDisabled = !canCancel || onCancel == null || terminal;
  return (
    <div className={[styles.jobControl, className].filter(Boolean).join(' ')}
      data-testid="job-control" data-status={status}>
      <div className={styles.jobHead}>
        <span className={styles.jobLabel} title={label}>{label}</span>
        <StatusBadge status={status} label={statusLabel} />
      </div>
      {progress == null
        ? <p className={styles.jobProgressNote}>прогресс не сообщается</p>
        : <ProgressBar value={progress} label={`${label} — прогресс`} />}
      <div className={styles.jobActions}>
        <Button size="sm" variant="ghost" disabled={pauseDisabled}
          title={pauseDisabled && !terminal ? 'пауза недоступна для этого прогона' : undefined}
          onClick={onPause}>{pauseLabel}</Button>
        {paused && (
          <Button size="sm" variant="ghost" disabled={resumeDisabled}
            title={resumeDisabled && !terminal ? 'возобновление недоступно' : undefined}
            onClick={onResume}>{resumeLabel}</Button>
        )}
        <Button size="sm" variant="ghost" disabled={cancelDisabled}
          title={cancelDisabled && !terminal ? 'остановка недоступна для этого прогона' : undefined}
          onClick={onCancel}>{cancelLabel}</Button>
      </div>
    </div>
  );
}
