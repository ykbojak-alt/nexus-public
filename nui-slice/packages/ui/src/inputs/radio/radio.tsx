'use client';

import { useId, type InputHTMLAttributes } from 'react';
import styles from '../inputs.module.css';

export interface RadioOption { value: string; label: string; disabled?: boolean }
export interface RadioGroupProps {
  className?: string;
  label: string;
  name?: string;
  options: RadioOption[];
  value: string;
  onChange: (value: string) => void;
}

/** Radios are a group, not a single control — matching native semantics. */
export function RadioGroup({className,  label, name, options, value, onChange }: RadioGroupProps) {
  const autoId = useId();
  const groupName = name ?? autoId;
  return (
    <fieldset className={[styles.field, className].filter(Boolean).join(' ')} data-testid="radio-group" style={{ border: 'none', padding: 0, margin: 0 }}>
      <legend className={styles.label}>{label}</legend>
      {options.map((o) => (
        <label key={o.value} className={styles.radioRow}>
          <input
            type="radio"
            name={groupName}
            value={o.value}
            checked={o.value === value}
            disabled={o.disabled}
            onChange={() => onChange(o.value)}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
