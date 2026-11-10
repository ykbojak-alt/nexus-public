'use client';

import { useId, type SelectHTMLAttributes } from 'react';
import styles from './select.module.css';

export interface SelectOption { value: string; label: string; disabled?: boolean }
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: SelectOption[];
  hint?: string;
}

/** Native select — no custom dropdown until a real need exists (spec §14). */
export function Select({ label, options, hint, id, className, ...rest }: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const descId = `${selectId}-desc`;
  return (
    <div className={styles.field} data-testid="select">
      <label className={styles.label} htmlFor={selectId}>{label}</label>
      <select id={selectId} className={[styles.select, className].filter(Boolean).join(' ')}
        aria-describedby={hint != null ? descId : undefined} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
        ))}
      </select>
      {hint != null && <div className={styles.hint} id={descId}>{hint}</div>}
    </div>
  );
}
