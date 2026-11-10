'use client';

/**
 * NEWF Lux — композиция экрана по референсу «minimal-lux» (gen-art #4).
 *
 * Состав: заголовок → стрип фикс-мест (NEWF_SEATS) → дерево агентов
 * (parent→subagent) + живой терминал выбранного агента + event-стрим
 * (SSE /api/core/events через bridge.streamEvents) → футер машин.
 *
 * Данные: useModData() — live-контекст или фикстуры E1; работает в обоих
 * режимах. Честная недоступность сохраняется: offline-стрим помечается,
 * мок событиями не подменяется.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { StatusBadge } from '@nexus/ui';
import { useVoiceUi } from './voice-ui';
import { RatingBadge, ratingFor, useRatings } from './ratings';
import {
  createCoreBridge,
  type LiveEvent,
  type NewfBridge,
} from './newf-live';
import { NEWF_SEATS, seatSpec, type RoleSeat } from './newf-roles';
import {
  LiveContext,
  LiveTerminalPane,
  mockHcBridge,
  OSC_BADGE,
  UiContext,
  useLiveData,
  useModData,
  type LiveData,
  type UiState,
} from './newf';
import styles from './newf.module.css';

/** Акцент места — hairline-полоса карточки (палитра nexus-lux). */
const SEAT_ACCENT: Record<string, string> = {
  orchestrator: '#f0a832',
  'coder-1': '#3fb950',
  'coder-2': '#58a6ff',
  reviewer: '#bc8cff',
  short: '#39c5cf',
};

const EVENT_KIND_ACCENT: Record<string, string> = {
  created: 'var(--nx-done)',
  lost: 'var(--nx-blocked)',
  restarted: 'var(--nx-accent)',
  keep: 'var(--nx-accent)',
  finished: 'var(--nx-done)',
  removed: 'var(--nx-blocked)',
  status: 'var(--nx-working)',
  turn: 'var(--nx-working)',
  title: 'var(--nx-muted)',
  labels: 'var(--nx-muted)',
  size: 'var(--nx-muted)',
  doc: 'var(--nx-working)',
};

const MAX_EVENTS = 60;

interface AgentRow {
  id: string;
  name: string;
  terminal: string;
  status: string;
  seat?: string;
  parent?: string;
}

function fmtEventTime(ts: unknown): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '--:--:--';
  const date = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function eventSummary(event: LiveEvent): string {
  const target = event.address ?? event.terminal ?? event.term ?? event.doc ?? '';
  const extra = event.status ?? event.state ?? event.why ?? event.title ?? '';
  return [target, extra].filter(Boolean).map(String).join(' ');
}

