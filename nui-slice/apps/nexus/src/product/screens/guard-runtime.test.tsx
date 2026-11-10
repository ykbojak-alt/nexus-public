// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsRequests = vi.fn();
const fsApprove = vi.fn();
const fsDeny = vi.fn();
let fsSeam: unknown = { requests: fsRequests, approve: fsApprove, deny: fsDeny };
vi.mock('../data-source', () => ({
  getDataSourceKind: () => 'mock',
  getDataSource: () => ({
    get fs() { return fsSeam; },
  }),
  useDataSource: () => ({ get fs() { return fsSeam; }, }),
}));

import { GuardRuntimeScreen } from './guard-runtime';

const ticket = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'tkt-1', runId: 'run1111abcd', root: 'repo', path: 'src/app.ts', op: 'write_file',
  size: 128, sha256: 'ab'.repeat(32), preview: 'export {}', status: 'pending',
  createdAt: 1700000000, resolvedAt: null,
  ...over,
});

beforeEach(() => {
  fsSeam = { requests: fsRequests, approve: fsApprove, deny: fsDeny };
  fsRequests.mockResolvedValue([ticket()]);
  fsApprove.mockResolvedValue(ticket({ status: 'approved' }));
  fsDeny.mockResolvedValue(ticket({ status: 'denied', resolvedAt: 1700000060 }));
});

afterEach(() => {
  cleanup();
  for (const fn of [fsRequests, fsApprove, fsDeny]) fn.mockReset();
});

describe('GuardRuntimeScreen — B.5 security-ops', () => {
  it('очередь: pending-тикет с op/path verbatim, approve вызывает seam', async () => {
    const user = userEvent.setup();
    render(<GuardRuntimeScreen />);
    const row = await screen.findByTestId('guard-ticket');
    expect(row.textContent).toContain('write_file');
    expect(row.textContent).toContain('repo:src/app.ts');
    await user.click(screen.getByRole('button', { name: 'Одобрить' }));
    await waitFor(() => expect(fsApprove).toHaveBeenCalledWith('tkt-1'));
    expect(fsRequests.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('инциденты: denied/expired тикеты со статусом verbatim', async () => {
    fsRequests.mockResolvedValue([
      ticket({ id: 'tkt-d', status: 'denied', resolvedAt: 1700000060 }),
      ticket({ id: 'tkt-e', status: 'expired', op: 'apply_patch' }),
    ]);
    render(<GuardRuntimeScreen />);
    const incidents = await screen.findAllByTestId('guard-incident');
    expect(incidents).toHaveLength(2);
    expect(screen.getByText('denied')).toBeTruthy();
    expect(screen.getByText('apply_patch')).toBeTruthy();
    expect(screen.getByText(/Нет ожидающих заявок/)).toBeTruthy();
  });

  it('fs-seam отсутствует → честный unavailable в обеих панелях', async () => {
    fsSeam = undefined;
    render(<GuardRuntimeScreen />);
    expect((await screen.findByTestId('guard-queue')).getAttribute('data-state')).toBe('unavailable');
    expect(screen.getByText(/fs-seam не подключён — очередь/)).toBeTruthy();
    expect(screen.getByText(/лента инцидентов недоступна/)).toBeTruthy();
  });

  it('ошибка seam → честный error; пустая история → пустые состояния', async () => {
    fsRequests.mockRejectedValue(new Error('down'));
    const { unmount } = render(<GuardRuntimeScreen />);
    expect(await screen.findByText(/Не удалось прочитать очередь/)).toBeTruthy();
    unmount();
    fsRequests.mockResolvedValue([]);
    render(<GuardRuntimeScreen />);
    expect(await screen.findByText(/Нет ожидающих заявок/)).toBeTruthy();
    expect(await screen.findByText(/Инцидентов нет/)).toBeTruthy();
  });

  it('NQ-098: скроллящаяся страница достижима клавиатурой (tabIndex)', async () => {
    render(<GuardRuntimeScreen />);
    await screen.findByTestId('guard-queue');
    const page = document.querySelector('[data-screen="guard-runtime"]')!;
    expect(page.getAttribute('tabindex')).toBe('0');
    (page as HTMLElement).focus();
    expect(document.activeElement).toBe(page);
  });
});
