'use client';

/**
 * PKG-B1 (PLAN-100-DECK, Фаза B, шаги 11–21) — реальный экран Nexus Deck.
 *
 * Deck = живой статус фермы из nexus-core: агенты, терминалы, машины,
 * панель состояния ядра и индикатор подключения. Ничего не фабрикуем:
 * пустые списки → HonestEmpty, ядро не ответило → честный offline.
 *
 * Связь: createDeckBridge() — roster фермы с /api/deck/* (GET-only, side-effect-
 * free), ядро — /api/core/server, экран терминала — /api/core/terminal/{t}/stream
 * (screenStream, read-only). Живые обновления — streamEvents моста:
 * createDeckBridge читает /api/deck/events, core bridge — /api/core/events;
 * обработчик принимает плоские и legacy-вложенные кадры, fallback-поллинг 10с.
 *
 * Не ломает существующий Deck (deck-tab.tsx как компонент сохранён;
 * манифест программ читается лениво — без роста shared-чанка).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { GlassPanel, LoadingState, StatusBadge } from '@nexus/ui';
import type { NexusStatus } from '@nexus/ui';
import {
  createDeckBridge,
  type CoreServerInfo,
  type DeckStatus,
  type LiveAgent,
  type LiveEvent,
  type LiveTerminal,
  type MachineRecord,
  type NewfBridge,
} from './newf-live';
import { BridgeHttpError } from './newf-live';
import { HonestEmpty } from './honest-empty';
import type { ProgramManifest } from '../programs/manifest';
import styles from './screens.module.css';

export interface DeckScreenProps {
  /** Инъекция для тестов/демо; по умолчанию createDeckBridge() → same-origin /api/deck. */
  bridge?: NewfBridge;
  /** Базовый URL (если bridge не передан). */
  base?: string;
}

export type DeckConnection =
  | { kind: 'checking' }
  | { kind: 'ok' }
  | { kind: 'degraded'; reason: string }
  | { kind: 'offline'; reason: string };

/** Честная расшифровка ошибки моста. */
function bridgeMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Сетевой обрыв (не HTTP-статус) → ядро недостижимо. */
function isUnreachable(error: unknown): boolean {
  return !(error instanceof BridgeHttpError);
}

/** Шаг 15: словарь статусов OSC-терминалов/агентов (aligned с data-source
 *  enum: LIVE/MOCK/CONFIG/SYNCING + OSC-статусы working/idle/blocked/done/
 *  error/archived). extra — визуальный класс бейджа (pulse/dim). */
export const OSC_STATE_VOCAB: Record<string, { badge: NexusStatus; label: string; extra?: 'pulse' | 'dim' }> = {
  working: { badge: 'active', label: 'LIVE', extra: 'pulse' },
  idle: { badge: 'waiting', label: 'IDLE' },
  blocked: { badge: 'warning', label: 'BLOCKED' },
  done: { badge: 'complete', label: 'DONE' },
  error: { badge: 'error', label: 'ERROR' },
  archived: { badge: 'paused', label: 'ARCHIVED' },
  exited: { badge: 'offline', label: 'EXITED', extra: 'dim' },
};

export function agentStatusEntry(state: string): { badge: NexusStatus; label: string; extra?: 'pulse' | 'dim' } {
  return OSC_STATE_VOCAB[state] ?? { badge: 'info', label: state.toUpperCase() };
}

/** Иконка внимания (⚠) — сигнал blocked/attention. */
export function AttentionIcon() {
  return (
    <svg
      className={styles.deckAttentionIcon}
      viewBox="0 0 16 16"
      width="14"
      height="14"
      role="img"
      aria-label="внимание"
    >
      <path d="M8 1.5 15 14H1Z" fill="currentColor" />
      <rect x="7.25" y="6" width="1.5" height="4" fill="var(--nexus-surface-panel, #1A1A21)" />
      <rect x="7.25" y="11" width="1.5" height="1.5" fill="var(--nexus-surface-panel, #1A1A21)" />
    </svg>
  );
}

/** Бейдж статуса Deck: vocab + визуальные классы (pulse/dim) + иконка
 *  внимания для blocked/attention. */
