// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootHandoff } from './boot-components';
import { markBootHandoff } from './boot-motion';

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');

afterEach(() => {
  window.document.body.replaceChildren();
  window.sessionStorage.removeItem('nexus:boot-handoff');
  if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia);
  else Reflect.deleteProperty(window, 'matchMedia');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('boot motion lifecycle', () => {
  it('clears the handoff fallback timeout and reduced-motion listener on unmount', async () => {
    const media = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => media),
    });
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    markBootHandoff();

    const host = document.createElement('div');
    document.body.append(host);
    const root: Root = createRoot(host);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    await act(async () => root.render(createElement(BootHandoff)));
    expect(host.querySelector('[data-testid="boot-handoff-veil"]')).not.toBeNull();
    const timerIndex = timeout.mock.calls.findIndex(([, delay]) => delay === 780);
    expect(timerIndex).toBeGreaterThanOrEqual(0);
    const timer = timeout.mock.results[timerIndex].value;
    const listener = media.addEventListener.mock.calls.find(([type]) => type === 'change')?.[1];
    expect(listener).toBeDefined();

    await act(async () => root.unmount());
    expect(clear).toHaveBeenCalledWith(timer);
    expect(media.removeEventListener).toHaveBeenCalledWith('change', listener);
  });

  it('settles via animationend exactly once, erases the flag, leaves no resources', async () => {
    const media = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => media),
    });
    const onSettled = vi.fn();
    markBootHandoff();

    const host = document.createElement('div');
    document.body.append(host);
    const root: Root = createRoot(host);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    await act(async () => root.render(createElement(BootHandoff, { onSettled })));
    const veil = host.querySelector('[data-testid="boot-handoff-veil"]');
    expect(veil).not.toBeNull();
    expect(window.sessionStorage.getItem('nexus:boot-handoff')).toBeNull();

    await act(async () => {
      veil!.dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    expect(host.querySelector('[data-testid="boot-handoff-veil"]')).toBeNull();
    expect(onSettled).toHaveBeenCalledTimes(1);
    // Поздний animationend/таймер не должен вызывать onSettled повторно.
    await act(async () => {
      veil!.dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    expect(onSettled).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });

  it('reduced-motion: the veil never enters the DOM — no intermediate frame', async () => {
    const media = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => media),
    });
    const onSettled = vi.fn();
    markBootHandoff();

    const host = document.createElement('div');
    document.body.append(host);
    const root: Root = createRoot(host);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    await act(async () => root.render(createElement(BootHandoff, { onSettled })));
    // Флаг честно поглощён, вейл ни на один коммит не попал в DOM.
    expect(host.children.length).toBe(0);
    expect(window.sessionStorage.getItem('nexus:boot-handoff')).toBeNull();
    expect(onSettled).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it('settles a reduced-motion handoff immediately without scheduling a timer', async () => {
    const media = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => media),
    });
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    const onSettled = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    const root: Root = createRoot(host);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    markBootHandoff();

    await act(async () => root.render(createElement(BootHandoff, { onSettled })));
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-testid="boot-handoff-veil"]')).toBeNull();
    expect(timeout.mock.calls.some(([, delay]) => delay === 780 || delay === 170)).toBe(false);
    await act(async () => root.unmount());
  });
});
