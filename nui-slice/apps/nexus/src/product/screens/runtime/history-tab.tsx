'use client';

/** Вкладка «История» Runtime (выделено из runtime.tsx). */
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { EmptyState, ErrorState, GlassPanel, LoadingState, StatusBadge } from '@nexus/ui';
import type { RunStatus, RunSummary } from '@nexus/mock-data';
import { getDataSource, useDataSource } from '../../data-source';
import { peekWarm } from '../../runtime-warmup';
import { STATUS_BADGE } from '../runtime-ops';
import styles from '../screens.module.css';

export function HistoryTab() {
  const router = useRouter();
  const ds = useDataSource();
  // Гидратация (NQ #418): тёплый снапшот применяется в mount-эффекте —
  // первый кадр на сервере и клиенте совпадает (null → loading).
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [projects, setProjects] = useState<string[] | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [status, setStatus] = useState<RunStatus | null>(null);

  const load = useCallback(() => {
    setLoadError(false);
    ds.listRuns({ limit: 50 }).then(setRuns).catch(() => setLoadError(true));
    ds.listProjects?.().then(setProjects).catch(() => { });
  }, [ds]);

  useEffect(() => {
    const wr = peekWarm<RunSummary[]>('runs');
    if (wr != null) setRuns(wr);
    const wp = peekWarm<string[]>('projects');
    if (wp != null) setProjects(wp);
    load();
  }, [load]);

  const list = (runs ?? []).filter(
    (r) => (project == null || r.project === project) && (status == null || r.status === status),
  );
  const state = loadError ? 'error' : runs == null ? 'loading' : list.length === 0 ? 'empty' : 'ready';

  return (
    <GlassPanel className={styles.panel} data-state={state} data-testid="tab-history">
      <h2 className={styles.panelTitle}>История прогонов <span className={styles.selectSub}>· последние 50</span></h2>
      <div className={styles.prefRow}>
        {projects != null && projects.length > 0 && (
          <>
            <span className={styles.prefLabel}>Проект <span className={styles.selectSub}>(из выборки)</span></span>
            <span className={styles.prefChoices}>
              <button type="button" className={styles.prefChoice} data-selected={project == null} onClick={() => setProject(null)}>все</button>
              {projects.map((p) => (
                <button key={p} type="button" className={styles.prefChoice} data-selected={project === p} onClick={() => setProject(p)}>{p}</button>
              ))}
            </span>
          </>
        )}
        <span className={styles.prefLabel}>Статус</span>
        <span className={styles.prefChoices}>
          <button type="button" className={styles.prefChoice} data-selected={status == null} onClick={() => setStatus(null)}>все</button>
          {(Object.keys(STATUS_BADGE) as RunStatus[]).map((s) => (
            <button key={s} type="button" className={styles.prefChoice} data-selected={status === s} onClick={() => setStatus(s)}>
              {STATUS_BADGE[s].label.toLowerCase()}
            </button>
          ))}
        </span>
      </div>
      {state === 'loading' && <LoadingState>Загрузка истории…</LoadingState>}
      {state === 'error' && <ErrorState variant="inline" title="Не удалось загрузить историю." onRetry={load} retryLabel="Повторить" />}
      {state === 'empty' && <EmptyState variant="inline" title="Прогонов под фильтром нет." />}
      {state === 'ready' && (
        <ul className={styles.selectList}>
          {list.map((r) => (
            <li key={r.runId}>
              <button
                type="button"
                className={styles.selectRow}
                onClick={() => router.push(`/run?id=${encodeURIComponent(r.runId)}`)}
              >
                <span className={styles.selectMain}>
                  <span>{r.taskText}</span>
                  <span className={styles.selectSub}>
                    {r.runId}
                    {r.agent ? ` · ${r.agent}` : ''}
                    {r.project ? ` · ${r.project}` : ''}
                    {r.costUsd != null ? ` · $${r.costUsd.toFixed(3)}` : ' · н/д'}
                  </span>
                </span>
                <StatusBadge {...STATUS_BADGE[r.status]} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </GlassPanel>
  );
}
