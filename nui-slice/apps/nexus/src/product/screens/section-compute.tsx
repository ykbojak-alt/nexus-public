'use client';

/** Волна XII — экран-обзор раздела Compute (NUE1): живые блоки раздела —
 *  метрики хоста, процессы агентов, воркер и прогоны. Каждая панель читает
 *  свой seam: загрузка/ошибка/пусто/unavailable — честные состояния,
 *  без выдуманных чисел. Подэкраны: /local-agent, /runtime/guard. */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EmptyState, ErrorState, GlassPanel, LoadingState, PanelHeader, StatusBadge } from '@nexus/ui';
import { getDesktopBridge, hasDesktopBridge } from '../../integrations/ai2/desktop-bridge/adapter';
import type { InstalledTool, InstalledToolLaunchResult } from '../../integrations/ai2/desktop-bridge/types';
import { STATUS_BADGE, fmtPlayTime } from './runtime-ops';
import { getDataSource, useDataSource } from '../data-source';
import { useAsyncValue } from '../use-async-value';
import { HonestEmpty } from './honest-empty';
import styles from './screens.module.css';

const WORKER_STATE: Record<string, { status: 'online' | 'executing' | 'error' | 'offline'; label: string }> = {
  ready: { status: 'online', label: 'работает' },
  starting: { status: 'executing', label: 'запускается' },
  crashed: { status: 'error', label: 'упал' },
  down: { status: 'offline', label: 'не запущен' },
};

function pct(v: number | null): string {
  return v == null ? '—' : `${Math.round(v)}%`;
}

const TOOL_REASON: Record<string, string> = {
  registry_path_not_found: 'Путь VS Code не найден в разрешённой записи App Paths.',
  registry_unavailable: 'Запись App Paths недоступна.',
  executable_unavailable: 'Исполняемый файл VS Code недоступен.',
  tool_not_allowlisted: 'Инструмент не входит в разрешённый список.',
  launcher_refused: 'Хост отклонил запуск.',
  desktop_window_unavailable: 'Запуск доступен только из окна приложения.',
  version_not_read: 'Версия хостом не считывалась.',
  version_unavailable: 'Версия недоступна.',
};

