'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@nexus/ui';
import type { UnrealSceneHostState, UnrealSceneStatus } from '@nexus/mock-data';
import { getDataSource, useDataSource } from '../data-source';
import { runWhileDocumentVisible } from '../visible-interval';
import styles from './scene-launch.module.css';

/**
 * VII V1.4 — «Открыть 3D-сцену» на экранах ассистентов. Состояние строго
 * verbatim от моста nexus-scene (ds.unrealScene.getState / subscribe):
 * UI никогда не поднимает статус до connected сам, процессы не запускает —
 * только seam.open() через DesktopBridge-хост.
 */
const STATUS_LABEL: Record<UnrealSceneStatus, string> = {
  'not-installed': 'UE не установлен',
  disconnected: 'UE не запущен',
  starting: 'UE запускается…',
  connected: 'Сцена открыта',
  stale: 'Сцена открыта · данные устарели',
  error: 'Ошибка сцены',
  unknown: 'Статус сцены неизвестен',
};

const POLL_MS = 15_000;

export function SceneLaunchButton({ className, persona }: { className?: string; persona?: string }) {
  const ds = useDataSource();
  const seam = ds.unrealScene;
  const [state, setState] = useState<UnrealSceneHostState | null>(null);
  const [down, setDown] = useState(false);
  const [opening, setOpening] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchFailed, setSwitchFailed] = useState(false);

  useEffect(() => {
    if (seam == null) return;
    let live = true;
    const poll = () => {
      seam.getState()
        .then((s) => { if (live) { setState(s); setDown(false); } })
        .catch(() => { if (live) setDown(true); });
    };
    poll();
    const unsub = seam.subscribe?.((s) => { if (live) setState(s); });
    const stopPolling = unsub == null ? runWhileDocumentVisible(poll, POLL_MS) : undefined;
    return () => { live = false; unsub?.(); stopPolling?.(); };
  }, [seam]);

  const open = useCallback(async () => {
    if (seam == null || opening) return;
    setOpening(true);
    try {
      // Ответ хоста — новое состояние verbatim (starting/connected/error…);
      // локально до connected ничего не «докручиваем».
      setState(await seam.open());
      setDown(false);
    } catch {
      setDown(true);
    } finally {
      setOpening(false);
    }
  }, [seam, opening]);

  // VIII V1.4: переключение персоны живой сцены без перезапуска. Показ —
  // только при подтверждённом connected, другой активной персоне и seam
  // с setActive; sent:false → честный «не дошло», не «переключено».
  const setActive = useCallback(async () => {
    if (seam?.setActive == null || persona == null || switching) return;
    setSwitching(true);
    setSwitchFailed(false);
    try {
      const r = await seam.setActive(persona);
      setState(r.state);
      if (!r.sent) setSwitchFailed(true);
      setDown(false);
    } catch {
      setSwitchFailed(true);
    } finally {
      setSwitching(false);
    }
  }, [seam, persona, switching]);

  if (seam == null) {
    return (
      <div className={`${styles.sceneLaunch} ${className ?? ''}`} data-state="unavailable" data-testid="scene-launch">
        <Button variant="secondary" disabled title="Мост сцены не подключён к этому источнику (unreal_scene_state / unreal_scene_open)">
          Открыть 3D-сцену
        </Button>
        <span className={styles.sceneStatus} data-testid="scene-launch-status">Мост сцены недоступен</span>
      </div>
    );
  }

  const status: UnrealSceneStatus = down || state == null ? 'unknown' : state.status;
  const canOpen = !down && (state?.status === 'disconnected' || state?.status === 'error');
  const demo = state?.source === 'mock';
  const hint = down
    ? 'Мост сцены не ответил на запрос состояния'
    : [state?.reason, demo ? 'источник DEMO' : null].filter(Boolean).join(' · ') || undefined;
  const personaActive =
    persona != null && state?.activeAssistant === persona;
  const canSwitch =
    persona != null &&
    !personaActive &&
    !down &&
    status === 'connected' &&
    seam?.setActive != null;

  return (
    <div className={`${styles.sceneLaunch} ${className ?? ''}`} data-state={down ? 'error' : status} data-testid="scene-launch">
      <Button
        variant="secondary"
        onClick={() => void open()}
        loading={opening}
        disabled={!canOpen}
        title={canOpen ? 'Открыть окно 3D-сцены' : hint ?? 'Запуск недоступен в текущем состоянии'}
      >
        Открыть 3D-сцену
      </Button>
      {canSwitch && (
        <Button
          variant="ghost"
          onClick={() => void setActive()}
          loading={switching}
          title={`Сменить активного ассистента сцены на ${persona} без перезапуска`}
          data-testid="scene-set-active"
        >
          Сделать активной в сцене
        </Button>
      )}
      <span className={styles.sceneStatus} data-testid="scene-launch-status">
        {down ? 'Мост сцены не ответил' : STATUS_LABEL[status]}
        {personaActive ? ' · активна' : ''}
        {demo ? ' · DEMO' : ''}
      </span>
      {switchFailed && (
        <span className={styles.sceneReason} data-testid="scene-set-active-fail">
          Команда переключения не дошла — сцена осталась на прежнем ассистенте
        </span>
      )}
      {!down && state?.reason != null && (
        <span className={styles.sceneReason} title={state.reason}>{state.reason}</span>
      )}
    </div>
  );
}
