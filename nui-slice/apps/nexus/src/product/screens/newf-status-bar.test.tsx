// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { StatusBar } from './newf-status-bar';
import type { NewfBridge } from './newf-live';

afterEach(cleanup);

function bridge(): NewfBridge {
  return {
    spaces: async () => [],
    terminals: async () => [],
    agents: async () => [],
    screen: async () => '',
    send: async () => {},
    keys: async () => {},
    machines: {
      list: vi.fn(async (): Promise<{ name: string; host: string; transport: string; state: string; since_ms: number; why: string | null; labels: Record<string, string> }[]> => [
        { name: 'machine-A', host: 'localhost', transport: 'local', state: 'connected', since_ms: 1, why: null, labels: {} },
      ]),
      get: async () => ({ found: false }),
      schema: async () => ({ name_pattern: '', host_pattern: '', transports: [], host_default_to_name: true, source: 'embedded' }),
    },
    terminalsSummary: vi.fn(async () => ({
      count: 3,
      terminals: [
        { name: 't1', space: 'local', state: 'working', lastLine: '', lastActivityTs: 1 },
        { name: 't2', space: 'local', state: 'blocked', lastLine: '', lastActivityTs: 2 },
        { name: 't3', space: 'local', state: 'idle', lastLine: '', lastActivityTs: 3 },
      ],
    })),
    worktrees: vi.fn(async () => [
      { main: true, name: 'nexus', path: 'D:/<repo>', branch: 'master' },
      { main: false, name: 'wt-a', path: 'D:/<repo>-wt-a', branch: 'refs/heads/feature/x' },
    ]),
  };
}

describe('StatusBar (W59)', () => {
  it('машина · branch · агенты · needs you · hint', async () => {
    render(<StatusBar bridge={bridge()} />);
    await waitFor(() => expect(screen.getByTestId('status-machine')).toHaveTextContent('machine-A'));
    expect(screen.getByTestId('status-branch')).toHaveTextContent('feature/x');
    expect(screen.getByTestId('status-agents')).toHaveTextContent('3 agents');
    expect(screen.getByTestId('status-needs')).toHaveTextContent('1 needs you');
    expect(screen.getByTestId('status-hint')).toHaveTextContent('Ctrl+P');
  });
});
