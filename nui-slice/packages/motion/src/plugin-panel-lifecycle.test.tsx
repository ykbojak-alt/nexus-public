import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePluginMotionPerformance } from './plugin-panel-components';

const observers: Array<{ observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];

class MockPerformanceObserver {
  observe = vi.fn();
  disconnect = vi.fn();

  constructor(_callback: PerformanceObserverCallback) {
    observers.push(this);
  }
}

function Probe({ active }: { active?: boolean }) {
  usePluginMotionPerformance(active);
  return null;
}

describe('plugin motion sampler lifecycle', () => {
  let root: Root | undefined;
  let host: HTMLDivElement | undefined;
  const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = undefined;
    host?.remove();
    host = undefined;
    if (visibilityDescriptor) Object.defineProperty(document, 'visibilityState', visibilityDescriptor);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    observers.length = 0;
  });

  function mount(active?: boolean) {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(createElement(Probe, { active })));
  }

  it('does not schedule RAF, interval, or observer while idle (including the default)', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const interval = vi.spyOn(window, 'setInterval');
    mount();
    expect(raf).not.toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();
    expect(observers).toHaveLength(0);
  });

  it('stops its frame and timer and disconnects the observer on unmount', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(31);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const timer = 47 as unknown as ReturnType<typeof window.setInterval>;
    const interval = vi.spyOn(window, 'setInterval').mockReturnValue(timer);
    const clear = vi.spyOn(window, 'clearInterval');
    const addVisibility = vi.spyOn(document, 'addEventListener');
    const removeVisibility = vi.spyOn(document, 'removeEventListener');
    vi.stubGlobal('PerformanceObserver', MockPerformanceObserver);

    mount(true);
    expect(raf).toHaveBeenCalledTimes(1);
    expect(interval).toHaveBeenCalledTimes(1);
    expect(observers[0].observe).toHaveBeenCalledWith({ entryTypes: ['longtask'] });

    act(() => root?.unmount());
    root = undefined;
    expect(cancel).toHaveBeenCalledWith(31);
    expect(clear).toHaveBeenCalledWith(timer);
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
    const visibilityListener = addVisibility.mock.calls.find(([type]) => type === 'visibilitychange')?.[1];
    expect(visibilityListener).toBeDefined();
    expect(removeVisibility).toHaveBeenCalledWith('visibilitychange', visibilityListener);
  });

  it('does not start a sample while the document is hidden', () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const interval = vi.spyOn(window, 'setInterval');
    mount(true);
    expect(raf).not.toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();
    expect(observers).toHaveLength(0);
  });

  it('releases an active sample when the document becomes hidden', () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(53);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const timer = 61 as unknown as ReturnType<typeof window.setInterval>;
    const interval = vi.spyOn(window, 'setInterval').mockReturnValue(timer);
    const clear = vi.spyOn(window, 'clearInterval');
    vi.stubGlobal('PerformanceObserver', MockPerformanceObserver);
    mount(true);
    expect(raf).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(cancel).toHaveBeenCalledWith(53);
    expect(clear).toHaveBeenCalledWith(timer);
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(raf).toHaveBeenCalledTimes(1);
  });
});
