import { describe, expect, it, vi } from 'vitest';
import { LocalAudioAdapter, type AudioElementLike } from './local-audio-adapter';

function stubElement(): AudioElementLike & {
  handlers: Record<string, Array<() => void>>;
  fire(type: string): void;
  playResult: Promise<void>;
} {
  const handlers: Record<string, Array<() => void>> = {};
  const el: AudioElementLike & {
    handlers: Record<string, Array<() => void>>;
    fire(type: string): void;
    playResult: Promise<void>;
  } = {
    src: '', preload: '', currentTime: 0, duration: 0, volume: 1, muted: false,
    dataset: {}, error: null, handlers,
    playResult: Promise.resolve(),
    load: vi.fn(),
    play: vi.fn(function (this: typeof el) { return el.playResult; }),
    pause: vi.fn(),
    addEventListener: (t, fn) => { (handlers[t] ??= []).push(fn); },
    removeEventListener: (t, fn) => {
      handlers[t] = (handlers[t] ?? []).filter((f) => f !== fn);
    },
    canPlayType: (mime: string) => (mime === 'audio/x-ms-wma' ? '' : 'probably'),
    fire(t: string) { for (const fn of handlers[t] ?? []) fn(); },
  };
  return el;
}

function makeAdapter(el = stubElement()) {
  const urls: string[] = [];
  let n = 0;
  const revoked: string[] = [];
  const adapter = new LocalAudioAdapter({
    createElement: () => el,
    createObjectURL: () => { const u = `blob:mock-${++n}`; urls.push(u); return u; },
    revokeObjectURL: (u) => revoked.push(u),
  });
  return { adapter, el, urls, revoked };
}

const mp3 = (name = 'a.mp3', size = 1000) =>
  new File([new Uint8Array(size)], name, { type: 'audio/mpeg' });

describe('LocalAudioAdapter (INT-22)', () => {
  it('accepts playable audio into the queue; rejects by size/type/codec', () => {
    const { adapter } = makeAdapter();
    adapter.addFiles([
      mp3('good.mp3'),
      mp3('big.mp3', 101 * 1024 * 1024),
      new File([new Uint8Array(1)], 'doc.pdf', { type: 'application/pdf' }),
      new File([new Uint8Array(1)], 'old.wma', { type: 'audio/x-ms-wma' }),
    ]);
    const s = adapter.state;
    expect(s.queue.map((t) => t.name)).toEqual(['good.mp3']);
    expect(s.rejected.map((r) => r.name)).toEqual(['big.mp3', 'doc.pdf', 'old.wma']);
    expect(s.rejected[2].reason).toContain('не поддерживается');
    expect(s.trackState[s.queue[0].id].state).toBe('ready');
  });

  it('empty MIME probes as unknown — accepted, honest decode verdict later', () => {
    const el = stubElement();
    el.canPlayType = undefined;
    const { adapter } = makeAdapter(el);
    adapter.addFiles([new File([new Uint8Array(1)], 'mystery.bin', { type: 'audio/unknown-x' })]);
    expect(adapter.state.queue).toHaveLength(1);
    expect(adapter.state.rejected).toHaveLength(0);
  });

  it('select loads the object URL and marks the track loading→ready on metadata', () => {
    const { adapter, el } = makeAdapter();
    adapter.addFiles([mp3()]);
    const id = adapter.state.queue[0].id;
    adapter.select(id);
    expect(el.src).toMatch(/^blob:mock-/);
    expect(el.load).toHaveBeenCalled();
    expect(adapter.state.trackState[id].state).toBe('loading');
    expect(adapter.state.currentId).toBe(id);
    el.duration = 212;
    el.fire('loadedmetadata');
    expect(adapter.state.trackState[id].state).toBe('ready');
    expect(adapter.state.duration).toBe(212);
  });

  it('queue next/prev stay in bounds; out-of-bounds is an honest no-op', () => {
    const { adapter } = makeAdapter();
    adapter.addFiles([mp3('a.mp3'), mp3('b.mp3')]);
    const [a, b] = adapter.state.queue.map((t) => t.id);
    adapter.select(a);
    adapter.next();
    expect(adapter.state.currentId).toBe(b);
    adapter.next(); // at the end — no wrap, no error
    expect(adapter.state.currentId).toBe(b);
    adapter.prev();
    expect(adapter.state.currentId).toBe(a);
    adapter.prev();
    expect(adapter.state.currentId).toBe(a);
  });

  it('togglePlay plays and pauses; rejected play() reports an honest error', async () => {
    const { adapter, el } = makeAdapter();
    adapter.addFiles([mp3()]);
    const id = adapter.state.queue[0].id;
    adapter.select(id);
    adapter.togglePlay();
    await Promise.resolve();
    expect(adapter.state.playing).toBe(true);
    expect(adapter.state.trackState[id].state).toBe('playing');
    adapter.togglePlay();
    expect(el.pause).toHaveBeenCalled();
    expect(adapter.state.trackState[id].state).toBe('paused');

    el.playResult = Promise.reject(new Error('gesture'));
    adapter.togglePlay();
    await Promise.resolve().then(() => Promise.resolve());
    expect(adapter.state.trackState[id].state).toBe('error');
    expect(adapter.state.trackState[id].reason).toContain('отклонено');
  });

  it('seek/volume/mute drive the element; volume clamps to [0,1]', () => {
    const { adapter, el } = makeAdapter();
    adapter.addFiles([mp3()]);
    adapter.select(adapter.state.queue[0].id);
    adapter.seek(74);
    expect(el.currentTime).toBe(74);
    adapter.setVolume(1.7);
    expect(el.volume).toBe(1);
    adapter.setMuted(true);
    expect(el.muted).toBe(true);
    expect(adapter.state.muted).toBe(true);
  });

  it('element events map to honest states: timeupdate, ended, error codes', () => {
    const { adapter, el } = makeAdapter();
    adapter.addFiles([mp3()]);
    const id = adapter.state.queue[0].id;
    adapter.select(id);
    el.currentTime = 33;
    el.fire('timeupdate');
    expect(adapter.state.currentTime).toBe(33);
    el.fire('ended');
    expect(adapter.state.playing).toBe(false);
    expect(adapter.state.trackState[id].state).toBe('ended');
    el.error = { code: 3 };
    el.fire('error');
    expect(adapter.state.trackState[id].state).toBe('error');
    expect(adapter.state.trackState[id].reason).toContain('декодирования');
    el.error = { code: 4 };
    el.fire('error');
    expect(adapter.state.trackState[id].state).toBe('unsupported');
  });

  it('clear revokes every object URL and resets transport', () => {
    const { adapter, urls, revoked } = makeAdapter();
    adapter.addFiles([mp3('a.mp3'), mp3('b.mp3')]);
    adapter.select(adapter.state.queue[0].id);
    adapter.clear();
    expect(revoked.sort()).toEqual([...urls].sort());
    expect(adapter.state.queue).toHaveLength(0);
    expect(adapter.state.currentId).toBeNull();
  });

  it('dispose revokes URLs and stops notifying', () => {
    const { adapter, urls, revoked } = makeAdapter();
    adapter.addFiles([mp3()]);
    const l = vi.fn();
    adapter.subscribe(l);
    adapter.dispose();
    expect(revoked).toEqual(urls);
    const callsAtDispose = l.mock.calls.length; // last snapshot push is fine
    adapter.setVolume(0.5);
    expect(l.mock.calls.length).toBe(callsAtDispose);
  });
});
