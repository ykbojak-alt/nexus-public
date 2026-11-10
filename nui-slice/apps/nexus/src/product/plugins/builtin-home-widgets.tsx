/**
 * Первый встроенный плагин NEU: блоки /home как записи keyed-слота
 * `home.widgets` (спека п.2.2). JSX перенесён verbatim — вид не меняется;
 * отключение бандла/строки снимает блок без перезагрузки.
 */
'use client';

import Link from 'next/link';
import type { MutableRefObject } from 'react';
import { GlassPanel } from '@nexus/ui';
import type { AgentSpec, MemoryItem, RunSummary } from '@nexus/mock-data';
import type { PresenceEntry } from '@nexus/patterns';
import { SceneLaunchButton } from '../screens/scene-launch';
import type { NeuPluginDef } from './plugin-host';
import styles from '../screens/home.module.css';

type AsyncState<T> = { state: 'loading' } | { state: 'error' } | { state: 'ready'; value: T };

export interface OrchestrationProps {
  presence: AsyncState<PresenceEntry[]>;
  specs: AsyncState<AgentSpec[]>;
}

export function OrchestrationWidget({ presence, specs }: OrchestrationProps) {
  return (
    <GlassPanel className={styles.infoPanel} data-state={presence.state} data-testid="home-orchestration">
      <div className={styles.panelHead}><h2>Оркестрация агентов</h2><Link href="/agents">Все агенты ↗</Link></div>
      {presence.state === 'ready' ? (
        presence.value.length > 0 ? (
          <ul className={styles.steps}>
            {presence.value.slice(0, 5).map((p, i) => (
              <li key={`${p.agent}-${i}`} data-current={p.state === 'running' || p.state === 'blocked' ? 'true' : undefined}>
                <i />
                {p.agent} · {p.state}
                {p.task !== '' && <small className={styles.railNote}>{p.task}</small>}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.railNote}>Активных процессов нет.</p>
        )
      ) : presence.state === 'error' ? (
        <p className={styles.railNote}>Нет данных — процессы недоступны.</p>
      ) : (
        <p className={styles.railNote}>Читаю процессы…</p>
      )}
      {specs.state === 'ready' && (
        <p className={styles.railNote}>В реестре: {specs.value.length} {specs.value.length === 1 ? 'спек' : specs.value.length < 5 ? 'спека' : 'спеков'} агентов.</p>
      )}
    </GlassPanel>
  );
}

export function WorkflowWidget() {
  return (
    <GlassPanel className={styles.infoPanel}>
      <div className={styles.panelHead}><h2>Ход работы</h2><Link href="/runtime">Открыть рантайм ↗</Link></div>
      <ol className={styles.steps}><li data-current="true"><i /> Опишите задачу</li><li><i /> Проверьте план и доступы</li><li><i /> Следите за ходом выполнения</li><li><i /> Получите результат</li></ol>
    </GlassPanel>
  );
}

export interface RecentRunsProps {
  recentRuns: AsyncState<RunSummary[]>;
}

/** Реестр последних прогонов на /home. «Последние окна» шины уже принадлежат
 *  Runtime bus и доступны через встроенную вкладку rightbar.tabs/windows. */
export function RecentRunsWidget({ recentRuns }: RecentRunsProps) {
  return (
    <GlassPanel className={styles.railPanel} data-state={recentRuns.state}>
      <h2>Задачи и план</h2>
      {recentRuns.state === 'ready' ? (
        recentRuns.value.length > 0 ? (
          <ul className={styles.activity}>
            {recentRuns.value.slice(0, 3).map((r) => (
              <li key={r.runId}><i />{r.taskText.length > 70 ? `${r.taskText.slice(0, 70)}…` : r.taskText}<small>{r.status}</small></li>
            ))}
          </ul>
        ) : (
          <p className={styles.railStatus}>Прогонов пока нет.</p>
        )
      ) : recentRuns.state === 'error' ? (
        <p className={styles.railStatus}>Нет данных — прогоны недоступны.</p>
      ) : (
        <p className={styles.railStatus}>Читаю прогоны…</p>
      )}
    </GlassPanel>
  );
}

export interface ListenProps {
  micState: 'idle' | 'recording' | 'transcribing';
  listenReason: string | null;
  voiceError: string | null;
  waveCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  onToggle: () => void;
}

export function ListenWidget({ micState, listenReason, voiceError, waveCanvasRef, onToggle }: ListenProps) {
  return (
    <GlassPanel className={styles.listenPanel} data-testid="listen-card" data-state={micState === 'recording' ? 'recording' : micState === 'transcribing' ? 'busy' : listenReason != null ? 'unavailable' : 'ready'}>
      <button
        type="button"
        className={styles.listenBtn}
        aria-label={micState === 'recording' ? 'Остановить запись' : 'Слушать голосом'}
        aria-pressed={micState === 'recording'}
        disabled={micState !== 'recording' && (listenReason != null || micState === 'transcribing')}
        title={listenReason ?? undefined}
        onClick={onToggle}
      >
        <span aria-hidden="true">{micState === 'recording' ? '■' : '◉'}</span>
      </button>
      <div className={styles.listenBody}>
        {micState === 'recording' ? (
          <canvas ref={waveCanvasRef} className={styles.wave} aria-label="Запись голоса" />
        ) : (
          <p className={styles.listenLabel}>
            {micState === 'transcribing' ? 'Распознаю…' : listenReason != null ? `Голос недоступен — ${listenReason}` : 'Слушаю — скажите задачу голосом'}
          </p>
        )}
        {voiceError != null && <p className={styles.error} role="alert">{voiceError}</p>}
      </div>
    </GlassPanel>
  );
}

export function SceneWidget() {
  return (
    <GlassPanel className={styles.railPanel}>
      <h2>3D-сцена</h2>
      <SceneLaunchButton persona="alice" />
    </GlassPanel>
  );
}

/** Манифест + активация: пять строк contributes → keyed-записи
 *  `home.widgets`. Компоненты — самостоятельные, пропсы передаёт экран. */
export const HOME_WIDGETS_PLUGIN: NeuPluginDef = {
  manifest: {
    id: 'nexus.home-widgets',
    version: '1.0.0',
    title: 'Блоки домашнего экрана',
    description: 'Оркестрация агентов, Ход работы, Задачи и план, Слушаю, Запуск сцены.',
    icon: '⌂',
    builtin: true,
    permissions: ['чтение сессий'],
  },
  rows: [
    { rowId: 'orchestration', slot: 'home.widgets', key: 'orchestration', title: 'Оркестрация агентов', order: 10 },
    { rowId: 'workflow', slot: 'home.widgets', key: 'workflow', title: 'Ход работы', order: 20 },
    { rowId: 'recent', slot: 'home.widgets', key: 'recent', title: 'Задачи и план', order: 30 },
    { rowId: 'listen', slot: 'home.widgets', key: 'listen', title: 'Слушаю', order: 40 },
    { rowId: 'scene', slot: 'home.widgets', key: 'scene', title: 'Запуск сцены', order: 50 },
  ],
  activate(ctx) {
    ctx.contribute('orchestration', OrchestrationWidget);
    ctx.contribute('workflow', WorkflowWidget);
    ctx.contribute('recent', RecentRunsWidget);
    ctx.contribute('listen', ListenWidget);
    ctx.contribute('scene', SceneWidget);
  },
};