function InstalledToolCard() {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'unavailable'; reason: string }
    | { kind: 'error'; reason: string }
    | { kind: 'ready'; tools: InstalledTool[] }
  >({ kind: 'loading' });
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [launchStates, setLaunchStates] = useState<Record<string,
    | { kind: 'error'; message: string }
    | { kind: 'unavailable'; message: string }
    | { kind: 'result'; result: InstalledToolLaunchResult }
  >>({});

  useEffect(() => {
    let alive = true;
    if (!hasDesktopBridge()) {
      setState({ kind: 'unavailable', reason: 'Действие доступно только в desktop host; браузерный режим его не запускает.' });
      return () => { alive = false; };
    }
    void getDesktopBridge().then(async (base) => {
      if (!base.available) {
        if (alive) setState({ kind: 'unavailable', reason: 'DesktopBridge не подключён.' });
        return;
      }
      try {
        const inventory = await base.listInstalledTools();
        if (inventory == null) {
          if (alive) setState({
            kind: 'unavailable',
            reason: 'DesktopBridge не предоставляет каталог installed-tools.',
          });
          return;
        }
        if (!alive) return;
        setState({ kind: 'ready', tools: inventory.tools });
      } catch (error) {
        if (alive) setState({
          kind: 'error',
          reason: error instanceof Error ? error.message : 'Ошибка запроса installed-tools.',
        });
      }
    }).catch(() => {
      if (alive) setState({ kind: 'error', reason: 'Не удалось подключиться к DesktopBridge.' });
    });
    return () => { alive = false; };
  }, []);

  const launch = async (tool: InstalledTool) => {
    if (state.kind !== 'ready' || tool.status !== 'available' || launchingId != null) return;
    setLaunchingId(tool.id);
    setLaunchStates((previous) => {
      const next = { ...previous };
      delete next[tool.id];
      return next;
    });
    try {
      const bridge = await getDesktopBridge();
      const result = await bridge.openInstalledTool(tool.id);
      if (result == null) {
        setLaunchStates((previous) => ({
          ...previous,
          [tool.id]: {
            kind: 'unavailable',
            message: 'DesktopBridge не предоставляет результат запуска installed-tools.',
          },
        }));
      } else {
        setLaunchStates((previous) => ({ ...previous, [tool.id]: { kind: 'result', result } }));
      }
    } catch (error) {
      setLaunchStates((previous) => ({
        ...previous,
        [tool.id]: {
          kind: 'error',
          message: error instanceof Error ? error.message : 'Ошибка вызова open_installed_tool.',
        },
      }));
    } finally {
      setLaunchingId(null);
    }
  };

  return (
    <GlassPanel className={styles.panel} data-testid="installed-tools-card"
      data-state={state.kind === 'ready' && state.tools.length === 0 ? 'empty' : state.kind}>
      <h3 className={styles.panelTitle}>Установленные инструменты</h3>
      {state.kind === 'loading' ? (
        <LoadingState>Читаю доступность из DesktopBridge…</LoadingState>
      ) : state.kind === 'error' ? (
        <ErrorState variant="inline" title="Ошибка запроса installed-tools." body={state.reason} />
      ) : state.kind === 'unavailable' ? (
        <EmptyState variant="inline" title="Каталог инструментов недоступен" reason={state.reason} />
      ) : state.tools.length === 0 ? (
        <EmptyState variant="inline" title="Хост вернул пустой список installed-tools." />
      ) : (
        <ul className={styles.selectList}>
          {state.tools.map((tool) => {
            const launchState = launchStates[tool.id];
            const launchLabel = tool.id === 'git'
              ? 'Проверить версию Git'
              : `Открыть ${tool.name}`;
            return (
              <li key={tool.id} className={styles.selectRow}
                data-testid={`installed-tool-${tool.id}`} data-state={tool.status}>
                <span className={styles.selectMain}>
                  <span>{tool.name}</span>
                  <span className={styles.selectSub}>
                    {tool.status === 'available' ? 'доступен' : `статус хоста: ${tool.status}`}
                  </span>
                  <span className={styles.selectSub}>
                    Версия: {tool.version ?? 'нет данных'}
                    {tool.version == null && tool.version_reason != null
                      ? ` · ${TOOL_REASON[tool.version_reason] ?? tool.version_reason}`
                      : ''}
                  </span>
                  {tool.reason != null && (
                    <span className={styles.selectSub}>
                      {TOOL_REASON[tool.reason] ?? tool.reason}
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={tool.status !== 'available' || launchingId != null}
                    onClick={() => void launch(tool)}
                  >
                    {launchingId === tool.id ? 'Передаю запрос…' : launchLabel}
                  </button>
                  {launchState?.kind === 'unavailable' && (
                    <span role="status">{launchState.message}</span>
                  )}
                  {launchState?.kind === 'error' && <span role="alert">{launchState.message}</span>}
                  {launchState?.kind === 'result' && (() => {
                    const { result } = launchState;
                    const verbatimResult = JSON.stringify(result);
                    const rejected = result.status === 'unavailable' || result.id !== tool.id;
                    return rejected
                      ? <span role="alert">Хост отклонил инструмент: <code>{verbatimResult}</code></span>
                      : <span role="status">Ответ хоста: <code>{verbatimResult}</code></span>;
                  })()}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </GlassPanel>
  );
}

export function ComputeScreen() {
  const ds = useDataSource();
  const metrics = useAsyncValue(() => ds.getMetrics(), [ds]);
  const presence = useAsyncValue(() => ds.listPresence(), [ds]);
  const runs = useAsyncValue(() => ds.listRuns({ limit: 20 }), [ds]);
  const usage = useAsyncValue(() => ds.getUsage(), [ds]);
  const worker = useAsyncValue(
    () => (ds.workerStatus == null ? Promise.resolve(null) : ds.workerStatus()),
    [ds],
  );

  const metricsState = metrics.failed ? 'error' : metrics.value == null ? 'loading' : 'ready';
  const presenceState = presence.failed ? 'error' : presence.value == null ? 'loading' : 'ready';
  const runsState = runs.failed ? 'error' : runs.value == null ? 'loading' : 'ready';
  const workerState = ds.workerStatus == null ? 'unavailable'
    : worker.failed ? 'error' : worker.value == null ? 'loading' : 'ready';

  const running = (runs.value ?? []).filter((r) => r.status === 'running');
  const w = worker.value;
  const wBadge = w != null ? (WORKER_STATE[w.state] ?? { status: 'offline' as const, label: w.state }) : null;

  return (
    <div className={styles.page} data-screen="compute" aria-labelledby="compute-title">
      <PanelHeader level="screen" divider={false} titleId="compute-title" title="Compute" />
      <p className={styles.pageIntro}>
        Нагрузка хоста, процессы, воркер и прогоны — реальные значения из seam'ов.{' '}
        <Link href="/local-agent">Локальный агент</Link> · <Link href="/runtime/guard">G.U.A.R.D.</Link>
      </p>

      <div className={styles.kpiRow} role="group" aria-label="Нагрузка хоста">
        <GlassPanel className={`${styles.panel} ${styles.kpiCard}`} data-state={metricsState} data-testid="compute-kpi-load">
          <span className={styles.kpiLabel}>Нагрузка</span>
          <span className={styles.kpiValue}>
            {metrics.value != null ? `CPU ${pct(metrics.value.cpuPct)}` : '—'}
          </span>
          <span className={styles.kpiLabel}>
            {metrics.value != null
              ? `RAM ${pct(metrics.value.ramPct)} · диск ${pct(metrics.value.diskPct)} · GPU ${metrics.value.gpuPct == null ? 'нет данных' : pct(metrics.value.gpuPct)}`
              : 'нет данных'}
          </span>
        </GlassPanel>
        <GlassPanel className={`${styles.panel} ${styles.kpiCard}`} data-state={presenceState} data-testid="compute-kpi-processes">
          <span className={styles.kpiLabel}>Процессы</span>
          <span className={styles.kpiValue}>
            {presence.value != null ? presence.value.length.toLocaleString('ru-RU') : '—'}
          </span>
          <span className={styles.kpiLabel}>
            {presence.value != null ? `в работе: ${presence.value.filter((p) => p.state === 'running').length}` : 'нет данных'}
          </span>
        </GlassPanel>
        <GlassPanel className={`${styles.panel} ${styles.kpiCard}`} data-state={runsState} data-testid="compute-kpi-runs">
          <span className={styles.kpiLabel}>Прогоны</span>
          <span className={styles.kpiValue}>
            {runs.value != null ? running.length.toLocaleString('ru-RU') : '—'}
          </span>
          <span className={styles.kpiLabel}>
            {usage.value != null ? `за ${usage.value.period}: ${usage.value.runsTotal} · $${usage.value.costUsd.toFixed(3)}` : 'нет данных'}
          </span>
        </GlassPanel>
      </div>

      <InstalledToolCard />

      <div className={styles.twoCol}>
        <GlassPanel className={styles.panel} data-state={workerState} data-testid="compute-worker">
          <h3 className={styles.panelTitle}>Воркер</h3>
          {ds.workerStatus == null ? (
            <HonestEmpty label="Нет данных" subtitle="seam workerStatus у источника отсутствует" />
          ) : worker.failed ? (
            <ErrorState variant="inline" title="Статус воркера не загрузился." onRetry={worker.retry} retryLabel="Повторить" />
          ) : w == null ? (
            <LoadingState>Читаю статус воркера…</LoadingState>
          ) : (
            <>
              <p>{wBadge != null && <StatusBadge status={wBadge.status} label={wBadge.label} />}</p>
              <p className={styles.emptyHint}>
                pid {w.pid ?? '—'} · перезапусков {w.restarts ?? '—'}{w.maxRestarts != null ? `/${w.maxRestarts}` : ''}
                {w.uptimeS != null ? ` · аптайм ${fmtPlayTime(w.uptimeS)}` : ''}
              </p>
              {w.grant != null && (
                <p className={styles.emptyHint}>
                  грант {w.grant.grantId} · {w.grant.mode} · корней {w.grant.roots.length}
                  {w.grant.revoked ? ' · отозван' : ''}
                </p>
              )}
            </>
          )}
        </GlassPanel>

        <GlassPanel className={styles.panel} data-state={runsState} data-testid="compute-runs">
          <h3 className={styles.panelTitle}>Последние прогоны</h3>
          {runs.failed ? (
            <ErrorState variant="inline" title="Прогоны не загрузились." onRetry={runs.retry} retryLabel="Повторить" />
          ) : runs.value == null ? (
            <LoadingState>Читаю прогоны…</LoadingState>
          ) : runs.value.length === 0 ? (
            <HonestEmpty label="Нет данных" subtitle="Прогонов не было — запустите задачу из Runtime." />
          ) : (
            <ul role="list" aria-label="Последние прогоны">
              {runs.value.slice(0, 5).map((r) => (
                <li key={r.runId} role="listitem">
                  <Link href={`/runtime?run=${r.runId}`}>{r.taskText}</Link>{' '}
                  <StatusBadge {...STATUS_BADGE[r.status]} />
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>
      </div>
    </div>
  );
}
