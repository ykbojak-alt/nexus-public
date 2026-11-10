import type { Meta, StoryObj } from '@storybook/react-vite';
import { SystemStatusPanel } from '../index';
import { aliceSystemStatusFixture } from './story-fixtures';

const meta = {
  title: 'templates/alice-home/SystemStatusPanel',
  component: SystemStatusPanel,
  args: aliceSystemStatusFixture,
  decorators: [
    (Story) => (
      <div
        data-theme="alice"
        style={{
          width: 356,
          minHeight: 720,
          margin: '0 auto',
          padding: 24,
          boxSizing: 'border-box',
          background: 'var(--nexus-surface-root)',
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SystemStatusPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Healthy: Story = { args: { core: 'healthy', statusLabel: 'Система в норме' }, parameters: { visual: true } };
export const Attention: Story = { args: { core: 'attention', statusLabel: 'Требует внимания', activeRuns: 1 } };
export const Thinking: Story = { args: { core: 'thinking', statusLabel: 'Обрабатывает запрос', activeRuns: 1 } };
export const Critical: Story = {
  args: {
    core: 'critical',
    statusLabel: 'Критическое состояние',
    activeRuns: null,
    latencyMs: null,
    meters: [
      { id: 'cpu', label: 'CPU', value: 96 },
      { id: 'memory', label: 'Память', value: null },
    ],
  },
};
export const Offline: Story = {
  args: {
    core: 'offline',
    statusLabel: 'Рантайм не в сети',
    activeRuns: null,
    latencyMs: null,
    meters: [
      { id: 'cpu', label: 'CPU', value: null },
      { id: 'memory', label: 'Память', value: null },
      { id: 'disk', label: 'Диск', value: null },
    ],
  },
};
