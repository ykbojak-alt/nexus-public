'use client';

import { useId } from 'react';
import styles from '../inputs.module.css';

export interface RangeSliderProps {
  className?: string;
  label: string;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}

/** Two-handle range as paired native range inputs (accessible, no pointer math). */
export function RangeSlider({className,  label, value, onChange, min = 0, max = 100, step = 1, disabled }: RangeSliderProps) {
  const autoId = useId();
  const [lo, hi] = value;
  return (
    <fieldset className={[styles.field, className].filter(Boolean).join(' ')} data-testid="range-slider" style={{ border: 'none', padding: 0, margin: 0 }}>
      <legend className={styles.label}>{label} <span aria-hidden="true">{lo}–{hi}</span></legend>
      <input
        type="range" className={styles.slider}
        aria-label={`${label} minimum`}
        min={min} max={max} step={step} value={lo} disabled={disabled}
        onChange={(e) => onChange([Math.min(Number(e.target.value), hi), hi])}
      />
      <input
        type="range" className={styles.slider}
        aria-label={`${label} maximum`}
        min={min} max={max} step={step} value={hi} disabled={disabled}
        onChange={(e) => onChange([lo, Math.max(Number(e.target.value), lo)])}
      />
    </fieldset>
  );
}
