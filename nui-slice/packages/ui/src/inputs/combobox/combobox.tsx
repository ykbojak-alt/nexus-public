'use client';

import { useId, useMemo, useRef, useState } from 'react';
import styles from '../inputs.module.css';

export interface ComboboxOption { value: string; label: string }
export interface ComboboxProps {
  className?: string;
  label: string;
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/** aria combobox + listbox with Arrow/Enter/Escape keyboard model. */
export function Combobox({ className, label, options, value, onChange, placeholder }: ComboboxProps) {
  const autoId = useId();
  const listId = `${autoId}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [text, setText] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => options.filter((o) => o.label.toLowerCase().includes(text.toLowerCase())),
    [options, text],
  );
  const selected = options.find((o) => o.value === value);

  function choose(i: number) {
    const opt = filtered[i];
    if (!opt) return;
    onChange(opt.value);
    setText('');
    setOpen(false);
  }

  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')} ref={wrapRef} data-testid="combobox" onBlur={(e) => {
      if (!wrapRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
    }}>
      <label className={styles.label} htmlFor={autoId}>{label}</label>
      <div className={styles.comboWrap}>
        <input
          id={autoId}
          className={[styles.control, styles.textField].join(' ')}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && filtered[active] ? `${listId}-${filtered[active].value}` : undefined}
          aria-autocomplete="list"
          placeholder={placeholder ?? selected?.label}
          value={open ? text : (selected?.label ?? '')}
          onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => { setText(''); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setOpen(false); (e.target as HTMLInputElement).blur(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
          }}
        />
        {open && (
          <div className={styles.comboList} role="listbox" id={listId}>
            {filtered.map((o, i) => (
              <div
                key={o.value}
                id={`${listId}-${o.value}`}
                role="option"
                aria-selected={o.value === value}
                className={styles.comboOption}
                data-active={i === active || undefined}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => { e.preventDefault(); choose(i); }}
              >
                {o.label}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
