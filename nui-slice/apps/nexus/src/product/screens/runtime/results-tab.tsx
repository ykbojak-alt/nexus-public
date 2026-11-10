'use client';

/** Вкладка «Результаты» Runtime (выделено из runtime.tsx). */
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { EmptyState, ErrorState, GlassPanel, LoadingState, StatusBadge } from '@nexus/ui';
import type { RunDetail } from '@nexus/mock-data';
import { getDataSource, useDataSource, getDataSourceConfigStatus, getDataSourceKind } from '../../data-source';
import { STATUS_BADGE, fmtEventTime } from '../runtime-ops';
import styles from '../screens.module.css';

export const RESULTS_SAMPLE = 8;

export function ResultsTab() {
  const router = useRouter();
  const ds = useDataSource();
  const [details, setDetails] = useState<RunDetail[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    if (ds.getRunDetail == null) {
      setDetails([]);
      return;
    }
    setLoadError(false);
    let live = true;
    ds.listRuns({ limit: 50 })
      .then(async (runs) => {
        const finished = runs.filter((r) => r.status !== 'running').slice(0, RESULTS_SAMPLE * 2);
        const out: RunDetail[] = [];
        for (const r of finished) {
          const d = await ds.getRunDetail!(r.runId);
          // Кандидатов берём вдвое больше (окно хоста может быть пустым по
          // результатам), но показываем ровно столько, сколько обещает
          // заголовок («до N прогонов») — список не должен врать о счётчике.
          if (d?.result != null) out.push(d);
          if (out.length >= RESULTS_SAMPLE) break;
        }
        if (live) setDetails(out);
      })
      .catch(() => live && setLoadError(true));
    return () => { live = false; };
  }, [ds]);

  useEffect(() => load(), [load]);

  const [compare, setCompare] = useState<string[]>([]);

  const toggleCompare = (id: string) =>
    setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length < 2 ? [...c, id] : [c[1], id]));

  const state = ds.getRunDetail == null
    ? 'unavailable'
    : loadError ? 'error' : details == null ? 'loading' : details.length === 0 ? 'empty' : 'ready';

  const pair = compare.length === 2
    ? compare.map((id) => details!.find((d) => d.run.runId === id)).filter((d): d is RunDetail => d != null)
    : null;

  const cmpRow = (label: string, a: string, b: string) => (
    <tr key={label}>
      <td className={styles.selectSub}>{label}</td>
      <td>{a}</td>
      <td>{b}</td>
    </tr>
  );

  const fmt = (v: unknown, suffix = '') => (v == null ? '—' : `${v}${suffix}`);
  const sourceKind = getDataSourceKind();
  const configStatus = getDataSourceConfigStatus();
  const sourceLabel = configStatus === 'misconfigured'
    ? 'live не настроен'
    : sourceKind === 'mock' ? 'mock (демо)' : 'live runtime';

  return (
    <GlassPanel className={styles.panel} data-state={state} data-testid="tab-results">
      <h2 className={styles.panelTitle}>
        Результаты <span className={styles.selectSub}>· сохранённые результаты, до {RESULTS_SAMPLE} прогонов · источник: {sourceLabel} · выберите два для сравнения</span>
      </h2>
      {ds.getRunDetail == null && (
        <p className={styles.emptyHint}>Источник данных не реализует получение результата прогона.</p>
      )}
      {state === 'loading' && <LoadingState>Загрузка результатов…</LoadingState>}
      {state === 'error' && <ErrorState variant="inline" title="Не удалось загрузить результаты." onRetry={load} retryLabel="Повторить" />}
      {state === 'ready' && (
        <ul className={styles.selectList}>
          {details!.map(({ run, result }) => (
            <li key={run.runId} className={styles.cmpLi}>
              <button
                type="button"
                className={styles.selectRow}
                data-selected={compare.includes(run.runId)}
                aria-pressed={compare.includes(run.runId)}
                onClick={() => toggleCompare(run.runId)}
              >
                <span className={styles.selectMain}>
                  <span>{run.taskText}</span>
                  <span className={styles.selectSub}>
                    {run.runId}
                    {run.finishedAt != null ? ` · ${fmtEventTime(run.finishedAt)}` : ''}
                    {result!.score != null ? ` · score ${result!.score}` : ''}
                    {result!.verified != null ? ` · ${result!.verified ? 'проверен' : 'не проверен'}` : ' · статус проверки неизвестен'}
                  </span>
                </span>
                <StatusBadge {...STATUS_BADGE[run.status]} />
              </button>
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => router.push(`/run?id=${encodeURIComponent(run.runId)}`)}
              >
                Открыть →
              </button>
            </li>
          ))}
        </ul>
      )}
      {pair != null && pair.length === 2 && (
        <table className={styles.cmpTable} data-testid="run-compare" aria-label="Сравнение прогонов">
          <tbody>
            <tr>
              <td />
              <td className={styles.selectSub}>{pair[0].run.runId}</td>
              <td className={styles.selectSub}>{pair[1].run.runId}</td>
            </tr>
            {cmpRow('Статус', STATUS_BADGE[pair[0].run.status].label, STATUS_BADGE[pair[1].run.status].label)}
            {cmpRow('Пресет', pair[0].run.config, pair[1].run.config)}
            {cmpRow('Агент', fmt(pair[0].run.agent), fmt(pair[1].run.agent))}
            {cmpRow('Проект', fmt(pair[0].run.project), fmt(pair[1].run.project))}
            {cmpRow('Длительность', fmt(pair[0].result!.durationS, ' с'), fmt(pair[1].result!.durationS, ' с'))}
            {cmpRow('Score', fmt(pair[0].result!.score), fmt(pair[1].result!.score))}
            {cmpRow('Verified', fmt(pair[0].result!.verified), fmt(pair[1].result!.verified))}
            {cmpRow('Расход', fmt(pair[0].result!.usage.costUsd, ' $'), fmt(pair[1].result!.usage.costUsd, ' $'))}
            {cmpRow('Токены', fmt(pair[0].result!.usage.tokens), fmt(pair[1].result!.usage.tokens))}
          </tbody>
        </table>
      )}
      {state === 'empty' && ds.getRunDetail != null && (
        <EmptyState variant="inline" title="Сохранённых результатов нет — результаты появляются по завершении прогона." />
      )}
    </GlassPanel>
  );
}
