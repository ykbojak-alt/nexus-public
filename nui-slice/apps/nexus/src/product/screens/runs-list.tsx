'use client';

/* W3-161: экран «Прогоны» — лента GET /v1/runs newest-first.
 * Реальные данные: ds.listRuns с серверным status-фильтром и offset-
 * пагинацией (before-курсора на /v1/runs нет — страницы по offset,
 * конец определяется честной короткой страницей). Строка = StatusBadge
 * (STATUS_BADGE — та же карта, что в ленте), prompt-preview, время,
 * длительность из finishedAt−createdAt. Клик → /runtime?run=<id>.
 * Ошибка/пусто — честные состояния, моковых прогонов нет. */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { EmptyState, ErrorState, GlassPanel, LoadingState, PanelHeader, StatusBadge } from '@nexus/ui';
import type { RunStatus, RunSummary } from '@nexus/mock-data/types';
import { getDataSource } from '../data-source';
import { STATUS_BADGE, fmtEventTime } from './runtime-ops';
import styles from './screens.module.css';
import rowStyles from './dialogs.module.css';

const PAGE_SIZE = 50;

const FILTERS: readonly { id: RunStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'running', label: 'В работе' },
  { id: 'done', label: 'Завершённые' },
  { id: 'error', label: 'С ошибкой' },
  { id: 'cancelled', label: 'Отменённые' },
  { id: 'timeout', label: 'Просроченные' },
];

function durationLabel(run: RunSummary): string | null {
  if (run.finishedAt == null || run.finishedAt <= run.createdAt) return null;
  const s = Math.round(run.finishedAt - run.createdAt);
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')} мин`;
}

type RunsState =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; rows: RunSummary[]; hasMore: boolean };

export function RunsScreen() {
  const [filter, setFilter] = useState<RunStatus | 'all'>('all');
  const [runs, setRuns] = useState<RunsState>({ state: 'loading' });
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const status = filter === 'all' ? undefined : filter;
  useEffect(() => {
    const ds = getDataSource();
    let alive = true;
    setRuns({ state: 'loading' });
    ds.listRuns({ limit: PAGE_SIZE, status }).then(
      (rows) => {
        if (!alive) return;
        setRuns({ state: 'ready', rows, hasMore: rows.length === PAGE_SIZE });
      },
      () => { if (alive) setRuns({ state: 'error' }); },
    );
    return () => { alive = false; };
  }, [status, reloadTick]);

  const loadMore = useCallback(() => {
    if (runs.state !== 'ready' || loadingMore) return;
    const ds = getDataSource();
    const offset = runs.rows.length;
    setLoadingMore(true);
    ds.listRuns({ limit: PAGE_SIZE, offset, status }).then(
      (rows) => {
        setLoadingMore(false);
        setRuns((cur) => cur.state !== 'ready'
          ? cur
          : {
            state: 'ready',
            rows: [...cur.rows, ...rows.filter((r) => !cur.rows.some((p) => p.runId === r.runId))],
            hasMore: rows.length === PAGE_SIZE,
          });
      },
      () => setLoadingMore(false),
    );
  }, [runs, loadingMore, status]);

  return (
    <div className={styles.page} data-screen="runs" aria-labelledby="runs-title">
      <GlassPanel className={styles.panel}>
        <p className={styles.eyebrow}>РАЗДЕЛ</p>
        <PanelHeader
          level="screen"
          divider={false}
          titleId="runs-title"
          title="Прогоны"
        />
        <p className={styles.body}>
          Все прогоны рантайма, новые сверху. Открытие — в{' '}
          <Link href="/runtime">Runtime</Link>; диалоги — на{' '}
          <Link href="/dialogs">«Диалоги»</Link>.
        </p>
      </GlassPanel>
      <GlassPanel className={styles.panel} data-state={runs.state}>
        <h2 className={styles.panelTitle}>Лента прогонов</h2>
        <div className={rowStyles.filterRow} role="group" aria-label="Фильтр по статусу">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={rowStyles.filterChip}
              aria-pressed={filter === f.id}
              data-active={filter === f.id || undefined}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {runs.state === 'loading' && <LoadingState>Читаю прогоны…</LoadingState>}
        {runs.state === 'error' && (
          <ErrorState
            variant="inline"
            title="Нет данных"
            body="источник не отдал список прогонов."
            onRetry={() => setReloadTick((t) => t + 1)}
            retryLabel="Повторить"
          />
        )}
        {runs.state === 'ready' && runs.rows.length === 0 && (
          <EmptyState
            variant="inline"
            title={status == null ? 'Прогонов пока нет' : 'Прогонов с таким статусом нет'}
            body="запустите задачу на главной или смените фильтр."
          />
        )}
        {runs.state === 'ready' && runs.rows.length > 0 && (
          <>
            <ul className={rowStyles.historyList} aria-label="Прогоны">
              {runs.rows.map((r) => {
                const task = r.taskText || r.runId;
                const badge = STATUS_BADGE[r.status as RunStatus];
                const duration = durationLabel(r);
                return (
                  <li key={r.runId} className={rowStyles.historyRow}>
                    <Link
                      className={rowStyles.historyLink}
                      href={`/runtime?run=${encodeURIComponent(r.runId)}`}
                      aria-label={`Открыть прогон ${r.runId}. Задача: ${task}. Статус: ${badge?.label ?? r.status}`}
                    >
                      <span className={rowStyles.taskText}>{task}</span>
                      <span className={rowStyles.rowMeta}>
                        <time dateTime={new Date(r.createdAt * 1000).toISOString()}>
                          {fmtEventTime(r.createdAt)}
                        </time>
                        {duration != null && <span> · {duration}</span>}
                        {r.agent != null && <span> · агент: {r.agent}</span>}
                        {r.config != null && r.config !== '' && <span> · {r.config}</span>}
                        {r.stopReason != null && <span> · {r.stopReason}</span>}
                      </span>
                    </Link>
                    {badge != null && <StatusBadge {...badge} />}
                  </li>
                );
              })}
            </ul>
            {runs.hasMore ? (
              <button
                type="button"
                className={rowStyles.loadMore}
                disabled={loadingMore}
                onClick={loadMore}
              >
                {loadingMore ? 'Загружаю…' : 'Загрузить ещё'}
              </button>
            ) : (
              <p className={rowStyles.listEnd} role="status">Вся лента загружена</p>
            )}
          </>
        )}
      </GlassPanel>
    </div>
  );
}
