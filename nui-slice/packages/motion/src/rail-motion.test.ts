import { describe, expect, it } from 'vitest';
import { railMotion, RAIL_MOTION_MS, RAIL_MOTION_EASING } from './rail-motion';

describe('railMotion — спека иконочной полосы (волна XIV W4)', () => {
  it('rail в брифовой полосе 180–240ms; остальные глаголы на месте', () => {
    expect(RAIL_MOTION_MS.railOut).toBe(140);
    expect(RAIL_MOTION_MS.marker).toBe(200);
    expect(RAIL_MOTION_MS.tip).toBe(140);
    expect(RAIL_MOTION_MS.deck).toBe(240);
    const r = railMotion('rail');
    expect(r.durationMs).toBeGreaterThanOrEqual(180);
    expect(r.durationMs).toBeLessThanOrEqual(240);
    expect(r.easing).toBe(RAIL_MOTION_EASING.launch);
  });

  it('reduced-motion и snapshot → 0ms', () => {
    for (const verb of ['rail', 'railOut', 'marker', 'tip', 'deck'] as const) {
      expect(railMotion(verb, 'launch', { reducedMotion: true }).durationMs).toBe(0);
      expect(railMotion(verb, 'glide', { snapshot: true }).reduced).toBe(true);
    }
  });
});
