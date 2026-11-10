// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { DeckTab } from './deck-tab';
import type { NewfBridge, TermSummary } from './newf-live';

afterEach(cleanup);

function bridge(overrides: Partial<NewfBridge> = {}): NewfBridge {
  return {
    spaces: async () => [],
    terminals: async () => [],
    agents: async () => [],
    screen: async () => '',
    send: async () => {},
    keys: async () => {},
    terminalsSummary: vi.fn(async () => ({ count: 0, terminals: [] as TermSummary[] })),
    ...overrides,
  };
}

describe('DeckTab (NUE-1, финал owner)', () => {
  it('шапка раздела + честная пометка модели Deck', () => {
    render(<DeckTab bridge={bridge()} />);
    const tab = screen.getByTestId('tab-deck');
    expect(tab.getAttribute('data-state')).toBe('ready');
    expect(screen.getByTestId('deck-header').textContent).toContain('Nexus Deck');
    expect(screen.getByTestId('deck-header').textContent).toContain('/api/core');
  });

  it('app-карточка из манифеста: NEXUS Deck, версия, честный маркер артефакта', () => {
    render(<DeckTab bridge={bridge()} />);
    const card = screen.getByTestId('deck-app-card');
    expect(card.textContent).toContain('NEXUS Deck');
    expect(card.textContent).toContain('0.0.1');
    expect(card.textContent).toContain('Артефакт ещё не опубликован');
    expect(card.textContent).toContain('СКАЧАТЬ');
  });

  it('мост жив (terminalsSummary отвечает) → статус «МОСТ ЖИВ»', async () => {
    render(<DeckTab bridge={bridge()} />);
    await waitFor(() => expect(screen.getByText('МОСТ ЖИВ')).toBeInTheDocument());
  });

  it('мост не ответил → честный offline-статус', async () => {
    render(<DeckTab bridge={bridge({
      terminalsSummary: vi.fn().mockRejectedValue(new Error('bridge 503: disabled')),
    })} />);
    await waitFor(() => expect(screen.getByText('ЯДРО НЕ ОТВЕТИЛО')).toBeInTheDocument());
  });

  it('без terminalsSummary (старое ядро) → offline честно', () => {
    const b = bridge();
    delete b.terminalsSummary;
    render(<DeckTab bridge={b} />);
    expect(screen.getByText('ЯДРО НЕ ОТВЕТИЛО')).toBeInTheDocument();
  });
});
