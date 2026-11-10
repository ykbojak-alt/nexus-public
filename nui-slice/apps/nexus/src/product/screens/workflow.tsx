'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { EmptyState, ErrorState, GlassPanel, LoadingState, PanelHeader, StatusBadge, type NexusStatus } from '@nexus/ui';
import { getDataSource, useDataSource } from '../data-source';
import { EDGE_API_BASE } from './newf-live';
import { HonestEmpty } from './honest-empty';
import styles from './workflow.module.css';

// ============================================================================
// Types
// ============================================================================

interface RosterPersona {
  id: string;
  name: string;
  role: string;
  term: string;
  model: string;
  group: string;
  status: string;
  current_wave: string;
}

type PersonaStatus = 'working' | 'ready' | 'queued' | 'service' | 'offline' | 'unknown' | 'live' | 'idle'
  | 'blocked' | 'done' | 'error' | 'exited' | 'archived';

// OSC-мапа статусов (ROSTER-CLIENT): blocked→warning, done→complete, error→error,
// exited→offline, archived→paused. Без неё OSC-глаголы рендерят status=undefined.
const STATUS_BADGE: Record<PersonaStatus, NexusStatus> = {
  working: 'active',
  ready: 'complete',
  queued: 'waiting',
  service: 'info',
  offline: 'offline',
  unknown: 'offline',
  live: 'active',
  idle: 'paused',
  blocked: 'warning',
  done: 'complete',
  error: 'error',
  exited: 'offline',
  archived: 'paused',
};

const GROUP_LABELS: Record<string, string> = {
  TEAM: 'Команда (TEAM)',
  SOCIAL: 'Соц-контур (RAE)',
  SWARM: 'Торговый рой (SWARM)',
};

const GROUP_ORDER = ['TEAM', 'SOCIAL', 'SWARM'] as const;

// Terminal style mappings from tools/alice/personas.py
const TERMINAL_STYLE_LABELS: Record<string, string> = {
  'alice-home': 'AGENT-A Home',
  'forge-ember': 'Forge Ember',
  'codex-surgical': 'Codex Surgical',
  'mech-gauge': 'Mech Gauge',
  'arch-blueprint': 'Arch Blueprint',
};

// Same-origin first; legacy same-origin JSON is second. Only after both fail
// do we try the read-only edge endpoints. No mock roster is substituted.
const ROSTER_SOURCES = [
  '/api/deck/roster',
  '/_live/roster.json',
] as const;
const EDGE_ROSTER_SOURCES = ROSTER_SOURCES.map((path) => `${EDGE_API_BASE}${path}`);

/** Нормализация записи core-ростера (RFC-001 §25.1) в RosterPersona. */
function normalizeRosterEntry(raw: Record<string, unknown>): RosterPersona {
  const labels = (raw.labels && typeof raw.labels === 'object' ? raw.labels : {}) as Record<string, unknown>;
  const role = String(raw.role ?? labels.role ?? '');
  const group = String(raw.group ?? labels.group ?? (role.includes('трейдер') ? 'SWARM' : 'TEAM'));
  return {
    id: String(raw.agent_id ?? raw.id ?? raw.term ?? ''),
    name: String(raw.name ?? raw.agent_id ?? raw.term ?? ''),
    role,
    term: String(raw.term ?? raw.machine ?? ''),
    model: String(raw.model ?? labels.model ?? ''),
    group,
    status: String(raw.status ?? raw.state ?? 'unknown'),
    current_wave: String(raw.current_wave ?? raw.turn ?? '—'),
  };
}

// ============================================================================
// Helpers
// ============================================================================

function getTerminalStyleClass(name: string): string {
  const key = name.toLowerCase().replace(/[.\s]+/g, '-');
  // Handle dot-separated names like ROLE-2, ROLE-1
  const simpleKey = name.toLowerCase().replace(/[.\s]/g, '');
  if (simpleKey.includes('alice')) return 'alice-home';
  if (simpleKey.includes('forge')) return 'forge-ember';
  if (simpleKey.includes('codex')) return 'codex-surgical';
  if (simpleKey.includes('mech')) return 'mech-gauge';
  if (simpleKey.includes('arch')) return 'arch-blueprint';
  if (simpleKey.includes('rae') || simpleKey.includes('qoder')) return 'alice-home';
  if (simpleKey.includes('sage')) return 'arch-blueprint';
  if (simpleKey.includes('swarm')) return 'forge-ember';
  return 'alice-home';
}

