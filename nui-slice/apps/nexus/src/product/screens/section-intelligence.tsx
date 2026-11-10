'use client';

/** Волна XII — экран-обзор раздела Intelligence (NUE1): живые блоки
 *  раздела — память хоста и каталог моделей. Каждая панель читает свой
 *  seam (useAsyncValue): загрузка/ошибка/пусто — честные состояния,
 *  без выдуманных чисел. Подэкраны: /memory, /models. */
import Link from 'next/link';

import { EmptyState, ErrorState, GlassPanel, LoadingState, PanelHeader, StatusBadge } from '@nexus/ui';
import { getDataSource, useDataSource } from '../data-source';
import { useAsyncValue } from '../use-async-value';
import styles from './screens.module.css';

export function IntelligenceScreen() {
  const ds = useDataSource();
  const structure = useAsyncValue(() => ds.getMemoryStructure(), [ds]);
  const items = useAsyncValue(() => ds.listMemory(), [ds]);
  const models = useAsyncValue(() => ds.listModels(), [ds]);
  const router = useAsyncValue(() => ds.getModelRouter(), [ds]);

  const memoryState = structure.failed ? 'error' : structure.value == null ? 'loading' : 'ready';
  const modelsState = models.failed ? 'error' : models.value == null ? 'loading' : 'ready';
  const routerState = router.failed ? 'error' : router.value == null ? 'loading' : 'ready';

  return (
    <div className={styles.page} data-screen="intelligence" aria-labelledby="intelligence-title">
      <PanelHeader level="screen" divider={false} titleId="intelligence-title" title="Intelligence" />
      <p className={styles.pageIntro}>
        Память и модели хоста — реальные значения из seam'ов.{' '}
        <Link href="/memory">Память</Link> · <Link href="/models">Модели</Link>
      </p>

      <div className={styles.kpiRow} role="group" aria-label="Сводка раздела Intelligence">
        <GlassPanel className={`${styles.panel} ${styles.kpiCard}`} data-state={memoryState} data-testid="intel-kpi-memory">
          <span className={styles.kpiLabel}>Записей памяти</span>
          <span className={styles.kpiValue}>
            {structure.value != null ? structure.value.total.toLocaleString('ru-RU') : '—'}
          </span>
          <span className={styles.kpiLabel}>
            {structure.value != null ? `проект ${structure.value.project}` : 'нет данных'}
          </span>
        </GlassPanel>
        <GlassPanel className={`${styles.panel} ${styles.kpiCard}`} data-state={modelsState} data-testid="intel-kpi-models">
          <span className={styles.kpiLabel}>Моделей в каталоге</span>
          <span className={styles.kpiValue}>
            {models.value != null ? models.value.length.toLocaleString('ru-RU') : '—'}
          </span>
          <span className={styles.kpiLabel}>
            {router.value != null ? `маршрутов: ${router.value.edges.length}` : 'нет данных'}
          </span>
        </GlassPanel>
      </div>

      <div className={styles.twoCol}>
        <GlassPanel className={styles.panel} data-state={memoryState} data-testid="intel-memory">
          <h3 className={styles.panelTitle}>Память — последние записи</h3>
          {structure.failed || items.failed ? (
            <ErrorState variant="inline" title="Память не загрузилась." onRetry={structure.failed ? structure.retry : items.retry} retryLabel="Повторить" />
          ) : items.value == null ? (
            <LoadingState>Читаю память…</LoadingState>
          ) : items.value.length === 0 ? (
            <EmptyState variant="inline" title="Нет данных" body="Записей памяти нет — прогоны с памятью ещё не сохраняли контекст." />
          ) : (
            <>
              <ul role="list" aria-label="Последние записи памяти">
                {items.value.slice(0, 5).map((m) => (
                  <li key={m.id} role="listitem">
                    <span className={styles.emptyHint}>{m.project}</span> {m.text}
                  </li>
                ))}
              </ul>
              {structure.value != null && structure.value.sources.length > 0 && (
                <p className={styles.emptyHint}>
                  источники: {structure.value.sources.map((s) => `${s.name} · ${s.count}`).join(', ')}
                </p>
              )}
            </>
          )}
        </GlassPanel>

        <GlassPanel className={styles.panel} data-state={modelsState} data-testid="intel-models">
          <h3 className={styles.panelTitle}>Модели</h3>
          {models.failed ? (
            <ErrorState variant="inline" title="Каталог моделей не загрузился." onRetry={models.retry} retryLabel="Повторить" />
          ) : models.value == null ? (
            <LoadingState>Читаю каталог…</LoadingState>
          ) : models.value.length === 0 ? (
            <EmptyState variant="inline" title="Нет данных" body="Каталог моделей пуст — хост не объявил ни одной." />
          ) : (
            <ul role="list" aria-label="Модели хоста">
              {models.value.map((m) => (
                <li key={m.id} role="listitem">
                  {m.label} {m.isDefault && <StatusBadge status="online" label="по умолчанию" />}
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>
      </div>
    </div>
  );
}
