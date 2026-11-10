// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuditPanel, decisionTone } from './newf-audit-panel';
import type { NewfBridge } from './newf-live';

afterEach(cleanup);

const AUDIT_ENTRIES = {
  entries: [
    { seq: 3, ts: 1700000003, action: 'run', decision: 'allow', subject: 'v1', detail: 'ok', agent: 'forge', term: 't1' },
    { seq: 2, ts: 1700000002, action: 'kill', decision: 'deny', subject: 'v1', detail: 'rule N-7', agent: 'forge', term: 't1' },
    { seq: 1, ts: 1700000001, action: 'run', decision: 'vote', subject: 'v2', agent: 'alice', term: 't2' },
  ],
  total: 3,
};

function bridge(): NewfBridge {
  return {
    spaces: async () => [],
    terminals: async () => [],
    agents: async () => [],
    screen: async () => '',
    send: async () => {},
    keys: async () => {},
    audit: async (opts) => {
      const entries = opts?.action
        ? AUDIT_ENTRIES.entries.filter((e) => e.action === opts.action)
        : AUDIT_ENTRIES.entries;
      return { entries, total: entries.length };
    },
  };
}

describe('decisionTone (W54)', () => {
  it('нормализует к enum бэкенда', () => {
    expect(decisionTone('allow')).toBe('allow');
    expect(decisionTone('deny')).toBe('deny');
    expect(decisionTone('vote')).toBe('vote');
    expect(decisionTone('allowed')).toBe('allow');
    expect(decisionTone('denied')).toBe('deny');
    expect(decisionTone(undefined)).toBe('unknown');
  });
});

describe('AuditPanel (W54)', () => {
  it('decision enum + subject/detail отображаются', async () => {
    render(<AuditPanel bridge={bridge()} />);
    await screen.findByTestId('audit-row-3');
    expect(screen.getByTestId('audit-row-3')).toHaveTextContent('allow');
    expect(screen.getByTestId('audit-row-3')).toHaveTextContent('v1');
    expect(screen.getByTestId('audit-row-3')).toHaveTextContent('ok');
    expect(screen.getByTestId('audit-row-2')).toHaveTextContent('deny');
    expect(screen.getByTestId('audit-row-2')).toHaveTextContent('rule N-7');
  });

  it('verify-кнопка реально вызывает /audit/verify', async () => {
    const b = bridge();
    b.auditVerify = vi.fn(async () => ({ ok: true, verified: true, detail: null, brokenAt: null }));
    render(<AuditPanel bridge={b} />);
    await screen.findByTestId('audit-row-3');
    fireEvent.click(screen.getByTestId('audit-verify'));
    await waitFor(() => expect(b.auditVerify).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('audit-verify')).toHaveTextContent('✓ verified'));
  });

  it('офлайн audit (ошибка моста) → offline-плашку, а не «записей нет»', async () => {
    const b = bridge();
    b.audit = vi.fn().mockRejectedValue(new Error('bridge 503: unavailable'));
    render(<AuditPanel bridge={b} />);
    await waitFor(() => expect(screen.getByTestId('audit-offline')).toHaveTextContent(/503/));
    expect(screen.queryByText('audit: записей нет')).not.toBeInTheDocument();
  });

  it('фильтр по action обновляет список', async () => {
    render(<AuditPanel bridge={bridge()} />);
    await screen.findByTestId('audit-row-3');
    fireEvent.click(screen.getByRole('button', { name: 'kill' }));
    await waitFor(() => {
      expect(screen.queryByTestId('audit-row-3')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('audit-row-2')).toBeInTheDocument();
  });

  it('офлайн (audit undefined) → честная подпись', async () => {
    const b = bridge();
    delete b.audit;
    render(<AuditPanel bridge={b} />);
    expect(await screen.findByText(/audit: capability отсутствует/)).toBeInTheDocument();
  });
});
