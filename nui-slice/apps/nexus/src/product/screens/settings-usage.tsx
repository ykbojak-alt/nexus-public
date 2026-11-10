'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { EmptyState, ErrorState, GlassPanel, LoadingState, PanelHeader } from '@nexus/ui';
import type { RunSummary } from '@nexus/mock-data';
import { getDataSource, useDataSource } from '../data-source';
import { useAsyncValue } from '../use-async-value';
import styles from './screens.module.css';

/** R-W3.6: агрегат расхода по дню — только наблюдаемые costUsd/createdAt. */
interface DayCost {
  day: string;          // YYYY-MM-DD локальной зоны
  costUsd: number;
  runs: number;
  pricedRuns: number;   // сколько прогонов реально отчитались о cost
}

function dayKey(epoch: number): string {
  const d = new Date(epoch * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function aggregateByDay(runs: RunSummary[]): DayCost[] {
  const map = new Map<string, DayCost>();
  for (const r of runs) {
    const key = dayKey(r.createdAt);
    const row = map.get(key) ?? { day: key, costUsd: 0, runs: 0, pricedRuns: 0 };
    row.runs += 1;
    if (r.costUsd != null) {
      row.costUsd += r.costUsd;
      row.pricedRuns += 1;
    }
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}

export function SettingsUsageScreen() {
  const ds = useDataSource();
  const runs = useAsyncValue(() => ds.listRuns({ limit: 200 }), [ds]);
  const state = runs.failed ? 'error' : runs.value == null ? 'loading' : runs.value.length === 0 ? 'empty' : 'ready';

  const days = useMemo(
    () => (runs.value != null ? aggregateByDay(runs.value) : []),
    [runs.value],
  );
  const totalCost = days.reduce((acc, d) => acc + d.costUsd, 0);
  const pricedRuns = days.reduce((acc, d) => acc + d.pricedRuns, 0);
  const maxCost = Math.max(0, ...days.map((d) => d.costUsd));

  return (
    <section className={styles.page} data-screen="settings-usage" aria-labelledby="usage-title">
      <p className={styles.runtimeEyebrow}>NEXUS · НАСТРОЙКИ</p>
      <PanelHeader
        level="screen"
        divider={false}
        titleId="usage-title"
        title="Расход"
        subtitle={(
          <>
            Агрегаты <code>cost_usd</code> по дням — из наблюдаемых прогонов.{' '}
            <Link href="/settings">← Настройки</Link>
          </>
        )}
      />

      {state === 'loading' && <LoadingState>Читаю прогоны…</LoadingState>}
      {state === 'error' && (
        <ErrorState variant="panel" title="Не удалось загрузить прогоны." onRetry={runs.retry} retryLabel="Повторить" />
      )}
      {state === 'empty' && (
        <EmptyState variant="panel" title="Нет данных о расходе" body="Прогонов ещё не было — агрегаты появятся после первых запусков." />
      )}
      {state === 'ready' && runs.value != null && (
        <>
          <div className={styles.kpiRow} aria-label="Сводка расхода">
            <GlassPanel className={styles.kpiCard} data-testid="usage-total">
              <span className={styles.kpiLabel}>Σ стоимость</span>
              <span className={styles.kpiValue}>{pricedRuns > 0 ? `$${totalCost.toFixed(3)}` : '—'}</span>
              <span className={styles.kpiSub}>по {runs.value.length} прогонам выборки</span>
            </GlassPanel>
            <GlassPanel className={styles.kpiCard}>
              <span className={styles.kpiLabel}>Прогоны с ценой</span>
              <span className={styles.kpiValue}>{pricedRuns}</span>
              <span className={styles.kpiSub}>остальные не отчитались о cost_usd</span>
            </GlassPanel>
            <GlassPanel className={styles.kpiCard}>
              <span className={styles.kpiLabel}>Дней в выборке</span>
              <span className={styles.kpiValue}>{days.length}</span>
              <span className={styles.kpiSub}>по created_at прогонов</span>
            </GlassPanel>
          </div>

          {pricedRuns === 0 ? (
            <EmptyState variant="panel" title="Стоимость не отчитана"
              body="Ни один прогон выборки не несёт cost_usd — расход не выдумывается." />
          ) : (
            <GlassPanel className={styles.panel}>
              <h3 className={styles.panelTitle}>Расход по дням</h3>
              <ul className={styles.usageDays} data-testid="usage-days">
                {days.map((d) => (
                  <li key={d.day} className={styles.usageDay} data-testid="usage-day">
                    <span className={styles.usageDayLabel}>{d.day}</span>
                    <span className={styles.usageDayBar}>
                      <span
                        className={styles.usageDayFill}
                        style={{ width: maxCost > 0 ? `${Math.round((d.costUsd / maxCost) * 100)}%` : '0%' }}
                      />
                    </span>
                    <span className={styles.usageDayValue}>
                      {d.pricedRuns > 0 ? `$${d.costUsd.toFixed(3)}` : '—'} · {d.runs} {d.runs === 1 ? 'прогон' : 'прогонов'}
                    </span>
                  </li>
                ))}
              </ul>
            </GlassPanel>
          )}
        </>
      )}
    </section>
  );
}
