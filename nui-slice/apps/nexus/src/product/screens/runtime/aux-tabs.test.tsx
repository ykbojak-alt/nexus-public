// @vitest-environment jsdom
import './test-harness';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { listHandoffs, listPresence } from './test-harness';
import { AgentsTab } from './agents-tab';
import { PendingTab } from './pending-tab';
import { TeamTab } from './team-tab';

afterEach(cleanup);

describe('Runtime auxiliary tabs', () => {
  it('AgentsTab renders actual presence and handoff data', async () => {
    listPresence.mockResolvedValue([
      { agent: 'alpha', state: 'running', task: 'сборка', runId: 'run-1' },
    ]);
    listHandoffs.mockResolvedValue([
      { id: 'handoff-1', from: null, to: 'alpha', task: 'сборка', runId: 'run-1', status: 'running', ts: 1 },
    ]);
    render(<AgentsTab />);
    const tab = screen.getByTestId('tab-agents');
    await waitFor(() => expect(tab.textContent).toContain('alpha'));
    expect(tab.textContent).toContain('сборка');
    expect(tab.textContent).toContain('оператор');
  });

  it('AgentsTab distinguishes empty and failed seams', async () => {
    listPresence.mockResolvedValue([]);
    listHandoffs.mockResolvedValue([]);
    const { unmount } = render(<AgentsTab />);
    await waitFor(() => expect(screen.getByText('Нет активных агентов.')).toBeTruthy());
    unmount();

    listHandoffs.mockRejectedValueOnce(new Error('offline'));
    render(<AgentsTab />);
    await waitFor(() => expect(screen.getByText('Цепочка недоступна.')).toBeTruthy());
  });

  it('TeamTab is honest unavailable without the identity/RBAC seam', () => {
    render(<TeamTab />);
    expect(screen.getByTestId('tab-team').getAttribute('data-state')).toBe('unavailable');
    expect(screen.getByText(/identity\/RBAC-слоя/)).toBeTruthy();
  });

  it('PendingTab renders its empty/deferred feature state', () => {
    render(<PendingTab name="Новая вкладка" />);
    expect(screen.getByTestId('tab-pending').getAttribute('data-state')).toBe('empty');
    expect(screen.getByText('Новая вкладка')).toBeTruthy();
    expect(screen.getByText(/Вкладка в разработке/)).toBeTruthy();
  });
});
