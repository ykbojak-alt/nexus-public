import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './button.module.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = 'secondary', size = 'md', loading = false,
  disabled, children, className, type = 'button', ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[styles.root, styles[variant], styles[size], className].filter(Boolean).join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-variant={variant}
      data-testid="button"
      {...rest}
    >
      {loading ? <span className={styles.spinner} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
