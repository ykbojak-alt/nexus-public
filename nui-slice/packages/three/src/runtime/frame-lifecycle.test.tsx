// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const frameLifecycle = vi.hoisted(() => ({
  active: new Set<unknown>(),
  registered: 0,
  removed: 0,
}));

vi.mock('@react-three/fiber', async () => {
  const React = await import('react');
  return {
    Canvas: ({ children }: { children: ReactNode }) =>
      React.createElement('div', { 'data-testid': 'mock-r3f-canvas' }, children),
    useFrame: (callback: unknown) => {
      React.useEffect(() => {
        frameLifecycle.active.add(callback);
        frameLifecycle.registered += 1;
        return () => {
          frameLifecycle.active.delete(callback);
          frameLifecycle.removed += 1;
        };
      }, [callback]);
    },
  };
});

import { CoreCanvas } from '../cores/core-webgl';
import { renderCoreState } from '../cores/core-state';
import { FrameStatsProbe } from './frame-stats';
import { SpatialWebGL } from '../spatial/spatial-webgl';
import { renderSpatialState } from '../spatial/spatial-state';

afterEach(() => {
  cleanup();
  frameLifecycle.active.clear();
  frameLifecycle.registered = 0;
  frameLifecycle.removed = 0;
  vi.restoreAllMocks();
});

describe('R3F frame subscription lifecycle', () => {
  it('unsubscribes CoreWebGL and frame-stat callbacks when the canvas unmounts', () => {
    const state = renderCoreState('nexus', { testMode: true, seed: 42, animationTime: 0 });
    const view = render(
      <CoreCanvas state={state} frozen={false} dprCap={1} width={320} height={240} />,
    );
    expect(frameLifecycle.active.size).toBe(2);
    expect(frameLifecycle.registered).toBe(2);

    view.unmount();
    expect(frameLifecycle.active.size).toBe(0);
    expect(frameLifecycle.removed).toBe(2);
  });

  it('unsubscribes spatial-scene and frame-stat callbacks when its canvas unmounts', () => {
    const state = renderSpatialState('constellation', { nodes: [], edges: [] }, { testMode: true, seed: 9 });
    const view = render(
      <SpatialWebGL state={state} frozen={false} dprCap={1} width={320} height={240} />,
    );
    expect(frameLifecycle.active.size).toBe(2);

    view.unmount();
    expect(frameLifecycle.active.size).toBe(0);
    expect(frameLifecycle.removed).toBe(2);
  });

  it('unsubscribes the standalone frame-stats probe on unmount', () => {
    const view = render(<FrameStatsProbe />);
    expect(frameLifecycle.active.size).toBe(1);
    view.unmount();
    expect(frameLifecycle.active.size).toBe(0);
    expect(frameLifecycle.removed).toBe(1);
  });
});
