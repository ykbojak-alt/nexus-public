'use client';

/** NEWF E3 — реальные моды workspace-обвязки.
 *
 * Один набор компонентов для обоих режимов: live берёт данные live-bridge,
 * mock — фикстуры E1. Недоступные источники — честные data-state="unavailable",
 * без фиктивного контента (seam-спека).
 *
 * Палитра — nexus-lux (тема пользователя): accent #d4af37, working #5f8fb5,
 * blocked #d9605a, done #8fb573, muted #7d8494.
 */

import { useEffect, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { StatusBadge, type NexusStatus } from '@nexus/ui';
import styles from './newf.module.css';
import { NEWF_SEATS } from './newf-roles';
import {
  BridgeHttpError,
  type NewfBridge,
  type FileListResult,
  type ChangesResult,
  type MachineRecord,
} from './newf-live';
import { RatingBadge, ratingFor, useRatings } from './ratings';

export interface ModSpace { id: string; name: string; machine: string }
export interface ModTerminal {
  address: string;
  label: string;
  spaceId?: string;
  tab?: string;
  state: string;
  machine?: string;
  agent?: string;
  seat?: string;
}
export interface ModAgent { id: string; name: string; terminal: string; status: string; seat?: string; parent?: string }

export interface ModData {
  live: boolean;
  error: string | null;
  spaces: ModSpace[];
  terminals: ModTerminal[];
  agents: ModAgent[];
}

/** Состояние capability-мода (#407): причина отказа вместо булева live-флага. */
export interface ModState<T> {
  data: T | null;
  /** cause === null и data === null означает «ещё не загружено». */
  cause: 'loading' | 'ok' | 'capability_missing' | 'not_found' | 'denied' | 'offline' | null;
  detail: string | null;
}

const LIVE_POLL_MS = 2500;

/**
 * Poll-хук одной capability моста. run === undefined ⇒ мост не объявляет
 * capability (честный capability_missing). Ловит BridgeHttpError по kind:
 * unavailable/404-текст → capability_missing; denied/disabled → denied;
 * not_found → not_found; прочее → offline (никакой mock-подмены).
 */
export function useCapability<T>(
  deps: unknown[],
  run: (() => Promise<T>) | undefined,
): ModState<T> {
  const [state, setState] = useState<ModState<T>>({ data: null, cause: 'loading', detail: null });
  useEffect(() => {
    if (!run) {
      setState({ data: null, cause: 'capability_missing', detail: null });
      return;
    }
    let alive = true;
    // deps сменились (напр. появился cwd для changes) — сбрасываем в loading,
    // иначе между перезапусками tick() висит stale cause (capability_missing
    // от run===undefined) и мод мигает unavailable вместо загрузки.
    setState({ data: null, cause: 'loading', detail: null });
    const tick = async () => {
      try {
        const value = await run();
        if (alive) setState({ data: value, cause: 'ok', detail: null });
      } catch (error) {
        if (!alive) return;
        if (error instanceof BridgeHttpError && (error.kind === 'unavailable')) {
          setState({ data: null, cause: 'capability_missing', detail: error.message });
        } else if (error instanceof BridgeHttpError && (error.kind === 'denied' || error.kind === 'disabled')) {
          setState({ data: null, cause: 'denied', detail: error.message });
        } else if (error instanceof BridgeHttpError && error.kind === 'not_found') {
          setState({ data: null, cause: 'not_found', detail: error.message });
        } else {
          setState({ data: null, cause: 'offline', detail: error instanceof Error ? error.message : 'bridge error' });
        }
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), LIVE_POLL_MS);
    return () => { alive = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

/** Честная подпись capability-мода при живом мосте. */
function capabilityNotice(name: string, state: ModState<unknown>, fallback: string): string {
  if (state.cause === 'capability_missing') {
    return `${name}: endpoint не зарегистрирован (N3). Контент не выдумывается.`;
  }
  if (state.cause === 'not_found') {
    return `${name}: не найдено — ${state.detail ?? 'ресурс отсутствует'}`;
  }
  if (state.cause === 'denied') {
    return `${name}: нужен ключ оператора / политика отказала — ${state.detail ?? ''}`;
  }
  if (state.cause === 'offline') {
    return `${name}: мост недоступен — ${state.detail ?? 'bridge error'}`;
  }
  return fallback;
}

/** Машина спейса или терминала: по ней фильтруется roster (активный фильтр = футер). */
function machineOf(space: ModSpace | undefined, terminal: ModTerminal | undefined): string | undefined {
  return space?.machine ?? terminal?.machine;
}

/** Агенты, видимые при активном фильтре машины (по машине их терминала/спейса). */
function agentsForMachine(data: ModData, machine: string): ModAgent[] {
  if (data.spaces.length === 0 && data.terminals.length === 0) return data.agents;
  return data.agents.filter((a) => {
    const terminal = data.terminals.find((t) => t.address === a.terminal);
    const space = terminal?.spaceId ? data.spaces.find((s) => s.id === terminal.spaceId) : undefined;
    return machineOf(space, terminal) === machine;
  });
}

/** OSC 7501 → статусная раскраска nexus-lux. */
export const OSC_STATUS: Record<string, { status: NexusStatus; dot: string }> = {
  working: { status: 'active', dot: 'var(--nx-working)' },
  idle: { status: 'paused', dot: 'var(--nx-muted)' },
  done: { status: 'complete', dot: 'var(--nx-done)' },
  blocked: { status: 'warning', dot: 'var(--nx-blocked)' },
  error: { status: 'warning', dot: 'var(--nx-blocked)' },
};

function tag(data: ModData): string {
  return data.live ? 'LIVE' : 'MOCK';
}

export function NewfChrome({ data }: { data: ModData }) {
  return (
    <section className={styles.chrome} role="region" aria-label="Workspace chrome">
      <span className={styles.brandMark}>N</span>
      <strong>NEXUS · NEWF</strong>
      <span className={styles.chromeMeta}>{data.live ? 'live' : 'mock'}</span>
    </section>
  );
}

export function NewfSpaces({ data, active, onSelect }: { data: ModData; active?: string; onSelect?: (id?: string) => void }) {
  const activeMachine = active ? data.spaces.find((s) => s.id === active)?.machine : undefined;
  const visible = activeMachine ? data.spaces.filter((s) => s.machine === activeMachine) : data.spaces;
  return (
    <section className={styles.module} role="region" aria-label="Spaces" data-state={data.error ? 'unavailable' : 'ready'}>
      <h2>Spaces <span>{tag(data)}</span></h2>
      {data.error ? <p role="status">bridge offline</p> : (
        <ul>
          {visible.map((s) => (
            <li key={s.id} className={active === s.id ? styles.selected : undefined}>
              <button type="button" className={styles.rowBtn} onClick={() => onSelect?.(s.id)}>
                <span>{s.name || s.id}</span><small>{s.machine}</small>
              </button>
            </li>
          ))}
          {visible.length === 0 && <li><span>нет спейсов</span></li>}
        </ul>
      )}
    </section>
  );
}

export function NewfAgents({ data, focused, onSelect, run, activeSpace, onFocusNextAgent, onFocusPrevAgent, onSetAgentOrder, bridge }: {
  data: ModData;
  focused?: string;
  onSelect?: (id?: string) => void;
  run?: NewfBridge['run'];
  activeSpace?: string;
  onFocusNextAgent?: () => void;
  onFocusPrevAgent?: () => void;
  onSetAgentOrder?: (order: string[]) => void;
  bridge?: NewfBridge | null;
}) {
  const ratings = useRatings(bridge);
  // Рой = 5 фиксированных мест (newf-roles); имена агентов задаёт пользователь.
  const childrenOf = (terminal: string) => data.agents.filter((c) => c.parent === terminal);
  const topLevel = (a: ModAgent) => !a.parent;
  const activeMachine = activeSpace ? data.spaces.find((s) => s.id === activeSpace)?.machine : undefined;
  const visibleAgent = (a: ModAgent) => activeMachine === undefined || agentsForMachine(data, activeMachine).some((v) => v.id === a.id);
  const unseated = data.agents.filter((a) => topLevel(a) && (!a.seat || !NEWF_SEATS.some((s) => s.seat === a.seat)) && visibleAgent(a));
  const [spawnId, setSpawnId] = useState<string | null>(null);
  const [command, setCommand] = useState('');
  const [spawnError, setSpawnError] = useState<string | null>(null);
  const [spawning, setSpawning] = useState(false);
  const canSpawn = (agent: ModAgent) => Boolean(run && agent.terminal)
    && NEWF_SEATS.find((seat) => seat.seat === agent.seat)?.role !== 'orchestrator';
  /** Дефолт команды для sub-agent (#528 UX): разумная команда по умолчанию. */
  const defaultSpawnCommand = 'claude';
  const openSpawn = (agent: ModAgent) => {
    setSpawnId(agent.id);
    setCommand(defaultSpawnCommand);
    setSpawnError(null);
  };
  const closeSpawn = () => {
    if (spawning) return;
    setSpawnId(null);
    setCommand('');
    setSpawnError(null);
  };
  const spawnButton = (agent: ModAgent) => canSpawn(agent) ? (
    <button
      className={styles.spawnButton}
      type="button"
      aria-label="Spawn sub-agent"
      data-testid={`spawn-sub-agent-${agent.id}`}
      title={`Spawn a child process for ${agent.name}`}
      onClick={() => openSpawn(agent)}
    >
      +
    </button>
  ) : null;
  const submitSpawn = async (agent: ModAgent) => {
    if (!run || spawning) return;
    const argv = command.trim().split(/\s+/).filter(Boolean);
    if (!argv.length) return;
    // #528 UX: простая валидация — известные бинари; неизвестные пропускаем,
    // но понятное сообщение про команду, а не про имя агента.
    const knownBinaries = new Set(['claude', 'python', 'py', 'node', 'npm', 'npx', 'cmd', 'powershell', 'pwsh', 'bash', 'sh', 'git']);
    if (!knownBinaries.has(argv[0].toLowerCase())) {
      setSpawnError(`'${argv[0]}' — не похоже на команду. Пример: claude / python agent.py / cmd`);
      return;
    }
    setSpawning(true);
    setSpawnError(null);
    try {
      await run({ command: argv, parent: agent.terminal, labels: { agent: 'sub' } });
      // New terminals are rendered by the next bridge poll; do not append a local fake row.
      setSpawnId(null);
      setCommand('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start sub-agent.';
      // WinError 2 = «системе не удается найти указанный файл» — понятный hint.
      if (/WinError 2|ENOENT|not found|не удается найти/i.test(message)) {
        setSpawnError(`Не удалось запустить '${argv[0]}': исполняемого файла нет. Проверьте команду (пример: claude / python agent.py / cmd)`);
      } else {
        setSpawnError(message);
      }
    } finally {
      setSpawning(false);
    }
  };
  const spawnForm = (agent: ModAgent) => spawnId === agent.id ? (
    <form
      className={styles.spawnForm}
      data-testid={`spawn-form-${agent.id}`}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void submitSpawn(agent);
      }}
    >
      <input
        autoFocus
        aria-label="Sub-agent command"
        value={command}
        disabled={spawning}
        placeholder="command, e.g. claude / python agent.py / cmd"
        onChange={(event) => setCommand(event.currentTarget.value)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeSpawn();
          }
        }}
      />
      <button type="submit" disabled={spawning || !command.trim()} aria-label="Run sub-agent command">
        {spawning ? '…' : 'Run'}
      </button>
      <button type="button" disabled={spawning} aria-label="Cancel sub-agent spawn" onClick={closeSpawn}>×</button>
      {spawnError && <p className={styles.spawnError} role="alert">{spawnError}</p>}
    </form>
  ) : null;
  const subRow = (a: ModAgent, ancestry: Set<string> = new Set()): ReactNode => {
    const meta = OSC_STATUS[a.status] ?? OSC_STATUS.idle;
    const nextAncestry = new Set(ancestry).add(a.terminal);
    const nested = childrenOf(a.terminal).filter((child) => !nextAncestry.has(child.terminal)).filter((child) => visibleAgent(child));
    return (
      <li key={a.id} className={`${styles.subRow} ${focused === a.id ? styles.selected : ''}`} data-sub-of={a.parent} data-agent-id={a.id} tabIndex={focused === a.id ? 0 : -1} data-agent-focused={focused === a.id ? 'true' : undefined}>
        <div className={styles.agentRow}>
          <button type="button" className={styles.rowBtn} onClick={() => onSelect?.(a.id)}>
            <span className={styles.agentName}><i style={{ background: meta.dot }} />{a.name}</span>
            <RatingBadge rating={ratingFor(ratings.entries, a)} />
            <StatusBadge status={meta.status} label={a.status} />
          </button>
          {spawnButton(a)}
        </div>
        {spawnForm(a)}
        {nested.length > 0 && <ul className={styles.subList}>{nested.map((child) => subRow(child, nextAncestry))}</ul>}
      </li>
    );
  };
  const handleAgentsKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'ArrowDown') onFocusNextAgent?.();
      else onFocusPrevAgent?.();
      return;
    }
    if (event.key === 'Enter' && focused) {
      event.preventDefault();
      event.stopPropagation();
      onSelect?.(focused);
      return;
    }
    if (event.key === 'Escape' && focused) {
      event.preventDefault();
      event.stopPropagation();
      onSelect?.(undefined);
    }
  };
  const collectTree = (root: ModAgent): ModAgent[] => {
    const out: ModAgent[] = [];
    const walk = (a: ModAgent) => {
      if (!visibleAgent(a)) return;
      out.push(a);
      for (const child of childrenOf(a.terminal)) walk(child);
    };
    walk(root);
    return out;
  };
  const orderedIds = [
    ...NEWF_SEATS.map((seat) => data.agents.find((a) => a.seat === seat.seat))
      .filter((a): a is ModAgent => Boolean(a))
      .flatMap((a) => collectTree(a)),
    ...unseated.flatMap((a) => collectTree(a)),
  ];
  const orderKey = orderedIds.map((a) => a.id).join('|');
  useEffect(() => {
    onSetAgentOrder?.(orderedIds.map((a) => a.id));
  }, [orderKey]);
  return (
    <section className={styles.module} role="region" aria-label="Agents" data-state={data.error ? 'unavailable' : 'ready'}>
      <h2>Agents <span>{tag(data)}</span></h2>
      {data.error ? <p role="status">bridge offline</p> : (
        <>
          {/* #517: live + ни одного терминала — честный empty-state, без моков
              и без подмены данных (терминалы поднимаются через nx run). */}
          {data.live && data.terminals.length === 0 && (
            <p className={styles.formNote} role="status" data-testid="agents-no-terminals">
              нет терминалов: nx run — агенты появятся, когда поднимется хоть один терминал.
            </p>
          )}
          <ul onKeyDown={handleAgentsKeyDown}>
          {NEWF_SEATS.map((seat) => {
            const agent = data.agents.find((a) => a.seat === seat.seat);
            const meta = agent ? (OSC_STATUS[agent.status] ?? OSC_STATUS.idle) : undefined;
            const children = agent ? childrenOf(agent.terminal).filter((child) => visibleAgent(child)) : [];
            if (agent && !visibleAgent(agent)) return null;
            return (
              <li key={seat.seat} className={agent && focused === agent.id ? styles.selected : undefined} data-seat={seat.seat} data-agent-id={agent?.id} tabIndex={agent && focused === agent.id ? 0 : -1} data-agent-focused={agent && focused === agent.id ? 'true' : undefined}>
                <div className={styles.agentRow}>
                  <button type="button" className={styles.rowBtn} onClick={() => agent && onSelect?.(agent.id)} disabled={!agent}>
                    <span className={styles.agentName}>
                      <i style={{ background: meta?.dot ?? 'var(--nx-dim)' }} />
                      <span>{seat.title} {agent && <small className={styles.seatName}>{agent.name}</small>}</span>
                    </span>
                    {agent
                      ? <>
                          <RatingBadge rating={ratingFor(ratings.entries, agent)} />
                          <StatusBadge status={meta!.status} label={agent.status} />
                        </>
                      : <small className={styles.vacant}>свободно</small>}
                  </button>
                  {agent && spawnButton(agent)}
                </div>
                {agent && spawnForm(agent)}
                {children.length > 0 && <ul className={styles.subList}>{children.map((child) => subRow(child, new Set([agent!.terminal])))}</ul>}
              </li>
            );
          })}
          {unseated.map((a) => {
            const meta = OSC_STATUS[a.status] ?? OSC_STATUS.idle;
            const children = childrenOf(a.terminal).filter((child) => visibleAgent(child));
            return (
              <li key={a.id} className={focused === a.id ? styles.selected : undefined} data-seat="none" data-agent-id={a.id} tabIndex={focused === a.id ? 0 : -1} data-agent-focused={focused === a.id ? 'true' : undefined}>
                <div className={styles.agentRow}>
                  <button type="button" className={styles.rowBtn} onClick={() => onSelect?.(a.id)}>
                    <span className={styles.agentName}><i style={{ background: meta.dot }} />{a.name}</span>
                    <RatingBadge rating={ratingFor(ratings.entries, a)} />
                    <StatusBadge status={meta.status} label={a.status} />
                  </button>
                  {spawnButton(a)}
                </div>
                {spawnForm(a)}
                {children.length > 0 && <ul className={styles.subList}>{children.map((child) => subRow(child, new Set([a.terminal])))}</ul>}
              </li>
            );
          })}
        </ul>
        </>
      )}
    </section>
  );
}

