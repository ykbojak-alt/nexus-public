import type { Meta, StoryObj } from '@storybook/react-vite';
import { AliceHomeTemplate } from '../index';
import { aliceHomeFixture, aliceHomeState } from './fixtures';

const meta = {
  title: 'templates/alice-home/AliceHomeTemplate',
  component: AliceHomeTemplate,
  parameters: { layout: 'fullscreen' },
  args: aliceHomeFixture,
  decorators: [
    (Story) => (
      <div
        data-theme="alice"
        style={{
          width: 1920,
          height: 1080,
          margin: '0 auto',
          overflow: 'hidden',
          background: 'var(--nexus-surface-root)',
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AliceHomeTemplate>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { parameters: { visual: true } };
export const Loading: Story = {
  args: aliceHomeState({ systemState: 'loading', composerState: 'disabled', todayState: 'loading', todayItems: [] }),
};
export const Thinking: Story = {
  args: aliceHomeState({ core: 'thinking', composerState: 'queued', activeRuns: 1, statusLabel: 'Обрабатывает запрос' }),
};
export const Executing: Story = {
  args: {
    ...aliceHomeState({ core: 'thinking', composerState: 'executing', activeRuns: 1 }),
    composer: {
      ...aliceHomeFixture.composer,
      value: 'Подготовить обзор текущих задач',
      state: 'executing',
      submitLabel: 'Запускаю…',
    },
  },
};
export const Attention: Story = {
  args: aliceHomeState({ core: 'attention', statusLabel: 'Требует внимания', meters: [
    { id: 'cpu', label: 'CPU', value: 82 },
    { id: 'memory', label: 'Память', value: 71 },
    { id: 'disk', label: 'Диск', value: 78 },
  ] }),
};
export const Degraded: Story = {
  args: aliceHomeState({
    core: 'degraded',
    statusLabel: 'Часть метрик недоступна',
    meters: [
      { id: 'cpu', label: 'CPU', value: 64 },
      { id: 'memory', label: 'Память', value: null },
      { id: 'disk', label: 'Диск', value: null },
    ],
  }),
};
export const Offline: Story = {
  args: aliceHomeState({
    core: 'offline',
    composerState: 'disabled',
    statusLabel: 'Рантайм не в сети',
    activeRuns: null,
    latencyMs: null,
    meters: [
      { id: 'cpu', label: 'CPU', value: null },
      { id: 'memory', label: 'Память', value: null },
      { id: 'disk', label: 'Диск', value: null },
    ],
    todayState: 'empty',
    todayItems: [],
  }),
};

export const WithPortrait: Story = {
  parameters: { visual: true },
  args: {
    hero: {
      ...aliceHomeFixture.hero,
      portrait: { src: '/art/alice-portrait-ribbons.png', alt: '' },
    },
  },
};
