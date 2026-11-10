// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listSessions } = vi.hoisted(() => ({ listSessions: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/agents',
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('../data-source', () => ({
  getDataSource: () => ({ sdkSessions: { list: listSessions } }),
  useDataSource: () => ({ sdkSessions: { list: listSessions } }),
}));

import { RightDockToggle, useRightDock } from '../plugins/right-dock';
import { RightDockPanel } from '../plugins/right-dock-panel';
import { resetPluginHost } from '../plugins/plugin-host';
import '../plugins/builtin';

const SESSION = {
  id: 'sess-kept',
  window: 'sdk',
  kind: 'sdk',
  title: 'Сохранённая сессия',
  status: 'busy',
  lastActivityAt: 1_792_160_000_000,
  messageCount: 4,
  parent: null,
  archived: false,
};
const STORAGE_KEY = 'nexus.rightbar.v1';

let previousDockState: string | null = null;

function DockRig() {
  const dock = useRightDock();
  return (
    <>
      <RightDockToggle dock={dock} />
      <button
        type="button"
        onClick={() => {
          dock.openTab('sessions');
          dock.openTab('sessions');
        }}
      >
        Повторно открыть вкладку Сессии
      </button>
      {dock.state.mode !== 'hidden' && <RightDockPanel dock={dock} />}
    </>
  );
}

beforeEach(() => {
  previousDockState = sessionStorage.getItem(STORAGE_KEY);
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
    mode: 'hidden', open: [], active: null, split: null, width: null,
  }));
  listSessions.mockReset();
  listSessions.mockImplementation(() => Promise.resolve([SESSION]));
  resetPluginHost();
});

afterEach(() => {
  cleanup();
  resetPluginHost();
  if (previousDockState == null) sessionStorage.removeItem(STORAGE_KEY);
  else sessionStorage.setItem(STORAGE_KEY, previousDockState);
  listSessions.mockReset();
});

describe('right-panel tool window — duplicate open/close', () => {
  it('reopen is idempotent, close/reopen keeps the host session and renders one layer', async () => {
    const user = userEvent.setup();
    render(<DockRig />);

    await user.click(screen.getByTestId('right-dock-toggle'));
    let panel = await screen.findByTestId('right-dock');
    await within(panel).findByTestId('session-sess-kept');

    // Программный повторный openTab: fireEvent без pointerdown — иначе
    // outside-dismiss панели (pointerdown вне root) скрывает док и клик
    // превращается в hide→remount, а не в проверку идемпотентности.
    fireEvent.click(screen.getByRole('button', { name: 'Повторно открыть вкладку Сессии' }));
    expect(within(panel).getAllByRole('tab', { name: 'Сессии' })).toHaveLength(1);
    expect(within(panel).getAllByRole('tabpanel')).toHaveLength(1);
    expect(within(panel).getAllByTestId('agent-sessions')).toHaveLength(1);
    expect(within(panel).getAllByTestId('session-sess-kept')).toHaveLength(1);
    expect(within(panel).getAllByRole('button', { name: 'Закрыть вкладку «Сессии»' })).toHaveLength(1);

    await user.click(screen.getByTestId('right-dock-toggle'));
    expect(screen.queryByTestId('right-dock')).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}').open).toEqual(['sessions']);

    await user.click(screen.getByTestId('right-dock-toggle'));
    panel = await screen.findByTestId('right-dock');
    await within(panel).findByTestId('session-sess-kept');
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(2));
    expect(within(panel).getAllByRole('tab', { name: 'Сессии' })).toHaveLength(1);
    expect(within(panel).getAllByRole('tabpanel')).toHaveLength(1);
    expect(within(panel).getAllByTestId('session-sess-kept')).toHaveLength(1);
    expect(within(panel).getByText('Сохранённая сессия')).toBeTruthy();
    expect(listSessions.mock.calls).toHaveLength(2);
  });
});