export function NewfTabs({ data, active, onSelect }: { data: ModData; active: string; onSelect: (tab: string) => void }) {
  const tabs = Array.from(new Set(data.terminals.map((t) => t.tab).filter(Boolean))) as string[];
  const all = ['active', ...tabs.filter((t) => t !== 'active')];
  return (
    <nav className={styles.tabs} aria-label="Workspace tabs" role="tablist">
      {all.map((t) => (
        <button
          key={t}
          type="button"
          role="tab"
          aria-selected={active === t}
          className={active === t ? styles.tabActive : undefined}
          onClick={() => onSelect(t)}
        >
          {t === 'active' ? `1 · ${t}` : `${all.indexOf(t) + 1} · ${t}`}
        </button>
      ))}
      <button
        type="button"
        className={styles.newTab}
        disabled
        aria-label="Новая вкладка — недоступно в N3"
        title="Новая вкладка (N3)"
      >
        ＋
      </button>
    </nav>
  );
}

export function NewfStatusBar({ data, activeSpace, onSelectSpace }: {
  data: ModData;
  activeSpace?: string;
  onSelectSpace?: (id?: string) => void;
}) {
  const counts = data.terminals.reduce<Record<string, number>>((acc, t) => {
    acc[t.state] = (acc[t.state] ?? 0) + 1;
    return acc;
  }, {});
  const chips = (['working', 'blocked', 'done', 'idle', 'error'] as const)
    .filter((s) => counts[s])
    .map((s) => `${s[0].toUpperCase()}${counts[s]}`);
  const machines = Array.from(new Set(data.spaces.map((s) => s.machine).filter(Boolean)));
  const activeMachine = activeSpace ? data.spaces.find((s) => s.id === activeSpace)?.machine : undefined;
  return (
    <footer className={styles.statusBar} role="contentinfo" aria-label="Workspace status">
      <span>workspace: {data.live ? 'live' : 'mock'} · terms {data.terminals.length}</span>
      {machines.length > 0 && (
        <div className={styles.machineFilter} role="group" aria-label="Machines">
          {machines.map((machine) => (
            <button
              key={machine}
              type="button"
              className={machine === activeMachine ? styles.machineActive : styles.machineChip}
              aria-pressed={machine === activeMachine}
              onClick={() => {
                if (machine === activeMachine) onSelectSpace?.(undefined);
                else onSelectSpace?.(data.spaces.find((s) => s.machine === machine)?.id);
              }}
            >
              {machine}
            </button>
          ))}
        </div>
      )}
      <span className={styles.statusChips}>
        {chips.length ? chips.join(' ') : '—'}
      </span>
      <span>{data.error ? 'bridge: offline' : data.live ? 'bridge: live' : 'bridge: fixture'}</span>
    </footer>
  );
}

