// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NewfGpuScreen } from './newf-gpu-screen';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function stubWebgl(available: boolean) {
  const loseContext = vi.fn();
  const getContext = vi.fn((type: string) => {
    if (!available) return null;
    if (type === 'webgl2' || type === 'webgl') {
      return { getExtension: vi.fn(() => ({ loseContext })) };
    }
    return null;
  });
  const originalCreateElement = document.createElement.bind(document);
  const createElement = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') return { getContext } as unknown as HTMLCanvasElement;
    return originalCreateElement(tag);
  });
  return { loseContext, createElement };
}

describe('NewfGpuScreen (W58)', () => {
  it('WebGL недоступен → <pre>-fallback с текстом', async () => {
    stubWebgl(false);
    render(<NewfGpuScreen screen="hello" testId="ts" />);
    expect(screen.getByTestId('ts')).toBeInTheDocument();
    expect(screen.getByTestId('ts')).toHaveTextContent('hello');
  });

  it('probe-контекст освобождается (loseContext вызывается)', async () => {
    const { loseContext } = stubWebgl(true);
    render(<NewfGpuScreen screen="abc" testId="ts2" />);
    await new Promise((r) => setTimeout(r, 10));
    // в jsdom терминал не монтируется полностью — ждём fallback, но probe-контекст должен быть освобождён
    expect(screen.getByTestId('ts2')).toBeInTheDocument();
    expect(loseContext).toHaveBeenCalled();
  });
});
