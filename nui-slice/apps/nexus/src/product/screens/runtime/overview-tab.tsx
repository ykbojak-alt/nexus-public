'use client';

/** Вкладка «Обзор» Runtime (выделено из runtime.tsx). */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { EmptyState, ErrorState, GlassPanel, JobControl, LoadingState, StatusBadge } from '@nexus/ui';
import { PROCESS_STATE_LABELS, RUN_STATUS_LABELS, processStateBadge, runStatusBadge } from '@nexus/patterns';
import type { PresenceEntry } from '@nexus/patterns';
import type { AgentSpec, ModelInfo, RunControlState, RunSummary, SystemMetrics, UsageSummary } from '@nexus/mock-data';
import type { FsWriteRequest } from '../../../integrations/ai2/contracts/fs';
import { getDataSource, useDataSource } from '../../data-source';
import { peekWarm } from '../../runtime-warmup';
import { planDagOf } from '../runtime-ops';
import styles from '../screens.module.css';

type OverviewSlice<T> = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; value: T };

const sliceOf = <T,>(r: PromiseSettledResult<T>): OverviewSlice<T> =>
  r.status === 'fulfilled' ? { state: 'ready', value: r.value } : { state: 'failed' };

export function OverviewTab() {
  const ds = useDataSource();
  const router = useRouter();
  const [tick, setTick] = useState(0);
  // Гидратация (NQ #418): прогретый кэш module-level — на SSR пуст, на
  // клиенте заполнен → lazy-init дал бы разный первый кадр. Начало всегда
  // 'loading', peekWarm применяется в эффекте до fetch — цена: один кадр.
  const [presence, setPresence] = useState<OverviewSlice<PresenceEntry[]>>({ state: 'loading' });
  const [runs, setRuns] = useState<OverviewSlice<RunSummary[]>>({ state: 'loading' });
  const [agents, setAgents] = useState<OverviewSlice<AgentSpec[]>>({ state: 'loading' });
  const [usage, setUsage] = useState<OverviewSlice<UsageSummary>>({ state: 'loading' });
  const [metrics, setMetrics] = useState<OverviewSlice<SystemMetrics>>({ state: 'loading' });
  const [models, setModels] = useState<OverviewSlice<ModelInfo[]>>({ state: 'loading' });
  const [fsPending, setFsPending] = useState<OverviewSlice<FsWriteRequest[]>>({ state: 'loading' });
  const [fsDecisions, setFsDecisions] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    const warmApply = <T,>(key: string, setter: (s: OverviewSlice<T>) => void) => {
      const v = peekWarm<T>(key);
      if (v != null) setter({ state: 'ready', value: v });
    };
    warmApply('presence', setPresence);
    warmApply('runs', setRuns);
    warmApply('agents', setAgents);
    warmApply('usage', setUsage);
    warmApply('metrics', setMetrics);
    warmApply('models', setModels);
    warmApply('fs', setFsPending);
    const set = <T,>(setter: (s: OverviewSlice<T>) => void) => (r: PromiseSettledResult<T>) => { if (live) setter(sliceOf(r)); };
    Promise.allSettled([
      ds.listPresence(), ds.listRuns({ limit: 50 }), ds.listAgents(),
      ds.getUsage(), ds.getMetrics(), ds.listModels(),
      ds.fs != null ? ds.fs.requests({ status: 'pending' }) : Promise.resolve(null),
    ]).then(([p, r, a, u, m, md, fs]) => {
      if (!live) return;
      setPresence(sliceOf(p));
      setRuns(sliceOf(r));
      setAgents(sliceOf(a));
      setUsage(sliceOf(u));
      setMetrics(sliceOf(m));
      setModels(sliceOf(md));
      // seam отсутствует → null из resolve: помечаем unavailable, не «пусто».
      setFsPending(fs.status === 'fulfilled' && fs.value == null
        ? { state: 'failed' }
        : sliceOf(fs as PromiseSettledResult<FsWriteRequest[]>));
    });
    return () => { live = false; };
  }, [ds, tick]);

  const decideFs = async (id: string, decision: 'approve' | 'deny') => {
    if (ds.fs == null) return;
    try {
      const req = await (decision === 'approve' ? ds.fs.approve(id) : ds.fs.deny(id));
      setFsDecisions((m) => ({ ...m, [id]: req.status }));
    } catch {
      setFsDecisions((m) => ({ ...m, [id]: 'error' }));
    }
  };

  const runningRuns = runs.state === 'ready' ? runs.value.filter((r) => r.status === 'running') : [];
  const activePresence = presence.state === 'ready' ? presence.value.filter((p) => p.state === 'running') : [];
  const usageVal = usage.state === 'ready' ? usage.value : null;
  const successPct = usageVal != null && usageVal.runsTotal > 0
    ? Math.round((usageVal.runsSucceeded / usageVal.runsTotal) * 100)
    : null;

  const metricChip = (label: string, pct: number | null | undefined) => (
    <span key={label} className={styles.metricChip} data-state={pct == null ? 'empty' : 'ready'}>
      {label} · {pct == null ? 'нет данных' : `${Math.round(pct)}%`}
    </span>
  );

  return (
    <div className={styles.overview} data-testid="tab-overview">
      {/* KPI-полоса (контракт §1): агенты по процессам, активные прогоны,
          успех/расход по /v1/usage. Нет данных → «нет данных», не ноль. */}
      <div className={styles.kpiRow} role="group" aria-label="Сводка обзора">
        <div className={styles.kpiCard} data-state={presence.state}>
          <span className={styles.kpiLabel}>Агенты активны</span>
          <span className={styles.kpiValue}>
            {presence.state === 'ready' ? activePresence.length : '—'}
          </span>
          <span className={styles.kpiSub}>
            {presence.state === 'ready'
              ? `из ${presence.value.length} процессов`
              : presence.state === 'failed' ? 'нет данных' : 'чтение…'}
          </span>
        </div>
        <div className={styles.kpiCard} data-state={runs.state}>
          <span className={styles.kpiLabel}>Прогоны активны</span>
          <span className={styles.kpiValue}>
            {runs.state === 'ready' ? runningRuns.length : '—'}
          </span>
          <span className={styles.kpiSub}>
            {runs.state === 'ready'
              ? `из ${runs.value.length} в выборке`
              : runs.state === 'failed' ? 'нет данных' : 'чтение…'}
          </span>
        </div>
        <div className={styles.kpiCard} data-state={usage.state}>
          <span className={styles.kpiLabel}>Успех{usageVal != null ? ` · ${usageVal.period}` : ''}</span>
          <span className={styles.kpiValue}>{successPct != null ? `${successPct}%` : '—'}</span>
          <span className={styles.kpiSub}>
            {usageVal != null
              ? `${usageVal.runsSucceeded}/${usageVal.runsTotal} прогонов`
              : usage.state === 'failed' ? 'нет данных' : 'чтение…'}
          </span>
        </div>
        <div className={styles.kpiCard} data-state={usage.state}>
          <span className={styles.kpiLabel}>Расход{usageVal != null ? ` · ${usageVal.period}` : ''}</span>
          <span className={styles.kpiValue}>{usageVal != null ? `$${usageVal.costUsd.toFixed(3)}` : '—'}</span>
          <span className={styles.kpiSub}>
            {usage.state === 'failed' ? 'нет данных' : usage.state === 'loading' ? 'чтение…' : 'по /v1/usage'}
          </span>
        </div>
      </div>

      <div className={styles.twoCol}>
        {/* Job Control (контракт §3): выбор активного прогона, прогресс —
            счётчик шагов из plan/emit_step событий, пауза/резюме/стоп по
            host-controls. Нет активных → честный empty. */}
        <OverviewJobControl runs={runs.state === 'ready' ? runs.value : null} onChanged={() => setTick((t) => t + 1)} />

        {/* Подтверждения (контракт §5/fs): pending fs-заявки; seam нет →
            unavailable, пусто → «нет ожидающих». */}
        <GlassPanel
          className={styles.panel}
          data-state={
            ds.fs == null ? 'unavailable'
              : fsPending.state === 'ready' ? (fsPending.value.length > 0 ? 'ready' : 'empty')
                : fsPending.state
          }
          data-testid="overview-approvals"
        >
          <h2 className={styles.fsPaneTitle}>Подтверждения</h2>
          {ds.fs == null ? (
            <EmptyState variant="inline" title="Очередь заявок недоступна" reason="fs-seam у источника отсутствует" />
          ) : fsPending.state === 'loading' ? (
            <LoadingState>Читаю заявки…</LoadingState>
          ) : fsPending.state === 'failed' ? (
            <ErrorState variant="inline" title="Нет данных" body="источник не ответил." />
          ) : fsPending.value.length === 0 ? (
            <EmptyState variant="inline" title="Нет ожидающих заявок." />
          ) : (
            <div role="list">
              {fsPending.value.map((req) => {
                const st = fsDecisions[req.id] ?? req.status;
                const decided = st !== 'pending';
                return (
                  <div key={req.id} role="listitem" data-state={st} className={styles.inboxRow}>
                    <span className={styles.inboxTarget} title={`${req.op} · ${req.size} Б · sha256 ${req.sha256}`}>
                      {req.runId.slice(0, 8)} · {req.op} · {req.root ? `${req.root}:${req.path}` : req.path}
                    </span>
                    {req.preview !== '' && <span className={styles.inboxPreview}>{req.preview.slice(0, 120)}</span>}
                    {decided ? (
                      <span className={styles.inboxState}>{st === 'approved' ? 'разрешено' : st === 'denied' ? 'отклонено' : st}</span>
                    ) : (
                      <span className={styles.inboxActions}>
                        <button type="button" className={styles.prefChoice} onClick={() => void decideFs(req.id, 'approve')}>Разрешить</button>
                        <button type="button" className={styles.prefChoice} onClick={() => void decideFs(req.id, 'deny')}>Отклонить</button>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </GlassPanel>
      </div>

      <div className={styles.twoCol}>
        {/* Карточки агентов (контракт §2): реестр + статус из процессов;
            портретов у хоста нет → монограмма; без процесса → «нет прогонов». */}
        <GlassPanel
          className={styles.panel}
          data-state={
            agents.state === 'ready'
              ? agents.value.length > 0 ? 'ready' : 'empty'
              : agents.state
          }
          data-testid="overview-agents"
        >
          <h2 className={styles.fsPaneTitle}>Агенты</h2>
          {agents.state === 'loading' && <LoadingState>Читаю реестр…</LoadingState>}
          {agents.state === 'failed' && <ErrorState variant="inline" title="Нет данных" body="реестр не ответил." />}
          {agents.state === 'ready' && agents.value.length === 0 && (
            <EmptyState variant="inline" title="Реестр агентов пуст." />
          )}
          {agents.state === 'ready' && agents.value.length > 0 && (
            <div role="list" className={styles.agentCards}>
              {agents.value.map((a) => {
                const proc = presence.state === 'ready'
                  ? presence.value.find((p) => p.agent === a.name)
                  : undefined;
                return (
                  <button
                    key={a.name}
                    type="button"
                    role="listitem"
                    className={styles.agentCard}
                    onClick={() => router.push('/agents')}
                    title={proc?.task ?? a.description ?? a.name}
                  >
                    <span className={styles.agentCardMono} aria-hidden="true">{a.name.trim()[0]?.toUpperCase() ?? '?'}</span>
                    <span className={styles.agentCardText}>
                      <span className={styles.agentCardName}>{a.name}</span>
                      <span className={styles.agentCardSub}>{a.config ?? 'конфиг не задан'}</span>
                    </span>
                    {proc != null ? (
                      <StatusBadge status={processStateBadge(proc.state)} label={PROCESS_STATE_LABELS[proc.state]} />
                    ) : (
                      <span className={styles.agentCardNone}>нет прогонов</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </GlassPanel>

        <div className={styles.overviewCol}>
          {/* Нагрузка (контракт §/v1/metrics): null-поля → «нет данных». */}
          <GlassPanel
            className={styles.panel}
            data-state={metrics.state}
            data-testid="overview-metrics"
          >
            <h2 className={styles.fsPaneTitle}>Нагрузка хоста</h2>
            {metrics.state === 'loading' && <LoadingState>Читаю метрики…</LoadingState>}
            {metrics.state === 'failed' && <ErrorState variant="inline" title="Нет данных" body="метрики не ответили." />}
            {metrics.state === 'ready' && (
              <div className={styles.metricChips}>
                {metricChip('CPU', metrics.value.cpuPct)}
                {metricChip('RAM', metrics.value.ramPct)}
                {metricChip('Диск', metrics.value.diskPct)}
                {metricChip('GPU', metrics.value.gpuPct)}
              </div>
            )}
          </GlassPanel>

          {/* Модели и расход (контракт §/v1/models + usage.breakdown). */}
          <GlassPanel
            className={styles.panel}
            data-state={models.state}
            data-testid="overview-models"
          >
            <h2 className={styles.fsPaneTitle}>Модели и расход</h2>
            {models.state === 'loading' && <LoadingState>Читаю каталог…</LoadingState>}
            {models.state === 'failed' && <ErrorState variant="inline" title="Нет данных" body="каталог не ответил." />}
            {models.state === 'ready' && (
              <>
                {models.value.length > 0
                  ? <p className={styles.emptyHint}>{models.value.length} моделей в каталоге</p>
                  : <EmptyState variant="inline" title="Каталог моделей пуст." />}
                {usageVal != null && usageVal.breakdown.length > 0 && (
                  <div role="list" className={styles.usageRows}>
                    {usageVal.breakdown.map((b) => (
                      <span key={b.config} role="listitem" className={styles.usageRow}>
                        {b.config} · {b.runs} прогонов · ${b.costUsd.toFixed(3)}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}

/** Job Control обзора (контракт §3): выбор прогона из активных, прогресс
 *  из наблюдаемых шагов плана (planDagOf по событиям detail), пауза/резюме
 *  по getRunControls — без seam/контролей кнопки честно disabled. */
export function OverviewJobControl({ runs, onChanged }: { runs: RunSummary[] | null; onChanged: () => void }) {
  const ds = useDataSource();
  const running = (runs ?? []).filter((r) => r.status === 'running');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = running.find((r) => r.runId === selectedId) ?? running[0] ?? null;
  const [controls, setControls] = useState<RunControlState | null>(null);
  const [controlsDown, setControlsDown] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (selected == null) { setControls(null); setProgress(null); return; }
    let live = true;
    setControlsDown(false);
    if (ds.getRunControls != null) {
      ds.getRunControls(selected.runId)
        .then((c) => { if (live) setControls(c); })
        .catch(() => { if (live) setControlsDown(true); });
    } else {
      setControls(null);
    }
    if (ds.getRunDetail != null) {
      ds.getRunDetail(selected.runId)
        .then((d) => {
          if (!live || d == null) return;
          const steps = planDagOf(d.events);
          const done = steps.filter((s) => s.status === 'done').length;
          setProgress(steps.length > 0 ? Math.round((done / steps.length) * 100) : null);
        })
        .catch(() => { if (live) setProgress(null); });
    } else {
      setProgress(null);
    }
    return () => { live = false; };
  }, [ds, selected?.runId]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: ((id: string) => Promise<unknown>) | undefined, id: string) => {
    if (fn == null || busy) return;
    setBusy(true);
    try {
      const next = await fn(id);
      if (next != null && typeof next === 'object' && 'pause' in next) setControls(next as RunControlState);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassPanel
      className={styles.panel}
      data-state={
        runs == null ? 'loading'
          : running.length === 0 ? 'empty'
            : 'ready'
      }
      data-testid="overview-jobcontrol"
    >
      <h2 className={styles.fsPaneTitle}>Управление прогоном</h2>
      {runs == null ? (
        <p className={styles.emptyHint}>Читаю прогоны…</p>
      ) : running.length === 0 ? (
        <p className={styles.emptyHint}>Нет активных прогонов — управлять нечем.</p>
      ) : (
        <>
          <select
            className={styles.jobSelect}
            aria-label="Активный прогон"
            value={selected?.runId ?? ''}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {running.map((r) => (
              <option key={r.runId} value={r.runId}>{r.taskText} · {r.runId.slice(0, 8)}</option>
            ))}
          </select>
          {selected != null && (
            <JobControl
              label={selected.taskText}
              status={runStatusBadge(selected.status)}
              statusLabel={RUN_STATUS_LABELS[selected.status] ?? selected.status}
              progress={progress}
              paused={controls?.paused ?? false}
              canPause={controls?.pause.available ?? false}
              canCancel
              onPause={ds.pauseRun != null ? () => void act(ds.pauseRun!.bind(ds), selected.runId) : undefined}
              onResume={ds.resumeRun != null ? () => void act(ds.resumeRun!.bind(ds), selected.runId) : undefined}
              onCancel={() => void act((id) => ds.cancelRun(id), selected.runId)}
            />
          )}
          {controlsDown && (
            <p className={styles.emptyHint}>Контроли прогона недоступны — хост не ответил.</p>
          )}
          {busy && <p className={styles.emptyHint}>Применяю…</p>}
        </>
      )}
    </GlassPanel>
  );
}
