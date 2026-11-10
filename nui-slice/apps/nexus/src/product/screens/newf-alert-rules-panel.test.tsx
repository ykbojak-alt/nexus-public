// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AlertRulesPanel, countFirings } from './newf-alert-rules-panel';
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
    alertRules: vi.fn(async () => ({
      count: 1,
      rules: [
        { idx: 0, pattern: 'error', action: 'notify', disabled: false, runtime: true },
      ],
    })),
    alerts: vi.fn(async () => ({
      alerts: [
        { ts: 1000, term: 'local/t1', ruleIdx: 0, pattern: 'error', action: 'notify', line: 'boom' },
        { ts: 1001, term: 'local/t2', ruleIdx: 0, pattern: 'error', action: 'notify', line: 'boom2' },
        { ts: 1002, term: 'local/t3', ruleIdx: 5, pattern: 'x', action: 'notify', line: 'x' },
      ],
      count: 3,
      rules_loaded: 1,
    })),
  };
}

describe('countFirings (W37)', () => {
  it('считает срабатывания по rule_idx', () => {
    const h = [
      { ruleIdx: 0 }, { ruleIdx: 0 }, { ruleIdx: 5 },
    ];
    expect(countFirings(h, 0)).toBe(2);
    expect(countFirings(h, 5)).toBe(1);
    expect(countFirings(h, 9)).toBe(0);
  });
});

describe('AlertRulesPanel (W37)', () => {
  it('правила: enabled-чип, pattern, action+source, счётчик сработавших', async () => {
    render(<AlertRulesPanel bridge={bridge()} pollMs={50} />);

    await screen.findByTestId('alert-rule-0');
    expect(screen.getByTestId('alert-enabled-0')).toHaveTextContent('on');
    expect(screen.getByTestId('alert-pattern-0')).toHaveTextContent('error');
    expect(screen.getByTestId('alert-rule-0')).toHaveTextContent('notify');
    expect(screen.getByTestId('alert-rule-0')).toHaveTextContent('runtime');
    expect(screen.getByTestId('alert-rule-0')).toHaveTextContent('2 сработало');
  });

  it('toggle: disable → alertToggle(idx, false=true) и правило помечается off', async () => {
    const b = bridge();
    b.alertToggle = vi.fn(async (_idx, enabled) => ({ idx: 0, disabled: !enabled }));
    render(<AlertRulesPanel bridge={b} pollMs={50} />);

    await screen.findByTestId('alert-toggle-0');
    fireEvent.click(screen.getByTestId('alert-toggle-0'));
    await waitFor(() => expect(b.alertToggle).toHaveBeenCalledWith(0, false));
    await waitFor(() => expect(screen.getByTestId('alert-enabled-0')).toHaveTextContent('off'));
    expect(screen.getByTestId('alert-toggle-0').getAttribute('aria-pressed')).toBe('false');
  });

  it('toggle-ошибка → честная плашка', async () => {
    const b = bridge();
    b.alertToggle = vi.fn().mockRejectedValue(new Error('bridge 403: denied'));
    render(<AlertRulesPanel bridge={b} pollMs={50} />);

    await screen.findByTestId('alert-toggle-0');
    fireEvent.click(screen.getByTestId('alert-toggle-0'));
    await waitFor(() => expect(screen.getByTestId('alert-toggle-error')).toHaveTextContent(/403/));
    expect(screen.getByTestId('alert-enabled-0')).toHaveTextContent('on'); // без ложного переключения
  });

  it('нет alertRules → честный маркер', async () => {
    const b = bridge();
    delete b.alertRules;
    render(<AlertRulesPanel bridge={b} pollMs={50} />);
    expect(screen.getByText('alertRules отсутствует')).toBeInTheDocument();
  });
});
