'use client';

/** Вкладка «Ресурсы» Runtime (выделено из runtime.tsx). */
import { useEffect, useState } from 'react';
import { ModelPerformance, SystemOverview } from '@nexus/patterns';
import type { SystemMetrics, UsageSummary } from '@nexus/mock-data';
import { getDataSource, useDataSource } from '../../data-source';
import { peekWarm } from '../../runtime-warmup';
import styles from '../screens.module.css';

export function ResourcesTab() {
  const ds = useDataSource();
  // Гидратация (NQ #418): тёплый снапшот применяется в эффекте — первый
  // кадр на сервере и клиенте совпадает (null → loading).
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let live = true;
    const wm = peekWarm<SystemMetrics>('metrics');
    if (wm != null) setMetrics(wm);
    const wu = peekWarm<UsageSummary>('usage');
    if (wu != null) setUsage(wu);
    Promise.all([ds.getMetrics(), ds.getUsage()])
      .then(([m, u]) => {
        if (!live) return;
        setMetrics(m);
        setUsage(u);
      })
      .catch(() => live && setLoadError(true));
    return () => { live = false; };
  }, [ds]);

  const state = loadError ? 'error' : metrics == null || usage == null ? 'loading' : 'ready';

  return (
    <div className={styles.twoCol} data-testid="tab-resources">
      <SystemOverview
        metrics={metrics}
        state={state}
        freshness={metrics?.freshness}
        title="Ресурсы · /v1/health"
      />
      <ModelPerformance
        usage={usage}
        state={state}
        title="Расход · /v1/usage"
      />
    </div>
  );
}
