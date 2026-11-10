import { describe, expect, it } from 'vitest';
import { EASING_BEZIER } from './presets';
import { typingMotion, TYPING_MOTION_EASING, TYPING_MOTION_MS } from './typing-motion';

describe('typingMotion — dots-cascade (W4-1020)', () => {
  it('uses the pulse cycle and enter easing token', () => {
    expect(TYPING_MOTION_MS).toBe(1100);
    expect(TYPING_MOTION_EASING).toBe(`cubic-bezier(${EASING_BEZIER.enter.join(', ')})`);
    expect(typingMotion()).toMatchObject({
      durationMs: 1100,
      easing: TYPING_MOTION_EASING,
      reduced: false,
      iterations: 'infinite',
    });
  });

  it('reduced motion and snapshots are static', () => {
    expect(typingMotion({ reducedMotion: true })).toMatchObject({ durationMs: 0, reduced: true });
    expect(typingMotion({ snapshot: true })).toMatchObject({ durationMs: 0, reduced: true });
  });
});
