import { describe, expect, it } from 'vitest';
import { createMockStream } from './mock-stream';
import { runEventStream } from './runs';
import type { RunStatus } from './types';

function fakeClock() {
  const pending: (() => void)[] = [];
  const cancelled = new Set<() => void>();
  const schedule = (fn: () => void) => {
    pending.push(fn);
    return () => cancelled.add(fn);
  };
  const flush = () => {
    while (pending.length) {
      const fn = pending.shift()!;
      if (!cancelled.has(fn)) fn();
    }
  };
  return { schedule, flush };
}

describe('createMockStream', () => {
  it('replays all events in seq order then ends with derived status', () => {
    const { schedule, flush } = fakeClock();
    const seen: number[] = [];
    let end: RunStatus | null = null;
    createMockStream(runEventStream, { schedule }, (e) => seen.push(e.seq), (s) => { end = s; });
    flush();
    expect(seen).toEqual(runEventStream.map((e) => e.seq));
    expect(end).toBe('done');
  });

  it('resumes strictly after fromSeq (Last-Event-ID)', () => {
    const { schedule, flush } = fakeClock();
    const seen: number[] = [];
    createMockStream(runEventStream, { fromSeq: 5, schedule }, (e) => seen.push(e.seq), () => {});
    flush();
    expect(seen[0]).toBe(6);
    expect(seen).toHaveLength(runEventStream.length - 5);
  });

  it('maps terminal stop_reason to RunStatus', () => {
    const { schedule, flush } = fakeClock();
    let end: RunStatus | null = null;
    createMockStream(
      [{ seq: 1, type: 'final', role: null, ts: 0, body: { stop_reason: 'timeout' } }],
      { schedule },
      () => {},
      (s) => { end = s; },
    );
    flush();
    expect(end).toBe('timeout');
  });

  it('pauses at gapAtSeq, signals onGap, then resumes', () => {
    const { schedule, flush } = fakeClock();
    const gaps: boolean[] = [];
    const seen: number[] = [];
    createMockStream(
      runEventStream,
      { schedule, gapAtSeq: 4 },
      (e) => seen.push(e.seq),
      () => {},
      (p) => gaps.push(p),
    );
    flush();
    expect(gaps).toEqual([true, false]);
    expect(seen).toEqual(runEventStream.map((e) => e.seq));
  });

  it('unsubscribe stops pending emissions', () => {
    const { schedule, flush } = fakeClock();
    const seen: number[] = [];
    const unsub = createMockStream(runEventStream, { schedule }, (e) => seen.push(e.seq), () => {});
    unsub();
    flush();
    expect(seen).toEqual([]);
  });
});
