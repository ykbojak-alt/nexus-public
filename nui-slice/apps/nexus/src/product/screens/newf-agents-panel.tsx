'use client';

/** NEWF "Spaces & Agents" sidebar — Herdr-parity панель (#536).
 *
 * Самодостаточный компонент: данные через createCoreBridge с same-origin,
 * poll каждые 300мс. НЕ трогает newf.tsx/newf-screen.ts (зона FORGE).
 *
 * Структура:
 *   MACHINES — реестр машин сверху, connected/unreachable/…
 *   WORKING / IDLE / DONE — терминалы, сгруппированные по state;
 *   blocked/error вынесены в NEEDS ATTENTION.
 *   Бейдж агента: цветная точка + имя + relative-time (created_at/exited_at).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BridgeUnavailable,
  createCoreBridge,
  type LiveTerminal,
  type LiveSpace,
  type LiveSpaceDetail,
  type MachineRecord,
  type MachineDetail,
  type NewfBridge,
  type ProgramEntry,
  type WorktreeEntry,
  type ApprovalEntry,
} from './newf-live';
import styles from './newf-agents-panel.module.css';
import { ShareDialog } from './newf-share-ui';
import { SharesList } from './newf-share-ui';
import { NewfCtxMenu } from './newf-ctx-menu';

export const POLL_MS = 300;
export const PINS_STORAGE_KEY = 'newf.pins.v1';
export const SPACES_ORDER_STORAGE_KEY = 'newf.spaces.order.v1';

/** W66: порядок спейсов (drag-reorder) — localStorage-преференс. */
export function readSpacesOrder(): string[] {
  try {
    const raw = window.localStorage.getItem(SPACES_ORDER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch { return []; }
}

function writeSpacesOrder(order: string[]): void {
  try { window.localStorage.setItem(SPACES_ORDER_STORAGE_KEY, JSON.stringify(order)); } catch { /* noop */ }
}

/** W61: закреплённые терминалы (address → true) — localStorage-преференс. */
export function readPins(): Set<string> {
  try {
    const raw = window.localStorage.getItem(PINS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch { return new Set(); }
}

function writePins(pins: Set<string>): void {
  try { window.localStorage.setItem(PINS_STORAGE_KEY, JSON.stringify([...pins])); } catch { /* noop */ }
}

/** Продолжительность (сек) → "45s"/"3m"/"2h"/"5d". */
export function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 1) return '1s';
  if (sec < 60) return `${Math.floor(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

/* ---------- чистая логика (тестируемая без DOM) ---------- */

export type AgentGroup = 'working' | 'idle' | 'done' | 'attention' | 'archived';

/** Сохраняем отдельную группу для blocked/error, чтобы не выдавать их за idle/done. */
export function groupOf(state: LiveTerminal['state']): AgentGroup {
  if (state === 'working') return 'working';
  if (state === 'done') return 'done';
  if (state === 'blocked' || state === 'error') return 'attention';
  if (state === 'archived') return 'archived';
  return 'idle';
}

export interface GroupedAgents {
  working: LiveTerminal[];
  idle: LiveTerminal[];
  done: LiveTerminal[];
  attention: LiveTerminal[];
  archived: LiveTerminal[];
}

/** Группировка терминалов по state, внутри группы — по имени. */
export function groupTerminals(terms: LiveTerminal[]): GroupedAgents {
  const groups: GroupedAgents = { working: [], idle: [], done: [], attention: [], archived: [] };
  for (const t of terms) groups[groupOf(t.state)].push(t);
  for (const key of Object.keys(groups) as AgentGroup[]) {
    groups[key].sort((a, b) => (a.label || a.address).localeCompare(b.label || b.address));
  }
  return groups;
}

/** unix-секунды → "только что"/"45s"/"3m"/"2h"/"5d". */
export function formatRelative(ts: number | undefined, now: number = Date.now() / 1000): string {
  if (!ts || !Number.isFinite(ts)) return '—';
  const diff = Math.max(0, now - ts);
  if (diff < 10) return 'now';
  if (diff < 60) return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

/** Метка машины: connected/unreachable/connecting/needs_login/… */
export function machineBadge(state: string): { cls: string; label: string } {
  switch (state) {
    case 'connected': return { cls: styles.machineOk, label: 'connected' };
    case 'connecting': return { cls: styles.machineWarn, label: 'connecting' };
    case 'needs_login': return { cls: styles.machineWarn, label: 'needs login' };
    case 'unreachable': return { cls: styles.machineBad, label: 'unreachable' };
    default: return { cls: styles.machineDim, label: state || 'unknown' };
  }
}

/** Точка статуса терминала: цвет по state. */
function dotClass(state: LiveTerminal['state']): string {
  switch (state) {
    case 'working': return styles.dotWorking;
    case 'blocked': return styles.dotBlocked;
    case 'done': return styles.dotDone;
    case 'error': return styles.dotError;
    case 'archived': return styles.dotArchived;
    default: return styles.dotIdle;
  }
}

/* ---------- компонент ---------- */

export interface NewfAgentsPanelProps {
  /** Инъекция для тестов/демо; по умолчанию createCoreBridge() использует same-origin. */
  bridge?: NewfBridge;
  /** Базовый URL core (если bridge не передан). */
  base?: string;
  /** Интервал опроса, мс (default 300). */
  pollMs?: number;
  /** Текущее время для relative-time (тесты); default Date.now. */
  now?: () => number;
  /** #552: открыть floating-окно с терминалом (по умолчанию no-op). */
  onOpenFloating?: (address: string) => void;
}

type LoadState = 'loading' | 'ok' | 'offline';

export function NewfAgentsPanel({
  bridge,
  base,
  pollMs = POLL_MS,
  now = () => Date.now(),
  onOpenFloating,
}: NewfAgentsPanelProps) {
  const [terms, setTerms] = useState<LiveTerminal[]>([]);
  const [spaces, setSpaces] = useState<LiveSpace[]>([]);
  // W32: детали спейсов (GET /api/core/spaces/detail) — terms/live/members.
  const [spaceDetail, setSpaceDetail] = useState<LiveSpaceDetail[]>([]);
  // W32: активный фильтр по спейсу (id или null = все карточки).
  const [spaceFilter, setSpaceFilter] = useState<string | null>(null);
  const [machines, setMachines] = useState<MachineRecord[]>([]);
  // W9: детальные карточки (?detail=1).
  const [machineDetail, setMachineDetail] = useState<MachineDetail[]>([]);
  // W14: worktrees-статусы (бейджи).
  const [worktrees, setWorktrees] = useState<WorktreeEntry[]>([]);
  // W20: approval-запросы (pending-баннер).
  const [approvals, setApprovals] = useState<ApprovalEntry[]>([]);
  // W56: ошибки GET /approvals → offline-state (не пустая очередь).
  const [approvalOffline, setApprovalOffline] = useState(false);
  // W36: admin token (X-AEGIS-Key) для решений; ошибки 401/503 честно.
  const [adminToken, setAdminToken] = useState('');
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [load, setLoad] = useState<LoadState>('loading');
  const [machineLoad, setMachineLoad] = useState<LoadState>('loading');
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [menu, setMenu] = useState<{ x: number; y: number; term: string } | null>(null);
  // W38: share-диалог (терминал → создание/ссылка).
  const [shareTerm, setShareTerm] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // W30: показывать архивные терминалы (по умолчанию скрыты).
  const [showArchived, setShowArchived] = useState(false);
  // W31: глубины send-очередей (address → depth; пусто = нет очередей).
  const [queues, setQueues] = useState<Record<string, number>>({});
  // W18: мультивыбор → batch-действия.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // W61: закреплённые строки (pin) — localStorage-преференс, везде вверху.
  const [pins, setPins] = useState<Set<string>>(() => readPins());
  const togglePin = (address: string) => {
    setPins((prev) => {
      const n = new Set(prev);
      if (n.has(address)) n.delete(address); else n.add(address);
      writePins(n);
      return n;
    });
  };
  // W66: sort-режим агентов (herdr: priority|grouped) + drag-reorder спейсов.
  const [agentSort, setAgentSort] = useState<'grouped' | 'priority'>('grouped');
  const [spaceOrder, setSpaceOrder] = useState<string[] | null>(null);
  // W66: drag-reorder спейсов (HTML5 DnD, localStorage-преференс).
  const dragSpaceRef = useRef<string | null>(null);
  const orderedSpaces = useMemo(() => {
    if (!spaceOrder || spaceOrder.length === 0) return spaces;
    const byId = new Map(spaces.map((s) => [s.id, s] as const));
    const sorted: LiveSpace[] = [];
    for (const id of spaceOrder) {
      const s = byId.get(id);
      if (s) { sorted.push(s); byId.delete(id); }
    }
    for (const s of byId.values()) sorted.push(s);
    return sorted;
  }, [spaces, spaceOrder]);
  const dropSpace = (targetId: string) => {
    const src = dragSpaceRef.current;
    dragSpaceRef.current = null;
    if (!src || src === targetId) return;
    const base = spaceOrder ?? spaces.map((s) => s.id);
    const order = base.filter((id) => id !== src);
    const ti = order.indexOf(targetId);
    order.splice(ti < 0 ? order.length : ti, 0, src);
    setSpaceOrder(order);
    writeSpacesOrder(order);
  };
  const toggleSelected = (address: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(address)) n.delete(address); else n.add(address);
      return n;
    });
  };
  const batch = (action: 'kill' | 'respawn') => {
    if (selected.size === 0) return;
    void br.batch?.({ action, terms: [...selected] })
      .then(() => { setSelected(new Set()); setMenu(null); })
      .catch(() => setMenu(null));
  };
  const [errText, setErrText] = useState<string | null>(null);
  const [machineErrText, setMachineErrText] = useState<string | null>(null);
  const inflight = useRef(false);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  // bridge создаётся один раз; base/bridge пропсы — только начальные.
  const br = useMemo(
    () => bridge ?? (base ? createCoreBridge(base) : createCoreBridge()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // W5: capabilities-флаги (null = capability не объявлена → gating off).
  const [caps, setCaps] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    if (!br.capabilities) { setCaps(null); return; }
    let cancelled = false;
    br.capabilities()
      .then((res) => { if (!cancelled) setCaps(res.endpoints ?? {}); })
      .catch(() => { if (!cancelled) setCaps({}); }); // офлайн/404 → все выкл
    return () => { cancelled = true; };
  }, [br]);
  /** W5: capability-гейт (true если gating off, иначе флаг). */
  const cap = (name: string): boolean => (caps === null ? true : Boolean(caps[name]));

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (inflight.current) return;
      inflight.current = true;
      try {
        const tasks: Promise<unknown>[] = [
          br.terminals(),
          br.spaces?.() ?? Promise.resolve([] as LiveSpace[]),
          ...(br.machines ? [br.machines.list()] : [Promise.reject(new BridgeUnavailable('no machines'))]),
          ...(br.machinesDetail ? [br.machinesDetail()] : [Promise.resolve([] as MachineDetail[])]),
        ];
        const [terminalsResult, spacesResult, machinesResult, machinesDetailResult] = await Promise.allSettled(tasks);
        if (cancelled) return;
        if (terminalsResult.status === 'fulfilled') {
          setTerms(terminalsResult.value as LiveTerminal[]);
          setLoad('ok');
          setErrText(null);
        } else {
          setLoad('offline');
          setErrText(terminalsResult.reason instanceof Error ? terminalsResult.reason.message : String(terminalsResult.reason));
        }
        if (spacesResult.status === 'fulfilled') {
          setSpaces(spacesResult.value as LiveSpace[]);
        }
        if (machinesResult.status === 'fulfilled') {
          setMachines(machinesResult.value as MachineRecord[]);
          setMachineLoad('ok');
          setMachineErrText(null);
        } else {
          setMachineLoad('offline');
          setMachineErrText(machinesResult.reason instanceof Error ? machinesResult.reason.message : String(machinesResult.reason));
        }
        if (machinesDetailResult.status === 'fulfilled') {
          setMachineDetail(machinesDetailResult.value as MachineDetail[]);
        }
        if (br.worktrees) {
          br.worktrees().then((list) => { if (!cancelled) setWorktrees(list); }).catch(() => {});
        }
        if (br.approvals) {
          br.approvals()
            .then((list) => { if (!cancelled) { setApprovals(list); setApprovalOffline(false); } })
            .catch(() => { if (!cancelled) setApprovalOffline(true); });
        }
        if (br.sendQueues) {
          br.sendQueues().then((q) => { if (!cancelled) setQueues(q); }).catch(() => {});
        }
        if (br.spacesDetail) {
          br.spacesDetail().then((list) => { if (!cancelled) setSpaceDetail(list); }).catch(() => {});
        }
      } catch (error) {
        if (cancelled) return;
        setLoad('offline');
        setErrText(error instanceof Error ? error.message : String(error));
      } finally {
        inflight.current = false;
      }
    };
    void tick();
    const id = setInterval(() => void tick(), pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [br, pollMs]);

  // W30: архивные скрыты по умолчанию — исключаем до группировки,
  // чтобы они не появлялись в живой секции как idle (#536 normalize).
  // W32: фильтр по спейсу (members из /spaces/detail, фолбэк spaceId).
  const visibleTerms = useMemo(() => {
    let list = showArchived ? terms : terms.filter((t) => t.state !== 'archived');
    if (spaceFilter) {
      const detail = spaceDetail.find((s) => s.id === spaceFilter);
      const members = new Set(detail?.members ?? []);
      list = list.filter((t) => members.has(t.address) || t.spaceId === spaceFilter);
    }
    return list;
  }, [terms, showArchived, spaceFilter, spaceDetail]);
  const groups = useMemo(() => groupTerminals(visibleTerms), [visibleTerms]);
  const nowSec = now() / 1000;

  const renderGroup = (key: AgentGroup, title: string) => {
    const list = groups[key];
    if (list.length === 0) return null;
    // W6: children под parent (отступ + иконка die_with_parent ⛓/○),
    // collapse-стрелки, sorted; survivor (die=false) — метка.
    // W61: pinned-строки идут первыми (внутри группы), остальные по label.
    const rootList = list
      .filter((t) => !list.some((p) => p.address === t.parent))
      .sort((a, b) => {
        const pa = pins.has(a.address) ? 0 : 1;
        const pb = pins.has(b.address) ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return (a.label || a.address).localeCompare(b.label || b.address);
      });
    const childrenOf = (address: string) => list.filter((t) => t.parent === address).sort((a, b) => a.label.localeCompare(b.label));
    return (
      <section key={key} className={styles.group} aria-label={title}>
        <h3 className={styles.groupTitle}>
          {title} <span className={styles.groupCount}>{list.length}</span>
        </h3>
        <ul className={styles.list}>
          {rootList.map((t) => {
            const children = childrenOf(t.address);
            const isCollapsed = collapsed.has(t.address);
            const row = (term: LiveTerminal, depth: number) => (
              <li
                key={term.address}
                className={styles.badge}
                style={{ marginLeft: depth * 14 }}
                onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, term: term.address }); }}
                data-testid={`term-row-${term.address}`}
                data-indent={depth > 0 ? 'child' : 'root'}
              >
                <span className={`${styles.dot} ${dotClass(term.state)}`} aria-hidden="true" />
                {br.batch && (
                  <input
                    type="checkbox"
                    data-testid={`select-${term.address}`}
                    aria-label={`Выбрать ${term.address}`}
                    checked={selected.has(term.address)}
                    onChange={() => toggleSelected(term.address)}
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
                {term.attention && (
                  <span className={styles.attentionDot} role="status" data-testid={`attention-${term.address}`} title="требует внимания">●</span>
                )}
                {depth > 0 && (
                  <span className={styles.treeIcon} title={term.dieWithParent ? 'die_with_parent' : 'survivor (переживёт родителя)'} data-testid={`tree-icon-${term.address}`}>
                    {term.dieWithParent ? '⛓' : '○'}
                  </span>
                )}
                <span className={styles.badgeMain}>
                  <span className={styles.badgeName}>
                    {children.length > 0 && (
                      <button
                        type="button"
                        className={styles.collapseBtn}
                        onClick={() => setCollapsed((prev) => { const n = new Set(prev); if (n.has(term.address)) n.delete(term.address); else n.add(term.address); return n; })}
                        aria-label={isCollapsed ? 'Развернуть' : 'Свернуть'}
                        data-testid={`collapse-${term.address}`}
                      >{isCollapsed ? '▸' : '▾'}</button>
                    )}
                    <button
                      type="button"
                      className={`${styles.collapseBtn} ${pins.has(term.address) ? styles.filterActive : ''}`}
                      onClick={(e) => { e.stopPropagation(); togglePin(term.address); }}
                      aria-label={pins.has(term.address) ? `Открепить ${term.address}` : `Закрепить ${term.address}`}
                      aria-pressed={pins.has(term.address)}
                      data-testid={`pin-${term.address}`}
                      title={pins.has(term.address) ? 'Открепить' : 'Закрепить'}
                    >📌</button>
                    {aliases[term.address] ?? (term.label || term.address)}{aliases[term.address] ? ' (alias)' : ''}
                    {term.state === 'archived' && (
                      <small className={styles.archivedMark} data-testid={`archived-${term.address}`}> · архив</small>
                    )}
                    {!term.dieWithParent && depth > 0 && <small className={styles.survivorMark} data-testid={`survivor-${term.address}`}> · survivor</small>}
                  </span>
                  <span className={styles.badgeMeta}>
                    {term.machine ? `${term.machine}/` : ''}{term.address.split('/').pop() ?? term.address}
                    {term.seat ? ` · ${term.seat}` : ''}
                    {term.state === 'working' && term.createdAt !== undefined
                      ? ` · ${fmtDuration(nowSec - term.createdAt)}` : ''}
                    {(term.state === 'done' || term.state === 'error')
                      && term.createdAt !== undefined && term.exitedAt !== undefined
                      ? ` · took ${fmtDuration(term.exitedAt - term.createdAt)}` : ''}
                    {term.labels && Object.keys(term.labels).length > 0 && (
                      <span className={styles.labelChips} data-testid={`labels-${term.address}`}>
                        {Object.entries(term.labels).map(([k, v]) => (
                          <span key={k} className={styles.labelChip} title={`${k}=${v}`}>{k}:{v}</span>
                        ))}
                      </span>
                    )}
                    {br.setLabels && (
                      <button
                        type="button"
                        className={styles.collapseBtn}
                        data-testid={`edit-labels-${term.address}`}
                        title="Редактировать labels"
                        onClick={() => {
                          const raw = window.prompt('labels (key=value, через запятую):', term.labels ? Object.entries(term.labels).map(([k, v]) => `${k}=${v}`).join(', ') : '');
                          if (raw === null) return;
                          const next: Record<string, string> = {};
                          for (const part of raw.split(',')) {
                            const eq = part.indexOf('=');
                            if (eq > 0) next[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
                            else if (part.trim()) next[part.trim()] = '';
                          }
                          void br.setLabels?.(term.address, next).then(() => setMenu(null)).catch(() => setMenu(null));
                        }}
                      >✎</button>
                    )}
                    {br.setNote && (
                      <button
                        type="button"
                        className={styles.collapseBtn}
                        data-testid={`edit-note-${term.address}`}
                        title="Заметка"
                        onClick={() => {
                          const current = term.labels?.note ?? '';
                          const next = window.prompt('Заметка:', current);
                          if (next === null) return;
                          void br.setNote?.(term.address, next).then(() => setMenu(null)).catch(() => setMenu(null));
                        }}
                      >📝</button>
                    )}
                    {term.labels?.note ? (
                      <span className={styles.noteChip} data-testid={`note-${term.address}`} title="note">{term.labels.note}</span>
                    ) : null}
                  </span>
                </span>
                <span
                  className={styles.badgeTime}
                  title={term.exitedAt !== undefined ? 'finished' : term.createdAt !== undefined ? 'created' : 'time unavailable'}
                >
                  {formatRelative(
                    term.state === 'done' || term.state === 'error' ? term.exitedAt ?? term.createdAt : term.createdAt,
                    nowSec,
                  )}
                </span>
                {queues[term.address] !== undefined && queues[term.address] > 0 && (
                  <span className={styles.sendqBadge} data-testid={`sendq-${term.address}`}>
                    <span title="send-queue: сообщения ожидают отправки">▸ {queues[term.address]}</span>
                    {br.flushSendQueue && (
                      <button
                        type="button"
                        className={styles.collapseBtn}
                        data-testid={`flush-sendq-${term.address}`}
                        title="Сбросить send-очередь"
                        aria-label={`Сбросить send-очередь ${term.address}`}
                        onClick={() => {
                          void br.flushSendQueue?.(term.address)
                            .then(() => setQueues((prev) => { const n = { ...prev }; delete n[term.address]; return n; }))
                            .catch(() => {});
                        }}
                      >×</button>
                    )}
                  </span>
                )}
              </li>
            );
            return [row(t, 0), ...(!isCollapsed ? children.map((c) => row(c, 1)) : [])];
          })}
        </ul>
      </section>
    );
  };

  return (
    <div className={styles.demoPage}>
      <aside className={styles.panel} aria-label="Spaces and agents" data-testid="newf-agents-panel">
        <header className={styles.header}>
          <h1 className={styles.headerTitle}>SPACES &amp; AGENTS</h1>
          <span
            className={`${styles.conn} ${load === 'ok' ? styles.connOk : load === 'loading' ? styles.connDim : styles.connBad}`}
            role="status"
          >
            {load === 'ok' ? `live · ${visibleTerms.length}` : load === 'loading' ? 'connecting…' : 'offline'}
          </span>
          <button
            type="button"
            className={`${styles.filterChip} ${agentSort === 'priority' ? styles.filterActive : ''}`}
            data-testid="agent-sort"
            aria-pressed={agentSort === 'priority'}
            aria-label="Сортировка агентов: priority / grouped"
            onClick={() => setAgentSort((v) => (v === 'priority' ? 'grouped' : 'priority'))}
          >
            {agentSort === 'priority' ? 'sort: priority' : 'sort: grouped'}
          </button>
          <button
            type="button"
            className={`${styles.filterChip} ${showArchived ? styles.filterActive : ''}`}
            data-testid="toggle-archived"
            aria-pressed={showArchived}
            aria-label="Показать архивные терминалы"
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? 'скрыть архив' : 'архив'}
          </button>
        </header>

        {br.batch && selected.size > 0 && (
          <div className={styles.batchBar} data-testid="batch-bar">
            <span data-testid="batch-count">{selected.size} selected</span>
            <button type="button" className={styles.filterChip} data-testid="batch-kill" onClick={() => batch('kill')}>kill</button>
            <button type="button" className={styles.filterChip} data-testid="batch-respawn" onClick={() => batch('respawn')}>respawn</button>
            <button type="button" className={styles.filterChip} onClick={() => setSelected(new Set())}>×</button>
          </div>
        )}
        {approvalOffline && (
          <p className={styles.offline} role="alert" data-testid="approval-offline">approvals offline — очередь недоступна</p>
        )}
        {approvals.length > 0 && (
          <div className={styles.approvalBanner} data-testid="approval-banner" role="status">
            <span>{approvals.length} pending approval{approvals.length > 1 ? 's' : ''}</span>
            {approvalError && (
              <p className={styles.offline} role="alert" data-testid="approval-error">{approvalError}</p>
            )}
            <div className={styles.approvalRow}>
              <input
                type="password"
                className={styles.approvalInput}
                placeholder="admin token (X-AEGIS-Key)"
                aria-label="Admin token"
                autoComplete="off"
                data-testid="admin-token-input"
                value={adminToken}
                onChange={(e) => { setAdminToken(e.target.value); setApprovalError(null); }}
              />
            </div>
            {approvals.map((a) => {
              const isDual = a.dualControl === true;
              const votes = a.decidedBy?.length ?? 0;
              const required = a.requiredApprovals ?? 1;
              return (
                <span key={a.approval_id} className={styles.approvalRow} data-testid={`approval-${a.approval_id}`} data-dual={isDual ? 'true' : undefined}>
                  <code>{a.action ?? a.subject ?? a.approval_id}</code>
                  {isDual ? (
                    <span className={styles.approvalProgress} data-testid={`approval-progress-${a.approval_id}`}>
                      {votes}/{required} голосов
                      {votes > 0 && (
                        <span className={styles.approvalBy} data-testid={`approval-by-${a.approval_id}`}>
                          {' '}· {a.decidedBy!.join(', ')}
                        </span>
                      )}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className={styles.filterChip}
                    data-testid={`approve-${a.approval_id}`}
                    onClick={() => {
                      void br.approvalDecide?.(a.approval_id, true, adminToken)
                        .then((res) => {
                          setApprovalError(null);
                          if (res.pending) {
                            // W56: 202 — vote принят, строка остаётся, прогресс обновляется.
                            setApprovals((prev) => prev.map((x) => x.approval_id === a.approval_id
                              ? { ...x, decidedBy: res.decidedBy ?? x.decidedBy, requiredApprovals: res.requiredApprovals ?? x.requiredApprovals }
                              : x));
                          } else {
                            setApprovals((prev) => prev.filter((x) => x.approval_id !== a.approval_id));
                          }
                        })
                        .catch((e: unknown) => setApprovalError(e instanceof Error ? e.message : 'approve failed'));
                    }}
                  >approve</button>
                  <button type="button" className={styles.filterChip} data-testid={`deny-${a.approval_id}`}
                    onClick={() => {
                      void br.approvalDecide?.(a.approval_id, false, adminToken)
                        .then(() => { setApprovalError(null); setApprovals((prev) => prev.filter((x) => x.approval_id !== a.approval_id)); })
                        .catch((e: unknown) => setApprovalError(e instanceof Error ? e.message : 'deny failed'));
                    }}
                  >deny</button>
                </span>
              );
            })}
          </div>
        )}
        {errText && load === 'offline' ? (
          <p className={styles.offline} role="alert">
            core unreachable: {errText}{terms.length > 0 ? ' · showing the last successful snapshot' : ''}
          </p>
        ) : null}

        <section className={styles.group} aria-label="Spaces">
          <h3 className={styles.groupTitle}>
            SPACES <span className={styles.groupCount}>{spaces.length}</span>
            {spaceFilter && (
              <button type="button" className={styles.filterChip} data-testid="space-filter-clear" onClick={() => setSpaceFilter(null)}>×</button>
            )}
          </h3>
          <ul className={styles.list}>
            {orderedSpaces.map((s, i) => {
              const detail = spaceDetail.find((d) => d.id === s.id);
              const active = spaceFilter === s.id;
              const wt = worktrees.find((w) => w.name === s.id || w.branch?.includes(s.name));
              const branch = (wt?.branch ?? '').replace(/^refs\/heads\//, '');
              // W60: цветной avatar (least-used палитра: ansi6/3/4/5/2/1)
              const avatarColors = ['#2aa8a0', '#d9903e', '#4f7fc1', '#8f6fc1', '#6fa85f', '#c15f8f'];
              const avatarColor = avatarColors[i % avatarColors.length];
              const avatarLetter = (s.name[0] ?? '?').toUpperCase();
              return (
                <li
                  key={s.id}
                  className={styles.badge}
                  data-testid={`space-row-${s.id}`}
                  draggable
                  onDragStart={() => { dragSpaceRef.current = s.id; }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => dropSpace(s.id)}
                >
                  <button
                    type="button"
                    className={`${styles.spaceRow} ${active ? styles.filterActive : ''}`}
                    data-testid={`space-filter-${s.id}`}
                    aria-pressed={active}
                    aria-label={`Фильтр по спейсу ${s.name}`}
                    onClick={() => setSpaceFilter(active ? null : s.id)}
                  >
                    <span className={styles.spaceAvatar} style={{ background: avatarColor }} aria-hidden="true">{avatarLetter}</span>
                    <span className={styles.badgeName}>{s.name}</span>
                    <span className={styles.spaceGitTail} data-testid={`space-git-${s.id}`}>
                      {branch ? `${s.id} · ${branch}` : s.machine}
                    </span>
                    {detail && (
                      <span className={styles.spaceStats}>
                        <span className={styles.spaceLive} data-testid={`space-live-${s.id}`} title="live-терминалы">{detail.live} live</span>
                        <span className={styles.spaceTerms} data-testid={`space-terms-${s.id}`} title="все терминалы">{detail.terms} terms</span>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className={styles.group} aria-label="Machines">
          <h3 className={styles.groupTitle}>
            MACHINES <span className={styles.groupCount}>{machines.length}</span>
          </h3>
          <ul className={styles.list}>
            {machines.map((m) => {
              const badge = machineBadge(m.state);
              const isExpanded = expanded.has(m.name) || m.state === 'connected';
              const childTerms = terms.filter((t) => t.machine === m.name);
              // W9: деталь из ?detail=1 (uptime/терминалы/метрики)
              const detail = machineDetail.find((d) => d.name === m.name);
              const fmtUptime = (s?: number) => {
                if (s === undefined || !Number.isFinite(s)) return null;
                if (s < 60) return `${Math.round(s)}s`;
                if (s < 3600) return `${Math.round(s / 60)}m`;
                return `${Math.round(s / 3600)}h`;
              };
              return (
                <li key={m.name} className={styles.badge}>
                  <span className={badge.cls} aria-hidden="true">{m.state === 'connected' ? '▾' : '▸'}</span>
                  <span className={styles.badgeMain}>
                    <span className={styles.badgeName}
                      onClick={() => {
                        if (m.state !== 'connected') return;
                        setExpanded((prev) => {
                          const n = new Set(prev);
                          if (n.has(m.name)) n.delete(m.name); else n.add(m.name);
                          return n;
                        });
                      }}
                    >
                      {m.name}
                    </span>
                    <span className={styles.badgeMeta}> {badge.label}
                      {detail?.uptime_s !== undefined && ` · up ${fmtUptime(detail.uptime_s)}`}
                      {detail?.terminals !== undefined && ` · ${detail.terminals} terms`}
                      {detail?.metrics?.cpu !== undefined && ` · cpu ${Math.round(detail.metrics.cpu)}%`}
                      {detail?.metrics?.mem !== undefined && ` · mem ${Math.round(detail.metrics.mem)}%`}
                    </span>
                  </span>
                  {m.state === 'connected' && isExpanded && (
                    <ul className={styles.list}>
                      {groupTerminals(childTerms).working.concat(groupTerminals(childTerms).idle, groupTerminals(childTerms).done, groupTerminals(childTerms).attention).map((t) => (
                        <li key={t.address} style={{ marginLeft: 14 }} className={styles.badge}>
                          <span className={styles.badgeName}>{t.label || t.address}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {worktrees.length > 0 && (
          <section className={styles.group} aria-label="Worktrees">
            <h3 className={styles.groupTitle}>
              WORKTREES <span className={styles.groupCount}>{worktrees.length}</span>
            </h3>
            <ul className={styles.list}>
              {worktrees.filter((w) => !w.main).map((w) => (
                <li key={w.name} className={styles.badge} data-testid={`worktree-${w.name}`}>
                  <span className={styles.badgeName}>{w.name}</span>
                  <span className={styles.badgeMeta}>
                    {w.branch?.replace(/^refs\/heads\//, '') ?? (w.detached ? 'detached' : '')}
                    {w.locked ? ' · 🔒' : ''}
                    {w.prunable ? ' · ⚠ prune' : ''}
                    {w.status ? ` · ${w.status}` : ''}
                  </span>
                  {w.status === 'dirty' && <span className={styles.wtDirty} data-testid={`wt-dirty-${w.name}`}>dirty</span>}
                  {w.status === 'failed' && <span className={styles.wtFailed} data-testid={`wt-failed-${w.name}`}>failed</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
        {br.shares && <SharesList bridge={br} />}

        {br.workspaceTemplates && (
          <section className={styles.group} aria-label="Cockpit">
            <h3 className={styles.groupTitle}>COCKPIT</h3>
            <ul className={styles.list}>
              <li className={styles.badge}>
                <button
                  type="button"
                  className={styles.filterChip}
                  data-testid="cockpit-spawn"
                  onClick={() => {
                    const name = window.prompt('Cockpit template name?');
                    if (!name) return;
                    void br.workspaceSpawn?.(name)
                      .then((r) => {
                        if (r.terminals[0]) onOpenFloating?.(r.terminals[0]);
                      })
                      .catch(() => {});
                  }}
                >🚀 запустить cockpit</button>
              </li>
            </ul>
          </section>
        )}

        {load === 'ok' && terms.length === 0 ? (
          <p className={styles.empty}>no terminals on core</p>
        ) : null}

        {agentSort === 'priority' ? (
          <>
            {renderGroup('attention', 'NEEDS ATTENTION')}
            {renderGroup('done', 'DONE')}
            {renderGroup('working', 'WORKING')}
            {renderGroup('idle', 'IDLE')}
          </>
        ) : (
          <>
            {renderGroup('working', 'WORKING')}
            {renderGroup('idle', 'IDLE')}
            {renderGroup('done', 'DONE')}
            {renderGroup('attention', 'NEEDS ATTENTION')}
          </>
        )}
        {renderGroup('archived', 'ARCHIVED')}
      </aside>
      {shareTerm && br.shareCreate && (
        <ShareDialog bridge={br} term={shareTerm} base={base ?? ''} onClose={() => setShareTerm(null)} />
      )}
      {menu ? (
        <NewfCtxMenu
          bridge={br}
          x={menu.x}
          y={menu.y}
          term={menu.term}
          terminals={terms}
          base={base ?? ''}
          onClose={() => setMenu(null)}
          onOpenFloating={onOpenFloating}
          onShare={(t) => setShareTerm(t)}
          onRename={(t, name) => setAliases((a) => ({ ...a, [t]: name }))}
          labelFor={(t) => (terms.find((x) => x.address === t)?.label ?? t)}
          programsCapable={cap('programs')}
        />
      ) : null}
    </div>
  );
}

export default NewfAgentsPanel;
