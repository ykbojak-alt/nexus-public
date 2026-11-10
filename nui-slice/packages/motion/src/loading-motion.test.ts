import { describe, expect, it } from 'vitest';
import { DURATION_MS, EASING_BEZIER } from './presets';
import { loadingMotion, LOADING_MOTION_MS, LOADING_MOTION_EASING } from './loading-motion';

describe('loadingMotion — спека состояний загрузки (W4-1013)', () => {
  it('паттерны: spinner 420/linear, shimmer 1600/linear, progressBar 240/standard, pulse 1100/ease-in-out', () => {
    expect(LOADING_MOTION_MS.spinner).toBe(DURATION_MS.slow);
    expect(LOADING_MOTION_MS.progressBar).toBe(DURATION_MS.normal);
    expect(LOADING_MOTION_MS.shimmer).toBe(1600);
    expect(LOADING_MOTION_MS.pulse).toBe(1100);
    expect(LOADING_MOTION_EASING.progressBar).toBe(
      `cubic-bezier(${EASING_BEZIER.standard.join(', ')})`,
    );

    expect(loadingMotion('spinner')).toMatchObject({
      durationMs: 420,
      easing: 'linear',
      reduced: false,
      iterations: 'infinite',
    });
    expect(loadingMotion('shimmer')).toMatchObject({
      durationMs: 1600,
      easing: 'linear',
      iterations: 'infinite',
    });
    expect(loadingMotion('progressBar')).toMatchObject({
      durationMs: 240,
      easing: `cubic-bezier(${EASING_BEZIER.standard.join(', ')})`,
      iterations: 'once',
    });
    expect(loadingMotion('pulse')).toMatchObject({
      durationMs: 1100,
      easing: 'ease-in-out',
      iterations: 'infinite',
    });
  });

  it('reduced-motion и snapshot → 0ms (статичный индикатор без кадров)', () => {
    for (const verb of ['spinner', 'shimmer', 'progressBar', 'pulse'] as const) {
      expect(loadingMotion(verb, { reducedMotion: true }).durationMs).toBe(0);
      expect(loadingMotion(verb, { reducedMotion: true }).reduced).toBe(true);
      expect(loadingMotion(verb, { snapshot: true }).durationMs).toBe(0);
    }
  });
});
