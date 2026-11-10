'use client';

import { createContext, useContext, type ButtonHTMLAttributes, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';

interface TabsContextValue {
  value: string;
  onChange: (value: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

export interface TabListProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  'aria-label': string;
  children: ReactNode;
}

export interface TabProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  value: string;
  controls?: string;
  children: ReactNode;
}

export interface TabPanelProps extends HTMLAttributes<HTMLDivElement> {
  id: string;
  labelledBy: string;
  active: boolean;
  children: ReactNode;
}

/** Composite tablist with roving focus and automatic activation. */
export function TabList({ value, onChange, children, onKeyDown, ...rest }: TabListProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || !['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)')];
    if (tabs.length === 0) return;
    const focused = tabs.indexOf(document.activeElement as HTMLButtonElement);
    const selected = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
    const current = focused >= 0 ? focused : Math.max(selected, 0);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[next]?.focus();
    const nextValue = tabs[next]?.dataset.tabValue;
    if (nextValue) onChange(nextValue);
  }

  return (
    <TabsContext.Provider value={{ value, onChange }}>
      <div {...rest} role="tablist" onKeyDown={handleKeyDown}>{children}</div>
    </TabsContext.Provider>
  );
}

export function Tab({ value, controls, children, onClick, ...rest }: TabProps) {
  const context = useContext(TabsContext);
  if (!context) throw new Error('Tab must be rendered inside TabList');
  const selected = value === context.value;
  const id = controls ? `${controls}-tab` : undefined;
  return (
    <button
      {...rest}
      type="button"
      role="tab"
      id={id}
      data-tab-value={value}
      aria-controls={controls}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={(event) => { onClick?.(event); context.onChange(value); }}
    >
      {children}
    </button>
  );
}

export function TabPanel({ id, labelledBy, active, children, ...rest }: TabPanelProps) {
  return (
    <div
      {...rest}
      id={id}
      role="tabpanel"
      aria-labelledby={labelledBy}
      hidden={!active}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
