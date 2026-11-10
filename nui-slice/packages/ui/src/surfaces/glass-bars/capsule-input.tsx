import { useState } from 'react';
import styles from './glass-bars.module.css';

export interface CapsuleInputProps {
  className?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  /** a11y label of the text field (RU default). */
  inputLabel?: string;
  submitLabel?: string;
  disabled?: boolean;
}

/** Capsule composer field on glass (ref main2.png): pill input + accent send. */
export function CapsuleInput({
  className, value, defaultValue, onChange, onSubmit,
  placeholder, inputLabel = 'Сообщение', submitLabel = 'Отправить', disabled,
}: CapsuleInputProps) {
  const [inner, setInner] = useState(defaultValue ?? '');
  const controlled = value !== undefined;
  const current = controlled ? value : inner;
  return (
    <form
      className={[styles.capsule, className].filter(Boolean).join(' ')}
      onSubmit={(e) => {
        e.preventDefault();
        if (current.trim() && !disabled) onSubmit?.(current);
      }}
    >
      <input
        className={styles.capsuleField}
        value={current}
        onChange={(e) => {
          if (!controlled) setInner(e.target.value);
          onChange?.(e.target.value);
        }}
        placeholder={placeholder}
        aria-label={inputLabel}
        disabled={disabled}
      />
      <button type="submit" className={styles.capsuleSubmit} disabled={disabled}>
        {submitLabel}
      </button>
    </form>
  );
}
