'use client';

import { useId, type TextareaHTMLAttributes } from 'react';
import styles from '../inputs.module.css';

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function TextArea({ label, hint, error, id, className, ...rest }: TextAreaProps) {
  const autoId = useId();
  const areaId = id ?? autoId;
  const descId = `${areaId}-desc`;
  return (
    <div className={styles.field} data-testid="text-area">
      <label className={styles.label} htmlFor={areaId}>{label}</label>
      <textarea
        id={areaId}
        className={[styles.control, styles.textArea, className].filter(Boolean).join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={error != null || hint != null ? descId : undefined}
        {...rest}
      />
      {error ? <div className={styles.error} role="alert" id={descId}>{error}</div>
        : hint != null ? <div className={styles.hint} id={descId}>{hint}</div> : null}
    </div>
  );
}
