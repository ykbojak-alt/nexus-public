'use client';

import { useId, type InputHTMLAttributes } from 'react';
import styles from '../inputs.module.css';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function TextField({ label, hint, error, id, className, ...rest }: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const descId = `${inputId}-desc`;
  return (
    <div className={styles.field} data-testid="text-field">
      <label className={styles.label} htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        className={[styles.control, styles.textField, className].filter(Boolean).join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={error != null || hint != null ? descId : undefined}
        {...rest}
      />
      {error ? <div className={styles.error} role="alert" id={descId}>{error}</div>
        : hint != null ? <div className={styles.hint} id={descId}>{hint}</div> : null}
    </div>
  );
}
