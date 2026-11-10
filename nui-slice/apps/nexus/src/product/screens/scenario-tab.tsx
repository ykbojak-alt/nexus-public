'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Button, EmptyState, ErrorState, GlassPanel, LoadingState, StatusBadge,
  type NexusStatus,
} from '@nexus/ui';
import type { ScenarioHealth, ScenarioStepStatus } from '../../integrations/ai2/contracts/system';
import { getDataSource, useDataSource } from '../data-source';
import { runWhileDocumentVisible } from '../visible-interval';
import styles from './screens.module.css';

/**
 * XV W3 — панель «Сценарий»: чек-лист S1–S9 по GET /v1/scenario/health
 * (приёмочный шлюз W1 — каждый шаг реальная проверка хоста, статусы
 * verbatim). Пустой список/сбой — честные состояния, без заглушек.
 * Ссылки «где смотреть» — навигация по нашим экранам, не данные хоста.
 */

const POLL_MS = 30_000;

const STEP_BADGE: Record<string, { status: NexusStatus; label: string }> = {
  ok: { status: 'complete', label: 'ГОТОВО' },
  degraded: { status: 'warning', label: 'ЧАСТИЧНО' },
  unavailable: { status: 'offline', label: 'НЕТ ДАННЫХ' },
  error: { status: 'error', label: 'ОШИБКА' },
};

/** Где в NEU живёт поверхность шага — навигация, не хост-данные. */
const STEP_LINKS: Record<string, { href: string; label: string }> = {
  S1: { href: '/', label: 'boot / выбор ассистента' },
  S2: { href: '/home', label: 'домашний экран' },
  S3: { href: '/home', label: 'сессии и композитор' },
  S4: { href: '/runtime?tab=process', label: 'лента прогона' },
  S5: { href: '/runtime?tab=process', label: 'карточки подтверждений' },
  S6: { href: '/runtime?tab=process', label: 'дифф и чекпоинты' },
  S7: { href: '/runtime?tab=bus', label: 'Окна и шина' },
  S8: { href: '/runtime?tab=overview', label: 'учёт и ресурсы' },
  S9: { href: '/runtime?tab=scene', label: 'сцена UE' },
};

export function ScenarioTab() {
  const ds = useDataSource();
  const seam = ds.scenarioHealth;
  const [health, setHealth] = useState<ScenarioHealth | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed' | 'unavailable'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (seam == null) { setState('unavailable'); return; }
    let live = true;
    setState((s) => (s === 'ready' ? s : 'loading'));
    const load = () => {
      seam()
        .then((h) => { if (live) { setHealth(h); setState('ready'); setError(null); } })
        .catch((e) => {
          if (live) { setState('failed'); setError(e instanceof Error ? e.message : String(e)); }
        });
    };
    load();
    const stopPolling = runWhileDocumentVisible(load, POLL_MS);
    return () => { live = false; stopPolling(); };
  }, [seam, tick]);

  return (
    <GlassPanel className={`${styles.panel} ${styles.scenarioPanel}`} data-testid="scenario-panel">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Сценарий «Рабочий день с AGENT-A»</h2>
        <span className={styles.panelNote}>
          Приёмочный шлюз /v1/scenario/health — статусы и причины verbatim от хоста.
          {health?.generatedAt != null && ` Снято: ${new Date(health.generatedAt).toLocaleTimeString('ru-RU')}`}
        </span>
        <Button size="sm" onClick={() => setTick((t) => t + 1)} disabled={state === 'loading'}>
          Обновить
        </Button>
      </div>
      {state === 'unavailable' && (
        <EmptyState variant="inline" title="Шлюз сценария недоступен — seam хоста не подключён." />
      )}
      {state === 'failed' && (
        <ErrorState variant="inline" title={`Шлюз не ответил: ${error ?? ''}`}
          onRetry={() => setTick((t) => t + 1)} retryLabel="Повторить" />
      )}
      {state === 'loading' && health == null && <LoadingState>Опрашиваю шлюз сценария…</LoadingState>}
      {state === 'ready' && health != null && health.steps.length === 0 && (
        <EmptyState variant="inline" title="Нет данных у хоста — шагов сценария шлюз не вернул." />
      )}
      {health != null && health.steps.length > 0 && (
        <ol className={styles.scenarioList} data-testid="scenario-steps">
          {health.steps.map((s) => {
            const badge = STEP_BADGE[s.status] ?? { status: 'syncing' as NexusStatus, label: s.status.toUpperCase() };
            const link = STEP_LINKS[s.id];
            return (
              <li key={s.id} className={styles.scenarioStep} data-status={s.status} data-testid={`scenario-${s.id}`}>
                <span className={styles.scenarioId}>{s.id}</span>
                <div className={styles.scenarioBody}>
                  <span className={styles.scenarioTitle}>{s.title}</span>
                  {s.detail != null && <span className={styles.scenarioDetail}>{s.detail}</span>}
                  {link != null && (
                    <Link className={styles.scenarioLink} href={link.href}>↗ {link.label}</Link>
                  )}
                </div>
                <div className={styles.scenarioSide}>
                  <StatusBadge {...badge} />
                  {s.latencyMs != null && <span className={styles.scenarioLatency}>{s.latencyMs} мс</span>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </GlassPanel>
  );
}
