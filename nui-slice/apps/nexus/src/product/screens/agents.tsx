'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, DonutChart, EmptyState, ErrorState, GlassPanel, LoadingState, PanelHeader, UnavailableState } from '@nexus/ui';
import { AgentFlow, AgentHandoff, AgentInspector, AgentPresence, AgentRoster } from '@nexus/patterns';
import type { AgentRosterItem, PresenceEntry, PatternState } from '@nexus/patterns';
import { useDataSource } from '../data-source';
import { useProfile } from '../profile/profile-store';
import { useAsyncValue } from '../use-async-value';
import { HandoffBar } from './copilot-widgets';
import { SdkDelegationsPanel, SdkHandoffsPanel } from './agent-sdk-panels';
import { AgentSessionsPanel } from './agent-sessions';
import styles from './screens.module.css';

/** Возможности из CAPABILITY_NAMES хоста (keystore.py) — verbatim-имена. */
const AGENT_CAPS = ['compute', 'fs.read', 'fs.write', 'external'] as const;

/** Реестр агентов + постановка задач (суб-агенты 15.10): именные спеки
 *  /v1/agents применяются прогонам с `agent` и детям spawn_agent. Записи —
 *  только через ds.agents seam; без него (mock) блок unavailable. */
function AgentRegistry({ specs, onChanged, onAssign }: {
  specs: AgentRosterItem[];
  onChanged: () => void;
  onAssign: (name: string, task: string, config: string | null) => Promise<string | null>;
}) {
  const ds = useDataSource(); // #418 (wave #418-2): mount-gated
  const seam = ds.agents ?? null;
  const presets = useAsyncValue(() => ds.listPresets(), [ds]);

  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [config, setConfig] = useState('');
  const [caps, setCaps] = useState<Set<string>>(new Set());
  const [prefix, setPrefix] = useState('');
  const [cost, setCost] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [sel, setSel] = useState('');
  const [task, setTask] = useState('');
  const [taskErr, setTaskErr] = useState<string | null>(null);

  const toggleCap = (c: string) => setCaps((s) => {
    const n = new Set(s);
    if (n.has(c)) n.delete(c); else n.add(c);
    return n;
  });

  // U-2: редактор rights — fs-режим/корни/инструменты. Контракт spawn
  // (rights.fs.mode, rights.fs.roots, rights.tools, rights.capabilities) в
  // CreateAgentInput ещё не приземлён (W1) — весь fieldset отключён с
  // объяснением, а не пост-фактум ошибкой от хоста.
  const RIGHTS_WIRE = false; // переключить на ('rights' in CreateAgentInput) после W1
  const [fsMode, setFsMode] = useState<'inherit' | 'none' | 'read_only' | 'read_write'>('inherit');
  const [fsRightsRoots, setFsRightsRoots] = useState<{ path: string; access: 'ro' | 'rw' }[]>([]);
  const [fsRightsPath, setFsRightsPath] = useState('');
  const [rightsTools, setRightsTools] = useState<Set<string>>(new Set());
  const KNOWN_TOOLS = ['read_file', 'write_file', 'apply_patch', 'restore_file', 'tree', 'read_files', 'memory_search'] as const;
  const toggleTool = (t: string) => setRightsTools((s) => {
    const n = new Set(s);
    if (n.has(t)) n.delete(t); else n.add(t);
    return n;
  });
  const rightsPreview = JSON.stringify({
    fs: { mode: fsMode, roots: fsRightsRoots.map((r) => `${r.path}:${r.access}`) },
    tools: [...rightsTools],
    capabilities: [...caps],
  });

  // wave-2 W3-3: PATCH-редактирование спеки. Имя — identity, не редактируется;
  // патчим только PatchAgentInput-поля, ошибки хоста verbatim.
  const [editing, setEditing] = useState<string | null>(null);

  const startEdit = useCallback(async (n: string) => {
    if (seam == null || busy) return;
    setErr(null); setBusy(true);
    try {
      const spec = await seam.get(n);
      setEditing(n);
      setName(n);
      setDesc(spec.description ?? '');
      setConfig(spec.config ?? '');
      setCaps(new Set(spec.capabilities));
      setPrefix(spec.taskPrefix ?? '');
      setCost(spec.maxCostUsd != null ? String(spec.maxCostUsd) : '');
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, [seam, busy]);

  const saveEdit = useCallback(async () => {
    if (seam == null || editing == null || busy) return;
    setErr(null); setNote(null); setBusy(true);
    try {
      await seam.update(editing, {
        description: desc.trim(),
        ...(config ? { config } : { config: null }),
        capabilities: [...caps],
        taskPrefix: prefix.trim(),
        ...(cost.trim() && Number(cost) > 0 ? { maxCostUsd: Number(cost) } : { maxCostUsd: null }),
      });
      setNote(`Спека ${editing} обновлена.`);
      setEditing(null);
      setName(''); setDesc(''); setPrefix(''); setCost(''); setCaps(new Set()); setConfig('');
      onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, [seam, editing, desc, config, caps, prefix, cost, busy, onChanged]);

  const create = useCallback(async () => {
    if (seam == null || !name.trim() || busy) return;
    setErr(null); setNote(null); setBusy(true);
    try {
      await seam.create({
        name: name.trim(),
        description: desc.trim(),
        ...(config ? { config } : {}),
        capabilities: [...caps],
        ...(prefix.trim() ? { taskPrefix: prefix.trim() } : {}),
        ...(cost.trim() && Number(cost) > 0 ? { maxCostUsd: Number(cost) } : {}),
      });
      setNote(`Агент ${name.trim()} зарегистрирован.`);
      setName(''); setDesc(''); setPrefix(''); setCost(''); setCaps(new Set());
      onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, [seam, name, desc, config, caps, prefix, cost, busy, onChanged]);

  const remove = useCallback(async (n: string) => {
    if (seam == null || busy) return;
    setErr(null); setNote(null); setBusy(true);
    try {
      await seam.delete(n);
      setNote(`Агент ${n} удалён.`);
      onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, [seam, busy, onChanged]);

  const assign = useCallback(async () => {
    if (!sel || !task.trim() || busy) return;
    setTaskErr(null); setBusy(true);
    try {
      const spec = specs.find((s) => s.name === sel);
      const e = await onAssign(sel, task.trim(), spec?.config ?? null);
      if (e != null) setTaskErr(e); else setTask('');
    } finally { setBusy(false); }
  }, [sel, task, specs, busy, onAssign]);

  if (seam == null) {
    return (
      <GlassPanel className={styles.panel} data-state="unavailable" data-testid="agents-registry">
        <h3 className={styles.panelTitle}>Реестр агентов</h3>
        <UnavailableState variant="inline" title="Управление реестром доступно только в live-источнике" reason="mock не имитирует записи в /v1/agents." />
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className={styles.panel} data-state="ready" data-testid="agents-registry">
      <h3 className={styles.panelTitle}>Реестр агентов</h3>
      <p className={styles.emptyHint}>
        Именные спеки применяются к прогонам с agent= и детям spawn_agent: права сужаются до ≤ родительских,
        пресет/бюджет/префикс задачи берутся из спеки.
      </p>

      <div className={styles.formRow} role="group" aria-label="Новый агент: имя, описание, пресет">
        <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)}
          placeholder="имя (до 64)" aria-label="Имя агента" maxLength={64} />
        <input className={styles.input} value={desc} onChange={(e) => setDesc(e.target.value)}
          placeholder="описание" aria-label="Описание агента" />
        <select className={styles.input} value={config} onChange={(e) => setConfig(e.target.value)} aria-label="Пресет агента">
          <option value="">пресет прогона (дефолт)</option>
          {(presets.value ?? []).map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
        </select>
      </div>
      <div className={styles.prefRow} role="group" aria-label="Права агента">
        <span className={styles.prefLabel}>Права</span>
        <span className={styles.prefChoices}>
          {AGENT_CAPS.map((c) => (
            <button key={c} type="button" className={styles.prefChoice}
              aria-pressed={caps.has(c)}
              data-selected={caps.has(c)} onClick={() => toggleCap(c)}>
              {c}
            </button>
          ))}
        </span>
      </div>

      {/* U-2: редактор rights. Поля отключены до приземления контракта
          spawn (rights.*) в CreateAgentInput — disabled с объяснением,
          а не пост-фактум ошибка от хоста. */}
      <fieldset className={styles.rightsEditor} disabled={!RIGHTS_WIRE} data-testid="rights-editor" data-wire={RIGHTS_WIRE ? 'ready' : 'pending'}>
        <legend>Политика прав субагента</legend>
        {!RIGHTS_WIRE && (
          <p className={styles.emptyHint}>
            Контракт /v1/agents пока не принимает rights (ждём W1) — поля недоступны, значения на хост не уйдут.
          </p>
        )}
        <div className={styles.prefRow} role="radiogroup" aria-label="FS-режим субагента">
          <span className={styles.prefLabel}>fs</span>
          <span className={styles.prefChoices}>
            {([['inherit', 'наследует'], ['none', 'нет'], ['read_only', 'чтение'], ['read_write', 'чтение+запись']] as const).map(([v, l]) => (
              <label key={v} className={styles.prefChoice} data-selected={fsMode === v}>
                <input type="radio" name="rights-fs-mode" checked={fsMode === v} onChange={() => setFsMode(v)} className={styles.visuallyHidden} />
                {l}
              </label>
            ))}
          </span>
        </div>
        <div className={styles.prefRow} role="group" aria-label="Корни FS с доступом">
          <span className={styles.prefLabel}>корни</span>
          <span className={styles.prefChoices}>
            {fsRightsRoots.map((r, i) => (
              <span key={r.path} className={styles.fsRootChip}>
                {r.path} · {r.access}
                <button type="button" aria-label={`Убрать корень ${r.path}`} onClick={() => setFsRightsRoots((xs) => xs.filter((_, j) => j !== i))}>×</button>
              </span>
            ))}
            <input className={styles.input} value={fsRightsPath} onChange={(e) => setFsRightsPath(e.target.value)}
              placeholder="путь корня" aria-label="Путь корня FS" />
            <button type="button" className={styles.prefChoice} disabled={!fsRightsPath.trim()}
              onClick={() => { setFsRightsRoots((xs) => [...xs, { path: fsRightsPath.trim(), access: 'ro' }]); setFsRightsPath(''); }}>
              + ro
            </button>
            <button type="button" className={styles.prefChoice} disabled={!fsRightsPath.trim()}
              onClick={() => { setFsRightsRoots((xs) => [...xs, { path: fsRightsPath.trim(), access: 'rw' }]); setFsRightsPath(''); }}>
              + rw
            </button>
          </span>
        </div>
        <div className={styles.prefRow} role="group" aria-label="Инструменты субагента">
          <span className={styles.prefLabel}>инструменты</span>
          <span className={styles.prefChoices}>
            {KNOWN_TOOLS.map((t) => (
              <button key={t} type="button" className={styles.prefChoice} aria-pressed={rightsTools.has(t)}
                data-selected={rightsTools.has(t)} onClick={() => toggleTool(t)}>
                {t}
              </button>
            ))}
          </span>
        </div>
        <p className={styles.emptyHint} data-testid="rights-preview" title="Итоговая политика — preview перед submit">
          rights → {rightsPreview}
        </p>
      </fieldset>
      <div className={styles.formRow} role="group" aria-label="Ограничения агента: префикс задачи, лимит стоимости">
        <input className={styles.input} value={prefix} onChange={(e) => setPrefix(e.target.value)}
          placeholder="префикс задачи (добавляется перед текстом)" aria-label="Префикс задачи" />
        <input className={`${styles.input} ${styles.ttlInput}`} value={cost} onChange={(e) => setCost(e.target.value.replace(/[^0-9.]/g, ''))}
          placeholder="≤ $ на прогон" aria-label="Лимит стоимости прогона" />
        {editing == null ? (
          <Button variant="primary" size="sm" disabled={!name.trim() || busy} onClick={() => void create()}>
            {busy ? 'Запись…' : 'Зарегистрировать'}
          </Button>
        ) : (
          <>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void saveEdit()}>
              {busy ? 'Запись…' : `Сохранить ${editing}`}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => {
              setEditing(null); setName(''); setDesc(''); setPrefix(''); setCost(''); setCaps(new Set()); setConfig('');
            }}>
              Отмена
            </Button>
          </>
        )}
      </div>
      {err && <ErrorState variant="inline" title={err} />}
      {note && <p className={styles.emptyHint} role="status">{note}</p>}

      <div className={styles.formRow} style={{ marginTop: 12 }} role="group" aria-label="Поручить задачу агенту">
        <select className={styles.input} value={sel} onChange={(e) => setSel(e.target.value)} aria-label="Агент для задачи">
          <option value="">агент…</option>
          {specs.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>
        <input className={styles.input} value={task} onChange={(e) => setTask(e.target.value)}
          placeholder="задача для агента" aria-label="Задача для агента"
          onKeyDown={(e) => { if (e.key === 'Enter') void assign(); }} />
        <Button variant="primary" size="sm" disabled={!sel || !task.trim() || busy} onClick={() => void assign()}>
          Поручить
        </Button>
        {sel && (
          <>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void startEdit(sel)}>
              Изменить
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove(sel)}>
              Удалить {sel}
            </Button>
          </>
        )}
      </div>
      {taskErr && <ErrorState variant="inline" title={taskErr} />}
    </GlassPanel>
  );
}

export function AgentsScreen() {
  const router = useRouter();
  const ds = useDataSource(); // #418 (wave #418-2): mount-gated
  const { profile } = useProfile();
  const specs = useAsyncValue(() => ds.listAgents(), [ds]);
  const presence = useAsyncValue(() => ds.listPresence(), [ds]);
  const handoffs = useAsyncValue(() => ds.listHandoffs(), [ds]);
  const graph = useAsyncValue(() => ds.getMissionGraph(), [ds]);
  const [selected, setSelected] = useState<string | null>(null);
  const runs = useAsyncValue(
    () => (selected == null ? Promise.resolve([]) : ds.listRuns({ agent: selected, limit: 5 })),
    [ds, selected],
  );

  // Live overlay: presence entries lift spec status (active/blocked beats idle).
  const roster: AgentRosterItem[] = useMemo(() => {
    const byAgent = new Map<string, PresenceEntry>();
    for (const p of presence.value ?? []) byAgent.set(p.agent, p);
    return (specs.value ?? []).map((s) => {
      const live = byAgent.get(s.name);
      const status: AgentRosterItem['status'] =
        live == null ? 'idle'
          : live.state === 'running' ? 'active'
            : live.state === 'blocked' ? 'blocked'
              : 'idle';
      return { ...s, status, activeTask: live?.state === 'running' ? live.task : null };
    });
  }, [specs.value, presence.value]);

  // Entry default: pick the first live (running) agent, else the first spec —
  // inspector and graph selection ring start populated, user can switch.
  useEffect(() => {
    if (selected != null || roster.length === 0) return;
    const running = roster.find((a) => a.status === 'active');
    setSelected((running ?? roster[0]).name);
  }, [roster, selected]);

  // Постановка задачи агенту — реальный прогон с agent=спекой (пресет спеки
  // сильнее родительского на хосте); после старта — на Runtime смотреть ход.
  const assignTask = useCallback(async (name: string, task: string, config: string | null): Promise<string | null> => {
    try {
      await ds.startRun({
        task,
        config: config ?? profile?.defaultPreset ?? 'baseline',
        agent: name,
        model: profile?.defaultModelId ?? null,
        useMemory: profile?.useMemory === true,
        project: profile?.useMemory === true ? (profile.memoryProject?.trim() || 'ai2') : null,
      });
      router.push('/runtime');
      return null;
    } catch (e) { return e instanceof Error ? e.message : String(e); }
  }, [ds, profile, router]);

  const rosterState: PatternState =
    specs.failed ? 'error' : specs.value == null ? 'loading' : specs.value.length === 0 ? 'empty' : 'ready';
  const presenceState: PatternState =
    presence.failed ? 'error' : presence.value == null ? 'loading' : presence.value.length === 0 ? 'empty' : 'ready';
  const handoffsState: PatternState =
    handoffs.failed ? 'error' : handoffs.value == null ? 'loading' : handoffs.value.length === 0 ? 'empty' : 'ready';
  const graphState: PatternState = graph.failed ? 'error' : graph.value == null ? 'loading' : 'ready';
  const selectedAgent = roster.find((a) => a.name === selected) ?? null;
  // Волна XII: продолжения спеки (AgentSpec.handoffs, verbatim от хоста —
  // аналог «Start Implementation» Copilot). send → реальный прогон целевому
  // агенту; без send → промпт в композитор главной через sessionStorage.
  const selectedHandoffs = specs.value?.find((s) => s.name === selected)?.handoffs ?? [];
  const onSpecHandoff = useCallback(async (h: { label: string; agent: string; prompt: string; send: boolean }) => {
    if (!h.send) {
      try { sessionStorage.setItem('nexus.composer.draft', h.prompt); } catch { /* приватный режим */ }
      router.push('/home');
      return;
    }
    const spec = specs.value?.find((s) => s.name === h.agent);
    await assignTask(h.agent, h.prompt, spec?.config ?? null);
  }, [specs.value, assignTask, router]);

  const onGraphSelect = (id: string) => {
    const node = graph.value?.nodes.find((n) => n.id === id);
    if (node?.kind === 'agent') setSelected(node.label);
  };

  // P-2: активность строится из live roster/presence; диаграмма — единственная
  // агрегированная сводка статусов рядом с поагентной орбитой.
  const statusCounts = useMemo(() => {
    const c = { active: 0, blocked: 0, idle: 0, offline: 0 };
    for (const a of roster) c[a.status ?? 'idle'] += 1;
    return c;
  }, [roster]);
  const donutSeries = {
    id: 'agents-status', label: 'Агенты по статусу',
    points: [
      { x: 'активны', y: statusCounts.active },
      { x: 'блокированы', y: statusCounts.blocked },
      { x: 'свободны', y: statusCounts.idle },
    ],
  };

  return (
    <div className={styles.page} data-screen="agents" aria-labelledby="agents-title">
      <PanelHeader
        level="screen"
        divider={false}
        titleId="agents-title"
        title="Агенты"
        subtitle="Состав, топология и делегации — по данным хоста."
      />
      <div className={styles.agentsOps}>
        <GlassPanel className={styles.panel} data-state={rosterState} data-testid="agents-roster">
          {specs.failed ? (
            <ErrorState variant="inline" title="Состав агентов не загрузился." onRetry={specs.retry} retryLabel="Повторить" />
          ) : (
            <AgentRoster
              items={roster}
              state={rosterState}
              selectedName={selected}
              onSelect={setSelected}
            />
          )}
        </GlassPanel>
        <GlassPanel className={styles.panel} data-state={graphState} data-testid="agents-topology">
          <h3 className={styles.panelTitle}>Топология</h3>
          {graph.failed ? (
            <ErrorState variant="inline" title="Топология не загрузилась." onRetry={graph.retry} retryLabel="Повторить" />
          ) : graph.value == null ? (
            <LoadingState>Загрузка графа…</LoadingState>
          ) : (
            <AgentFlow
              data={{ ...graph.value, state: 'ready', freshness: 'live' }}
              title="Созвездие агентов"
              description="Агенты → шаги → выходы текущей миссии"
              width={860}
              height={300}
              selectedId={selected != null ? `a-${selected}` : undefined}
              onSelectNode={onGraphSelect}
            />
          )}
        </GlassPanel>
        <div className={styles.agentsInspector} data-testid="agents-inspector">
          {/* P-2: констелляция — агенты-чипы вокруг орба + распределение
              задач донатом + доля «в работе», всё из roster/presence. */}
          <GlassPanel className={styles.panel} data-state={rosterState} data-testid="agents-activity">
            <h3 className={styles.panelTitle}>Активность</h3>
            {specs.failed ? (
              <ErrorState variant="inline" title="Состав агентов не загрузился." onRetry={specs.retry} retryLabel="Повторить" />
            ) : roster.length === 0 ? (
              <EmptyState variant="inline" title="Агентов нет — зарегистрируйте первого ниже." />
            ) : (
              <>
                <div className={styles.orbWrap} role="list" aria-label="Созвездие агентов">
                  <span className={styles.orbCore} aria-hidden="true" />
                  {roster.map((a, i) => {
                    const angle = (360 / roster.length) * i - 90;
                    return (
                      <button
                        key={a.name}
                        type="button"
                        role="listitem"
                        className={styles.orbChip}
                        data-status={a.status ?? 'idle'}
                        data-selected={a.name === selected || undefined}
                        style={{ transform: `translate(-50%, -50%) rotate(${angle}deg) translate(76px) rotate(${-angle}deg)` }}
                        title={a.activeTask != null ? `${a.name} — ${a.activeTask}` : a.name}
                        onClick={() => setSelected(a.name)}
                      >
                        {a.name.slice(0, 2).toUpperCase()}
                      </button>
                    );
                  })}
                </div>
                <DonutChart
                  series={donutSeries}
                  a11y={{
                    title: 'Распределение агентов по статусу',
                    description: `активны ${statusCounts.active}, блокированы ${statusCounts.blocked}, свободны ${statusCounts.idle}`,
                  }}
                  freshness="live"
                  width={220}
                  height={180}
                />
              </>
            )}
          </GlassPanel>
          <GlassPanel
            className={styles.panel}
            data-state={specs.failed || runs.failed ? 'error'
              : selectedAgent != null && runs.value == null ? 'loading' : 'ready'}
          >
            {runs.failed ? (
              <ErrorState variant="inline" title="Прогоны агента не загрузились." onRetry={runs.retry} retryLabel="Повторить" />
            ) : (
              <>
                <AgentInspector
                  agent={selectedAgent}
                  runs={runs.value ?? undefined}
                  onOpenRun={(id) => router.push(`/run?id=${encodeURIComponent(id)}`)}
                  state={specs.failed ? 'error' : 'ready'}
                />
                {selectedAgent != null && runs.value == null && (
                  <LoadingState>Прогоны агента загружаются…</LoadingState>
                )}
                <Link className={styles.linkBtn} href="/runtime?tab=history" data-testid="agents-full-history">
                  Открыть историю прогонов ↗
                </Link>
              </>
            )}
            {/* Волна XII: продолжения спеки агента — только из живого
                AgentSpec.handoffs; спеки без поля → бара нет, не пустышка. */}
            {selectedAgent != null && selectedHandoffs.length > 0 && (
              <div data-testid="agent-spec-handoffs">
                <HandoffBar handoffs={selectedHandoffs} onPick={(h) => void onSpecHandoff(h)} />
              </div>
            )}
          </GlassPanel>
          <GlassPanel className={styles.panel} data-state={presenceState}>
            {presence.failed ? (
              <ErrorState variant="inline" title="Присутствие не загрузилось." onRetry={presence.retry} retryLabel="Повторить" />
            ) : (
              <AgentPresence entries={presence.value ?? []} state={presenceState} freshness="live" />
            )}
          </GlassPanel>
        </div>
        <GlassPanel className={styles.panel} data-state={handoffsState} data-testid="agents-events">
          {handoffs.failed ? (
            <ErrorState variant="inline" title="Передачи не загрузились." onRetry={handoffs.retry} retryLabel="Повторить" />
          ) : (
            <AgentHandoff links={handoffs.value ?? []} state={handoffsState} />
          )}
        </GlassPanel>
        {/* XV W3 — «Агенты и сессии»: список сессий агента с фильтрами,
            ветвлением/возобновлением и учётом (токены/стоимость), плюс
            связанные данные прогона. Делегации и хэндофы — ниже. */}
        <AgentSessionsPanel />
        {/* XIV W3: делегации и хэндофы SDK-канала (sdk-delegations-contract):
            параллельные фоновые прогоны + передачи между ассистентами.
            Не путать с «Передачи» выше — там связи родитель→потомок прогонов. */}
        <SdkDelegationsPanel agentNames={roster.map((a) => a.name)} />
        <SdkHandoffsPanel agentNames={roster.map((a) => a.name)} />
        <AgentRegistry specs={roster} onChanged={specs.retry} onAssign={assignTask} />
      </div>
    </div>
  );
}