function getTerminalStyleLabel(style: string): string {
  return TERMINAL_STYLE_LABELS[style] ?? style;
}

// ============================================================================
// Components
// ============================================================================

interface PersonaCardProps {
  persona: RosterPersona;
}

function PersonaCard({ persona }: PersonaCardProps) {
  const terminalStyle = getTerminalStyleClass(persona.name);
  const status = persona.status as PersonaStatus;

  return (
    <article className={`${styles.card} ${styles[terminalStyle]}`} data-testid={`persona-${persona.id}`}>
      <header className={styles.cardHeader}>
        <div className={styles.personaIdentity}>
          <div className={`${styles.avatar} ${styles[terminalStyle]}`} aria-hidden="true">
            {persona.name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h3 className={styles.personaName}>{persona.name}</h3>
            <p className={styles.personaRole}>{persona.role}</p>
          </div>
        </div>
        <div className={styles.personaMeta}>
          <StatusBadge status={STATUS_BADGE[status]} label={persona.status} />
          <span className={styles.terminalStyle}>{getTerminalStyleLabel(terminalStyle)}</span>
        </div>
      </header>

      <div className={styles.cardBody}>
        <dl className={styles.metaList}>
          <dt>Модель</dt>
          <dd className={styles.modelPool}>{persona.model}</dd>

          <dt>Терминал</dt>
          <dd>{persona.term}</dd>

          <dt>Текущая волна</dt>
          <dd className={styles.currentWave}>{persona.current_wave || '—'}</dd>
        </dl>
      </div>

      <footer className={styles.cardFooter}>
        <Link href={`/runtime?agent=${persona.id}`} className={styles.viewLink}>
          Открыть в Runtime ↗
        </Link>
      </footer>
    </article>
  );
}

interface GroupSectionProps {
  group: string;
  personas: RosterPersona[];
  isLoading: boolean;
  isError: boolean;
}

function GroupSection({ group, personas, isLoading, isError }: GroupSectionProps) {
  if (isLoading) {
    return (
      <GlassPanel className={styles.groupPanel} data-state="loading" data-testid={`workflow-group-${group.toLowerCase()}`}>
        <h2 className={styles.groupTitle}>{GROUP_LABELS[group]}</h2>
        <LoadingState>Загружаю реестр фермы…</LoadingState>
      </GlassPanel>
    );
  }

  if (isError) {
    return (
      <GlassPanel className={styles.groupPanel} data-state="error" data-testid={`workflow-group-${group.toLowerCase()}`}>
        <h2 className={styles.groupTitle}>{GROUP_LABELS[group]}</h2>
        <ErrorState variant="inline" title="Реестр недоступен" body="roster_unavailable: проверьте /api/deck/roster" />
      </GlassPanel>
    );
  }

  if (personas.length === 0) {
    return (
      <GlassPanel className={styles.groupPanel} data-state="empty" data-testid={`workflow-group-${group.toLowerCase()}`}>
        <h2 className={styles.groupTitle}>{GROUP_LABELS[group]}</h2>
        <HonestEmpty label="Персон в группе нет" subtitle="Реестр вернул пустую группу — данные не имитируются." />
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className={styles.groupPanel} data-state="ready" data-testid={`workflow-group-${group.toLowerCase()}`}>
      <h2 className={styles.groupTitle}>{GROUP_LABELS[group]}</h2>
      <div className={styles.grid} role="list" aria-label={GROUP_LABELS[group]}>
        {personas.map((p) => (
          <PersonaCard key={p.id} persona={p} />
        ))}
      </div>
    </GlassPanel>
  );
}

// ============================================================================
// Main Screen
// ============================================================================

export function WorkflowScreen() {
  const ds = useDataSource();
  const [roster, setRoster] = useState<RosterPersona[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [source, setSource] = useState<string | null>(null);

  // Same-origin roster endpoints are always tried before the public edge.
  const fetchRoster = useCallback(async () => {
    let served: 'local' | 'edge' | null = null;
    const hostname = window.location.hostname.toLowerCase();
    const localHost = hostname === 'localhost' || hostname.endsWith('.localhost')
      || hostname === '::1' || hostname.startsWith('127.');
    const sourceGroups: { source: 'local' | 'edge'; urls: readonly string[] }[] = [
      { source: localHost ? 'local' : 'edge', urls: ROSTER_SOURCES },
    ];
    if (window.location.origin !== EDGE_API_BASE) {
      sourceGroups.push({ source: 'edge', urls: EDGE_ROSTER_SOURCES });
    }
    for (const group of sourceGroups) {
      for (const url of group.urls) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) continue;
        const data = await res.json();
        const list = Array.isArray(data)
          ? data
          : (data && typeof data === 'object' && Array.isArray((data as { roster?: unknown }).roster)
            ? (data as { roster: unknown[] }).roster
            : undefined);
        if (list) {
          setRoster((list as Record<string, unknown>[]).map(normalizeRosterEntry));
          setError(null);
          setLastUpdated(new Date());
          served = group.source;
          break;
        }
      } catch {
        // источник недоступен — пробуем следующий
      }
      }
      if (served) break;
    }
    if (!served) {
      setRoster([]);
      setError('roster_unavailable: /api/deck/roster и /_live/roster.json не отвечают — живого реестра нет');
      setSource(null);
    } else {
      setSource(served);
    }
    setLoading(false);
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchRoster();
  }, [fetchRoster]);

  // Live polling every 10s
  useEffect(() => {
    const interval = setInterval(fetchRoster, 10_000);
    return () => clearInterval(interval);
  }, [fetchRoster]);

  // Group personas by group
  const grouped = useMemo(() => {
    const map = new Map<string, RosterPersona[]>();
    for (const p of roster) {
      const g = p.group;
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(p);
    }
    // Sort groups by GROUP_ORDER
    const result: [string, RosterPersona[]][] = [];
    for (const g of GROUP_ORDER) {
      if (map.has(g)) {
        // Sort within group: working first, then ready, then others
        const sorted = [...map.get(g)!].sort((a, b) => {
          const order = { working: 0, live: 1, ready: 2, queued: 3, service: 4, idle: 5, offline: 6, unknown: 7 };
          return (order[a.status as keyof typeof order] ?? 99) - (order[b.status as keyof typeof order] ?? 99);
        });
        result.push([g, sorted]);
      }
    }
    return result;
  }, [roster]);

  return (
    <div className={styles.page} data-screen="workflow">
      <PanelHeader
        level="screen"
        divider={false}
        titleId="workflow-title"
        title="NEXUS Workflow"
        subtitle="Живой ростер фермы — TEAM + RAE/SAGE + SWARM 6"
      />

      <div className={styles.headerMeta}>
        {error && (
          <div className={styles.warningBanner} role="alert">
            ⚠ {error}
          </div>
        )}
        <div className={styles.meta}>
          <span>Обновлено: {lastUpdated ? lastUpdated.toLocaleTimeString('ru-RU') : '—'}</span>
          <span>Автообновление: каждые 10 с</span>
          <span>Источник: <code data-testid="roster-source">{source ?? '— недоступен'}</code></span>
        </div>
      </div>

      <div className={styles.grid}>
        {grouped.map(([group, personas]) => (
          <GroupSection
            key={group}
            group={group}
            personas={personas}
            isLoading={loading && roster.length === 0}
            isError={!!error && roster.length === 0}
          />
        ))}
      </div>

      {roster.length === 0 && !loading && (
        <GlassPanel className={styles.fallbackPanel} data-state="empty">
          <HonestEmpty label="Ростер пуст" subtitle="Живой реестр вернул пустой список персон." />
        </GlassPanel>
      )}
    </div>
  );
}
