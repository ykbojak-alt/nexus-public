import type {
  AliceHomeComposerProps,
  AliceHomeCoreState,
  AliceHomeDataState,
  AliceHomeTemplateProps,
} from '../index';

/** Deterministic local Storybook data only; no API, host, or secret inputs. */
export const aliceHomeFixture = {
  /** Только для историй: на /home шаблон свою картинку не рисует — единая
      заливка окна лежит под рамкой, и второй кроп того же кадра внутри main
      давал «копию бэкграунда». */
  environmentImageSrc: '/art/alice-home-extended.png',
  environmentImageAlt: '',
  workspaceLabel: 'Рабочая область AGENT-A',
  railLabel: 'Состояние рантайма и сегодняшние прогоны',
  hero: {
    eyebrow: 'ПЕРСОНАЛЬНЫЙ ИНТЕЛЛЕКТ',
    title: 'AGENT-A',
    description: 'Ваш интеллектуальный рантайм. AGENT-A готова помочь с вашими задачами.',
    statement: 'Думать глубже. Видеть дальше. Создавать новое.',
    signature: [
      { id: 'research', label: 'Исследовать' },
      { id: 'analyze', label: 'Анализировать' },
      { id: 'plan', label: 'Планировать' },
      { id: 'create', label: 'Создавать' },
      { id: 'automate', label: 'Автоматизировать' },
      { id: 'observe', label: 'Обозревать' },
    ],
  },
  capabilities: [
    { id: 'research', label: 'Исследование', state: 'active' as const },
    { id: 'analyze', label: 'Анализ' },
    { id: 'plan', label: 'План' },
    { id: 'create', label: 'Создание' },
    { id: 'automate', label: 'Автоматизация' },
    { id: 'observe', label: 'Обзор' },
  ],
  onCapabilitySelect: () => undefined,
  composer: {
    agent: 'AGENT-A',
    mode: 'agent',
    modes: [
      { id: 'agent', label: 'Агент' },
      { id: 'ask', label: 'Спросить' },
      { id: 'plan', label: 'План' },
    ],
    onModeChange: () => undefined,
    value: '',
    onValueChange: () => undefined,
    onSubmit: () => undefined,
    state: 'idle',
    voice: { enabled: true, label: 'Слушать ответ', onToggle: () => undefined },
    attachment: { enabled: false, reason: 'Вложения не подключены в Storybook fixture' },
    tools: [
      { id: 'memory', label: 'Память', onSelect: () => undefined },
      { id: 'files', label: 'Файлы', disabled: true, reason: 'Не подключено в Storybook fixture' },
    ],
  } satisfies AliceHomeComposerProps,
  systemStatus: {
    state: 'ready',
    core: 'healthy',
    statusLabel: 'Система в норме',
    activeRuns: 0,
    latencyMs: 147,
    processes: 2,
    meters: [
      { id: 'cpu', label: 'CPU', value: 64 },
      { id: 'memory', label: 'Память', value: 51 },
      { id: 'disk', label: 'Диск', value: 78 },
    ],
    onFactSelect: () => undefined,
    onClose: () => undefined,
  },
  activity: {
    state: 'ready',
    data: [18, 26, 22, 38, 32, 47, 42, 64, 57, 70],
    series: [
      { id: 'cpu', label: 'CPU', data: [18, 26, 22, 38, 32, 47, 42, 64, 57, 70] },
      { id: 'ram', label: 'Память', data: [42, 40, 45, 47, 44, 51, 49, 55, 52, 51] },
      { id: 'disk', label: 'Диск', data: [70, 71, 68, 74, 76, 73, 79, 77, 81, 78] },
    ],
    label: 'Локальная серия активности',
  },
  today: {
    state: 'ready',
    items: [
      { id: 'sample-1', title: 'Анализ рыночных данных', timestamp: '14:30', status: 'success' as const },
      { id: 'sample-2', title: 'Подготовка сценария', timestamp: '16:20', status: 'executing' as const },
      { id: 'sample-3', title: 'Оптимизация процессов', timestamp: '18:10', status: 'warning' as const },
    ],
  },
} satisfies AliceHomeTemplateProps;

export function aliceHomeState({
  core,
  composerState,
  systemState,
  statusLabel,
  activeRuns,
  latencyMs,
  meters,
  activity,
  todayState,
  todayItems,
}: {
  core?: AliceHomeCoreState;
  composerState?: AliceHomeComposerProps['state'];
  systemState?: AliceHomeDataState;
  statusLabel?: string;
  activeRuns?: number | null;
  latencyMs?: number | null;
  meters?: NonNullable<AliceHomeTemplateProps['systemStatus']>['meters'];
  activity?: readonly number[] | null;
  todayState?: AliceHomeDataState;
  todayItems?: NonNullable<AliceHomeTemplateProps['today']>['items'];
} = {}): AliceHomeTemplateProps {
  return {
    ...aliceHomeFixture,
    composer: {
      ...aliceHomeFixture.composer,
      ...(composerState == null ? {} : { state: composerState }),
    },
    systemStatus: {
      ...aliceHomeFixture.systemStatus,
      ...(core == null ? {} : { core }),
      ...(systemState == null ? {} : { state: systemState }),
      ...(statusLabel == null ? {} : { statusLabel }),
      ...(activeRuns === undefined ? {} : { activeRuns }),
      ...(latencyMs === undefined ? {} : { latencyMs }),
      ...(meters === undefined ? {} : { meters }),
    },
    activity: {
      ...aliceHomeFixture.activity,
      ...(activity === undefined ? {} : { data: activity, state: activity == null ? 'empty' : 'ready' }),
    },
    today: {
      ...aliceHomeFixture.today,
      ...(todayState == null ? {} : { state: todayState }),
      ...(todayItems === undefined ? {} : { items: todayItems }),
    },
  };
}
