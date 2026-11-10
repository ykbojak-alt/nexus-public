import type { AliceHomeActivityPanelProps, AliceHomeComposerProps, AliceHomeSystemStatusProps } from '../index';

/** Static view-only fixture; callbacks intentionally have no side effects. */
export const aliceComposerFixture = {
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
} satisfies AliceHomeComposerProps;

export const aliceSystemStatusFixture = {
  title: 'Состояние системы',
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
} satisfies AliceHomeSystemStatusProps;

export const aliceActivityFixture = {
  state: 'ready',
  data: [18, 26, 22, 38, 32, 47, 42, 64, 57, 70],
  series: [
    { id: 'cpu', label: 'CPU', data: [18, 26, 22, 38, 32, 47, 42, 64, 57, 70] },
    { id: 'ram', label: 'Память', data: [42, 40, 45, 47, 44, 51, 49, 55, 52, 51] },
    { id: 'disk', label: 'Диск', data: [70, 71, 68, 74, 76, 73, 79, 77, 81, 78] },
  ],
  label: 'Локальная серия активности',
} satisfies AliceHomeActivityPanelProps;
