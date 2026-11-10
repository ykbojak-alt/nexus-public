// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DiagDrawer, DIAG_TOGGLE_EVENT } from './newf-diag-drawer';
import type { CoreDiag, NewfBridge } from './newf-live';

afterEach(cleanup);

const DIAG: CoreDiag = {
  ts: 1000,
  version: 'N3',
  uptime_s: 3600,
  health: { pump_alive: true, drain_alive: false },
  stats: { sent: 5, failed: 1, dead: 0, pending: 2 },
  terminals: { live: 3, total: 4, exited: 1, states: { working: 2, idle: 1 } },
  spaces: 2,
  alerts: { rules: 3, history_count: 7 },
  config: { pump_interval_s: 1, rate_limit: 100, scrollback_maxlen: 2000 },
  events_total: 10,
};

function bridge(): NewfBridge {
  return {
    spaces: async () => [],
    terminals: async () => [],
    agents: async () => [],
    screen: async () => '',
    send: async () => {},
    keys: async () => {},
    diag: vi.fn(async () => DIAG),
  };
}

describe('DiagDrawer (W34)', () => {
  it('открытие по CustomEvent (кнопка HealthPanel) + контент-секции', async () => {
    render(<DiagDrawer bridge={bridge()} pollMs={50} />);
    expect(screen.queryByTestId('diag-drawer')).not.toBeInTheDocument();

    window.dispatchEvent(new CustomEvent(DIAG_TOGGLE_EVENT));
    await screen.findByTestId('diag-drawer');

    await waitFor(() => expect(screen.getByTestId('diag-pump')).toHaveTextContent(/pump alive/));
    expect(screen.getByTestId('diag-drain')).toHaveTextContent(/drain dead/);
    expect(screen.getByTestId('diag-stats')).toHaveTextContent(/sent 5/);
    expect(screen.getByTestId('diag-terminals')).toHaveTextContent(/3 live/);
    expect(screen.getByTestId('diag-alerts')).toHaveTextContent(/rules 3/);
    expect(screen.getByTestId('diag-config')).toHaveTextContent('pump_interval_s');
    expect(screen.getByTestId('diag-config')).toHaveTextContent('scrollback_maxlen');
  });

  it('открытие по клавише d; × закрывает', async () => {
    render(<DiagDrawer bridge={bridge()} pollMs={50} />);
    fireEvent.keyDown(window, { key: 'd' });
    await screen.findByTestId('diag-drawer');

    fireEvent.click(screen.getByTestId('diag-close'));
    await waitFor(() => expect(screen.queryByTestId('diag-drawer')).not.toBeInTheDocument());
  });

  it('клавиша d не срабатывает в input', async () => {
    render(<DiagDrawer bridge={bridge()} pollMs={50} />);
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'd' });
    expect(screen.queryByTestId('diag-drawer')).not.toBeInTheDocument();
    document.body.removeChild(input);
  });

  it('diag недоступен → честный offline-маркер', async () => {
    const b = bridge();
    delete b.diag;
    render(<DiagDrawer bridge={b} pollMs={50} />);
    window.dispatchEvent(new CustomEvent(DIAG_TOGGLE_EVENT));
    await screen.findByTestId('diag-drawer');
    await waitFor(() => expect(screen.getByText('diag unavailable')).toBeInTheDocument());
  });

  it('ошибочный diag → offline, last snapshot остаётся', async () => {
    const b = bridge();
    b.diag = vi.fn()
      .mockResolvedValueOnce(DIAG)
      .mockRejectedValue(new Error('boom'));
    render(<DiagDrawer bridge={b} pollMs={50} />);
    window.dispatchEvent(new CustomEvent(DIAG_TOGGLE_EVENT));
    await waitFor(() => expect(screen.getByTestId('diag-drawer')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('diag unavailable · showing last snapshot')).toBeInTheDocument());
    expect(screen.getByTestId('diag-pump')).toHaveTextContent(/pump alive/);
  });
});
