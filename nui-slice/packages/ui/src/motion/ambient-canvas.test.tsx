// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AmbientCanvas } from './ambient-canvas';

const resizeObservers: Array<{ observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
const intersectionObservers: Array<{ observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];

class MockResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(_callback: ResizeObserverCallback) { resizeObservers.push(this); }
}

class MockIntersectionObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(_callback: IntersectionObserverCallback) { intersectionObservers.push(this); }
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resizeObservers.length = 0;
  intersectionObservers.length = 0;
});

describe('AmbientCanvas prefers-reduced-motion', () => {
  it('draws one static frame, starts no RAF/visibility observer, and releases resize observer', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    const raf = vi.fn(() => 21);
    vi.stubGlobal('requestAnimationFrame', raf);
    const cancel = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const context = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 80, width: 100, height: 80,
      toJSON: () => ({}),
    });

    const view = render(<AmbientCanvas />);
    expect(raf).not.toHaveBeenCalled();
    expect(intersectionObservers).toHaveLength(0);
    expect(resizeObservers[0].observe).toHaveBeenCalledTimes(1);
    expect(context.clearRect).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(resizeObservers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });
});
