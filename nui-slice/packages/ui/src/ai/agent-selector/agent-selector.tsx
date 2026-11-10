'use client';

import { useEffect, useRef, useState } from 'react';
import { NexusIcon } from '@nexus/icons';
import { AgentAvatar } from '../agent-avatar/agent-avatar';
import styles from '../ai.module.css';
import type { AgentRef } from '../types';

export interface AgentSelectorProps {
  className?: string;
  agents: AgentRef[];
  value: string;
  onChange: (agentId: string) => void;
  label?: string;
}

/** Persona picker — button + listbox, Arrow/Enter/Escape keyboard model. */
export function AgentSelector({ className, agents, value, onChange, label = 'Select agent' }: AgentSelectorProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const current = agents.find((a) => a.id === value);

  useEffect(() => {
    if (!open) return;
    const idx = agents.findIndex((a) => a.id === value);
    setActive(idx >= 0 ? idx : 0);
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, agents, value]);

  function choose(i: number) {
    const a = agents[i];
    if (!a) return;
    onChange(a.id);
    setOpen(false);
    btnRef.current?.focus();
  }

  return (
    <div ref={wrapRef} className={[styles.selector, className].filter(Boolean).join(' ')} data-testid="agent-selector">
      <button
        ref={btnRef}
        type="button"
        className={styles.selectorBtn}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); } }}
      >
        {current != null && <AgentAvatar agentId={current.id} size={20} />}
        <span>{current?.name ?? label}</span>
        <NexusIcon name="act.chevron" size="var(--nexus-icon-size-xs)" />
      </button>
      {open && (
        <div role="listbox" aria-label={label} className={styles.selectorList}
          tabIndex={-1}
          ref={(el) => el?.focus()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btnRef.current?.focus(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, agents.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active); }
          }}
        >
          {agents.map((a, i) => (
            <button
              key={a.id}
              type="button"
              role="option"
              aria-selected={a.id === value}
              className={styles.selectorOption}
              data-active={i === active || undefined}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              <AgentAvatar agentId={a.id} size={24} />
              <span>{a.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
