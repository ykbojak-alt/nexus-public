import { describe, expect, it } from 'vitest';
import { dockMotion, DOCK_MOTION_MS, DOCK_MOTION_EASING } from './dock-motion';
import { DURATION_MS, EASING_BEZIER } from './presets';

describe('dockMotion — переходы правой панели (W4-1008)', () => {
  it('глаголы на токен-шкале и с семейными easing', () => {
    expect(DOCK_MOTION_MS.slideIn).toBe(DURATION_MS.normal);
    expect(DOCK_MOTION_MS.slideOut).toBe(DURATION_MS.fast);
    expect(DOCK_MOTION_MS.slimCollapse).toBe(DURATION_MS.normal);
    expect(DOCK_MOTION_MS.fullscreenExpand).toBe(DURATION_MS.normal);
    expect(DOCK_MOTION_EASING.slideIn).toBe('enter');
    expect(DOCK_MOTION_EASING.slideOut).toBe('exit');
    expect(DOCK_MOTION_EASING.slimCollapse).toBe('standard');
    expect(DOCK_MOTION_EASING.fullscreenExpand).toBe('enter');
    const out = dockMotion('slideOut');
    expect(out.durationMs).toBe(140);
    expect(out.easing).toBe(`cubic-bezier(${EASING_BEZIER.exit.join(', ')})`);
  });

  it('reduced-motion/snapshot → 0ms — keep-alive окно нулевой длины', () => {
    for (const v of ['slideIn', 'slideOut', 'slimCollapse', 'fullscreenExpand'] as const) {
      expect(dockMotion(v, { reducedMotion: true }).durationMs).toBe(0);
      expect(dockMotion(v, { snapshot: true }).reduced).toBe(true);
      expect(dockMotion(v).iterations).toBe('once');
    }
  });
});
