'use client';

/* #53 W3: раздел «Диалоги» (лист 16_56_37-1) — обзор диалоговой активности.
 * Реальные данные: последние прогоны из listRuns (это и есть диалоги/
 * задачи рантайма), сессии агента — на /agents (sdkSessions seam).
 * Нет прогонов → честное пустое состояние, без выдуманных «диалогов». */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EmptyState, ErrorState, GlassPanel, LoadingState, PanelHeader } from '@nexus/ui';
import type { RunSummary } from '@nexus/mock-data/types';
import { getDataSource } from '../data-source';
import { PROC_STATE_LABEL } from '../proc-state-label';
import styles from './screens.module.css';
import rowStyles from './dialogs.module.css';

type Runs = { state: 'loading' } | { state: 'error' } | { state: 'ready'; value: RunSummary[] };

export function DialogsScreen() {
  const [runs, setRuns] = useState<Runs>({ state: 'loading' });
  useEffect(() => {
    const ds = getDataSource();
    let alive = true;
    ds.listRuns({ limit: 20 }).then(
      (rows) => { if (alive) setRuns({ state: 'ready', value: rows }); },
      () => { if (alive) setRuns({ state: 'error' }); },
    );
    return () => { alive = false; };
  }, []);

  return (
    <div className={styles.page} data-screen="dialogs" aria-labelledby="dialogs-title">
      <GlassPanel className={styles.panel}>
        <p className={styles.eyebrow}>РАЗДЕЛ</p>
        <PanelHeader level="screen" divider={false} titleId="dialogs-title" title="Диалоги" />
        <p className={styles.body}>
          История диалогов и задач рантайма. Сессии агента — на экране
          {' '}<Link href="/agents">«Агенты и сессии»</Link>, события — на
          {' '}<Link href="/runtime?tab=bus">шине Runtime</Link>.
        </p>
      </GlassPanel>
      <GlassPanel className={styles.panel} data-state={runs.state}>
        <h2 className={styles.panelTitle}>Последние диалоги</h2>
        {runs.state === 'loading' && <LoadingState>Читаю историю…</LoadingState>}
        {runs.state === 'error' && (
          <ErrorState variant="inline" title="Нет данных" body="источник не отдал список прогонов." />
        )}
        {runs.state === 'ready' && runs.value.length === 0 && (
          <EmptyState variant="inline" title="Диалогов пока нет" body="начните задачу на главной." />
        )}
        {runs.state === 'ready' && runs.value.length > 0 && (
          <ul className={rowStyles.historyList} aria-label="Последние диалоги">
            {runs.value.map((r) => {
              const task = r.taskText || r.runId;
              const status = PROC_STATE_LABEL[r.status] ?? r.status;
              return (
                <li key={r.runId} className={rowStyles.historyRow}>
                  <Link
                    className={rowStyles.historyLink}
                    href={`/runtime?run=${encodeURIComponent(r.runId)}`}
                    aria-label={`Открыть прогон ${r.runId}. Задача: ${task}. Статус: ${status}${r.agent ? `. Агент: ${r.agent}` : ''}${r.stopReason ? `. Причина: ${r.stopReason}` : ''}`}
                  >
                    <span className={rowStyles.taskText}>{task}</span>
                    <span className={rowStyles.rowMeta}>
                      <span>{status}</span>
                      {r.agent != null && <span> · Агент: {r.agent}</span>}
                    </span>
                  </Link>
                  <details className={rowStyles.disclosure}>
                    <summary aria-label={`Подробнее о прогоне ${r.runId}`}>Подробнее</summary>
                    <dl className={rowStyles.fullDetails}>
                      <dt>Задача</dt><dd>{task}</dd>
                      <dt>Прогон</dt><dd>{r.runId}</dd>
                      <dt>Статус</dt><dd>{status}</dd>
                      {r.agent != null && <><dt>Агент</dt><dd>{r.agent}</dd></>}
                      {r.stopReason != null && <><dt>Причина</dt><dd>{r.stopReason}</dd></>}
                    </dl>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </GlassPanel>
    </div>
  );
}
