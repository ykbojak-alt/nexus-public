'use client';

/**
 * PHASE-C (docs/farm/PHASE-C-AGENT-CHIP-SPEC.md §1–3) — chip «Агенты фермы»
 * для IconRail footer: живой roster nexus-core через /api/deck/*.
 *
 * Данные — useDeckAgents (snapshot → SSE → poll-fallback). Standalone:
 * app-shell.tsx НЕ тронут, монтирование — отдельной интеграционной волной.
 *
 * 4 состояния (spec §2): conn+agents → тон по worst agent_state + счётчик;
 * conn+0 → честный «Агентов нет»; offline → muted «Deck offline»;
 * degraded (!sseLive при conn ok) → бейдж «опрос» + пометка в поповере.
 * Клик по строкам/футеру → /deck (onOpenDeck — SPA-навигация, иначе Link).
 */

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import Link from 'next/link';
import { GlassSurface } from '@nexus/ui';
import { useDeckAgents } from './screens/use-deck-agents';
import { agentEntry, toneOfAgents } from './deck-vocab';
import { HonestEmpty } from './screens/honest-empty';
import styles from './app-shell.module.css';

export interface RailDeckAgentsProps {
  /** Базовый URL API ('' = same-origin). Для тестов/демо. */
  base?: string;
  /** SPA-навигация на /deck; без пропа — обычный next/link. */
  onOpenDeck?: () => void;
}

export function RailDeckAgents({ base, onOpenDeck }: RailDeckAgentsProps) {
  const { conn, status, agents, sseLive, error, refresh } = useDeckAgents(base);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  const rows = useMemo(() => (agents ?? []).map((a) => ({ agent: a, entry: agentEntry(a) })), [agents]);
  const tone = conn === 'ok' ? (rows.length > 0 ? toneOfAgents(agents ?? []) : 'idle') : 'none';
  const degraded = conn === 'ok' && !sseLive;
  const count = conn === 'checking' ? '…' : conn === 'offline' ? '—' : String(agents?.length ?? '…');

  /** /deck-навигация: callback перехватывает Link (SPA push), иначе — дефолт. */
  const deckClick = (e: ReactMouseEvent) => {
    if (onOpenDeck == null) return;
    e.preventDefault();
    setOpen(false);
    onOpenDeck();
  };

  const summary =
    conn === 'checking' ? 'читаю состояние фермы'
    : conn === 'offline' ? 'Nexus Deck offline'
    : degraded ? `Агентов ${rows.length}, обновление опросом`
    : `Агентов ${rows.length}`;

  return (
    <section ref={rootRef} className={styles.linkedAgents} aria-label="Агенты фермы — Nexus Deck">
      <button
        type="button"
        className={styles.agentsTrigger}
        aria-expanded={open}
        aria-controls="rail-deck-agents-list"
        aria-label={`${summary}. Открыть список агентов фермы`}
        onClick={() => setOpen((v) => !v)}
      >
        <i className={styles.agentsTone} data-tone={tone} aria-hidden="true" />
        <span className={styles.linkedTitle}>Deck</span>
        <span className={styles.agentsCount}>{count}</span>
        {degraded && <span className={styles.linkedState}>опрос</span>}
        <svg className={styles.agentsChevron} viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 7.5 6 4.5 9 7.5" />
        </svg>
      </button>

      {open && (
        <GlassSurface
          variant="card"
          className={styles.agentsPopover}
          id="rail-deck-agents-list"
          role="group"
          aria-label="Агенты Nexus Deck"
        >
          {conn === 'checking' && <p className={styles.linkedNote}>Читаю состояние…</p>}
          {conn === 'offline' && (
            <HonestEmpty
              label="Deck offline"
              subtitle={error ?? 'nexus-core не отвечает — статусы недоступны честно.'}
            />
          )}
          {conn === 'ok' && rows.length === 0 && (
            <HonestEmpty
              label="Агентов нет"
              subtitle="Ферма онлайн, roster пуст — агенты появятся после connect машин."
            />
          )}
          {rows.length > 0 && (
            <ul className={styles.linkedList}>
              {rows.map(({ agent, entry }) => (
                <li key={agent.address || agent.name}>
                  <Link href="/deck" className={styles.linkedRow} onClick={deckClick}
                    title={`${agent.machine ?? agent.address}${typeof agent.turn === 'number' && agent.turn > 0 ? ` · ход ${agent.turn}` : ''}`}>
                    <i data-state={entry.row} aria-hidden="true" />
                    <span className={styles.linkedName}>{agent.name}</span>
                    <span className={styles.linkedState}>
                      {entry.label}
                      {agent.machine != null ? ` · ${agent.machine}` : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {degraded && (
            <p className={styles.linkedNote}>
              SSE отключён — обновление опросом{status != null ? ` · seq ${status.events_seq}` : ''}.
            </p>
          )}
          <Link href="/deck" className={styles.agentsAll} onClick={deckClick}>
            Открыть Nexus Deck
          </Link>
          {conn === 'offline' && (
            <button type="button" className={styles.agentsAll} onClick={() => { setOpen(false); refresh(); }}>
              Повторить
            </button>
          )}
        </GlassSurface>
      )}
    </section>
  );
}
