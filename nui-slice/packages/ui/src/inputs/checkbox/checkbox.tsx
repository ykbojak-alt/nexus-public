'use client';

import { useId, type InputHTMLAttributes } from 'react';
import styles from '../inputs.module.css';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export function Checkbox({ label, checked, onCheckedChange, id, ...rest }: CheckboxProps) {
  const autoId = useId();
  const cbId = id ?? autoId;
  return (
    <label className={styles.checkRow} htmlFor={cbId} data-testid="checkbox">
      <input
        id={cbId}
        type="checkbox"
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
        {...rest}
      />
      <span>{label}</span>
    </label>
  );
}
