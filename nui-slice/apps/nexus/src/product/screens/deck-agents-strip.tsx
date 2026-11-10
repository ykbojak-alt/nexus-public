'use client';

/**
 * PHASE-C (docs/farm/PHASE-C-AGENT-CHIP-SPEC.md §1b, §6) — горизонтальная
 * полоса agent-status для главного экрана под hero (alice-home-route-adapter).
 *
 * Standalone: адаптер НЕ тронут, монтирование — отдельной интеграционной
 * волной. Данные — useDeckAgents (snapshot → SSE → poll-fallback), тот же
 * контракт и те же 4 состояния, что у rail-deck-agents.tsx:
 *   conn+agents → счётчик + StatusBadge worst-агента;
 *   conn+0      → честное «0 / агентов нет» (HonestEmpty-семантика строкой);
 *   offline     → badge offline + error в title, retry через refresh;
 *   degraded    → метка «опрос» (SSE мёртв, poll-fallback жив).
 * Клик → /deck (next/link; onOpenDeck — SPA-навигация при интеграции).
 * CSS: только существующий screens.module.css (metaStrip/metaField/…).
 */

import Link from 'next/link';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { StatusBadge, type NexusStatus } from '@nexus/ui';
import { useDeckAgents } from './use-deck-agents';
import { agentEntry, worstAgent } from '../deck-vocab';
import styles from './screens.module.css';

export interface DeckAgentsStripProps {
  base?: string;
  onOpenDeck?: () => void;
}

export function DeckAgentsStrip({ base, onOpenDeck }: DeckAgentsStripProps) {
  const { conn, agents, sseLive, error, refresh } = useDeckAgents(base);
  const list = agents ?? [];
  const degraded = conn === 'ok' && !sseLive;

  const badge =
    conn === 'checking' ? { status: 'syncing' as NexusStatus, label: 'читаю…' }
    : conn === 'offline' ? { status: 'offline' as NexusStatus, label: 'Deck offline' }
    : list.length === 0 ? { status: 'info' as NexusStatus, label: 'агентов нет' }
    : degraded ? { status: 'warning' as NexusStatus, label: 'опрос' }
    : (() => { const w = worstAgent(list); const e = w != null ? agentEntry(w) : { label: '', status: 'info' as NexusStatus }; return { status: e.status, label: `${w?.name ?? ''} ${e.label}`.trim() }; })();

  const count = conn === 'checking' || conn === 'offline' ? '—' : String(list.length);
  const summary =
    conn === 'checking' ? 'Читаю состояние агентов фермы'
    : conn === 'offline' ? `Nexus Deck offline${error != null ? `: ${error}` : ''}`
    : `Агентов ${list.length}${degraded ? ', обновление опросом' : ''} — открыть Deck`;

  const deckClick = (e: ReactMouseEvent) => {
    if (onOpenDeck == null) return;
    e.preventDefault();
    onOpenDeck();
  };

  return (
    <div className={styles.metaStrip} data-state={conn} data-degraded={degraded ? 'true' : undefined}>
      {/* display:contents — Link не создаёт своей коробки: дети становятся
          flex-элементами .metaStrip, кнопка retry остаётся соседним узлом
          (button внутри <a> — невалидный HTML). */}
      <Link
        href="/deck"
        onClick={deckClick}
        aria-label={summary}
        title={conn === 'offline' ? (error ?? 'nexus-core не отвечает') : 'Открыть Nexus Deck'}
        style={{ display: 'contents' }}
      >
        <span className={styles.metaField}>
          <span className={styles.metaLabel}>Deck</span>
          <span className={styles.metaValue}>{count}</span>
        </span>
        <StatusBadge status={badge.status} label={badge.label} />
        {degraded && conn === 'ok' && list.length > 0 && (
          <span className={styles.metaValue}>опрос 30с</span>
        )}
        <span className={styles.visuallyHidden} role="status">{summary}</span>
      </Link>
      {conn === 'offline' && (
        <button
          type="button"
          className={styles.linkBtn}
          onClick={(e) => { e.stopPropagation(); refresh(); }}
        >
          повторить
        </button>
      )}
    </div>
  );
}
