// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EventsPanel } from './newf-events-panel';
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
    eventsSince: vi.fn(async (_since: number, _limit?: number) => ({
      events: [],
      cursor: 0,
      total_seen: 0,
    })),
  };
}

describe('EventsPanel (W33)', () => {
  it('feed: события рендерятся (тип + время + терминал), счётчик', async () => {
    const b = bridge();
    b.eventsSince = vi.fn(async (since: number) => ({
      events: since === 0
        ? [
            { seq: 1, type: 'status', ts: 1000, address: 'local/t1' },
            { seq: 2, type: 'send_queue', ts: 1001, address: 'local/t2' },
          ]
        : [],
      cursor: since === 0 ? 1001 : since,
      total_seen: 2,
    }));
    render(<EventsPanel bridge={b} pollMs={50} />);

    await screen.findByTestId('ev-row-0');
    expect(screen.getByTestId('ev-type-0')).toHaveTextContent('status');
    expect(screen.getByTestId('ev-time-0')).toHaveTextContent(/\d{2}:\d{2}:\d{2}/);
    expect(screen.getByTestId('ev-term-0')).toHaveTextContent('local/t1');
    expect(screen.getByTestId('ev-type-1')).toHaveTextContent('send_queue');
    await waitFor(() => expect(screen.getByTestId('ev-count')).toHaveTextContent('2'));
    expect(b.eventsSince).toHaveBeenCalledWith(0, 100);
  });

  it('pause: поллинг останавливается (новая партия не приходит)', async () => {
    const b = bridge();
    b.eventsSince = vi.fn(async (since: number) => ({
      events: since === 0 ? [{ seq: 1, type: 'status', ts: 1000, address: 'local/t1' }] : [],
      cursor: since === 0 ? 1000 : since,
      total_seen: 1,
    }));
    render(<EventsPanel bridge={b} pollMs={50} />);
    await screen.findByTestId('ev-row-0');

    const callsBefore = (b.eventsSince as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByTestId('ev-pause'));
    expect(screen.getByTestId('ev-pause')).toHaveAttribute('aria-pressed', 'true');
    await new Promise((r) => setTimeout(r, 120));
    expect((b.eventsSince as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
  });

  it('clear: трей очищается', async () => {
    const b = bridge();
    b.eventsSince = vi.fn(async (since: number) => ({
      events: since === 0 ? [{ seq: 1, type: 'status', ts: 1000, address: 'local/t1' }] : [],
      cursor: since === 0 ? 1000 : since,
      total_seen: 1,
    }));
    render(<EventsPanel bridge={b} pollMs={50} />);
    await screen.findByTestId('ev-row-0');
    fireEvent.click(screen.getByTestId('ev-clear'));
    await waitFor(() => expect(screen.queryByTestId('ev-row-0')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('ev-count')).toHaveTextContent('0'));
  });

  it('нет eventsSince → честный unavailable-маркер', async () => {
    const b = bridge();
    delete b.eventsSince;
    render(<EventsPanel bridge={b} pollMs={50} />);
    expect(screen.getByTestId('events-panel')).toBeInTheDocument();
    expect(screen.getByText('eventsSince отсутствует')).toBeInTheDocument();
  });
});
