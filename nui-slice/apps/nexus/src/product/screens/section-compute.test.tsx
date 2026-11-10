// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bridgeState = vi.hoisted(() => ({
  desktop: false,
  bridge: null as Record<string, unknown> | null,
}));

vi.mock('../../integrations/ai2/desktop-bridge/adapter', () => ({
  hasDesktopBridge: () => bridgeState.desktop,
  getDesktopBridge: async () => bridgeState.bridge,
}));

const _ds = {
  getMetrics: async () => null,
  listPresence: async () => [],
  listRuns: async () => [],
  getUsage: async () => null,
};
vi.mock('../data-source', () => ({
  getDataSource: () => _ds,
  useDataSource: () => _ds,
}));

import { ComputeScreen } from './section-compute';

afterEach(cleanup);
beforeEach(() => {
  bridgeState.desktop = false;
  bridgeState.bridge = null;
});

describe('ComputeScreen — installed VS Code action', () => {
  it('browser mode is honest unavailable and never attempts a launch', async () => {
    render(<ComputeScreen />);
    const card = await screen.findByTestId('installed-tools-card');
    expect(card.getAttribute('data-state')).toBe('unavailable');
    expect(card.textContent).toContain('только в desktop host');
    expect(screen.queryByRole('button', { name: /Открыть|Проверить версию/ })).toBeNull();
  });

  it('desktop bridge without the installed-tools adapter remains unavailable', async () => {
    bridgeState.desktop = true;
    bridgeState.bridge = {
      available: true,
      listInstalledTools: async () => null,
      openInstalledTool: async () => null,
    };
    render(<ComputeScreen />);
    expect(await screen.findByText(/не предоставляет каталог installed-tools/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Открыть|Проверить версию/ })).toBeNull();
  });

  it('renders every host tool and launches the selected exact ID only on click', async () => {
    const listInstalledTools = vi.fn(async () => ({
      tools: [{
        id: 'vscode',
        name: 'Visual Studio Code',
        status: 'available' as const,
        reason: null,
        version: null,
        version_status: 'unavailable',
        version_reason: 'version_not_read',
      }, {
        id: 'git',
        name: 'Git version probe',
        status: 'available' as const,
        reason: null,
        version: null,
        version_status: 'not_checked',
        version_reason: null,
      }],
    }));
    const openInstalledTool = vi.fn(async (id: string) => ({
      id,
      status: id === 'git' ? 'completed' as const : 'launch_requested' as const,
      reason: null,
    }));
    bridgeState.desktop = true;
    bridgeState.bridge = { available: true, listInstalledTools, openInstalledTool };
    render(<ComputeScreen />);

    const card = await screen.findByTestId('installed-tools-card');
    expect(card.textContent).toContain('доступен');
    expect(card.textContent).toContain('Версия: нет данных');
    expect(card.textContent).toContain('Версия хостом не считывалась');
    expect(card.textContent).toContain('Git version probe');
    expect(listInstalledTools).toHaveBeenCalledTimes(1);
    expect(openInstalledTool).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Проверить версию Git' }));
    await waitFor(() => expect(openInstalledTool).toHaveBeenCalledTimes(1));
    expect(openInstalledTool).toHaveBeenCalledWith('git');
    expect(openInstalledTool.mock.calls[0]).toHaveLength(1);
    expect(await screen.findByTestId('installed-tools-card')).toHaveTextContent(
      'Ответ хоста: {"id":"git","status":"completed","reason":null}',
    );
  });

  it('shows host errors and keeps an unknown-ID response verbatim as an error', async () => {
    bridgeState.desktop = true;
    bridgeState.bridge = {
      available: true,
      listInstalledTools: async () => ({
        tools: [{
          id: 'vscode',
          name: 'Visual Studio Code',
          status: 'available',
          reason: null,
          version: null,
          version_status: 'unavailable',
          version_reason: 'version_not_read',
        }],
      }),
      openInstalledTool: vi.fn(async () => ({
        id: null,
        status: 'unavailable',
        reason: 'tool_not_allowlisted',
      })),
    };
    render(<ComputeScreen />);

    expect(await screen.findByTestId('installed-tools-card')).toHaveAttribute('data-state', 'ready');
    await userEvent.click(screen.getByRole('button', { name: 'Открыть Visual Studio Code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Хост отклонил инструмент: {"id":null,"status":"unavailable","reason":"tool_not_allowlisted"}',
    );
  });

  it('renders inventory request failures as an error, not unavailable', async () => {
    bridgeState.desktop = true;
    bridgeState.bridge = {
      available: true,
      listInstalledTools: async () => { throw new Error('host offline'); },
      openInstalledTool: async () => null,
    };
    render(<ComputeScreen />);
    expect(await screen.findByRole('alert')).toHaveTextContent('host offline');
  });

  it('unavailable host response disables the action and never invents a version', async () => {
    bridgeState.desktop = true;
    bridgeState.bridge = {
      available: true,
      listInstalledTools: async () => ({
        tools: [{
          id: 'vscode',
          name: 'Visual Studio Code',
          status: 'unavailable' as const,
          reason: 'executable_unavailable',
          version: null,
          version_status: 'unavailable',
          version_reason: 'version_not_read',
        }],
      }),
      openInstalledTool: vi.fn(),
    };
    render(<ComputeScreen />);
    const card = await screen.findByTestId('installed-tools-card');
    expect(card.textContent).toContain('Исполняемый файл VS Code недоступен.');
    expect(card.textContent).toContain('Версия: нет данных');
    expect((screen.getByRole('button', { name: 'Открыть Visual Studio Code' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders a real empty inventory as empty, not a fabricated tool row', async () => {
    bridgeState.desktop = true;
    bridgeState.bridge = {
      available: true,
      listInstalledTools: async () => ({ tools: [] }),
      openInstalledTool: vi.fn(),
    };
    render(<ComputeScreen />);
    const card = await screen.findByTestId('installed-tools-card');
    expect(card).toHaveAttribute('data-state', 'empty');
    expect(await screen.findByText('Хост вернул пустой список installed-tools.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Открыть|Проверить версию/ })).toBeNull();
  });

  it('shows loading while waiting for the host inventory response', async () => {
    let resolveInventory: ((value: { tools: Array<Record<string, unknown>> }) => void) | undefined;
    bridgeState.desktop = true;
    bridgeState.bridge = {
      available: true,
      listInstalledTools: () => new Promise((resolve) => { resolveInventory = resolve; }),
      openInstalledTool: async () => null,
    };
    render(<ComputeScreen />);
    const card = await screen.findByTestId('installed-tools-card');
    expect(card).toHaveAttribute('data-state', 'loading');
    expect(card.textContent).toContain('Читаю доступность из DesktopBridge');
    resolveInventory?.({
      tools: [{
        id: 'vscode',
        name: 'Visual Studio Code',
        status: 'available',
        reason: null,
      }],
    });
    expect(await screen.findByTestId('installed-tool-vscode')).toBeTruthy();
  });
});
