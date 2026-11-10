import { describe, expect, it } from 'vitest';
import { pageMotion, PAGE_MOTION_MS, PAGE_MOTION_EASING } from './page-motion';
import { DURATION_MS, EASING_BEZIER } from './presets';

describe('pageMotion — спека переходов экранов (W4-1005)', () => {
  it('глаголы на токен-шкале: enter 240/enter, exit 140/exit', () => {
    expect(PAGE_MOTION_MS.pageEnter).toBe(DURATION_MS.normal);
    expect(PAGE_MOTION_MS.pageExit).toBe(DURATION_MS.fast);
    expect(PAGE_MOTION_EASING.pageEnter).toBe('enter');
    expect(PAGE_MOTION_EASING.pageExit).toBe('exit');
    const enter = pageMotion('pageEnter');
    expect(enter.durationMs).toBe(240);
    expect(enter.easing).toBe(`cubic-bezier(${EASING_BEZIER.enter.join(', ')})`);
    const exit = pageMotion('pageExit');
    expect(exit.durationMs).toBe(140);
    expect(exit.easing).toBe(`cubic-bezier(${EASING_BEZIER.exit.join(', ')})`);
  });

  it('reduced-motion и snapshot → 0ms, статичное конечное состояние', () => {
    for (const v of ['pageEnter', 'pageExit'] as const) {
      expect(pageMotion(v, { reducedMotion: true }).durationMs).toBe(0);
      expect(pageMotion(v, { snapshot: true }).reduced).toBe(true);
      expect(pageMotion(v).iterations).toBe('once');
      expect(pageMotion(v).delayMs).toBe(0);
    }
  });
});
