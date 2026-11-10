// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFeedPerf, useFeedWindow } from './feed-components';
import type { RefObject } from 'react';

const observers: Array<{ observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
const roots: Array<{ root: Root; host: HTMLDivElement }> = [];

function mount(node: ReactNode): { unmount: () => void } {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push({ root, host });
  act(() => root.render(node));
  return {
    unmount: () => {
      act(() => root.unmount());
      host.remove();
      const index = roots.findIndex((entry) => entry.root === root);
      if (index >= 0) roots.splice(index, 1);
    },
  };
}

class MockPerformanceObserver {
  observe = vi.fn();
  disconnect = vi.fn();

  constructor(_callback: PerformanceObserverCallback) {
    observers.push(this);
  }
}

class MockResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();

  constructor(_callback: ResizeObserverCallback) {
    observers.push(this);
  }
}

afterEach(() => {
  for (const { root, host } of roots.splice(0)) {
    root.unmount();
    host.remove();
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  observers.length = 0;
});

describe('feed motion lifecycle', () => {
  it('cancels the perf sampler RAF/interval and disconnects PerformanceObserver', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(17);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const timer = 29 as unknown as ReturnType<typeof window.setInterval>;
    const interval = vi.spyOn(window, 'setInterval').mockReturnValue(timer);
    const clear = vi.spyOn(window, 'clearInterval');
    vi.stubGlobal('PerformanceObserver', MockPerformanceObserver);

    function Probe() {
      useFeedPerf({ windowMs: 1000 });
      return null;
    }
    const root = mount(createElement(Probe));
    expect(raf).toHaveBeenCalledTimes(1);
    expect(interval).toHaveBeenCalledTimes(1);
    expect(observers[0].observe).toHaveBeenCalledWith({ entryTypes: ['longtask'] });

    root.unmount();
    expect(cancel).toHaveBeenCalledWith(17);
    expect(clear).toHaveBeenCalledWith(timer);
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it('removes the scroll listener, cancels its queued frame, and disconnects ResizeObserver', () => {
    const target = document.createElement('div');
    Object.defineProperties(target, {
      clientHeight: { configurable: true, value: 200 },
      scrollTop: { configurable: true, value: 0 },
    });
    const ref = { current: target } as RefObject<HTMLElement | null>;
    const add = vi.spyOn(target, 'addEventListener');
    const remove = vi.spyOn(target, 'removeEventListener');
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(41);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    function Probe() {
      useFeedWindow(ref, 500, 40);
      return null;
    }
    const root = mount(createElement(Probe));
    const scrollListener = add.mock.calls.find(([type]) => type === 'scroll')?.[1] as EventListener;
    expect(scrollListener).toBeDefined();
    expect(observers[0].observe).toHaveBeenCalledWith(target);

    scrollListener(new Event('scroll'));
    expect(raf).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    expect(cancel).toHaveBeenCalledWith(41);
    expect(remove).toHaveBeenCalledWith('scroll', scrollListener);
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
  });
});
