'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NexusIcon, type NexusIconName } from '@nexus/icons';
import styles from '../actions.module.css';

export interface ActionMenuItem {
  id: string;
  label: string;
  icon?: NexusIconName;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
}

export interface ActionMenuProps {
  className?: string;
  trigger: ReactNode;
  triggerLabel: string;
  items: ActionMenuItem[];
  onAction: (id: string) => void;
}

/** aria menu/menuitem with roving highlight, Arrow/Enter/Escape keyboard model. */
export function ActionMenu({ className, trigger, triggerLabel, items, onAction }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const firstEnabled = items.findIndex((item) => !item.disabled);
    const selected = items[active] && !items[active].disabled ? active : Math.max(firstEnabled, 0);
    if (selected !== active) setActive(selected);
    menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[selected]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const enabled = items.filter((i) => !i.disabled);

  function move(dir: 1 | -1) {
    let next = active;
    for (let n = 0; n < items.length; n++) {
      next = (next + dir + items.length) % items.length;
      if (!items[next]?.disabled) break;
    }
    setActive(next);
    menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[next]?.focus();
  }

  function activate(i: number) {
    const item = items[i];
    if (!item || item.disabled) return;
    setOpen(false);
    btnRef.current?.focus();
    onAction(item.id);
  }

  return (
    <span ref={wrapRef} data-testid="action-menu" style={{ position: 'relative', display: 'inline-block' }} className={className}>
      <button
        type="button"
        ref={btnRef}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel}
        onClick={() => { setOpen((o) => !o); setActive(enabled.length ? items.indexOf(enabled[0]) : 0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); }
        }}
        className={styles.unstyledTrigger}
      >
        {trigger}
      </button>
      {open && (
        <div role="menu" className={styles.menu} ref={menuRef}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btnRef.current?.focus(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
            else if (e.key === 'Home' || e.key === 'End') {
              e.preventDefault();
              const edge = e.key === 'Home' ? enabled[0] : enabled[enabled.length - 1];
              if (edge) {
                const index = items.indexOf(edge);
                setActive(index);
                menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[index]?.focus();
              }
            }
          }}
          tabIndex={-1}
        >
          {items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={styles.menuItem}
              data-active={i === active || undefined}
              data-danger={item.danger || undefined}
              tabIndex={i === active && !item.disabled ? 0 : -1}
              disabled={item.disabled}
              onMouseEnter={() => setActive(i)}
              onClick={() => activate(i)}
            >
              {item.icon != null && <NexusIcon name={item.icon} size="var(--nexus-icon-size-sm)" />}
              <span>{item.label}</span>
              {item.shortcut != null && <span className={styles.menuShortcut}>{item.shortcut}</span>}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
