// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChessScreen } from './screen';

// matchMedia/canvas/WAAPI stubs + RTL cleanup live in the shared harness
// (packages/ui/test/setup.ts) — do not re-register here.

const start = () => {
  render(<ChessScreen />);
  fireEvent.click(screen.getByRole('button', { name: 'Начать партию' }));
};

const cell = (name: string | RegExp) =>
  screen.getByRole('gridcell', { name }) as HTMLElement;

describe('ChessScreen — контракт и клавиатурная модель', () => {
  it('data-screen/data-state: empty на сетапе, ready в партии', () => {
    const { container } = render(<ChessScreen />);
    const root = container.firstElementChild!;
    expect(root.getAttribute('data-screen')).toBe('chess');
    expect(root.getAttribute('data-state')).toBe('empty');
    fireEvent.click(screen.getByRole('button', { name: 'Начать партию' }));
    expect(root.getAttribute('data-state')).toBe('ready');
    // Стартовая позиция — 32 svg-фигуры Staunton-набора на доске.
    expect(
      screen
        .getByRole('grid', { name: /Шахматная доска/ })
        .querySelectorAll('svg[data-c]'),
    ).toHaveLength(32);
  });

  it('roving tabindex: ровно один tab-стоп на доске, стрелки двигают фокус', () => {
    start();
    const tabbable = screen
      .getAllByRole('gridcell')
      .filter((el) => el.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);

    const board = screen.getByRole('grid', { name: /Шахматная доска/ });
    const startSq = tabbable[0] as HTMLElement; // e2
    startSq.focus();
    fireEvent.keyDown(board, { key: 'ArrowRight' });
    expect(document.activeElement?.getAttribute('data-sq')).toBe('53'); // f2
    fireEvent.keyDown(board, { key: 'ArrowUp' });
    expect(document.activeElement?.getAttribute('data-sq')).toBe('45'); // f3
    fireEvent.keyDown(board, { key: 'End' });
    expect(document.activeElement?.getAttribute('data-sq')).toBe('47'); // h3
  });

  it('клетки имеют говорящие имена: координата + цвет + фигура', () => {
    start();
    expect(cell('e2, белая пешка')).toBeTruthy();
    expect(cell('a8, чёрная ладья')).toBeTruthy();
    expect(cell('d4')).toBeTruthy(); // пустая клетка — только координата
  });

  it('Enter/клик на клетке выбирает фигуру, Escape снимает выбор', () => {
    start();
    const e2 = cell('e2, белая пешка');
    fireEvent.click(e2);
    expect(e2.getAttribute('aria-selected')).toBe('true');
    expect(cell('e3').getAttribute('data-target')).toBe('true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(e2.getAttribute('aria-selected')).toBeNull();
  });

  it('фокус следует за сходившей фигурой', () => {
    start();
    fireEvent.click(cell('e2, белая пешка'));
    fireEvent.click(cell('e4'));
    // После хода roving-точка и DOM-фокус — на клетке назначения.
    expect(cell(/e4/).getAttribute('tabindex')).toBe('0');
    expect(document.activeElement?.getAttribute('data-sq')).toBe('36'); // e4
  });
});
