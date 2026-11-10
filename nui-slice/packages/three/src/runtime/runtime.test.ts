import { describe, expect, it } from 'vitest';
import { createDeterministicClock, createSeededRandom, resolveDeterminism } from './determinism';
import { resolveQuality } from './quality';
import { detectWebGL, hasWebGL } from './webgl-support';

describe('quality tiers (spec §10)', () => {
  it('forces DOM fallback when WebGL is unavailable', () => {
    const q = resolveQuality({ requested: 'high', webglAvailable: false });
    expect(q.useFallback).toBe(true);
    expect(q.quality).toBe('reduced');
  });

  it('honours explicit reduced tier with fallback', () => {
    expect(resolveQuality({ requested: 'reduced' }).useFallback).toBe(true);
  });

  it('freezes motion under prefers-reduced-motion without demoting tier', () => {
    const q = resolveQuality({ requested: 'high', reducedMotion: true });
    expect(q.quality).toBe('high');
    expect(q.frozen).toBe(true);
    expect(q.useFallback).toBe(false);
  });

  it('caps DPR at the provided budget ceiling', () => {
    expect(resolveQuality({ dprCap: 4 }).dprCap).toBe(2);
    expect(resolveQuality({ dprCap: 1.25 }).dprCap).toBe(1.25);
  });
});

describe('deterministic mode (Task 13)', () => {
  it('produces identical state for identical seed/time', () => {
    const a = resolveDeterminism({ testMode: true, seed: 42, animationTime: 0 });
    const b = resolveDeterminism({ testMode: true, seed: 42, animationTime: 0 });
    const seqA = [a.random(), a.random(), a.clock.tick()];
    const seqB = [b.random(), b.random(), b.clock.tick()];
    expect(seqA).toEqual(seqB);
  });

  it('defaults seed for reproducible test mode', () => {
    const r = resolveDeterminism({ testMode: true });
    expect(r.seed).toBe(1);
    expect(r.clock.now()).toBe(0);
  });

  it('virtual clock ignores wall time', () => {
    const c = createDeterministicClock(100);
    expect(c.now()).toBe(100);
    expect(c.tick()).toBeCloseTo(100 + 1000 / 60);
  });

  it('seeded RNG stays in [0,1) and differs across seeds', () => {
    const r1 = createSeededRandom(1)();
    const r2 = createSeededRandom(2)();
    expect(r1).toBeGreaterThanOrEqual(0);
    expect(r1).toBeLessThan(1);
    expect(r1).not.toBe(r2);
  });
});

describe('webgl detection', () => {
  it('returns none when canvas creation fails', () => {
    expect(detectWebGL(() => null)).toBe('none');
  });

  it('detects webgl2 first, webgl1 second', () => {
    const fake = { getContext: (n: string) => (n === 'webgl2' ? {} : n === 'webgl' ? {} : null) };
    expect(detectWebGL(() => fake)).toBe('webgl2');
    const only1 = { getContext: (n: string) => (n === 'webgl' ? {} : null) };
    expect(detectWebGL(() => only1)).toBe('webgl1');
  });

  it('swallows context-throwing canvases', () => {
    expect(detectWebGL(() => ({ getContext: () => { throw new Error('gpu off'); } }))).toBe('none');
  });

  it('hasWebGL reflects support tiers', () => {
    expect(hasWebGL('webgl2')).toBe(true);
    expect(hasWebGL('none')).toBe(false);
  });
});
