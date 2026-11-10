'use client';

/** B.2: KPI-полоса Runtime (выделено из runtime.tsx). */
import { useEffect, useState } from 'react';
import type { RunSummary } from '@nexus/mock-data';
import { getDataSource, useDataSource } from '../../data-source';
import { peekWarm } from '../../runtime-warmup';
import styles from '../screens.module.css';

type KpiState =
  | { state: 'loading' }
  | { state: 'ready'; runs: RunSummary[]; agents: number | null };

/** B.2: KPI-полоса — только то, что честно вычисляется из listRuns +
 *  listAgents: активные джобы, успех завершённых, ср. длительность,
 *  Σ стоимость. tok/мин не считаем — usage нет в сводке прогонов. */
export function RuntimeKpiBand() {
  const ds = useDataSource();
  // Гидратация (NQ #418): peekWarm в lazy-init расходил SSR и первый
  // клиентский кадр — теперь тёплый снапшот применяется в эффекте.
  const [kpi, setKpi] = useState<KpiState>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    const warmRuns = peekWarm<RunSummary[]>('runs');
    if (warmRuns != null) {
      setKpi({ state: 'ready', runs: warmRuns, agents: peekWarm<unknown[]>('agents')?.length ?? null });
    }
    Promise.allSettled([ds.listRuns({ limit: 50 }), ds.listAgents()]).then(([r, a]) => {
      if (!live) return;
      if (r.status === 'rejected') { setKpi({ state: 'loading' }); return; }
      setKpi({ state: 'ready', runs: r.value, agents: a.status === 'fulfilled' ? a.value.length : null });
    });
    return () => { live = false; };
  }, [ds]);

  if (kpi.state !== 'ready') return null;
  const { runs, agents } = kpi;
  const running = runs.filter((r) => r.status === 'running');
  const finished = runs.filter((r) => r.finishedAt != null);
  const done = runs.filter((r) => r.status === 'done');
  const durations = finished.map((r) => (r.finishedAt ?? 0) - r.createdAt).filter((d) => d > 0);
  const avgS = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
  const cost = runs.reduce((acc, r) => acc + (r.costUsd ?? 0), 0);
  const successPct = finished.length ? Math.round((done.length / finished.length) * 100) : null;

  return (
    <div className={styles.kpiRow} data-testid="runtime-kpi" role="group" aria-label="Сводка рантайма">
      <div className={styles.kpiCard}>
        <span className={styles.kpiLabel}>Агенты</span>
        <span className={styles.kpiValue}>{agents ?? '—'}</span>
        <span className={styles.kpiSub}>в реестре</span>
      </div>
      <div className={styles.kpiCard}>
        <span className={styles.kpiLabel}>Джобы</span>
        <span className={styles.kpiValue}>{running.length}<small className={styles.kpiSub}> / {runs.length}</small></span>
        <span className={styles.kpiSub}>активных из выборки</span>
      </div>
      <div className={styles.kpiCard}>
        <span className={styles.kpiLabel}>Успех</span>
        <span className={styles.kpiValue}>{successPct != null ? `${successPct}%` : '—'}</span>
        <span className={styles.kpiSub}>завершённых прогонов</span>
      </div>
      <div className={styles.kpiCard}>
        <span className={styles.kpiLabel}>Длительность</span>
        <span className={styles.kpiValue}>{avgS != null ? `${avgS}с` : '—'}</span>
        <span className={styles.kpiSub}>средняя по завершённым</span>
      </div>
      <div className={styles.kpiCard}>
        <span className={styles.kpiLabel}>Стоимость</span>
        <span className={styles.kpiValue}>{cost > 0 ? `$${cost.toFixed(2)}` : '—'}</span>
        <span className={styles.kpiSub}>Σ по выборке прогонов</span>
      </div>
    </div>
  );
}
