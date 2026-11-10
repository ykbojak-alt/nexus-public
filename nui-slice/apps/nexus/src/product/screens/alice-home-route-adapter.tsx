'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AliceHomeTemplate,
  type AliceHomeCapability,
  type AliceHomeDataState,
} from '@nexus/templates';
import { DeckAgentsStrip } from './deck-agents-strip';
import { HomeScreen, type HomeScreenAliceRouteModel } from './home';
import styles from './alice-home-route-adapter.module.css';

const ACTION_IDS = ['research', 'analyze', 'plan', 'create', 'automate', 'observe'] as const;

const HERO_DESCRIPTION =
  'Ваш интеллектуальный рантайм.\nAGENT-A готова помочь с вашими задачами.\nДумать глубже. Видеть дальше. Создать новое.';

// Локальная настройка UI: режим композитора не входит в RunIn и не
// отправляется хосту (см. startTask — agent выбирается рантаймом).
const COMPOSER_MODES = [
  { id: 'agent', label: 'Агент' },
  { id: 'ask', label: 'Спросить' },
  { id: 'plan', label: 'План' },
] as const;

function toTodayStatus(status: string): 'executing' | 'success' | 'warning' | 'error' {
  if (status === 'running') return 'executing';
  if (status === 'done') return 'success';
  if (status === 'cancelled') return 'warning';
  return 'error';
}

function todayDataState(state: HomeScreenAliceRouteModel['recentRuns']['state'], hasToday: boolean): AliceHomeDataState {
  if (state === 'loading') return 'loading';
  if (state === 'error') return 'error';
  return hasToday ? 'ready' : 'empty';
}

