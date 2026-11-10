import styles from '../feedback.module.css';

export interface ProgressBarProps {
  className?: string;
  /** 0..100; omit for indeterminate. */
  value?: number;
  tone?: 'default' | 'success' | 'error';
  label?: string;
}

export function ProgressBar({className,  value, tone, label }: ProgressBarProps) {
  const indeterminate = value == null;
  return (
    <div className={[styles.progressTrack, className].filter(Boolean).join(' ')}>
      <div
        className={[styles.progressFill, indeterminate ? styles.progressIndeterminate : ''].filter(Boolean).join(' ')}
        data-tone={tone !== 'default' ? tone : undefined}
        role="progressbar"
        aria-label={label}
        aria-valuemin={indeterminate ? undefined : 0}
        aria-valuemax={indeterminate ? undefined : 100}
        aria-valuenow={indeterminate ? undefined : value}
        style={{ width: indeterminate ? undefined : `${Math.min(100, Math.max(0, value!))}%` }}
      />
    </div>
  );
}
