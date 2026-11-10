import { describe, expect, it } from 'vitest';
import { DURATION_MS, EASING_BEZIER } from './presets';
import { notifyMotion, NOTIFY_MOTION_MS, NOTIFY_MOTION_EASING } from './notify-motion';

const bezier = (name: keyof typeof EASING_BEZIER) =>
  `cubic-bezier(${EASING_BEZIER[name].join(', ')})`;

describe('notifyMotion — спека уведомлений (W4-1010)', () => {
  it('глаголы на UI-токенах: notifyIn 240/enter, notifyOut 140/exit, notifyStack 240/standard', () => {
    expect(NOTIFY_MOTION_MS.notifyIn).toBe(DURATION_MS.normal);
    expect(NOTIFY_MOTION_MS.notifyOut).toBe(DURATION_MS.fast);
    expect(NOTIFY_MOTION_MS.notifyStack).toBe(DURATION_MS.normal);
    expect(NOTIFY_MOTION_EASING.notifyIn).toBe('enter');
    expect(NOTIFY_MOTION_EASING.notifyOut).toBe('exit');
    expect(NOTIFY_MOTION_EASING.notifyStack).toBe('standard');

    expect(notifyMotion('notifyIn')).toMatchObject({
      durationMs: 240,
      easing: bezier('enter'),
      reduced: false,
      iterations: 'once',
    });
    expect(notifyMotion('notifyOut')).toMatchObject({
      durationMs: 140,
      easing: bezier('exit'),
    });
    expect(notifyMotion('notifyStack')).toMatchObject({
      durationMs: 240,
      easing: bezier('standard'),
    });
  });

  it('reduced-motion и snapshot схлопывают всё в 0ms (мгновенный enter/exit)', () => {
    for (const verb of ['notifyIn', 'notifyOut', 'notifyStack'] as const) {
      expect(notifyMotion(verb, { reducedMotion: true }).durationMs).toBe(0);
      expect(notifyMotion(verb, { reducedMotion: true }).reduced).toBe(true);
      expect(notifyMotion(verb, { snapshot: true }).durationMs).toBe(0);
    }
  });
});
