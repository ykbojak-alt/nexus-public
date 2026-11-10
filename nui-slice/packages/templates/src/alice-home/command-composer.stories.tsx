import { useEffect, useRef } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CommandComposer, type AliceHomeComposerProps } from '../index';
import { aliceComposerFixture } from './story-fixtures';

function FocusedComposer(args: AliceHomeComposerProps) {
  const container = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    container.current?.querySelector('textarea')?.focus();
  }, []);
  return <div ref={container}><CommandComposer {...args} /></div>;
}

const meta = {
  title: 'templates/alice-home/CommandComposer',
  component: CommandComposer,
  args: aliceComposerFixture,
  decorators: [
    (Story) => (
      <div
        data-theme="alice"
        style={{
          width: 'min(100%, 960px)',
          minHeight: 280,
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
} satisfies Meta<typeof CommandComposer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = { args: { value: '', state: 'idle' }, parameters: { visual: true } };
export const Focused: Story = {
  args: { value: '', state: 'focused' },
  render: (args) => <FocusedComposer {...aliceComposerFixture} {...args} />,
};
export const Typing: Story = {
  args: { value: 'Собери обзор по текущему проекту', state: 'typing' },
};
export const Queued: Story = {
  args: { value: 'Составить план следующего этапа', state: 'queued', submitLabel: 'В очереди' },
};
export const Executing: Story = {
  args: { value: 'Подготовить сводку', state: 'executing', submitLabel: 'Задача выполняется' },
};
export const Error: Story = {
  args: {
    value: 'Сформировать отчёт',
    state: 'error',
    error: 'Локальное Storybook-состояние ошибки. Повторите попытку.',
  },
};