function SeatStrip({ agents, onSelect, focusedId }: {
  agents: AgentRow[];
  onSelect: (id: string) => void;
  focusedId?: string;
}) {
  const bySeat = useMemo(() => {
    const map = new Map<string, AgentRow>();
    for (const agent of agents) {
      if (agent.seat && !map.has(agent.seat)) map.set(agent.seat, agent);
    }
    return map;
  }, [agents]);
  const subCount = useMemo(() => {
    const count = new Map<string, number>();
    for (const agent of agents) {
      if (agent.parent) count.set(agent.parent, (count.get(agent.parent) ?? 0) + 1);
    }
    return count;
  }, [agents]);

  return (
    <ul className={styles.luxStrip} aria-label="Agent seats">
      {NEWF_SEATS.map((seat: RoleSeat) => {
        const agent = bySeat.get(seat.seat);
        const badge = agent ? OSC_BADGE[agent.status] : undefined;
        const accent = SEAT_ACCENT[seat.seat] ?? 'var(--nx-accent)';
        const subs = agent ? (subCount.get(agent.terminal) ?? subCount.get(agent.id) ?? 0) : 0;
        return (
          <li key={seat.seat} className={styles.luxSeatItem}>
            <button
              type="button"
              className={`${styles.luxSeat}${agent && focusedId === agent.id ? ` ${styles.luxSeatFocused}` : ''}`}
              style={{ borderTopColor: accent }}
              onClick={() => agent && onSelect(agent.id)}
              disabled={!agent}
              data-seat={seat.seat}
            >
              <span className={styles.luxSeatName}>{agent?.name ?? seat.title}</span>
              <span className={styles.luxSeatMeta}>{seat.title}</span>
              <span className={styles.luxSeatStatus}>
                {agent && badge ? <StatusBadge status={badge.status} label={agent.status} /> : <span className={styles.vacant}>vacant</span>}
              </span>
              <span className={styles.luxSeatFoot}>{agent ? `${agent.terminal} · ${subs} sub` : '—'}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function AgentsTree({ agents, onSelect, focusedId, bridge }: {
  agents: AgentRow[];
  onSelect: (id: string) => void;
  focusedId?: string;
  bridge?: NewfBridge | null;
}) {
  const ratings = useRatings(bridge);
  const { roots, childrenOf } = useMemo(() => {
    const byTerminal = new Set(agents.map((a) => a.terminal));
    const children = new Map<string, AgentRow[]>();
    const rootList: AgentRow[] = [];
    for (const agent of agents) {
      if (agent.parent && byTerminal.has(agent.parent)) {
        const list = children.get(agent.parent) ?? [];
        list.push(agent);
        children.set(agent.parent, list);
      } else {
        rootList.push(agent);
      }
    }
    return { roots: rootList, childrenOf: children };
  }, [agents]);

  const row = (agent: AgentRow, depth: number): ReactNode => {
    const badge = OSC_BADGE[agent.status];
    const seat = seatSpec(agent.seat);
    const subs = childrenOf.get(agent.terminal) ?? [];
    return (
      <li key={agent.id}>
        <button
          type="button"
          className={`${styles.rowBtn}${focusedId === agent.id ? ` ${styles.luxTreeFocused}` : ''}`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          onClick={() => onSelect(agent.id)}
        >
          <span className={styles.agentName}>
            <i style={{ background: seat ? SEAT_ACCENT[agent.seat!] : 'var(--nx-dim)' }} />
            {agent.name}
            {seat && <span className={styles.seatName}>{seat.title}</span>}
          </span>
          <RatingBadge rating={ratingFor(ratings.entries, agent)} />
          {badge && <StatusBadge status={badge.status} label={agent.status} />}
        </button>
        {subs.length > 0 && (
          <ul className={styles.subList}>
            {subs.map((sub) => row(sub, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <section className={styles.luxPanel} aria-label="Agents hierarchy">
      <h3 className={styles.luxPanelTitle}>AGENTS</h3>
      <ul className={styles.luxTree}>
        {roots.length ? roots.map((agent) => row(agent, 0)) : <li className={styles.vacant}>нет агентов</li>}
      </ul>
    </section>
  );
}

function EventsStream({ events, error }: { events: LiveEvent[]; error: string | null }) {
  return (
    <section className={styles.luxPanel} aria-label="Event stream">
      <h3 className={styles.luxPanelTitle}>EVENTS{error ? ` · ${error}` : ''}</h3>
      <ul className={styles.luxEvents}>
        {events.length === 0 && <li className={styles.vacant}>{error ? 'поток недоступен' : 'событий пока нет'}</li>}
        {events.map((event) => (
          <li key={event.seq}>
            <time>{fmtEventTime(event.ts)}</time>
            <span style={{ color: EVENT_KIND_ACCENT[event.type] ?? 'var(--nx-muted)' }}>{event.type}</span>
            <span className={styles.luxEventText}>{eventSummary(event)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MachinesFooter({ live }: { live: LiveData }) {
  const machines = useMemo(() => {
    const names = new Set<string>();
    for (const space of live.spaces) if (space.machine) names.add(space.machine);
    for (const term of live.terminals) if (term.machine) names.add(term.machine);
    if (names.size === 0) names.add('local');
    return [...names];
  }, [live.spaces, live.terminals]);
  return (
    <footer className={styles.luxFooter}>
      <span>machines: {machines.map((name) => `${name} ${live.error ? 'offline' : 'live'}`).join(' · ')}</span>
      <span>{live.error ? `bridge: ${live.error}` : `${live.terminals.length} terminals · ${live.agents.length} agents`}</span>
    </footer>
  );
}

function LuxBody({ bridge, focusedId, onSelect }: {
  bridge: NewfBridge | null;
  focusedId?: string;
  onSelect: (id: string) => void;
}) {
  const data = useModData();
  const agents = data.agents as AgentRow[];
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  // #517: SSE-статусы (OSC 7501) между поллами — мгновенные обновления
  // idle/working/done/blocked/error; полл остаётся источником истины,
  // поэтому overrides сбрасываются с каждым новым массивом агентов.
  // Зависимость — стабильный ключ (JSON), а не ссылка: в mock-режиме
  // useModData() создаёт свежий массив на каждый рендер, и зависимость
  // от ссылки порождала бесконечный цикл рендеров.
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({});
  const agentsKey = JSON.stringify(data.agents);

  useEffect(() => {
    if (!bridge?.streamEvents) return;
    return bridge.streamEvents(
      (event) => {
        setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS));
        if ((event.type === 'status' || event.type === 'attention' || event.type === 'done')
          && typeof event.address === 'string'
          && typeof (event.state ?? event.status) === 'string') {
          const address = event.address as string;
          const state = String(event.state ?? event.status);
          setStatusOverrides((prev) => (prev[address] === state ? prev : { ...prev, [address]: state }));
        }
      },
      (message) => setEventsError(message),
    );
  }, [bridge]);

  useEffect(() => {
    setStatusOverrides({});
  }, [agentsKey]);

  const agentsWithStatus = useMemo(
    () => agents.map((a) => ({
      ...a,
      status: statusOverrides[a.terminal] ?? a.status,
    })),
    [agents, statusOverrides],
  );

  const focusedRow = agentsWithStatus.find((a) => a.id === focusedId)
    ?? agentsWithStatus.find((a) => a.status === 'working')
    ?? agentsWithStatus[0];

  return (
    <div className={styles.luxGrid}>
      <AgentsTree agents={agentsWithStatus} onSelect={onSelect} focusedId={focusedRow?.id} bridge={bridge} />
      <div className={styles.luxCenter}>
        {bridge && focusedRow
          ? <LiveTerminalPane address={focusedRow.terminal} bridge={bridge} />
          : (
            <section className={styles.luxPanel} aria-label="Terminal">
              <h3 className={styles.luxPanelTitle}>terminal · {focusedRow?.name ?? '—'}</h3>
              <p className={styles.footerNote}>{focusedRow ? 'mock-режим: живой экран только с live-мостом.' : 'Агент не выбран.'}</p>
            </section>
          )}
      </div>
      <EventsStream events={events} error={bridge?.streamEvents ? eventsError : 'events: core-only'} />
    </div>
  );
}

export function NewfLuxScreen({ live = false, bridgeBase, backend }: {
  live?: boolean;
  bridgeBase?: string;
  backend?: 'core' | string;
}) {
  const bridge = useMemo(() => {
    if (!live) return null;
    return createCoreBridge(bridgeBase);
  }, [live, bridgeBase, backend]);
  const liveData = useLiveData(bridge);
  const [focusedAgent, setFocusedAgent] = useState<string | undefined>(undefined);
  const ui = useMemo<UiState>(() => ({
    activeTab: 'active',
    setActiveTab: () => {},
    activeSpace: undefined,
    setActiveSpace: () => {},
    focusedAgent,
    setFocusedAgent,
    agentOrder: undefined,
    setAgentOrder: () => {},
    focusNextAgent: () => {},
    focusPrevAgent: () => {},
  }), [focusedAgent]);
  const liveCtx = useMemo(() => bridge ? { live: liveData, bridge, dismissAttention: liveData.dismissAttention } : null, [bridge, liveData]);

  const headerMachine = liveData.spaces.find((s) => s.machine)?.machine ?? 'local';
  const voiceUi = useVoiceUi();
  const agents = (live ? liveData.agents : mockHcBridge.agents()) as AgentRow[];
  const footerData: LiveData = live ? liveData : {
    spaces: mockHcBridge.spaces(),
    terminals: mockHcBridge.terminals() as LiveData['terminals'],
    agents: mockHcBridge.agents() as LiveData['agents'],
    error: null,
  };

  const page = (
    <div className={styles.luxShell}>
      <header className={styles.luxHeader}>
        <strong>NEWF</strong>
        <span className={styles.luxHeaderSub}>Nexus Frontend</span>
        {voiceUi.active && (
          <button
            type="button"
            className={`${styles.luxVoiceBtn}${voiceUi.open ? ` ${styles.luxVoiceBtnOn}` : ''}`}
            onClick={() => voiceUi.setOpen(!voiceUi.open)}
            aria-expanded={voiceUi.open}
            aria-label="Голосовая панель"
            data-testid="newf-voice-toggle"
          >
            🎙 Voice
          </button>
        )}
        <span className={styles.luxHeaderRight}>
          {headerMachine} · {liveData.error ? 'offline' : 'live'}
        </span>
      </header>
      <SeatStrip agents={agents} onSelect={setFocusedAgent} focusedId={focusedAgent} />
      <LuxBody bridge={bridge} focusedId={focusedAgent} onSelect={setFocusedAgent} />
      <MachinesFooter live={footerData} />
    </div>
  );

  return (
    <UiContext.Provider value={ui}>
      {liveCtx
        ? <LiveContext.Provider value={liveCtx}>{page}</LiveContext.Provider>
        : page}
    </UiContext.Provider>
  );
}