/** files/changes: файлового API в мосте пока нет — честный placeholder. */
export function NewfStubMod({ name, data }: { name: string; data: ModData }) {
  const title = name === 'files' ? 'Files' : name === 'changes' ? 'Changes' : name;
  return (
    <section className={styles.module} role="region" aria-label={`Mod ${title}`} data-state="unavailable">
      <h2>{title} <span>{tag(data)}</span></h2>
      <p role="status">{title}: источник не подключён — файловый seam появится в N3 (file read/write через nx). Контент не выдумывается.</p>
    </section>
  );
}

/** files: файловый источник в мосте отсутствует — mock-фикстуры демо, live = честный unavailable. */
const FIXTURE_FILES: { path: string; kind: 'dir' | 'file' }[] = [
  { path: 'apps/nexus/src/product/screens', kind: 'dir' },
  { path: 'apps/nexus/src/product/screens/newf.tsx', kind: 'file' },
  { path: 'apps/nexus/src/product/screens/newf-mods.tsx', kind: 'file' },
  { path: 'apps/nexus/src/product/screens/newf.module.css', kind: 'file' },
  { path: 'contracts/hivebid_market/src/lib.rs', kind: 'file' },
  { path: 'docs/NEWF_SPEC.md', kind: 'file' },
  { path: 'docs/SWARM_PROTOCOL.md', kind: 'file' },
  { path: 'tools/nexus_core/api.py', kind: 'file' },
];

