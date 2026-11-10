import { describe, expect, it } from 'vitest';
import { DURATION_MS, EASING_BEZIER } from './presets';
import { FEED_MOTION_MS } from './feed-motion';
import {
  compactionMotion,
  COMPACTION_MOTION_EASING,
  COMPACTION_MOTION_MS,
} from './compaction-motion';

describe('compactionMotion contract', () => {
  it('uses shared duration and easing tokens for each motion verb', () => {
    expect(COMPACTION_MOTION_MS).toEqual({
      compactOut: DURATION_MS.normal,
      compactIn: DURATION_MS.normal,
      rowStagger: 0,
      badgePop: DURATION_MS.fast,
      contextPulse: FEED_MOTION_MS.wait,
    });
    expect(compactionMotion('compactOut').easing).toBe(
      `cubic-bezier(${EASING_BEZIER.exit.join(', ')})`,
    );
    expect(compactionMotion('compactIn').easing).toBe(
      `cubic-bezier(${EASING_BEZIER.enter.join(', ')})`,
    );
    expect(compactionMotion('badgePop').easing).toBe(
      `cubic-bezier(${EASING_BEZIER.pop.join(', ')})`,
    );
    expect(compactionMotion('contextPulse')).toMatchObject({
      durationMs: 1400,
      easing: `cubic-bezier(${EASING_BEZIER.dissolve.join(', ')})`,
      iterations: 'infinite',
    });
    expect(COMPACTION_MOTION_EASING.contextPulse).toBe('dissolve');
  });

  it('stagger is batch-only and caps each row delay at five 40ms steps', () => {
    expect(compactionMotion('rowStagger', { batch: false, index: 4 }).delayMs).toBe(0);
    expect(compactionMotion('rowStagger', { batch: true, index: 0 }).delayMs).toBe(0);
    expect(compactionMotion('rowStagger', { batch: true, index: 3 }).delayMs).toBe(120);
    expect(compactionMotion('rowStagger', { batch: true, index: 100 }).delayMs).toBe(200);
  });

  it('reduced motion and snapshots resolve every verb to a static final state', () => {
    for (const verb of [
      'compactOut', 'compactIn', 'rowStagger', 'badgePop', 'contextPulse',
    ] as const) {
      expect(compactionMotion(verb, { reducedMotion: true })).toMatchObject({
        durationMs: 0,
        delayMs: 0,
        reduced: true,
        iterations: 'once',
      });
      expect(compactionMotion(verb, { snapshot: true })).toMatchObject({
        durationMs: 0,
        delayMs: 0,
        reduced: true,
      });
    }
  });
});