export function DeckStatusBadge({ state, attention }: { state: string; attention?: boolean }) {
  const entry = agentStatusEntry(state);
  const css = entry.extra === 'pulse' ? styles.statusPulse : entry.extra === 'dim' ? styles.statusDim : undefined;
  return (
    <span className={styles.deckBadgeWrap}>
      <StatusBadge status={entry.badge} label={entry.label} className={css} />
      {(attention === true || state === 'blocked') && <AttentionIcon />}
      {attention === true && <StatusBadge status="warning" label="ВНИМАНИЕ" />}
    </span>
  );
}

/** Статусы машин (state из machine_registry). */
export const MACHINE_STATE_VOCAB: Record<string, { badge: NexusStatus; label: string }> = {
  connected: { badge: 'online', label: 'CONNECTED' },
  connecting: { badge: 'syncing', label: 'CONNECTING' },
  error: { badge: 'error', label: 'ERROR' },
  unknown: { badge: 'offline', label: 'UNKNOWN' },
};

export function machineStatusEntry(state: string): { badge: NexusStatus; label: string } {
  return MACHINE_STATE_VOCAB[state] ?? { badge: 'info', label: state.toUpperCase() };
}

/** Персона из labels (persona → agent); fallback — имя/адрес. */
export function personaOf(labels: Record<string, string> | undefined, fallback: string): string {
  if (!labels) return fallback;
  return labels.persona ?? labels.agent ?? fallback;
}

/** Санитизация свободного заголовка (title-события SSE): управляющие
 *  символы убираются, строка обрезается. Пути/команды (у ROLE-3 это
 *  путь pwsh) отбрасываются — в UI показываем только sanitized. */
export function sanitizeTitle(text: string): string {
  const clean = text.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 80);
  if (!clean) return '';
  // пути/команды (C:\…, /usr/…, *.exe, pwsh …, команда с пробелами и флагами)
  if (/^(?:[a-zA-Z]:[\\/]|\/|\.{1,2}[\\/])/.test(clean)) return '';
  if (/\.[a-zA-Z0-9]{1,5}$/.test(clean) && /[\\/]/.test(clean)) return '';
  if (/^(?:pwsh|powershell|cmd|bash|sh|zsh|node|python|git)\b/i.test(clean)) return '';
  return clean;
}

/** Группировка записей по машине; порядок групп — из реестра машин. */
export function groupByMachine<T extends { machine?: string }>(
  items: T[],
  order: string[],
): Array<{ machine: string; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = item.machine ?? '—';
    const arr = map.get(key) ?? [];
    arr.push(item);
    map.set(key, arr);
  }
  const keys = [
    ...order.filter((name) => map.has(name)),
    ...[...map.keys()].filter((name) => !order.includes(name)),
  ];
  return keys.map((machine) => ({ machine, items: map.get(machine)! }));
}

/** Статус самого процесса ядра (server.state). */
export const CORE_STATE_VOCAB: Record<string, { badge: NexusStatus; label: string }> = {
  running: { badge: 'online', label: 'RUNNING' },
  starting: { badge: 'syncing', label: 'STARTING' },
  stopping: { badge: 'warning', label: 'STOPPING' },
  stopped: { badge: 'offline', label: 'STOPPED' },
};

export function coreStatusEntry(state: string): { badge: NexusStatus; label: string } {
  return CORE_STATE_VOCAB[state] ?? { badge: 'info', label: state.toUpperCase() };
}

/** Человекочитаемый аптайм: 86400 → «24ч», 90 → «1м 30с». */
export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return m > 0 ? `${h}ч ${m}м` : `${h}ч`;
  if (m > 0) return r > 0 ? `${m}м ${r}с` : `${m}м`;
  return `${r}с`;
}

