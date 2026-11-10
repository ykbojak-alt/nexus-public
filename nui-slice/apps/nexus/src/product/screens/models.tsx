'use client';


import { ErrorState, GlassPanel, LoadingState, PanelHeader } from '@nexus/ui';
import { ModelCenter, ModelComparison, ModelPerformance, ModelRouter, ModelRouterGraph } from '@nexus/patterns';
import type { PatternState } from '@nexus/patterns';
import { getDataSource, useDataSource } from '../data-source';
import { ModelPickerControl } from '../model-picker-control';
import { updateProfile, useProfile } from '../profile/profile-store';
import { useAsyncValue } from '../use-async-value';
import styles from './screens.module.css';

export function ModelsScreen() {
  const ds = useDataSource();
  const models = useAsyncValue(() => ds.listModels(), [ds]);
  const presets = useAsyncValue(() => ds.listPresets(), [ds]);
  const router = useAsyncValue(() => ds.getModelRouter(), [ds]);
  const usage = useAsyncValue(() => ds.getUsage(), [ds]);
  const { profile } = useProfile();
  // Выбор живёт в профиле (localStorage) — раньше он был локальным состоянием
  // экрана и терялся при переходе на другую вкладку.
  const selectedId = profile?.defaultModelId ?? null;

  const modelsState: PatternState =
    models.failed ? 'error' : models.value == null ? 'loading' : models.value.length === 0 ? 'empty' : 'ready';
  const presetsState: PatternState =
    presets.failed ? 'error' : presets.value == null ? 'loading' : presets.value.length === 0 ? 'empty' : 'ready';
  const routerState: PatternState =
    router.failed ? 'error' : router.value == null ? 'loading' : router.value.nodes.length === 0 ? 'empty' : 'ready';
  const usageState: PatternState =
    usage.failed ? 'error' : usage.value == null ? 'loading' : usage.value.runsTotal === 0 ? 'empty' : 'ready';

  return (
    <div className={styles.page} data-screen="models" aria-labelledby="models-title">
      <PanelHeader level="screen" divider={false} titleId="models-title" title="Модели и маршрутизация" />
      <div className={styles.twoCol}>
        <GlassPanel className={styles.panel} data-state={modelsState} data-testid="models-center">
          {models.failed ? (
            <ErrorState variant="inline" title="Модели не загрузились." onRetry={models.retry} retryLabel="Повторить" />
          ) : (
            <>
              {/* Выбор провайдера и модели — пикер (по образцу OpenCode). */}
              <div className={styles.prefRow}>
                <span className={styles.prefLabel}>Модель по умолчанию</span>
                <ModelPickerControl
                  models={models.value}
                  selectedId={selectedId}
                  onSelect={(id) => updateProfile({ defaultModelId: id })}
                  className={styles.select}
                  label={selectedId ?? 'default (сервер)'}
                  title="Выбрать провайдера и модель"
                  testId="models-picker-trigger"
                />
              </div>
              <ModelCenter
                models={models.value ?? []}
                state={modelsState}
                selectedId={selectedId}
                onSelect={(id) => updateProfile({ defaultModelId: id })}
                title="Каталог моделей"
              />
            </>
          )}
        </GlassPanel>
        <GlassPanel className={styles.panel} data-state={presetsState} data-testid="models-presets">
          {presets.failed ? (
            <ErrorState variant="inline" title="Пресеты не загрузились." onRetry={presets.retry} retryLabel="Повторить" />
          ) : (
            <ModelComparison presets={presets.value ?? []} state={presetsState} />
          )}
        </GlassPanel>
      </div>
      <div className={styles.twoCol}>
        <GlassPanel className={styles.panel} data-state={routerState} data-testid="models-router">
          {router.failed ? (
            <ErrorState variant="inline" title="Маршрутизатор не загрузился." onRetry={router.retry} retryLabel="Повторить" />
          ) : (
            <ModelRouter data={router.value} state={routerState} freshness="live" />
          )}
        </GlassPanel>
        <GlassPanel className={styles.panel} data-state={usageState} data-testid="models-usage">
          {usage.failed ? (
            <ErrorState variant="inline" title="Использование не загрузилось." onRetry={usage.retry} retryLabel="Повторить" />
          ) : (
            <ModelPerformance usage={usage.value} state={usageState} freshness="live" />
          )}
        </GlassPanel>
      </div>
      <GlassPanel className={styles.panel} data-state={routerState} data-testid="models-router-graph">
        <h2 className={styles.panelTitle}>Граф маршрутизатора</h2>
        {router.failed ? (
          <ErrorState variant="inline" title="Граф не загрузился." onRetry={router.retry} retryLabel="Повторить" />
        ) : router.value == null ? (
          <LoadingState>Загрузка графа…</LoadingState>
        ) : (
          <ModelRouterGraph
            data={{ ...router.value, state: 'ready', freshness: 'live' }}
            title="Маршрутизация"
            description="Пресеты → роли → модели"
            width={720}
            height={300}
          />
        )}
      </GlassPanel>
    </div>
  );
}
