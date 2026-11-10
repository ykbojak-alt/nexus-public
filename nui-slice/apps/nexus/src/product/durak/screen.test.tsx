// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DurakScreen } from './screen';

// matchMedia/canvas/WAAPI stubs + RTL cleanup live in the shared harness
// (packages/ui/test/setup.ts) — do not re-register here.

const start = () => {
  render(<DurakScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Начать партию' }));
};

describe('DurakScreen — контракт и состояние', () => {
  it('data-screen/data-state: empty на сетапе, ready в партии', () => {
    const { container } = render(<DurakScreen />);
    const root = container.firstElementChild!;
    expect(root.getAttribute('data-screen')).toBe('durak');
    expect(root.getAttribute('data-state')).toBe('empty');
    fireEvent.click(screen.getByRole('button', { name: 'Начать партию' }));
    expect(root.getAttribute('data-state')).toBe('ready');
  });

  it('выбор противника — toggle-кнопки с aria-pressed', () => {
    render(<DurakScreen />);
    const alice = screen.getByRole('button', { name: 'AGENT-A' });
    expect(alice.getAttribute('aria-pressed')).toBe('true'); // выбрана по умолчанию
    const codex = screen.getByRole('button', { name: 'ROLE-1' });
    expect(codex.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(codex);
    expect(codex.getAttribute('aria-pressed')).toBe('true');
  });

  it('фаза партии анонсируется в aria-live-регионе', () => {
    start();
    const live = document.querySelector('[aria-live="polite"]');
    expect(live).toBeTruthy();
    expect(live!.textContent).toMatch(/атака|защита|подкидывание|дурак|ничья/i);
  });

  it('seed партии показан — честная локальная сессия', () => {
    start();
    expect(screen.getByText(/seed \d+/)).toBeTruthy();
  });

  it('рука игрока: roving-tabindex и обзор стрелками (паттерн chess grid)', () => {
    start();
    const hand = screen.getByRole('group', { name: /Ваша рука/ });
    const cards = hand.querySelectorAll<HTMLElement>('[data-handidx]');
    expect(cards.length).toBeGreaterThan(0);
    // Roving: один tabIndex=0, остальные -1
    const tabStops = [...cards].filter((c) => c.tabIndex === 0);
    expect(tabStops).toHaveLength(1);
    expect(tabStops[0].getAttribute('data-handidx')).toBe('0');
    // Стрелка вправо переносит фокус и единственную tab-остановку
    fireEvent.keyDown(hand, { key: 'ArrowRight' });
    const moved = [...hand.querySelectorAll<HTMLElement>('[data-handidx]')];
    expect(moved[1].tabIndex).toBe(0);
    expect(moved[0].tabIndex).toBe(-1);
    expect(document.activeElement).toBe(moved[1]);
    // Край руки не уходит за границу; End — на последнюю карту
    fireEvent.keyDown(hand, { key: 'ArrowLeft' });
    fireEvent.keyDown(hand, { key: 'ArrowLeft' });
    expect(moved[0].tabIndex).toBe(0);
    fireEvent.keyDown(hand, { key: 'End' });
    expect(moved[moved.length - 1].tabIndex).toBe(0);
  });

  it('пикер стилей: 4 чипа по testid, переключение v1→v2→v3→v4, persist localStorage', () => {
    render(<DurakScreen />);

    expect(screen.getByTestId('deck-style-chip-v1')).toBeTruthy();
    expect(screen.getByTestId('deck-style-chip-v2')).toBeTruthy();
    expect(screen.getByTestId('deck-style-chip-v3')).toBeTruthy();
    expect(screen.getByTestId('deck-style-chip-v4')).toBeTruthy();

    expect(screen.getByTestId('deck-style-chip-v1').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByTestId('deck-style-chip-v2'));
    expect(screen.getByTestId('deck-style-chip-v2').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('deck-style-chip-v1').getAttribute('aria-pressed')).toBe('false');
    expect(window.localStorage.getItem('nexus.durak.deckStyle')).toBe('v2');

    fireEvent.click(screen.getByTestId('deck-style-chip-v3'));
    expect(window.localStorage.getItem('nexus.durak.deckStyle')).toBe('v3');

    fireEvent.click(screen.getByTestId('deck-style-chip-v4'));
    expect(window.localStorage.getItem('nexus.durak.deckStyle')).toBe('v4');
  });

  it('стиль колоды: неизвестное значение localStorage → фолбэк v1', () => {
    window.localStorage.setItem('nexus.durak.deckStyle', 'v99');
    render(<DurakScreen />);
    expect(screen.getByTestId('deck-style-chip-v1').getAttribute('aria-pressed')).toBe('true');
    expect(window.localStorage.getItem('nexus.durak.deckStyle')).toBe('v1');
  });

  it('NOIR v5: чип в пикере, выбор и persist; лица v5 идут из /durak/cards/ (PNG-канон)', () => {
    render(<DurakScreen />);
    expect(screen.getByTestId('deck-style-chip-v5')).toBeTruthy();
    fireEvent.click(screen.getByTestId('deck-style-chip-v5'));
    expect(screen.getByTestId('deck-style-chip-v5').getAttribute('aria-pressed')).toBe('true');
    expect(window.localStorage.getItem('nexus.durak.deckStyle')).toBe('v5');

    fireEvent.click(screen.getByRole('button', { name: 'Начать партию' }));
    // Рука в v5 ссылается на канонические PNG: 6h.png (6♥) и т.п.
    const hand = screen.getByRole('group', { name: /Ваша рука/ });
    const srcs = [...hand.querySelectorAll<HTMLImageElement>('img')].map((i) => i.getAttribute('src'));
    expect(srcs.some((s) => s!.includes('/durak/cards/'))).toBe(true);
    expect(srcs.some((s) => s!.match(/\/durak\/cards\/[a-j0-9][shdc]\.png$/))).toBe(true);
  });

  it('зона действий — под рукой игрока: .actions следует за .hand в DOM (ТЗ п.1)', () => {
    start();
    const hand = screen.getByRole('group', { name: /Ваша рука/ });
    const handArea = hand.closest('[class*="handArea"]')!;
    const actions = handArea.querySelector<HTMLElement>('[class*="actions"]');
    expect(actions).toBeTruthy();
    expect(
      hand.compareDocumentPosition(actions!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('рука игрока занимает всю нижнюю полосу: handArea и лог — разные ряды одной колонки (ТЗ п.2)', () => {
    start();
    const hand = screen.getByRole('group', { name: /Ваша рука/ });
    const handArea = hand.closest('[class*="handArea"]')!;
    const log = document.querySelector('[class*="log"]')!;
    // Рука и журнал — соседние ряды .bottomRow: лог идёт после руки,
    // а не колонкой рядом — руке достаётся вся ширина стола.
    const bottomRow = handArea.parentElement!;
    expect(log.parentElement).toBe(bottomRow);
    expect(
      handArea.compareDocumentPosition(log) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('руки соперников: отдельные стеки по игрокам с бейджами количества', () => {
    start();
    // Каждый соперник — свой контейнер руки [data-zone="opponent"]
    const hands = document.querySelectorAll<HTMLElement>('[data-zone="opponent"]');
    expect(hands.length).toBeGreaterThan(0);
    // У каждого стека есть бейдж с количеством карт (span с числом)
    hands.forEach((hand) => {
      const countBadge = hand.querySelector<HTMLElement>('span[class*="opponentCount"]');
      expect(countBadge).toBeTruthy();
      const cardBacks = hand.querySelectorAll<HTMLImageElement>('img');
      // Количество рубашек не превышает 10 (лимит отрисовки)
      expect(cardBacks.length).toBeLessThanOrEqual(10);
      expect(parseInt(countBadge!.textContent!, 10)).toBeGreaterThanOrEqual(cardBacks.length);
    });
    // Стеки не объединяются: каждый hand — отдельный DOM-узел со своим data-seat
    const seats = Array.from(hands).map((h) => h.getAttribute('data-seat')!);
    expect(new Set(seats).size).toBe(seats.length);
  });
});
