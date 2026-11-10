// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const listRuns = vi.fn();
vi.mock('../data-source', () => ({
  getDataSource: () => ({ listRuns }),
  useDataSource: () => ({ listRuns }),
}));

import { DialogsScreen } from './dialogs';

afterEach(() => {
  cleanup();
  listRuns.mockReset();
});

const longTask = `Сверить миграцию ${'очень-длинная-задача-'.repeat(16)}`;
const longAgent = `agent-${'имя-'.repeat(16)}`;
const longReason = `error: ${'подробная-причина-'.repeat(18)}`;

describe('DialogsScreen — long history rows', () => {
  it.each(['nexus', 'alice'])('%s tone keeps full values available and keyboard disclosure usable', async (theme) => {
    listRuns.mockResolvedValue([{
      runId: `run-${'A'.repeat(90)}`,
      taskText: longTask,
      config: 'baseline',
      status: 'error',
      stopReason: longReason,
      agent: longAgent,
      parent: null,
      project: null,
      model: null,
      costUsd: null,
      createdAt: 1,
      finishedAt: 2,
    }]);
    const user = userEvent.setup();
    render(<div data-theme={theme}><DialogsScreen /></div>);

    const row = await screen.findByRole('listitem');
    const link = within(row).getByRole('link', { name: /Открыть прогон/ });
    expect(link.getAttribute('aria-label')).toContain(longTask);
    expect(link.getAttribute('aria-label')).toContain(longAgent);
    expect(link.getAttribute('aria-label')).toContain(longReason);

    const details = row.querySelector('details');
    const summary = within(row).getByText('Подробнее') as HTMLElement;
    expect(details).not.toBeNull();
    expect(summary.getAttribute('aria-label')).toMatch(/Подробнее о прогоне/);
    link.focus();
    expect(document.activeElement).toBe(link);
    await user.tab();
    expect(document.activeElement).toBe(summary);
    await user.click(summary);
    await waitFor(() => expect(details?.hasAttribute('open')).toBe(true));

    const expanded = within(details as HTMLElement);
    expect(expanded.getByText(longTask)).toBeTruthy();
    expect(expanded.getByText(longAgent)).toBeTruthy();
    expect(expanded.getByText(longReason)).toBeTruthy();
  });

  it('keeps honest error and empty states', async () => {
    listRuns.mockRejectedValueOnce(new Error('offline'));
    const first = render(<DialogsScreen />);
    expect(await screen.findByTestId('error-state')).toBeTruthy();
    first.unmount();

    listRuns.mockResolvedValueOnce([]);
    render(<DialogsScreen />);
    expect(await screen.findByTestId('empty-state')).toBeTruthy();
  });
});
