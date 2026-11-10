'use client';

import { createContext, useContext, useRef, type HTMLAttributes, type ReactNode, type KeyboardEvent } from 'react';

interface ListboxContextValue {
  value: string;
  onChange: (value: string) => void;
}

const ListboxContext = createContext<ListboxContextValue | null>(null);

export interface ListboxProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  'aria-label': string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}

export interface ListboxOptionProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> {
  value: string;
  disabled?: boolean;
  children: ReactNode;
}

/** Single-select listbox. Arrow/Home/End move focus; Enter/Space selects. */
export function Listbox({ 'aria-label': label, value, onChange, children, ...rest }: ListboxProps) {
  const ref = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
    const root = ref.current;
    if (!root) return;
    const options = [...root.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled="true"])')];
    if (options.length === 0) return;
    const focused = options.indexOf(document.activeElement as HTMLElement);
    const selected = options.findIndex((option) => option.getAttribute('aria-selected') === 'true');
    const current = focused >= 0 ? focused : Math.max(selected, 0);
    if (event.key === 'Enter' || event.key === ' ') {
      const active = options[current];
      if (active) {
        event.preventDefault();
        onChange(active.dataset.optionValue ?? '');
      }
      return;
    }
    event.preventDefault();
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? options.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[next]?.focus();
  }

  return (
    <ListboxContext.Provider value={{ value, onChange }}>
      <div
        {...rest}
        ref={ref}
        role="listbox"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </ListboxContext.Provider>
  );
}

export function ListboxOption({ value, disabled = false, children, onClick, ...rest }: ListboxOptionProps) {
  const context = useContext(ListboxContext);
  if (!context) throw new Error('ListboxOption must be rendered inside Listbox');
  const selected = context.value === value;
  return (
    <div
      {...rest}
      role="option"
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      data-option-value={value}
      tabIndex={-1}
      onClick={(event) => {
        onClick?.(event);
        if (!disabled) context.onChange(value);
      }}
    >
      {children}
    </div>
  );
}
