'use client';

/* Runtime — композиция вкладок. Секции вынесены в
 * screens/runtime/ (split wave-XVI): поведение, тексты и testid не менялись. */

import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useProfile } from '../profile/profile-store';
import { RuntimeKpiBand } from './runtime/kpi-band';
import { RuntimeSceneStateProvider } from './runtime/scene-state';
import { SceneStatusChip } from './runtime/scene-status-chip';
import { OverviewTab } from './runtime/overview-tab';
import { SceneTab } from './runtime/scene-tab';
import { PendingTab } from './runtime/pending-tab';
import { ProcessTab } from './runtime/process-tab';
import { TABS, TEAM_TAB, TAB_LABELS, parseTab } from './runtime/shared';
import type { RuntimeTab } from './runtime/shared';
import styles from './screens.module.css';

/**
 * Вкладок девять, а в первый экран попадают три — «Процесс» (дефолт), «Обзор»
 * (сводка) и «Сцена» (карточка 3D-сцены). Остальные грузятся по требованию:
 * иначе весь их код едет в маршрутный чанк /runtime (было 1004 KB при бюджете
 * 1000 KB). Паттерн тот же, что у палитры и карточки подтверждений в app-shell:
 * тяжёлое — по требованию, первая отрисовка не меняется.
 */
const TeamTabLazy = dynamic(() => import('./runtime/team-tab').then((m) => m.TeamTab));
const HistoryTabLazy = dynamic(() => import('./runtime/history-tab').then((m) => m.HistoryTab));
const ResultsTabLazy = dynamic(() => import('./runtime/results-tab').then((m) => m.ResultsTab));
const AgentsTabLazy = dynamic(() => import('./runtime/agents-tab').then((m) => m.AgentsTab));
const ResourcesTabLazy = dynamic(() => import('./runtime/resources-tab').then((m) => m.ResourcesTab));
const BusTabLazy = dynamic(() => import('./bus-tab').then((m) => m.BusTab));
const ScenarioTabLazy = dynamic(() => import('./scenario-tab').then((m) => m.ScenarioTab));

export function RuntimeScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const { profile } = useProfile();
  const level = profile?.uiLevel ?? 'professional';
  // Levels change navigation/detail depth only — same runs, IDs and
  // permissions everywhere (runtime-interface-levels-concept).
  const visibleTabs: readonly RuntimeTab[] =
    level === 'simple' ? ['process']
      : level === 'team' ? [...TABS, TEAM_TAB]
        : TABS;
  const tab = parseTab(params.get('tab'), visibleTabs, params.get('run') != null);
  // NQ-073: ?freeze=1 halts the event-stream simulator before first paint —
  // the visual gate needs consecutive frames that do not mutate. The run
  // panel still renders its attached state; only the stream stays closed.
  const freeze = params.get('freeze') === '1';
  // Состояние вкладок сохраняется: панель монтируется при первом открытии
  // и дальше лишь прячется (hidden) — локальный стейт вкладок не сгорает.
  const [visited, setVisited] = useState<ReadonlySet<RuntimeTab>>(() => new Set([tab]));
  useEffect(() => {
    setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab)));
  }, [tab]);
  const pane = (t: RuntimeTab, node: ReactNode) => (
    <div
      key={t}
      role="tabpanel"
      id={`runtime-panel-${t}`}
      aria-labelledby={`runtime-tab-${t}`}
      tabIndex={0}
      hidden={tab !== t}
    >
      {node}
    </div>
  );

  return (
    <RuntimeSceneStateProvider>
    <div className={styles.page} data-screen="runtime">
      <header className={styles.runtimeHeader}>
        <div>
          <p className={styles.runtimeEyebrow}>NEXUS · INTELLIGENCE</p>
          <h2 className={styles.runtimeTitle}>Runtime</h2>
          <p className={styles.runtimeIntro}>Рабочее пространство для запуска задач, контроля процесса и изучения результатов.</p>
        </div>
        <span className={styles.runtimeEnvironment}>DESKTOP WEB · 1920 × 1080</span>
        <SceneStatusChip />
      </header>
      <RuntimeKpiBand />
      {visibleTabs.length > 1 && (
        <div
          className={styles.tabBar}
          role="tablist"
          aria-label="Рантайм"
          onKeyDown={(e) => {
            const idx = visibleTabs.indexOf(tab);
            const next =
              e.key === 'ArrowRight' ? (idx + 1) % visibleTabs.length
                : e.key === 'ArrowLeft' ? (idx - 1 + visibleTabs.length) % visibleTabs.length
                  : e.key === 'Home' ? 0
                    : e.key === 'End' ? visibleTabs.length - 1
                      : -1;
            if (next >= 0) {
              e.preventDefault();
              router.push(`/runtime?tab=${visibleTabs[next]}`);
            }
          }}
        >
          {visibleTabs.map((t) => (
            <button
              key={t}
              id={`runtime-tab-${t}`}
              role="tab"
              aria-selected={tab === t}
              aria-controls={`runtime-panel-${t}`}
              tabIndex={tab === t ? 0 : -1}
              className={styles.tab}
              data-active={tab === t}
              onClick={() => router.push(`/runtime?tab=${t}`)}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
      )}
      {visited.has('overview') && pane('overview', <OverviewTab />)}
      {visited.has('process') && pane('process', <ProcessTab freeze={freeze} />)}
      {visited.has('history') && pane('history', <HistoryTabLazy />)}
      {visited.has('results') && pane('results', <ResultsTabLazy />)}
      {visited.has('agents') && pane('agents', <AgentsTabLazy />)}
      {visited.has('resources') && pane('resources', <ResourcesTabLazy />)}
      {visited.has('scene') && pane('scene', <SceneTab />)}
      {visited.has('bus') && pane('bus', <BusTabLazy />)}
      {visited.has('scenario') && pane('scenario', <ScenarioTabLazy />)}
      {visited.has('team') && pane('team', <TeamTabLazy />)}
      {!TABS.includes(tab as (typeof TABS)[number]) && tab !== 'team' && pane(tab, <PendingTab name={TAB_LABELS[tab]} />)}
    </div>
    </RuntimeSceneStateProvider>
  );
}
