// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toast, ToastRegion, type ToastData } from './toast';

const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => media),
  });
});

afterEach(() => {
  vi.useRealTimers();
  media.matches = false;
  vi.clearAllMocks();
});

const toast = (id: string, over: Partial<ToastData> = {}): ToastData => ({
  id,
  message: `Событие ${id}`,
  ...over,
});

describe('Toast — notifyMotion lifecycle (W4-1010)', () => {
  it('dismiss: keep-alive data-exit+inert в окне notifyOut, затем onDismiss', () => {
    const onDismiss = vi.fn();
    render(<Toast toast={toast('a')} onDismiss={onDismiss} />);
    const el = screen.getByTestId('toast-a');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).not.toHaveBeenCalled();
    expect(el.getAttribute('data-exit')).toBe('true');
    expect(el.getAttribute('inert')).not.toBeNull();

    act(() => { vi.advanceTimersByTime(140); });
    expect(onDismiss).toHaveBeenCalledWith('a');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('auto-dismiss: таймер durationMs → exit → onDismiss после окна', () => {
    const onDismiss = vi.fn();
    render(<Toast toast={toast('b', { durationMs: 500 })} onDismiss={onDismiss} />);
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByTestId('toast-b').getAttribute('data-exit')).toBe('true');
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(140); });
    expect(onDismiss).toHaveBeenCalledWith('b');
  });

  it('reduced-motion: dismiss без keep-alive — onDismiss немедленно, без data-exit', () => {
    media.matches = true;
    const onDismiss = vi.fn();
    render(<Toast toast={toast('c')} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledWith('c');
    expect(screen.getByTestId('toast-c').getAttribute('data-exit')).toBeNull();
  });

  it('unmount в окне exit: clearTimeout — поздний onDismiss не стреляет', () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<Toast toast={toast('d')} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    unmount();
    act(() => { vi.advanceTimersByTime(500); });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('ToastRegion: стек рендерит все тосты, dismiss доходит до владельца', () => {
    const onDismiss = vi.fn();
    render(
      <ToastRegion
        toasts={[toast('x'), toast('y'), toast('z')]}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByTestId('toast-x')).toBeTruthy();
    expect(screen.getByTestId('toast-z')).toBeTruthy();
    const region = document.body.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();
    const buttons = region!.querySelectorAll('button');
    fireEvent.click(buttons[1]);
    act(() => { vi.advanceTimersByTime(140); });
    expect(onDismiss).toHaveBeenCalledWith('y');
  });

  it('ToastRegion без тостов рендерит null', () => {
    render(<ToastRegion toasts={[]} onDismiss={vi.fn()} />);
    expect(document.body.querySelector('[aria-live="polite"]')).toBeNull();
  });
});
