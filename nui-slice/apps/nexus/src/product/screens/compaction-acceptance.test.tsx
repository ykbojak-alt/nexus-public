// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { CHAT_COMPACTION_THRESHOLD_MESSAGES, ChatCompactBlock, ChatCompactionUnavailable } from './agent-chat-feed';
import { ContextUsageIndicator } from './context-usage-indicator';

afterEach(cleanup);

describe('W5 compaction acceptance UI states', () => {
  it('shows normal and warning only from measured message counts', () => {
    const { rerender } = render(
      <ContextUsageIndicator used={8} total={32} />,
    );
    expect(screen.getByTestId('context-usage-indicator').getAttribute('data-state')).toBe('normal');

    rerender(<ContextUsageIndicator used={24} total={32} />);
    expect(screen.getByTestId('context-usage-indicator').getAttribute('data-state')).toBe('near');
    expect(screen.getByText('75%')).toBeTruthy();
  });

  it('shows compaction and unavailable as distinct honest states', () => {
    const { rerender } = render(
      <ContextUsageIndicator used={32} total={32} compacting />,
    );
    expect(screen.getByTestId('context-usage-indicator').getAttribute('data-state')).toBe('compacting');
    expect(screen.getByText('Сжимаю историю…')).toBeTruthy();

    rerender(<ContextUsageIndicator used={null} total={32} />);
    expect(screen.getByTestId('context-usage-indicator').getAttribute('data-state')).toBe('unavailable');
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('triggers unavailable action at threshold but not before when compact seam is absent', () => {
    const threshold = CHAT_COMPACTION_THRESHOLD_MESSAGES;
    const { rerender } = render(
      <ChatCompactionUnavailable messageCount={threshold - 1} compactChat={undefined} />,
    );
    expect(screen.queryByTestId('chat-compaction')).toBeNull();

    rerender(<ChatCompactionUnavailable messageCount={threshold} compactChat={undefined} />);
    expect(screen.getByTestId('chat-compaction').getAttribute('data-state')).toBe('unavailable');
    expect((screen.getByRole('button', { name: 'Сжать историю' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders the exact compact summary and every host-provided source ref', async () => {
    render(<ChatCompactBlock compact={{
      compacted: true,
      compactId: 'cmp-fixture',
      threadId: 'root',
      summary: 'Сжатый факт: maple-417. Ограничение: только локально.',
      coversMessageIds: ['root:task', 'root:answer', 'child:task'],
      keptMessageIds: ['child:answer'],
      createdAt: '2026-10-19T00:00:00Z',
    }} />);

    expect(screen.getByText('Сжатый факт: maple-417. Ограничение: только локально.')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Показать исходные · 3' }));
    expect(screen.getByRole('link', { name: 'root:task' }).getAttribute('href')).toBe('/run?id=root');
    expect(screen.getByRole('link', { name: 'root:answer' }).getAttribute('href')).toBe('/run?id=root');
    expect(screen.getByRole('link', { name: 'child:task' }).getAttribute('href')).toBe('/run?id=child');
  });
});
