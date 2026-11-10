import styles from './typing-indicator.module.css';

export interface TypingIndicatorProps {
  label?: string;
  className?: string;
}

/** Three-dot typing status; reduced-motion keeps the localized label static. */
export function TypingIndicator({ label = 'печатает…', className }: TypingIndicatorProps) {
  return (
    <span
      className={[styles.root, className].filter(Boolean).join(' ')}
      data-typing-indicator="dots-cascade"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <span className={styles.dots} aria-hidden="true">
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.dot} />
      </span>
      <span className={styles.label}>{label}</span>
    </span>
  );
}
