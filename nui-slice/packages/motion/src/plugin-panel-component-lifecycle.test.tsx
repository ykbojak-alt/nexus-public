// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginMotionItem, PluginPanelLayout } from './plugin-panel-components';

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
const roots: Array<{ root: Root; host: HTMLDivElement }> = [];

function mount(node: ReactNode) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push({ root, host });
  act(() => root.render(node));
  return {
    render: (next: ReactNode) => act(() => root.render(next)),
    unmount: () => {
      act(() => root.unmount());
      host.remove();
      const index = roots.findIndex((entry) => entry.root === root);
      if (index >= 0) roots.splice(index, 1);
    },
  };
}

afterEach(() => {
  for (const { root, host } of roots.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia);
  else Reflect.deleteProperty(window, 'matchMedia');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubMotionQuery(matches = false) {
  const query = {
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => query),
  });
  return query;
}

describe('plugin panel component lifecycle', () => {
  it('unsubscribes the reduced-motion listener when a panel layout unmounts', () => {
    const query = stubMotionQuery();
    const view = mount(createElement(PluginPanelLayout, {
      mode: 'push',
      center: createElement('span', null, 'center'),
      panel: createElement('span', null, 'panel'),
    }));
    const listener = query.addEventListener.mock.calls.find(([type]) => type === 'change')?.[1];
    expect(listener).toBeDefined();

    view.unmount();
    expect(query.removeEventListener).toHaveBeenCalledWith('change', listener);
  });

  it('cancels the entrance frame, exit timeout, and preference listener on unmount', () => {
    const query = stubMotionQuery();
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(31);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const timer = 47 as unknown as ReturnType<typeof window.setTimeout>;
    const setTimer = vi.spyOn(window, 'setTimeout').mockReturnValue(timer);
    const clear = vi.spyOn(window, 'clearTimeout');
    const view = mount(createElement(PluginMotionItem, { kind: 'tab', present: false, children: 'tab' }));

    view.render(createElement(PluginMotionItem, { kind: 'tab', present: true, children: 'tab' }));
    expect(raf).toHaveBeenCalledTimes(1);
    view.render(createElement(PluginMotionItem, { kind: 'tab', present: false, children: 'tab' }));
    expect(cancel).toHaveBeenCalledWith(31);
    expect(setTimer).toHaveBeenCalled();
    view.unmount();

    expect(clear).toHaveBeenCalledWith(timer);
    const listener = query.addEventListener.mock.calls.find(([type]) => type === 'change')?.[1];
    expect(query.removeEventListener).toHaveBeenCalledWith('change', listener);
  });

  it('skips entrance RAF and exit timeout when reduced motion is enabled', () => {
    const query = stubMotionQuery(true);
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const timeout = vi.spyOn(window, 'setTimeout');
    const view = mount(createElement(PluginMotionItem, { kind: 'tab', present: false, children: 'tab' }));

    view.render(createElement(PluginMotionItem, { kind: 'tab', present: true, children: 'tab' }));
    view.render(createElement(PluginMotionItem, { kind: 'tab', present: false, children: 'tab' }));
    expect(raf).not.toHaveBeenCalled();
    expect(timeout).not.toHaveBeenCalled();
    view.unmount();
    const listener = query.addEventListener.mock.calls.find(([type]) => type === 'change')?.[1];
    expect(query.removeEventListener).toHaveBeenCalledWith('change', listener);
  });
});
