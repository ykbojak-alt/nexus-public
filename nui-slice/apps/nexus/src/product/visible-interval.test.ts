// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAnimationFrameWhileVisible, runWhileDocumentVisible } from './visible-interval';

const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');

afterEach(() => {
  if (hiddenDescriptor) Object.defineProperty(document, 'hidden', hiddenDescriptor);
  else Reflect.deleteProperty(document, 'hidden');
  if (visibilityDescriptor) Object.defineProperty(document, 'visibilityState', visibilityDescriptor);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('runWhileDocumentVisible lifecycle', () => {
  it('does not start while hidden, pauses and resumes, and releases timer/listener on unmount', () => {
    let hidden = true;
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden,
    });
    const timer = 41 as unknown as ReturnType<typeof window.setInterval>;
    const setInterval = vi.spyOn(window, 'setInterval').mockReturnValue(timer);
    const clearInterval = vi.spyOn(window, 'clearInterval');
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');

    const cleanup = runWhileDocumentVisible(() => {}, 78);
    expect(setInterval).not.toHaveBeenCalled();

    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(setInterval).toHaveBeenCalledTimes(1);

    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(clearInterval).toHaveBeenCalledWith(timer);
    expect(setInterval).toHaveBeenCalledTimes(1);

    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(setInterval).toHaveBeenCalledTimes(2);

    cleanup();
    expect(clearInterval).toHaveBeenCalledTimes(2);
    const listener = add.mock.calls.find(([type]) => type === 'visibilitychange')?.[1];
    expect(remove).toHaveBeenCalledWith('visibilitychange', listener);
  });

  it('cancels the waveform RAF while hidden and on unmount, then resumes when visible', () => {
    let hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    const raf = vi.spyOn(window, 'requestAnimationFrame')
      .mockReturnValueOnce(11)
      .mockReturnValueOnce(12);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');

    const cleanup = runAnimationFrameWhileVisible(() => {});
    expect(raf).toHaveBeenCalledTimes(1);

    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(cancel).toHaveBeenCalledWith(11);
    expect(raf).toHaveBeenCalledTimes(1);

    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(raf).toHaveBeenCalledTimes(2);

    cleanup();
    expect(cancel).toHaveBeenCalledWith(12);
    const listener = add.mock.calls.find(([type]) => type === 'visibilitychange')?.[1];
    expect(remove).toHaveBeenCalledWith('visibilitychange', listener);
  });
});