function AliceHomeView({ model }: { model: HomeScreenAliceRouteModel }) {
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);
  const [mode, setMode] = useState<string>('agent');
  const [statusHidden, setStatusHidden] = useState(false);
  useEffect(() => setNow(Date.now()), []);

  const todayRange = now == null ? null : (() => {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return {
      start: Math.floor(today.getTime() / 1000),
      end: Math.floor(tomorrow.getTime() / 1000),
    };
  })();
  const todaysRuns = model.recentRuns.state === 'ready' && todayRange != null
    ? model.recentRuns.value.filter((run) => run.createdAt >= todayRange.start && run.createdAt < todayRange.end).slice(0, 5)
    : [];

  const capabilities: AliceHomeCapability[] = model.actions.map((action, index) => ({
    id: ACTION_IDS[index],
    label: action.label,
    state: model.busy ? 'disabled' : index === 0 ? 'active' : 'default',
  }));

  const metricsState: AliceHomeDataState = model.metrics.state;
  const health = model.metrics.state === 'ready' && Array.isArray(model.metrics.value.health)
    ? model.metrics.value.health
    : [];
  const hasHealthEvidence = health.length > 0;
  const core = model.metrics.state !== 'ready'
    ? 'offline'
    : !hasHealthEvidence
      ? 'attention'
      : health.some((item) => item.status === 'error')
        ? 'degraded'
        : health.some((item) => item.status === 'warn')
          ? 'attention'
          : model.runningCount != null && model.runningCount > 0
            ? 'thinking'
            : 'healthy';
  const statusLabel = model.metrics.state !== 'ready'
    ? undefined
    : !hasHealthEvidence
      ? 'Статус недоступен'
      : health.some((item) => item.status === 'error')
        ? 'Требует внимания'
        : health.some((item) => item.status === 'warn')
          ? 'Есть замечания'
          : 'В норме';

  return (
    <div className={styles.route} data-theme="alice" data-screen="home" data-alice-route="home">
      <div className={styles.templateStage}>
        <AliceHomeTemplate
          /* Сцену несёт окно (app-shell: --nexus-frame-scene под всей
             рамкой), поэтому шаблон не рисует второй кадр той же
             картинки — стеклянные панели брали за подложку свой кроп
             (аннотация владельца 2026-10-29: «копия бэкграунда»). */
          workspaceLabel="Рабочая область AGENT-A"
          railLabel="Состояние рантайма и сегодняшние прогоны"
          hero={{
            eyebrow: 'ПЕРСОНАЛЬНЫЙ ИНТЕЛЛЕКТ',
            title: 'AGENT-A',
            description: HERO_DESCRIPTION,
          }}
          capabilities={capabilities}
          onCapabilitySelect={(capability) => {
            const index = ACTION_IDS.indexOf(capability.id as (typeof ACTION_IDS)[number]);
            const action = model.actions[index];
            if (action != null && typeof action.hint === 'string' && !model.busy) model.setTask(action.hint);
          }}
          composer={{
            agent: model.agentName,
            mode,
            modes: COMPOSER_MODES,
            onModeChange: setMode,
            value: model.task,
            onValueChange: model.setTask,
            onSubmit: model.startTask,
            // Handoff-контракт W5-126: тот же стабильный id, что и у прежней
            // главной, — e2e восстанавливает черновик именно по нему.
            inputId: 'alice-task',
            state: model.busy ? 'executing' : model.error != null ? 'error' : model.task.trim() ? 'typing' : 'idle',
            voice: {
              enabled: model.voice.enabled,
              active: model.voice.active,
              reason: model.voice.reason ?? undefined,
              onToggle: model.voice.onToggle,
            },
            attachment: {
              enabled: false,
              reason: 'Подключённый рантайм не принимает вложения',
            },
            tools: model.actions.map((action, index) => ({
              id: ACTION_IDS[index],
              label: action.label,
              onSelect: () => { if (!model.busy) model.setTask(action.hint); },
            })),
            submitLabel: 'Запустить задачу',
            placeholder: 'С чего начнём? Опишите задачу…',
            error: model.error,
          }}
          systemStatus={{
            hidden: statusHidden,
            state: metricsState,
            core,
            statusLabel,
            activeRuns: model.recentRuns.state === 'ready' ? model.runningCount : null,
            latencyMs: model.latencyMs,
            load: model.metrics.state === 'ready' && model.metrics.value.cpuPct != null
              ? model.metrics.value.cpuPct / 100
              : null,
            loadB: model.metrics.state === 'ready' && model.metrics.value.ramPct != null
              ? model.metrics.value.ramPct / 100
              : null,
            processes: model.metrics.state === 'ready' ? model.metrics.value.processesActive ?? null : null,
            meters: model.metrics.state === 'ready' ? [
              { id: 'cpu', label: 'CPU', value: model.metrics.value.cpuPct },
              { id: 'ram', label: 'Память', value: model.metrics.value.ramPct },
              { id: 'disk', label: 'Диск', value: model.metrics.value.diskPct },
            ] : [],
            onFactSelect: (fact) => router.push(fact === 'activeRuns' ? '/runs' : '/runtime'),
            onClose: () => setStatusHidden(true),
          }}
          activity={{
            state: model.cpuTrail.length >= 2 ? 'ready' : metricsState === 'loading' ? 'loading' : 'empty',
            data: model.cpuTrail,
            series: [
              { id: 'cpu', label: 'CPU', data: model.cpuTrail },
              { id: 'ram', label: 'Память', data: model.ramTrail },
              { id: 'disk', label: 'Диск', data: model.diskTrail },
            ],
            emptyBody: 'Наблюдений активности пока нет.',
          }}
          today={{
            state: now == null ? 'loading' : todayDataState(model.recentRuns.state, todaysRuns.length > 0),
            items: todaysRuns.map((run) => ({
              id: run.runId,
              title: run.taskText,
              timestamp: new Date(run.createdAt * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
              status: toTodayStatus(run.status),
            })),
            emptyTitle: 'Сегодня прогонов пока нет',
            emptyBody: 'Когда появятся реальные прогоны, они отобразятся здесь.',
            onRefresh: model.retryRuns,
            actionLabel: 'Повторить',
            onAction: model.retryRuns,
          }}
        />
        <DeckAgentsStrip />
      </div>
    </div>
  );
}

export function AliceHomeRouteAdapter() {
  return <HomeScreen renderAliceRoute={(model) => <AliceHomeView model={model} />} />;
}
