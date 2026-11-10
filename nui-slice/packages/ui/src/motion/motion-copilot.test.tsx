import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExpandRegion, NestedReveal, StreamingText, BusyDot, SendFlash, useSendConfirm } from './motion-copilot';
import { ParallaxLayer } from './parallax-layer';
import { useState } from 'react';

afterEach(() => vi.unstubAllGlobals());

describe('ExpandRegion — раскрытие ToolCallCard/SubagentCard', () => {
  it('держит контент в DOM и переключает data-open', () => {
    const { rerender } = render(<ExpandRegion open={false}>тело</ExpandRegion>);
    const region = screen.getByText('тело').parentElement!; // inner → expand root
    expect(region.getAttribute('data-open')).toBeNull();
    rerender(<ExpandRegion open>тело</ExpandRegion>);
    expect(screen.getByText('тело').parentElement!.getAttribute('data-open')).toBe('true');
  });

  it('animated=false → data-animated=false (probe-режим)', () => {
    render(<ExpandRegion open animated={false}>x</ExpandRegion>);
    expect(screen.getByText('x').parentElement!.getAttribute('data-animated')).toBe('false');
  });
});

describe('NestedReveal — появление вложенных вызовов', () => {
  it('закрыт → не рендерится; открыт → дети со стаггер-задержкой', () => {
    const { rerender } = render(<NestedReveal open={false} index={2}>дитя</NestedReveal>);
    expect(screen.queryByText('дитя')).toBeNull();
    rerender(<NestedReveal open index={2}>дитя</NestedReveal>);
    const el = screen.getByText('дитя');
    expect((el as HTMLElement).style.getPropertyValue('--enter-delay')).toBe('120ms');
  });
});

describe('StreamingText — стриминг вывода', () => {
  it('текст verbatim; каретка только при active', () => {
    const { container, rerender } = render(<StreamingText text="часть ответа" active={false} />);
    expect(container.textContent).toBe('часть ответа');
    expect(container.querySelector('[class*="streamCaret"]')).toBeNull();
    rerender(<StreamingText text="часть ответа" active />);
    expect(container.querySelector('[class*="streamCaret"]')).toBeTruthy();
  });
});

describe('BusyDot — пульс busy у SessionList', () => {
  it('data-busy отражает состояние, без текста (aria-hidden)', () => {
    const { container, rerender } = render(<BusyDot busy={false} />);
    const dot = container.firstElementChild!;
    expect(dot.getAttribute('data-busy')).toBeNull();
    rerender(<BusyDot busy />);
    expect(container.firstElementChild!.getAttribute('data-busy')).toBe('true');
  });
});

describe('SendFlash — подтверждение отправки DelegationChip', () => {
  it('перемонтирует вспышку при смене flashKey', () => {
    const { rerender, container } = render(<SendFlash flashKey="0">пилюля</SendFlash>);
    const first = container.firstElementChild!;
    rerender(<SendFlash flashKey="sent">пилюля</SendFlash>);
    expect(container.firstElementChild).not.toBe(first); // новый узел → анимация играет заново
  });

  it('useSendConfirm меняет ключ только на sent/answered', () => {
    function Chip() {
      const [state, setState] = useState('queued');
      const k = useSendConfirm(state);
      return <button data-k={String(k)} onClick={() => setState((s) => s === 'queued' ? 'sent' : 'sent')}>{state}</button>;
    }
    render(<Chip />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('data-k')).toBe('0');
    fireEvent.click(btn);
    expect(btn.getAttribute('data-k')).toContain('sent');
  });
});

describe('ParallaxLayer — reduced-motion', () => {
  it('does not install a pointer listener or schedule RAF when motion is reduced', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const raf = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', raf);
    const add = vi.spyOn(window, 'addEventListener');

    render(<ParallaxLayer>stable content</ParallaxLayer>);
    expect(raf).not.toHaveBeenCalled();
    expect(add.mock.calls.some(([type]) => type === 'pointermove')).toBe(false);
  });
});
