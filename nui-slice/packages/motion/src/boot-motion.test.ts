import { describe, expect, it } from 'vitest';
import {
  bootMotion, bootSequenceProgress,
  BOOT_MOTION_MS, BOOT_MOTION_EASING,
  type BootStageState,
} from './boot-motion';

describe('bootMotion — спека стартового экрана (волна XIV W4)', () => {
  it('длительности по глаголам; handoff в брифовой полосе 600–900ms', () => {
    expect(BOOT_MOTION_MS.emblem).toBe(700);
    expect(BOOT_MOTION_MS.figure).toBe(900);
    expect(BOOT_MOTION_MS.fill).toBe(240);
    expect(BOOT_MOTION_MS.shimmer).toBe(1400);
    const h = bootMotion('handoff', 'dissolve');
    expect(h.durationMs).toBeGreaterThanOrEqual(600);
    expect(h.durationMs).toBeLessThanOrEqual(900);
    expect(h.easing).toBe(BOOT_MOTION_EASING.dissolve);
    expect(h.reduced).toBe(false);
  });

  it('reduced-motion и snapshot схлопывают всё в 0ms', () => {
    for (const verb of ['emblem', 'figure', 'fill', 'shimmer', 'handoff'] as const) {
      const rm = bootMotion(verb, 'launch', { reducedMotion: true });
      const snap = bootMotion(verb, 'launch', { snapshot: true });
      expect(rm.durationMs).toBe(0);
      expect(rm.reduced).toBe(true);
      expect(snap.durationMs).toBe(0);
    }
  });

  it('unknown sync inventory remains null, not a fabricated zero percent', () => {
    expect(bootSequenceProgress({
      profile: null,
      host: null,
      synchronization: null,
      readiness: null,
    })).toEqual({
      value: null,
      completed: null,
      total: null,
      syncCompleted: null,
      syncTotal: null,
    });
  });

  it('derives N/12 and percent from settled real-stage events including readiness', () => {
    const twelvePending: BootStageState[] = Array.from({ length: 12 }, () => 'loading');
    expect(bootSequenceProgress({
      profile: 'loading',
      host: 'loading',
      synchronization: twelvePending,
      readiness: 'loading',
    })).toMatchObject({
      value: null,
      completed: 0,
      total: 15,
      syncCompleted: 0,
      syncTotal: 12,
    });

    const partial = [...twelvePending];
    partial[0] = 'ok';
    partial[1] = 'failed';
    partial[2] = 'skipped';
    expect(bootSequenceProgress({
      profile: 'ok',
      host: 'unavailable',
      synchronization: partial,
      readiness: 'loading',
    })).toEqual({
      value: 33,
      completed: 5,
      total: 15,
      syncCompleted: 3,
      syncTotal: 12,
    });

    expect(bootSequenceProgress({
      profile: 'ok',
      host: 'ok',
      synchronization: Array.from({ length: 12 }, () => 'ok' as const),
      readiness: 'ok',
    }).value).toBe(100);
  });
});
