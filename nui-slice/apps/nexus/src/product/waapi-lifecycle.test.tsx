// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChessScreen } from './chess/screen';
import { DurakScreen } from './durak/screen';

// matchMedia/canvas/WAAPI stubs + RTL cleanup live in the shared harness
// (packages/ui/test/setup.ts) — do not re-register here. animate returns
// { cancel: vi.fn(), ... } — created handles are read back via mock.results.

type AnimHandle = { cancel: ReturnType<typeof vi.fn> };
const animateMock = () => Element.prototype.animate as unknown as ReturnType<typeof vi.fn>;
const createdAnims = (): AnimHandle[] =>
  animateMock()
    .mock.results.filter((r) => r.type === 'return')
    .map((r) => r.value as AnimHandle);

beforeEach(() => animateMock().mockClear());

describe('WAAPI lifecycle — handles отменяются на cleanup (W4-1004)', () => {
  it('durak: раздача создаёт анимации, unmount отменяет все', () => {
    const { unmount } = render(<DurakScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Начать партию' }));
    const anims = createdAnims();
    expect(anims.length).toBeGreaterThan(0);
    unmount();
    for (const a of anims) expect(a.cancel).toHaveBeenCalledTimes(1);
  });

  it('durak: перезапуск эффекта отменяет предыдущие анимации', () => {
    const { unmount } = render(<DurakScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Начать партию' }));
    const first = createdAnims();
    expect(first.length).toBeGreaterThan(0);
    unmount();
    // Cleanup предыдущего запуска отменил все in-flight анимации.
    for (const a of first) expect(a.cancel).toHaveBeenCalled();
  });

  it('chess: ход создаёт анимацию фигуры, unmount отменяет её', () => {
    const { unmount } = render(<ChessScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Начать партию' }));
    fireEvent.click(screen.getByRole('gridcell', { name: 'e2, белая пешка' }));
    fireEvent.click(screen.getByRole('gridcell', { name: 'e4' }));
    const anims = createdAnims();
    expect(anims.length).toBeGreaterThan(0);
    unmount();
    for (const a of anims) expect(a.cancel).toHaveBeenCalledTimes(1);
  });

  it('chess: смена state отменяет анимации предыдущего хода', () => {
    render(<ChessScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Начать партию' }));
    fireEvent.click(screen.getByRole('gridcell', { name: 'e2, белая пешка' }));
    fireEvent.click(screen.getByRole('gridcell', { name: 'e4' }));
    const first = createdAnims();
    expect(first.length).toBeGreaterThan(0);
    // Откат меняет state → cleanup эффекта гасит предыдущие handles до того,
    // как тело эффекта решает, анимируется ли новый ход.
    fireEvent.click(screen.getByRole('button', { name: 'Откат' }));
    for (const a of first) expect(a.cancel).toHaveBeenCalled();
  });
});
