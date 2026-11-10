// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { HealthPanel } from './newf-health-panel';
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
    capabilities: async () => ({ version: 'N3', endpoints: { screen: true, restart: true } }),
    audit: async (opts) => ({ entries: [], total: opts?.limit === 1 ? 42 : 0 }),
    streamEvents: () => () => {},
  };
}

describe('HealthPanel (W27)', () => {
  it('показывает core/audit ok, sse — no events (unknown)', async () => {
    render(<HealthPanel bridge={bridge()} />);
    await waitFor(() => expect(screen.getByTestId('health-core')).toHaveTextContent(/ok/));
    expect(screen.getByTestId('health-audit')).toHaveTextContent('(42)');
    expect(screen.getByTestId('health-core')).toHaveTextContent('2 endpoints');
  });

  it('офлайн (capabilities/audit нет) → honest offline/unknown', async () => {
    const b = bridge();
    delete b.capabilities;
    delete b.audit;
    render(<HealthPanel bridge={b} />);
    expect(screen.getByTestId('health-core')).toHaveTextContent('unknown');
    expect(screen.getByTestId('health-audit')).toHaveTextContent('unknown');
  });
});
