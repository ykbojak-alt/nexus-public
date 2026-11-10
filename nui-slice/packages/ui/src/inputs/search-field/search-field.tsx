'use client';

import { useId, type InputHTMLAttributes } from 'react';
import { NexusIcon } from '@nexus/icons';
import styles from '../inputs.module.css';

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  label?: string;
  /** Accessible name when no visible `label` is rendered. */
  inputLabel?: string;
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
}

/** Search input with a clear affordance; controlled value. */
export function SearchField({ label, inputLabel = 'Поиск', value, onChange, onClear, id, className, ...rest }: SearchFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={styles.field} data-testid="search-field">
      {label != null && <label className={styles.label} htmlFor={inputId}>{label}</label>}
      <div className={styles.searchWrap}>
        <input
          id={inputId}
          type="search"
          className={[styles.control, styles.searchField, className].filter(Boolean).join(' ')}
          value={value}
          aria-label={label == null ? inputLabel : undefined}
          onChange={(e) => onChange(e.target.value)}
          {...rest}
        />
        {value !== '' && (
          <button type="button" className={styles.clear} aria-label="Clear search"
            onClick={() => { onChange(''); onClear?.(); }}>
            <NexusIcon name="act.close" size="var(--nexus-icon-size-xs)" />
          </button>
        )}
      </div>
    </div>
  );
}
