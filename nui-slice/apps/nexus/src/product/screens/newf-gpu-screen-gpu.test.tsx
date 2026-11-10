// @vitest-environment jsdom
/**
 * W58-F3: GPU-path тесты (QODER V81 F3) — моки @xterm модулей,
 * чтобы gpuOk=true ветка рендерилась в jsdom.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const writeSpy = vi.fn();
const resetSpy = vi.fn();
const disposeSpy = vi.fn();
const loadAddonSpy = vi.fn();

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    loadAddon = loadAddonSpy;
    open() {}
    write = writeSpy;
    reset = resetSpy;
    dispose = disposeSpy;
  },
}));
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class { dispose() {} },
}));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

import { NewfGpuScreen } from './newf-gpu-screen';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function stubWebglTrue() {
  const loseContext = vi.fn();
  vi.spyOn(document, 'createElement').mockImplementation((tag: string, opts?: unknown) => {
    if (tag === 'canvas') {
      return {
        getContext: (type: string) =>
          (type === 'webgl2' || type === 'webgl')
            ? { getExtension: () => ({ loseContext }) }
            : null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as HTMLCanvasElement;
    }
    return document.createElementNS('http://www.w3.org/1999/xhtml', tag, opts as ElementCreationOptions | undefined) as unknown as HTMLElement;
  });
  return { loseContext };
}

describe('NewfGpuScreen GPU-path (W58-F3)', () => {
  it('WebGL доступен → gpuOk=true, host виден, <pre> скрыт', async () => {
    stubWebglTrue();
    const { container } = render(<NewfGpuScreen screen="gpu text" testId="gpu1" />);
    await new Promise((r) => setTimeout(r, 20));
    const host = container.querySelector('[data-testid="gpu1"]');
    expect(host).not.toBeNull();
    expect((host as HTMLElement).tagName.toLowerCase()).toBe('div');
    expect(container.querySelector('pre[data-testid="gpu1"]')).toBeNull();
    expect(loadAddonSpy).toHaveBeenCalled();
  });

  it('кадр пишется через reset+write (snapshot-семантика)', async () => {
    stubWebglTrue();
    render(<NewfGpuScreen screen="frame-one" testId="gpu2" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(resetSpy).toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledWith('frame-one');
  });

  it('unmount → dispose терминала (нет утечки)', async () => {
    stubWebglTrue();
    const { unmount } = render(<NewfGpuScreen screen="x" testId="gpu3" />);
    await new Promise((r) => setTimeout(r, 20));
    unmount();
    expect(disposeSpy).toHaveBeenCalled();
  });
});
