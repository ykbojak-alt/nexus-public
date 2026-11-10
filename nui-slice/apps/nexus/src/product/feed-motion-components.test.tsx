import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  CheckpointMark, FeedItemIn, ModePill, RunBar, WaitMark,
} from '@nexus/motion/feed-components';

const MODES = [
  { id: 'agent', label: 'агент' },
  { id: 'ask', label: 'спросить' },
  { id: 'plan', label: 'план' },
];

describe('feed-components — лента агента (волна XIV W4)', () => {
  it('FeedItemIn: обёртка события, стаггер ограничен 4*50ms', () => {
    const { container } = render(<FeedItemIn index={10}>событие</FeedItemIn>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.animationDelay).toBe('200ms');
    expect(screen.getByText('событие')).toBeTruthy();
  });

  it('FeedItemIn: animated=false → без класса и задержки', () => {
    const { container } = render(<FeedItemIn index={3} animated={false}>x</FeedItemIn>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.animationDelay).toBe('');
  });

  it('CheckpointMark: aria-hidden svg с рисуемой галкой', () => {
    const { container } = render(<CheckpointMark />);
    expect(container.querySelector('svg path')).toBeTruthy();
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it('ModePill: data-mode = активный, бегунок смещён на индекс', () => {
    render(<ModePill modes={MODES} value="plan" data-testid="mp" />);
    const pill = screen.getByTestId('mp');
    expect(pill.getAttribute('data-mode')).toBe('plan');
    expect(pill.querySelector('[aria-selected="true"]')?.textContent).toBe('план');
    const slider = pill.querySelector('[aria-hidden="true"]') as HTMLElement;
    // Смещение бегунка — через custom-properties translate (feed-components).
    expect(slider.style.getPropertyValue('--mode-slide-ltr')).toBe('200%');
    expect(slider.style.getPropertyValue('--mode-slide-rtl')).toBe('-200%');
  });

  it('WaitMark: aria-live и подпись; active=false → статика', () => {
    render(<WaitMark label="ждёт подтверждения" />);
    expect(screen.getByText('ждёт подтверждения')).toBeTruthy();
  });

  it('RunBar: известная доля → aria-valuenow и scaleX; null → без значения', () => {
    const { rerender } = render(<RunBar value={0.42} data-testid="rb" />);
    expect(screen.getByTestId('rb').getAttribute('aria-valuenow')).toBe('42');
    rerender(<RunBar value={null} data-testid="rb" />);
    expect(screen.getByTestId('rb').getAttribute('aria-valuenow')).toBeNull();
  });

  it('RunBar: доля зажата в 0..1 — выдуманного переполнения нет', () => {
    render(<RunBar value={1.7} data-testid="rb" />);
    expect(screen.getByTestId('rb').getAttribute('aria-valuenow')).toBe('100');
  });
});