export function NewfFiles({ data, bridge }: { data: ModData; bridge?: NewfBridge | null }) {
  const [selected, setSelected] = useState<string | null>(null);
  const cap = bridge?.files;
  const state = useCapability<FileListResult>([bridge], cap ? () => cap.list() : undefined);
  if (!data.live) {
    return (
      <section className={styles.module} role="region" aria-label="Mod Files" data-state="ready">
        <h2>Files <span>MOCK</span></h2>
        <ul>
          {FIXTURE_FILES.map((file) => (
            <li key={file.path} className={selected === file.path ? styles.selected : undefined}>
              <button type="button" className={styles.rowBtn} onClick={() => setSelected(file.path)} data-testid={`file-row-${file.kind}`}>
                <span>{file.kind === 'dir' ? '▸ ' : '· '}{file.path}</span>
                <small>{file.kind}</small>
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  if (state.cause === 'loading') {
    return (
      <section className={styles.module} role="region" aria-label="Mod Files" data-state="loading" aria-busy="true">
        <h2>Files <span>LIVE</span></h2>
        <p role="status">Загрузка…</p>
      </section>
    );
  }
  if (state.cause !== 'ok' || !state.data) {
    return (
      <section className={styles.module} role="region" aria-label="Mod Files" data-state="unavailable">
        <h2>Files <span>LIVE</span></h2>
        <p role="status">{capabilityNotice('Files', state, 'Файловый источник недоступен.')}</p>
      </section>
    );
  }
  const result = state.data;
  if (result.state === 'not_found') {
    return (
      <section className={styles.module} role="region" aria-label="Mod Files" data-state="unavailable" data-testid="file-state-not-found">
        <h2>Files <span>LIVE</span></h2>
        <p role="status">Не найдено: {result.detail ?? result.cwd}</p>
      </section>
    );
  }
  if (result.state === 'out_of_scope') {
    return (
      <section className={styles.module} role="region" aria-label="Mod Files" data-state="unavailable">
        <h2>Files <span>LIVE</span></h2>
        <p role="status">Files: за пределами sandbox-корня демона.</p>
      </section>
    );
  }
  if (result.state === 'unsupported') {
    return (
      <section className={styles.module} role="region" aria-label="Mod Files" data-state="unavailable">
        <h2>Files <span>LIVE</span></h2>
        <p role="status">Files: remote-машина недоступна в N3.</p>
      </section>
    );
  }
  if (result.state === 'unavailable') {
    return (
      <section className={styles.module} role="region" aria-label="Mod Files" data-state="unavailable">
        <h2>Files <span>LIVE</span></h2>
        <p role="status">Files: источник не подключён — {result.detail ?? 'endpoint не зарегистрирован'}. Контент не выдумывается.</p>
      </section>
    );
  }
  if (result.state === 'empty' || result.entries.length === 0) {
    return (
      <section className={styles.module} role="region" aria-label="Mod Files" data-state="ready">
        <h2>Files <span>LIVE</span></h2>
        <p className={styles.formNote} role="status" data-testid="file-list-empty">Каталог пуст</p>
      </section>
    );
  }
  return (
    <section className={styles.module} role="region" aria-label="Mod Files" data-state="ready">
      <h2>Files <span>LIVE</span></h2>
      <ul>
        {result.entries.map((file) => (
          <li key={file.path} className={selected === file.path ? styles.selected : undefined}>
            <button type="button" className={styles.rowBtn} onClick={() => setSelected(file.path)} data-testid={`file-row-${file.kind}`}>
              <span>{file.kind === 'dir' ? '▸ ' : '· '}{file.path}</span>
              <small>{file.kind}</small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** changes: git-подобный список изменений (mock), live = честный unavailable. */
const FIXTURE_CHANGES: { path: string; kind: string; note: string }[] = [
  { path: 'apps/nexus/src/product/screens/newf.module.css', kind: 'M', note: 'row.resizable min-width' },
  { path: 'apps/nexus/src/product/screens/hivebid.module.css', kind: 'M', note: 'table wrap @700' },
  { path: 'apps/nexus/src/product/screens/newf-mods.tsx', kind: 'M', note: 'mod ports E3' },
  { path: 'docs/NEWF_SPEC.md', kind: 'M', note: 'E3 list' },
  { path: 'apps/nexus/tests/e2e/lite-surface.spec.ts', kind: 'A', note: 'new' },
];

export function NewfChanges({ data, bridge }: { data: ModData; bridge?: NewfBridge | null }) {
  const [selected, setSelected] = useState<string | null>(null);
  const cap = bridge?.changes;
  // SPARK #506 GAP1: backend /api/core/changes по contractу требует `cwd`
  // (ядро не знает, какой репо показывать). Песочница files-связки и git-статус
  // — один и тот же root, поэтому cwd берём из files.list() — он отдаёт result.cwd.
  const filesState = useCapability<FileListResult>([bridge], bridge?.files
    ? () => bridge.files!.list()
    : undefined);
  const filesCwd = filesState.cause === 'ok' ? filesState.data?.cwd : undefined;
  const state = useCapability<ChangesResult>([bridge, filesCwd], cap && filesCwd
    ? () => cap.list(filesCwd)
    : undefined);
  // cwd ещё резолвится через files-capability — это загрузка, а не
  // «endpoint не зарегистрирован» (state.cause в этот момент может быть
  // capability_missing из-за run===undefined).
  const waitingForCwd = Boolean(cap) && !filesCwd && filesState.cause === 'loading';
  if (!data.live) {
    return (
      <section className={styles.module} role="region" aria-label="Mod Changes" data-state="ready">
        <h2>Changes <span>MOCK</span></h2>
        <ul>
          {FIXTURE_CHANGES.map((change) => (
            <li key={change.path} className={selected === change.path ? styles.selected : undefined}>
              <button type="button" className={styles.rowBtn} onClick={() => setSelected(change.path)} data-testid={`change-row-${change.kind}`}>
                <span>{change.kind} · {change.path}</span>
                <small>{change.note}</small>
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  if (state.cause === 'loading' || waitingForCwd) {
    return (
      <section className={styles.module} role="region" aria-label="Mod Changes" data-state="loading" aria-busy="true">
        <h2>Changes <span>LIVE</span></h2>
        <p role="status">Загрузка…</p>
      </section>
    );
  }
  if (state.cause !== 'ok' || !state.data) {
    return (
      <section className={styles.module} role="region" aria-label="Mod Changes" data-state="unavailable">
        <h2>Changes <span>LIVE</span></h2>
        <p role="status">{capabilityNotice('Changes', state, 'git-статус недоступен.')}</p>
      </section>
    );
  }
  const result = state.data;
  if (result.state === 'clean') {
    return (
      <section className={styles.module} role="region" aria-label="Mod Changes" data-state="ready">
        <h2>Changes <span>LIVE</span></h2>
        <p className={styles.formNote} role="status" data-testid="change-list-empty">Изменений нет</p>
      </section>
    );
  }
  if (result.state === 'not_a_repository') {
    return (
      <section className={styles.module} role="region" aria-label="Mod Changes" data-state="unavailable">
        <h2>Changes <span>LIVE</span></h2>
        <p role="status">Это не git-дерево.</p>
      </section>
    );
  }
  if (result.state === 'git_unavailable' || result.state === 'out_of_scope' || result.state === 'unsupported' || result.state === 'unavailable') {
    const text = result.state === 'git_unavailable' ? 'git не найден / не выполнился.'
      : result.state === 'out_of_scope' ? 'за пределами корня демона.'
      : result.state === 'unsupported' ? 'remote-машина недоступна в N3.'
      : 'источник не подключён.';
    return (
      <section className={styles.module} role="region" aria-label="Mod Changes" data-state="unavailable">
        <h2>Changes <span>LIVE</span></h2>
        <p role="status">Changes: {text} Контент не выдумывается.</p>
      </section>
    );
  }
  return (
    <section className={styles.module} role="region" aria-label="Mod Changes" data-state="ready">
      <h2>Changes <span>LIVE</span></h2>
      <ul>
        {result.entries.map((change) => {
          const kind = change.xy.trim().slice(0, 1) || '?';
          return (
            <li key={change.path} className={selected === change.path ? styles.selected : undefined}>
              <button type="button" className={styles.rowBtn} onClick={() => setSelected(change.path)} data-testid={`change-row-${kind}`}>
                <span>{change.xy.trim() || kind} · {change.path}</span>
                <small>{change.note ?? change.xy}</small>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** new-menu: список команд (E3) + рабочие шифты вкладок/спейсов. */
export function NewfNewMenu({ data, active, onSelect, onSelectSpace, onOpenMod }: {
  data: ModData;
  active: string;
  onSelect?: (tab: string) => void;
  onSelectSpace?: (id?: string) => void;
  onOpenMod?: (mod: string) => void;
}) {
  const tabs = Array.from(new Set(data.terminals.map((t) => t.tab).filter(Boolean))) as string[];
  const all = ['active', ...tabs.filter((t) => t !== 'active')];
  const mods = ['files', 'changes', 'nexuslink', 'nexustick', 'sysmon', 'machine-add'];
  return (
    <section className={styles.module} role="region" aria-label="Command menu" data-state="ready">
      <h2>New <span>{tag(data)}</span></h2>
      {data.error ? <p role="status">bridge offline</p> : (
        <>
          <h4 className={styles.detailHeading}>Open panel</h4>
          <ul className={styles.linkList}>
            {mods.map((mod) => (
              <li key={mod}>
                <button type="button" className={`${styles.linkRow} ${styles.linkRowBtn}`} onClick={() => onOpenMod?.(mod)}>
                  <i style={{ background: 'var(--nx-accent)' }} /><span>{mod}</span><code>open</code>
                </button>
              </li>
            ))}
          </ul>
          <h4 className={styles.detailHeading}>Tabs</h4>
          <ul className={styles.linkList}>
            {all.map((t) => (
              <li key={t}>
                <button type="button" className={`${styles.linkRow} ${styles.linkRowBtn}`} onClick={() => onSelect?.(t)}>
                  <i style={{ background: t === active ? 'var(--nx-accent)' : 'var(--nx-border)' }} /><span>{t}</span><code>switch</code>
                </button>
              </li>
            ))}
          </ul>
          <h4 className={styles.detailHeading}>Spaces</h4>
          <ul className={styles.linkList}>
            {data.spaces.map((s) => (
              <li key={s.id}>
                <button type="button" className={`${styles.linkRow} ${styles.linkRowBtn}`} onClick={() => onSelectSpace?.(s.id)}>
                  <i style={{ background: 'var(--nx-done)' }} /><span>{s.name || s.id}</span><code>{s.machine}</code>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** nexuslink: адреса шлюзов — статичная конфигурация; liveness мост не даёт, точки не фейкаются. */
export function NewfNexusLink({ data }: { data: ModData }) {
  const items: { name: string; address: string }[] = [
    { name: 'NexusLink MCP', address: 'D:\\openbridge\\target\\release\\nexuslink.exe mcp' },
    { name: 'Video gateway', address: 'Agnes Video 2.5 Flash' },
    { name: 'Speech bridge', address: '127.0.0.1:8798' },
    { name: 'STT server', address: '127.0.0.1:8123' },
  ];
  return (
    <section className={styles.module} role="region" aria-label="NexusLink" data-state="ready">
      <h2>NexusLink <span>static config</span></h2>
      <ul className={styles.linkList}>
        {items.map((item) => (
          <li key={item.name} className={styles.linkRow}>
            <i style={{ background: 'var(--nx-border)' }} />
            <span>{item.name}</span>
            <code>{item.address}</code>
          </li>
        ))}
      </ul>
      <p className={styles.formNote}>configured · static: bridge не даёт liveness шлюзов — статус не выдумывается.</p>
    </section>
  );
}

/** nexustick: пульс-время (правая панель, компактный список). */
export function NewfNexusTick({ data }: { data: ModData }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const fmt = (d: Date) => d.toTimeString().slice(0, 8);
  const stamp = now ? fmt(now) : '--:--:--';
  return (
    <section className={styles.module} role="region" aria-label="NexusTick" data-state="ready">
      <h2>NexusTick <span>{tag(data)}</span></h2>
      <ul className={styles.tickList}>
        <li className={styles.tickRow}><time>{stamp}</time><span>now</span><b style={{ color: 'var(--nx-accent)' }} aria-hidden="true">●</b></li>
        {data.terminals.slice(0, 5).map((t) => (
          <li key={t.address} className={styles.tickRow}>
            <time>{stamp}</time>
            <span>{t.label || t.address}</span>
            <b style={{ color: OSC_STATUS[t.state]?.dot ?? 'var(--nx-muted)' }}>{t.state}</b>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** sysmon: терминалы/агенты — из ModData (live=реальные, mock=фикстуры);
 *  CPU/Memory — производная эвристика (derived), не измерения моста. */
export function NewfSysmon({ data }: { data: ModData }) {
  if (data.error) {
    return (
      <section className={styles.module} role="region" aria-label="System monitor" data-state="unavailable">
        <h2>System <span>{tag(data)}</span></h2>
        <p role="status">bridge offline</p>
      </section>
    );
  }
  const machines = Array.from(new Set(data.spaces.map((s) => s.machine).filter(Boolean)));
  const terms = data.terminals.length;
  const working = data.terminals.filter((t) => t.state === 'working').length;
  const cpu = Math.min(99, 12 + terms * 7 + working * 9);
  const mem = Math.min(99, 35 + terms * 5 + working * 6);
  const rows = [
    { label: 'CPU', value: `${cpu}%`, pct: cpu, hint: 'derived heuristic: 12 + terminals*7 + working*9 — not a real core measurement' },
    { label: 'Memory', value: `${mem}%`, pct: mem, hint: 'derived heuristic: 35 + terminals*5 + working*6 — not a real core measurement' },
    { label: 'Terminals', value: String(terms), pct: Math.min(100, terms * 10), hint: 'live bridge terminals' },
    { label: 'Agents', value: String(data.agents.length), pct: Math.min(100, data.agents.length * 20), hint: 'live bridge agents' },
  ];
  return (
    <section className={styles.module} role="region" aria-label="System monitor" data-state="ready">
      <h2>System <span>{tag(data)}</span></h2>
      <p className={styles.formNote}>{machines.length ? machines.join(' · ') : 'no machines'} · derived ({data.live ? 'live' : 'mock'}): терминалы/агенты из моста, CPU/Memory — эвристика, не измерения.</p>
      <ul className={styles.metricList}>
        {rows.map((row) => (
          <li key={row.label} className={styles.metricRow} title={row.hint}>
            <span className={styles.metricHead}><span>{row.label}</span><small>{row.value}</small></span>
            <span className={styles.meter}><i className={styles.meterFill} style={{ width: `${row.pct}%` }} /></span>
            <small className={styles.metricHint}>{row.hint}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}
export function NewfMachineAdd({ data, bridge }: { data: ModData; bridge?: NewfBridge | null }) {
  const [host, setHost] = useState('');
  const [label, setLabel] = useState('');
  const [saved, setSaved] = useState(false);
  const cap = bridge?.machines;
  const machinesState = useCapability<MachineRecord[]>([bridge], cap ? () => cap.list() : undefined);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!host.trim()) return;
    setSaved(true);
  };
  if (!data.live) {
    if (data.error) {
      return (
        <section className={styles.module} role="region" aria-label="Add a machine" data-state="unavailable">
          <h2>Add a machine <span>MOCK</span></h2>
          <p role="status">bridge offline</p>
        </section>
      );
    }
    return (
      <section className={styles.module} role="region" aria-label="Add a machine" data-state="ready">
        <h2>Add a machine <span>MOCK</span></h2>
        <form className={styles.machineForm} onSubmit={submit} data-testid="machine-add-form">
          <label className={styles.formLabel}>Host
            <input
              className={styles.configInput}
              type="text"
              value={host}
              placeholder="user@host"
              onChange={(event) => setHost(event.currentTarget.value)}
              aria-label="Machine host"
            />
          </label>
          <label className={styles.formLabel}>Label
            <input
              className={styles.configInput}
              type="text"
              value={label}
              placeholder="optional"
              onChange={(event) => setLabel(event.currentTarget.value)}
              aria-label="Machine label"
            />
          </label>
          <button type="submit" className={styles.configButton} disabled={!host.trim() || saved}>
            {saved ? 'Added (mock)' : 'Add'}
          </button>
          {saved && <p className={styles.formNote} role="status">Добавлено в локальную форму (mock: без сетевого вызова).</p>}
        </form>
      </section>
    );
  }
  const disabledForm = (
    <form className={styles.machineForm} data-testid="machine-add-form" aria-disabled="true">
      <label className={styles.formLabel}>Name
        <input className={styles.configInput} type="text" placeholder="worker-2" disabled aria-label="Machine name" />
      </label>
      <label className={styles.formLabel}>Host
        <input className={styles.configInput} type="text" placeholder="user@host" disabled aria-label="Machine host" />
      </label>
      <label className={styles.formLabel}>Label
        <input className={styles.configInput} type="text" placeholder="optional" disabled aria-label="Machine label" />
      </label>
      <button type="submit" className={styles.configButton} disabled>Add</button>
    </form>
  );
  if (machinesState.cause === 'loading') {
    return (
      <section className={styles.module} role="region" aria-label="Add a machine" data-state="loading" aria-busy="true">
        <h2>Add a machine <span>LIVE</span></h2>
        <p role="status">Загрузка…</p>
      </section>
    );
  }
  if (machinesState.cause === 'denied') {
    return (
      <section className={styles.module} role="region" aria-label="Add a machine" data-state="unavailable" data-testid="machine-state-denied">
        <h2>Add a machine <span>LIVE</span></h2>
        <p role="status">Машины: нужен ключ оператора / политика отказала — {machinesState.detail ?? ''}</p>
        {disabledForm}
      </section>
    );
  }
  if (machinesState.cause === 'capability_missing' || machinesState.cause === 'not_found' || machinesState.cause === 'offline') {
    return (
      <section className={styles.module} role="region" aria-label="Add a machine" data-state="unavailable">
        <h2>Add a machine <span>LIVE</span></h2>
        <p className={styles.formNote} role="status">Machine provisioning недоступен через мост (honest unavailable): у NewfBridge нет API для добавления машин — контент не выдумывается.</p>
        {disabledForm}
      </section>
    );
  }
  if (machinesState.cause !== 'ok' || !machinesState.data) {
    return (
      <section className={styles.module} role="region" aria-label="Add a machine" data-state="unavailable">
        <h2>Add a machine <span>LIVE</span></h2>
        <p role="status">Machine provisioning недоступен через мост (honest unavailable): {machinesState.detail ?? 'bridge error'} — контент не выдумывается.</p>
      </section>
    );
  }
  const machines = machinesState.data;
  return (
    <section className={styles.module} role="region" aria-label="Add a machine" data-state="ready">
      <h2>Add a machine <span>LIVE</span></h2>
      {machines.length === 0 ? (
        <p className={styles.formNote} role="status" data-testid="machine-list-empty">Подключена только локальная машина.</p>
      ) : (
        <ul className={styles.linkList}>
          {machines.map((machine) => (
            <li key={machine.name} className={styles.linkRow}>
              <i style={{ background: machine.state === 'connected' ? 'var(--nx-done)' : 'var(--nx-border)' }} />
              <span>{machine.name}</span>
              <code>{machine.host || machine.transport}</code>
              <small>{machine.state}</small>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.formNote}>Добавление через браузер заблокировано: PUT /api/core/machines/* требует NEXUS_CORE_TOKEN (секрет не кладётся в бандл). Регистрация — из operator-линзы (QODER #476 §5).</p>
    </section>
  );
}

/** Диспетчер модов по имени — как у herdr content.mod. */
export function NewfMod(props: {
  name: string;
  data: ModData;
  run?: NewfBridge['run'];
  bridge?: NewfBridge | null;
  activeSpace?: string;
  focusedAgent?: string;
  activeTab: string;
  onSelectSpace?: (id?: string) => void;
  onSelectAgent?: (id?: string) => void;
  onSelectTab?: (tab: string) => void;
  onOpenMod?: (mod: string) => void;
  onFocusNextAgent?: () => void;
  onFocusPrevAgent?: () => void;
  onSetAgentOrder?: (order: string[]) => void;
}): ReactNode {
  const { name, data } = props;
  switch (name) {
    case 'workspace-chrome': return <NewfChrome data={data} />;
    case 'spaces': return <NewfSpaces data={data} active={props.activeSpace} onSelect={props.onSelectSpace} />;
    case 'agents': return <NewfAgents
      data={data}
      focused={props.focusedAgent}
      onSelect={props.onSelectAgent}
      run={props.run}
      bridge={props.bridge}
      activeSpace={props.activeSpace}
      onFocusNextAgent={props.onFocusNextAgent}
      onFocusPrevAgent={props.onFocusPrevAgent}
      onSetAgentOrder={props.onSetAgentOrder}
    />;
    case 'tabs': return <NewfTabs data={data} active={props.activeTab} onSelect={props.onSelectTab ?? (() => {})} />;
    case 'workspace-status': return <NewfStatusBar data={data} activeSpace={props.activeSpace} onSelectSpace={props.onSelectSpace} />;
    case 'new-menu': return <NewfNewMenu data={data} active={props.activeTab} onSelect={props.onSelectTab} onSelectSpace={props.onSelectSpace} onOpenMod={props.onOpenMod} />;
    case 'files': return <NewfFiles data={data} bridge={props.bridge} />;
    case 'changes': return <NewfChanges data={data} bridge={props.bridge} />;
    case 'nexuslink': return <NewfNexusLink data={data} />;
    case 'nexustick': return <NewfNexusTick data={data} />;
    case 'sysmon': return <NewfSysmon data={data} />;
    case 'machine-add': return <NewfMachineAdd data={data} bridge={props.bridge} />;
    default: return <NewfStubMod name={name} data={data} />;
  }
}
