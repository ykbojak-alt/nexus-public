'use client';

/** Чип статуса 3D-сцены в шапке Runtime (выделено). */
import { StatusBadge } from '@nexus/ui';
import type { UnrealSceneStatus } from '@nexus/mock-data';
import { SCENE_STATUS_BADGE, sceneUpdatedLabel } from './shared';
import { useRuntimeSceneState } from './scene-state';

/** runtime-wave2 B5: чип состояния UE-сцены в шапке Runtime. Статус —
 *  verbatim от моста nexus-scene (ds.unrealScene.getState); источник
 *  `mock` → DEMO, seam отсутствует/ошибка → UNKNOWN, никаких «здоровых»
 *  значений без хоста. Источник состояния и polling общий с вкладкой сцены. */
export function SceneStatusChip() {
  const { seam, state, failed } = useRuntimeSceneState();

  const status: UnrealSceneStatus = seam == null || failed ? 'unknown' : (state?.status ?? 'unknown');
  const badge = SCENE_STATUS_BADGE[status] ?? SCENE_STATUS_BADGE.unknown;
  const demo = state?.source === 'mock';
  const label = demo ? 'DEMO' : badge.label;
  const hint = seam == null
    ? 'Мост сцены не подключён к этому источнику'
    : failed
      ? 'Мост сцены не ответил'
      : [state?.reason,
      // nexus-scene-v1 (W1 S3): ассистент сцены verbatim — только когда
      // хост сообщил поле; fallback 'alice' — правило хоста.
      state?.activeAssistant != null ? `Ассистент: ${state.activeAssistant}` : null,
      state?.lastUpdated != null ? `обновлено ${sceneUpdatedLabel(state.lastUpdated)}` : null]
        .filter(Boolean).join(' · ') || 'Состояние сцены от хоста';
  return (
    <StatusBadge
      status={demo ? 'info' : badge.status}
      label={`Сцена · ${label}`}
      data-testid="scene-chip"
      title={hint}
    />
  );
}
