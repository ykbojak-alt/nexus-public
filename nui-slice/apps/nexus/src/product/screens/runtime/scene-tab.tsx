'use client';

/** Вкладка «3D-сцена» Runtime (выделено из runtime.tsx). */
import { useEffect, useState } from 'react';
import { Button, ErrorState, GlassPanel, LoadingState, StatusBadge } from '@nexus/ui';
import { SCENE_MAP_BY_ASSISTANT } from '@nexus/mock-data';
import type { UnrealSceneEvent } from '@nexus/mock-data';
import { SCENE_FRESHNESS, SCENE_STATUS_BADGE, sceneAgeLabel, sceneAgeSeconds, sceneUpdatedLabel } from './shared';
import { useRuntimeSceneState } from './scene-state';
import { runWhileDocumentVisible } from '../../visible-interval';
import styles from '../screens.module.css';

export function SceneTab() {
  const { seam, state, failed, opening, refresh, open } = useRuntimeSceneState();
  const [lastEvent, setLastEvent] = useState<UnrealSceneEvent | null>(null);

  useEffect(() => {
    if (seam == null) return;
    let live = true;
    // VII V3-1: обратные события `unreal-scene.event` — показываем только
    // пришедшее от хоста (нет событий → блока нет, без фабрикации).
    const unsubEvents = seam?.subscribeEvents?.((e) => { if (live) setLastEvent(e); });
    return () => { live = false; unsubEvents?.(); };
  }, [seam]);

  // Tick so the "updated N s ago" label and data-fresh-age stay honest.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    return runWhileDocumentVisible(() => setNowMs(Date.now()), 5000);
  }, []);

  if (seam == null) {
    return (
      <GlassPanel className={styles.panel} data-state="unavailable" data-testid="tab-scene">
        <h2 className={styles.panelTitle}>3D-сцена Runtime</h2>
        <p className={styles.emptyHint}>
          3D-сцена открывается отдельным окном Unreal рядом с этим интерфейсом — она показывает
          ядро NEXUS, узлы системы и статусы в 3D и не заменяет 2D Runtime.
        </p>
        <p className={styles.emptyHint}>
          Управление сценой недоступно: DesktopBridge-хост не предоставляет метод сцены
          (unreal_scene_state / unreal_scene_open). Подключение выполняет AI-2-хост — интерфейс
          не запускает процессы сам. Порядок установки:{' '}
          <code>integrations/unreal/NexusRuntimeScene/README.md</code>.
        </p>
      </GlassPanel>
    );
  }

  if (failed) {
    return (
      <GlassPanel className={styles.panel} data-state="error" data-testid="tab-scene">
        <h2 className={styles.panelTitle}>3D-сцена Runtime</h2>
        <ErrorState variant="inline" title="Не удалось получить состояние сцены от хоста." onRetry={() => void refresh()} retryLabel="Повторить" />
      </GlassPanel>
    );
  }

  if (state == null) {
    return (
      <GlassPanel className={styles.panel} data-state="loading" data-testid="tab-scene">
        <h2 className={styles.panelTitle}>3D-сцена Runtime</h2>
        <LoadingState>Запрос состояния сцены…</LoadingState>
      </GlassPanel>
    );
  }

  // Неизвестный enum от host/новой схемы — fail-safe в 'unknown', никогда в connected.
  const badge = SCENE_STATUS_BADGE[state.status] ?? SCENE_STATUS_BADGE.unknown;
  const canOpen = state.status === 'disconnected' || state.status === 'error';

  const age = sceneAgeSeconds(state.lastUpdated, nowMs);
  return (
    <GlassPanel
      className={styles.panel}
      data-state="ready"
      data-freshness={SCENE_FRESHNESS[state.status] ?? 'unknown'}
      data-fresh-age={age ?? undefined}
      data-testid="tab-scene"
    >
      <div data-testid="scene-preview">
      <h2 className={styles.panelTitle}>3D-сцена Runtime</h2>
      <p className={styles.emptyHint}>
        Отдельное окно Unreal с 3D-представлением ядра и узлов системы. Этот экран остаётся
        основным: запуск задач, разрешения и данные — здесь, сцена только визуализирует.
      </p>
      <div className={styles.prefRow}>
        <span className={styles.prefLabel}>Состояние</span>
        <StatusBadge status={badge.status} label={badge.label} />
        {state.source === 'mock' && <StatusBadge status="info" label="DEMO" />}
      </div>
      {state.reason != null && <p className={styles.emptyHint}>{state.reason}</p>}
      {state.status === 'not-installed' && (
        <p className={styles.emptyHint}>
          Восстановление — через ремонт или переустановку пакета клиента; выбор
          произвольного exe недоступен.
        </p>
      )}
      <div className={styles.prefRow}>
        <span className={styles.prefLabel}>Обновлено</span>
        <span className={styles.selectSub}>{sceneUpdatedLabel(state.lastUpdated)}</span>
        <span className={styles.selectSub} data-testid="scene-age">· {sceneAgeLabel(age)}</span>
        {state.protocolVersion != null && (
          <span className={styles.selectSub}>· протокол v{state.protocolVersion}</span>
        )}
      </div>
      {/* nexus-scene-v1 (W1 S3): активный ассистент сцены — verbatim и
          только когда хост сообщил поле; без поля строки нет. */}
      {state.activeAssistant != null && (
        <div className={styles.prefRow} data-testid="scene-assistant">
          <span className={styles.prefLabel}>Ассистент сцены</span>
          <span className={styles.selectSub}>{state.activeAssistant}</span>
        </div>
      )}
      {/* VII V3-3: активная карта — verbatim от хоста; «ожидаемая карта» —
          канон SCENE_MAP_BY_ASSISTANT (справочно, выбор карты у хоста). */}
      {state.activeMap != null && (
        <div className={styles.prefRow} data-testid="scene-map">
          <span className={styles.prefLabel}>Карта</span>
          <span className={styles.selectSub}>{state.activeMap}</span>
        </div>
      )}
      {state.activeAssistant != null && SCENE_MAP_BY_ASSISTANT[state.activeAssistant] != null && (
        <div className={styles.prefRow} data-testid="scene-map-expected">
          <span className={styles.prefLabel}>Карта по контракту</span>
          <span className={styles.selectSub}>{SCENE_MAP_BY_ASSISTANT[state.activeAssistant]}</span>
        </div>
      )}
      {/* VII V3-1: последнее обратное событие сцены (клик по портрету,
          возврат, ошибка карты) — verbatim, без словаря синонимов. */}
      {lastEvent != null && (
        <div className={styles.prefRow} data-testid="scene-event">
          <span className={styles.prefLabel}>Событие сцены</span>
          <span className={styles.selectSub}>{lastEvent.type}</span>
          {lastEvent.map != null && <span className={styles.selectSub}>· {lastEvent.map}</span>}
          {lastEvent.ts != null && <span className={styles.selectSub}>· {sceneUpdatedLabel(lastEvent.ts)}</span>}
        </div>
      )}
      <div className={styles.prefRow}>
        <Button
          variant="secondary"
          onClick={() => void open()}
          loading={opening}
          disabled={!canOpen}
          title={
            canOpen
              ? 'Открыть окно 3D-сцены'
              : 'Запуск недоступен в текущем состоянии — см. статус и причину выше'
          }
        >
          Открыть 3D-сцену
        </Button>
      </div>
      </div>
    </GlassPanel>
  );
}
