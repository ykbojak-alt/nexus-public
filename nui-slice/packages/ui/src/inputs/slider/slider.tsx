'use client';

import { useId } from 'react';
import styles from '../inputs.module.css';

export interface SliderProps {
  className?: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  format?: (v: number) => string;
}

export function Slider({className,  label, value, onChange, min = 0, max = 100, step = 1, disabled, format }: SliderProps) {
  const autoId = useId();
  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')} data-testid="slider">
      <label className={styles.label} htmlFor={autoId}>
        {label}{' '}<span aria-hidden="true">{format ? format(value) : value}</span>
      </label>
      <input
        id={autoId}
        type="range"
        className={styles.slider}
        min={min} max={max} step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