/** Относительная метка «когда»: since_ms (unix, мс) → «только что». */
export function formatSince(sinceMs: number | undefined): string {
  if (typeof sinceMs !== 'number' || !Number.isFinite(sinceMs) || sinceMs <= 0) return '—';
  const delta = Math.max(0, Date.now() - sinceMs);
  const min = Math.floor(delta / 60000);
  if (delta < 60000) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч назад`;
  return new Date(sinceMs).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function DeckScreen({ bridge, base }: DeckScreenProps) {
  const core = useMemo(() => bridge ?? createDeckBridge(base), [bridge, base]);

  const [conn, setConn] = useState<DeckConnection>({ kind: 'checking' });
  const [coreInfo, setCoreInfo] = useState<CoreServerInfo | null>(null);
  const [deckStatus, setDeckStatus] = useState<DeckStatus | null>(null);
  const [agents, setAgents] = useState<LiveAgent[] | null>(null);
  const [terminals, setTerminals] = useState<LiveTerminal[] | null>(null);
  const [machines, setMachines] = useState<MachineRecord[] | null>(null);
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({});
  const [selectedTerm, setSelectedTerm] = useState<string | null>(null);
  const [screenText, setScreenText] = useState<string | null>(null);
  const [screenLoading, setScreenLoading] = useState(false);
  const [deckApp, setDeckApp] = useState<ProgramManifest['programs'][number] | null>(null);

  const inFlight = useRef(false);
  const lastRunRef = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // NUE-1 owner-финал: Deck — отдельное скачиваемое приложение; манифест
  // читаем лениво (не тащим в первый кадр).
  useEffect(() => {
    let alive = true;
    import('../programs/manifest').then((m) => {
      if (!alive) return;
      const p = m.PROGRAMS_MANIFEST.programs.find((x) => x.id === 'deck');
      setDeckApp(p ?? null);
    }).catch(() => { /* нет записи — карточка просто не показывается */ });
    return () => { alive = false; };
  }, []);

  /** Полная/мягкая перезагрузка данных. Мягкая (silent) не мигает
   *  checking и не трогает статус соединения при успехе.
   *
   * Poll-обновления (таймер) троттлятся ≥10с — deck-эндпоинты
   * side-effect-free, но без необходимости поллинг не нужен. SSE-события
   * этим троттлингом НЕ ограничены — они и есть живой канал. */
  const refresh = useCallback(async (opts?: { silent?: boolean; force?: boolean; poll?: boolean }) => {
    if (inFlight.current) return;
    const now = Date.now();
    if (opts?.poll && !opts.force && now - lastRunRef.current < 10000) return;
    lastRunRef.current = now;
    inFlight.current = true;
    try {
      if (!opts?.silent) setConn({ kind: 'checking' });
      const errs: Record<string, string> = {};
      let farmConnected = true;
      let coreUnreachable = false;

      // Статус фермы: канонический источник connected/events. Если ферма
      // не подключена — offline честно (без фабрикации данных).
      if (typeof core.deck === 'function') {
        try {
          const status = await core.deck();
          if (mounted.current) setDeckStatus(status);
          farmConnected = status.connected;
        } catch {
          farmConnected = false;
        }
      }
      if (mounted.current && !farmConnected) {
        setConn({ kind: 'offline', reason: 'ферма не подключена (rt.connected=false) — данные недоступны честно' });
        // HonestEmpty: данные не фабрикуются — секции пусты честно.
        if (mounted.current) {
          setAgents([]);
          setTerminals([]);
          setMachines([]);
          setSectionErrors({});
        }
        return;
      }

      // Ядро: server() — если недостижимо, offline честно.
      if (typeof core.server === 'function') {
        try {
          const info = await core.server();
          if (mounted.current) setCoreInfo(info);
        } catch (error) {
          if (isUnreachable(error)) {
            coreUnreachable = true;
            if (mounted.current) setConn({ kind: 'offline', reason: bridgeMessage(error) });
            return;
          }
          errs.core = bridgeMessage(error);
        }
      }

      // Секции — параллельно, каждая честно: успех или ошибка.
      await Promise.all([
        (async () => {
          try {
            const list = await core.agents();
            if (mounted.current) setAgents(list);
          } catch (error) { errs.agents = bridgeMessage(error); }
        })(),
        (async () => {
          try {
            const list = await core.terminals();
            if (mounted.current) setTerminals(list);
          } catch (error) { errs.terminals = bridgeMessage(error); }
        })(),
        (async () => {
          if (core.machines == null) return;
          try {
            const list = await core.machines.list();
            if (mounted.current) setMachines(list);
          } catch (error) { errs.machines = bridgeMessage(error); }
        })(),
      ]);

      if (!mounted.current) return;
      setSectionErrors(errs);
      const failureCount = Object.keys(errs).length;
      if (failureCount === 0) {
        setConn({ kind: 'ok' });
      } else if (failureCount >= 3) {
        // ферма/ядро ok, но ни одна секция не отдала данные.
        setConn({ kind: 'offline', reason: 'ядро ответило, но все разделы недоступны' });
      } else {
        const first = Object.entries(errs)[0];
        setConn({ kind: 'degraded', reason: `недоступен раздел ${first[0]}: ${first[1]}` });
      }
    } finally {
      inFlight.current = false;
    }
  }, [core]);

  // createDeckBridge consumes /api/deck/events; core bridge consumes /api/core/events.
  // Both normalize to LiveEvent; handler accepts flat and legacy nested frames.
  // Status/turn update locally; other relevant events trigger a silent refresh.
  const applySseStatus = useCallback((address: string, raw: string) => {
    const KNOWN: LiveTerminal['state'][] = ['working', 'idle', 'blocked', 'done', 'error', 'archived', 'exited'];
    const state = (KNOWN.includes(raw as LiveTerminal['state']) ? raw : 'idle') as LiveTerminal['state'];
    setTerminals((prev) => prev ? prev.map((t) => t.address === address ? { ...t, state } : t) : prev);
    setAgents((prev) => prev ? prev.map((a) => a.terminal === address ? { ...a, status: state } : a) : prev);
  }, []);

  const handleSse = useCallback((event: LiveEvent) => {
    const type = typeof event.type === 'string' ? event.type : '';
    // createDeckBridge нормализует /api/deck/events; core stream тоже flat.
    // Поддерживаем address/state и legacy terminal/data.state.
    const relevant = /agent|terminal|machine|screen|status|turn|title/i.test(type);
    if (!relevant) return;
    // Плавный путь: status/turn — точечный локальный переход, refetch не
    // нужен (крайние данные синхронизируются поллингом 10с). Остальные
    // типы меняют состав списков → мягкий refetch.
    const addr = event.address ?? event.terminal;
    const s = event.state ?? (event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>).state : undefined);
    if (type === 'status' && typeof addr === 'string' && typeof s === 'string') {
      applySseStatus(addr, s);
      return;
    }
    const turn = event.turn ?? (event.data && typeof event.data === 'object'
      ? (event.data as Record<string, unknown>).turn : undefined);
    if (type === 'turn' && typeof addr === 'string' && typeof turn === 'number') {
      setAgents((prev) => prev ? prev.map((a) => a.terminal === addr ? { ...a, turn } : a) : prev);
      return;
    }
    // title — свободный текст: показываем только sanitized (у ROLE-3 это
    // путь pwsh). Персону (labels.persona/agent) НЕ перезаписываем — в
    // ростере уже есть name/persona. Локально обновляем title, чтобы
    // смена заголовка не ждала поллинга 10с.
    const title = event.title ?? (event.data && typeof event.data === 'object'
      ? (event.data as Record<string, unknown>).title : undefined);
    if (type === 'title' && typeof addr === 'string' && title != null) {
      const clean = sanitizeTitle(String(title));
      if (clean) {
        setTerminals((prev) => prev ? prev.map((t) => t.address === addr ? { ...t, title: clean } : t) : prev);
        setAgents((prev) => prev ? prev.map((a) => a.terminal === addr ? { ...a, title: clean } : a) : prev);
      }
      return;
    }
    void refresh({ silent: true });
  }, [applySseStatus, refresh]);

  useEffect(() => {
    void refresh({ silent: false });
    const timer = setInterval(() => void refresh({ silent: true, poll: true }), 10000);
    let unsubscribe: (() => void) | undefined;
    if (typeof core.streamEvents === 'function') {
      unsubscribe = core.streamEvents(handleSse, () => { /* SSE оборвался — поллинг 10с остаётся */ });
    }
    return () => {
      clearInterval(timer);
      unsubscribe?.();
    };
  }, [refresh, core, handleSse]);

  // Экран выделенного терминала (шаг 18): живой screenStream, read-only.
  useEffect(() => {
    if (selectedTerm == null) {
      setScreenText(null);
      setScreenLoading(false);
      return;
    }
    let alive = true;
    setScreenText(null);
    setScreenLoading(true);
    if (typeof core.screenStream !== 'function') {
      setScreenLoading(false);
      setScreenText('');
      return;
    }
    const unsubscribe = core.screenStream(
      selectedTerm,
      (screen) => {
        if (!alive) return;
        setScreenText(screen);
        setScreenLoading(false);
      },
      () => { if (alive) setScreenLoading(false); },
    );
    return () => { alive = false; unsubscribe(); };
  }, [selectedTerm, core]);

  const handleAgentKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const cards = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[data-agent-card]'),
    );
    if (cards.length === 0) return;
    const current = cards.findIndex((card) => card === document.activeElement);
    const next = event.key === 'ArrowDown'
      ? Math.min(current + 1, cards.length - 1)
      : Math.max(current - 1, 0);
    cards[next]?.focus();
  };

  const handleTerminalKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const rows = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[data-terminal-row]'),
    );
    if (rows.length === 0) return;
    const current = rows.findIndex((row) => row === document.activeElement);
    const next = event.key === 'ArrowDown'
      ? Math.min(current + 1, rows.length - 1)
      : Math.max(current - 1, 0);
    rows[next]?.focus();
  };

  const agentCount = agents?.length ?? 0;
  const terminalCount = terminals?.length ?? 0;
  const liveTerminals = terminals?.filter((t) => t.state === 'working' || t.state === 'idle').length ?? 0;
  const machineCount = machines?.length ?? 0;

  // Группировка по машинам: порядок групп — из реестра машин (host-перекрёст).
  const machineOrder = useMemo(() => {
    const seen = new Set<string>();
    const order: string[] = [];
    for (const m of machines ?? []) {
      if (m.name && !seen.has(m.name)) { seen.add(m.name); order.push(m.name); }
    }
    return order;
  }, [machines]);
  const machineHost = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of machines ?? []) if (m.name) map.set(m.name, m.host || m.target || '');
    return map;
  }, [machines]);
  const agentGroups = useMemo(() => groupByMachine(agents ?? [], machineOrder), [agents, machineOrder]);
  const terminalGroups = useMemo(() => groupByMachine(terminals ?? [], machineOrder), [terminals, machineOrder]);

  const machineGroupHead = (machine: string, count: number) => (
    <div className={styles.deckMachineHead}>
      <span className={styles.deckMachineName}>{machine}</span>
      {machineHost.get(machine) ? <span className={styles.deckMachineHost}>{machineHost.get(machine)}</span> : null}
      <StatusBadge status="info" label={String(count)} />
    </div>
  );

  const connectionBadge =
    conn.kind === 'checking' ? <LoadingState>Проверяю ядро…</LoadingState>
    : conn.kind === 'ok' ? <StatusBadge status="online" label="CORE LIVE" />
    : conn.kind === 'degraded' ? <StatusBadge status="warning" label="ЧАСТИЧНО" />
    : <StatusBadge status="offline" label="CORE OFFLINE" />;

  const connectionNote =
    conn.kind === 'ok' ? 'Ядро отвечает — данные живые (SSE + поллинг 15с).'
    : conn.kind === 'checking' ? 'Первичная проверка подключения к nexus-core…'
    : conn.kind === 'degraded' ? `Частичная доступность: ${conn.reason}.`
    : `Ядро недоступно: ${conn.reason}. Данные не фабрикуются — секции пусты честно.`;

  // Раздел агентов: null = загрузка, [] = честный пустой, иначе карточки.
  let agentsBlock: ReactNode;
  if (agents == null) {
    agentsBlock = <LoadingState>Загружаю агентов…</LoadingState>;
  } else if (agents.length === 0) {
    agentsBlock = (
      <HonestEmpty
        label="Агентов нет"
        subtitle="nexus-core не видит ни одного агента. Появятся после connect машин (Phase E)."
      />
    );
  } else {
    agentsBlock = (
      <div className={styles.deckMachineGroups}>
        {agentGroups.map(({ machine, items }) => (
          <section key={machine} className={styles.deckMachineGroup}>
            {machineGroupHead(machine, items.length)}
            <div className={styles.agentCards} role="list" aria-label={`Агенты ${machine}`} onKeyDown={handleAgentKeyDown}>
              {items.map((agent) => {
                const entry = agentStatusEntry(agent.status);
                const persona = personaOf(agent.labels, agent.name);
                return (
                  <div
                    key={agent.id}
                    className={styles.agentCard}
                    role="listitem"
                    data-agent-card
                    data-status={agent.status}
                    tabIndex={0}
                    aria-label={`Агент ${persona}, статус ${entry.label}`}
                  >
                    <div className={styles.agentCardText}>
                      <span className={styles.agentCardName}>{persona}</span>
                      <span className={styles.agentCardSub}>
                        {agent.app ?? agent.seat ?? agent.terminal}
                        {typeof agent.turn === 'number' && agent.turn > 0 ? ` · ход ${agent.turn}` : ''}
                      </span>
                      <span className={styles.agentCardMono}>
                        {agent.machine ?? agent.terminal}
                        {agent.cwd ? ` · ${agent.cwd}` : ''}
                      </span>
                      {agent.title ? <span className={styles.termTitle}>{agent.title}</span> : null}
                    </div>
                    <span className={styles.deckBadgeWrap}>
                      <DeckStatusBadge state={agent.status} />
                      <span className={styles.termBadge}>{agent.terminal}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    );
  }

  let terminalsBlock: ReactNode;
  if (terminals == null) {
    terminalsBlock = <LoadingState>Загружаю терминалы…</LoadingState>;
  } else if (terminals.length === 0) {
    terminalsBlock = (
      <HonestEmpty
        label="Терминалов нет"
        subtitle="Запущенные терминалы появятся здесь после подключения машин."
      />
    );
  } else {
    terminalsBlock = (
      <div className={styles.deckMachineGroups}>
        {terminalGroups.map(({ machine, items }) => (
          <section key={machine} className={styles.deckMachineGroup}>
            {machineGroupHead(machine, items.length)}
            <div className={styles.terminalRows} role="list" aria-label={`Терминалы ${machine}`} onKeyDown={handleTerminalKeyDown}>
              {items.map((terminal) => {
                const persona = personaOf(terminal.labels, terminal.label);
                return (
                  <button
                    key={terminal.address}
                    type="button"
                    className={styles.terminalRow}
                    role="listitem"
                    data-terminal-row
                    data-status={terminal.state}
                    data-selected={terminal.address === selectedTerm ? 'true' : 'false'}
                    aria-pressed={terminal.address === selectedTerm}
                    aria-label={`Терминал ${persona} (${terminal.address}), статус ${agentStatusEntry(terminal.state).label}${terminal.machine ? `, машина ${terminal.machine}` : ''}`}
                    onClick={() => setSelectedTerm(terminal.address === selectedTerm ? null : terminal.address)}
                  >
                    <span className={styles.terminalName}>{persona}</span>
                    <span className={styles.termBadge}>{terminal.address}</span>
                    {terminal.title ? <span className={styles.termTitle}>{terminal.title}</span> : null}
                    <DeckStatusBadge state={terminal.state} attention={terminal.attention} />
                    <span className={styles.terminalMachine}>{terminal.machine ?? '—'}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    );
  }

  let machinesBlock: ReactNode;
  if (machines == null) {
    machinesBlock = <LoadingState>Загружаю машины…</LoadingState>;
  } else if (machines.length === 0) {
    machinesBlock = (
      <HonestEmpty
        label="Машин нет"
        subtitle="Реестр машин пуст — только local-машина появится после deployment."
      />
    );
  } else {
    machinesBlock = (
      <div className={styles.machineRows} role="list" aria-label="Машины">
        {machines.map((machine) => {
          const entry = machineStatusEntry(machine.state);
          return (
            <div key={machine.name} className={styles.machineRow} role="listitem" data-status={machine.state}>
              <span className={styles.terminalName}>{machine.name}</span>
              <StatusBadge status={entry.badge} label={entry.label} />
              <span className={styles.rowMeta}>{machine.transport}</span>
              <span className={styles.rowMeta}>{machine.host || machine.target || '—'}</span>
              <span className={styles.rowText}>{formatSince(machine.since_ms)}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={styles.panelStack} data-state={conn.kind} data-testid="deck-screen">
      <GlassPanel className={styles.panel} data-testid="deck-screen-header">
        <div className={styles.panelHead}>
          <h3 className={styles.panelTitle}>Nexus Deck</h3>
          {connectionBadge}
        </div>
        <p className={styles.panelNote} data-testid="deck-conn-note">{connectionNote}</p>
        {deckStatus != null && (
          <p className={styles.panelNote} data-testid="deck-farm-note">
            Ферма: {deckStatus.version || '—'} · сессия {deckStatus.session || '—'} ·{' '}
            события seq {deckStatus.eventsSeq}
            {!deckStatus.eventsConnected ? ' (SSE отключён — только поллинг)' : ''}
          </p>
        )}
        <span className={styles.visuallyHidden} aria-live="polite" data-testid="deck-conn-live">
          {conn.kind === 'ok' ? 'Ядро онлайн' : conn.kind === 'offline' ? 'Ядро офлайн' : conn.kind === 'degraded' ? 'Ядро частично доступно' : 'Проверка подключения'}
        </span>
        {deckApp != null && (
          <p className={styles.panelNote} data-testid="deck-app-note">
            Приложение {deckApp.nexusName} (v{deckApp.version ?? '—'}){' '}
            {deckApp.artifactUrl != null
              ? `скачивается: ${deckApp.artifactUrl}`
              : '— артефакт ещё не опубликован (owner).'}
          </p>
        )}
      </GlassPanel>

      <div className={styles.deckTwoCol}>
        <div className={styles.deckCol}>
          {/* Шаг 12: панель состояния ядра */}
          <GlassPanel className={styles.panel} data-testid="deck-core-panel">
            <div className={styles.panelHead}>
              <h3 className={styles.panelTitle}>Ядро</h3>
              {coreInfo != null && <StatusBadge status={coreStatusEntry(coreInfo.state).badge} label={coreStatusEntry(coreInfo.state).label} />}
            </div>
            {coreInfo == null ? (
              <p className={styles.panelNote}>Информация о ядре недоступна.</p>
            ) : (
              <dl className={styles.statGrid}>
                <div>
                  <dt>Версия</dt>
                  <dd data-testid="deck-core-version">{coreInfo.version || '—'}</dd>
                </div>
                <div>
                  <dt>Аптайм</dt>
                  <dd>{formatUptime(coreInfo.uptime_s)}</dd>
                </div>
                <div>
                  <dt>Состояние</dt>
                  <dd>{coreInfo.state}</dd>
                </div>
                <div>
                  <dt>Хост</dt>
                  <dd>{coreInfo.host ?? '—'}</dd>
                </div>
              </dl>
            )}
          </GlassPanel>

          {/* Шаг 11: агенты */}
          <GlassPanel className={styles.panel} data-testid="deck-agents-panel">
            <div className={styles.panelHead}>
              <h3 className={styles.panelTitle}>Агенты</h3>
              {agents != null && <StatusBadge status={agentCount > 0 ? 'info' : 'offline'} label={`${agentCount}`} />}
            </div>
            {sectionErrors.agents != null && agents == null && (
              <p className={styles.panelNote}>Ошибка раздела: {sectionErrors.agents}</p>
            )}
            {agentsBlock}
          </GlassPanel>

          {/* Шаг 16: терминалы */}
          <GlassPanel className={styles.panel} data-testid="deck-terminals-panel">
            <div className={styles.panelHead}>
              <h3 className={styles.panelTitle}>Терминалы</h3>
              {terminals != null && <StatusBadge status={liveTerminals > 0 ? 'online' : 'info'} label={`${liveTerminals}/${terminalCount} live`} />}
            </div>
            {terminalsBlock}
          </GlassPanel>
        </div>

        <div className={styles.deckCol}>
          {/* Шаг 17: машины */}
          <GlassPanel className={styles.panel} data-testid="deck-machines-panel">
            <div className={styles.panelHead}>
              <h3 className={styles.panelTitle}>Машины</h3>
              {machines != null && <StatusBadge status={machineCount > 0 ? 'info' : 'offline'} label={`${machineCount}`} />}
            </div>
            {machinesBlock}
          </GlassPanel>

          {/* Шаг 18: экран выделенного терминала (read-only) */}
          <GlassPanel className={styles.panel} data-testid="deck-screen-panel">
            <div className={styles.panelHead}>
              <h3 className={styles.panelTitle}>Экран терминала</h3>
              {selectedTerm != null && <span className={styles.rowMeta}>{selectedTerm}</span>}
            </div>
            {selectedTerm == null ? (
              <p className={styles.panelNote}>
                Выберите терминал в списке выше — здесь появится read-only снимок
                его экрана (live, через SSE).
              </p>
            ) : screenLoading ? (
              <LoadingState>Подключаюсь к экрану…</LoadingState>
            ) : screenText === '' ? (
              <HonestEmpty label="Экран пуст" subtitle="Терминал не отдаёт содержимое экрана." />
            ) : (
              <pre className={styles.screenPreview} data-testid="deck-screen-preview">{screenText}</pre>
            )}
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}
