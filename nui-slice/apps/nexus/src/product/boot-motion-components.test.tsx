// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOT_HANDOFF_KEY, consumeBootHandoff, markBootHandoff } from '@nexus/motion';
import { BootEmblem, BootFigure, BootHandoff, BootProgress } from '@nexus/motion/boot-components';

describe('boot-components (волна XIV W4)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('BootEmblem/BootFigure — появление; animated=false статичен', () => {
    render(
      <>
        <BootEmblem data-testid="em"><h2>NEXUS</h2></BootEmblem>
        <BootFigure src="/art/agent-alice.webp" alt="Образ" data-testid="fig" />
      </>,
    );
    expect(screen.getByTestId('em').className).toContain('emblem');
    expect(screen.getByTestId('fig').className).toContain('figure');
    expect(screen.getByTestId('fig').getAttribute('decoding')).toBe('async');
  });

  it('animated={false} — конечный кадр без анимационных классов', () => {
    render(<BootFigure src="x" alt="" animated={false} data-testid="s" />);
    expect(screen.getByTestId('s').className).not.toContain('figure');
  });

  it('BootProgress: determinate — aria и ширина по реальной доле', () => {
    render(<BootProgress value={60} label="Загрузка среды" />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('60');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect((bar as HTMLElement).style.width).toBe('60%');
  });

  it('BootProgress: без доли — indeterminate, aria-атрибутов нет', () => {
    render(<BootProgress label="Загрузка среды" />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBeNull();
    expect(bar.getAttribute('aria-valuemin')).toBeNull();
  });

  it('BootHandoff: без флага — ничего не рендерит', () => {
    const { container } = render(<BootHandoff />);
    expect(container.firstChild).toBeNull();
  });

  it('BootHandoff: после markBootHandoff вейл играет и самоубирается', () => {
    vi.useFakeTimers();
    markBootHandoff();
    const settled = vi.fn();
    render(<BootHandoff onSettled={settled} />);
    expect(screen.queryByTestId('boot-handoff-veil')).toBeTruthy();
    // флаг одноразовый — второй mount без mark → пусто
    expect(consumeBootHandoff()).toBe(false);
    act(() => { vi.advanceTimersByTime(900); });
    expect(screen.queryByTestId('boot-handoff-veil')).toBeNull();
    expect(settled).toHaveBeenCalledOnce();
  });

  it('seam-флаг: mark → consume одноразово', () => {
    expect(consumeBootHandoff()).toBe(false);
    markBootHandoff();
    expect(sessionStorage.getItem(BOOT_HANDOFF_KEY)).toBe('1');
    expect(consumeBootHandoff()).toBe(true);
    expect(consumeBootHandoff()).toBe(false);
  });
});
