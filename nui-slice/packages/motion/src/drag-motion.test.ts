import { describe, expect, it } from 'vitest';
import { DURATION_MS, EASING_BEZIER } from './presets';
import { dragMotion, DRAG_MOTION_MS, DRAG_MOTION_EASING } from './drag-motion';

const bezier = (name: keyof typeof EASING_BEZIER) =>
  `cubic-bezier(${EASING_BEZIER[name].join(', ')})`;

describe('dragMotion — спека перетаскивания (W4-1011)', () => {
  it('глаголы на UI-токенах: dragLift 80/enter, dragDrop 140/exit, dragSnap 240/standard', () => {
    expect(DRAG_MOTION_MS.dragLift).toBe(DURATION_MS.instant);
    expect(DRAG_MOTION_MS.dragDrop).toBe(DURATION_MS.fast);
    expect(DRAG_MOTION_MS.dragSnap).toBe(DURATION_MS.normal);
    expect(DRAG_MOTION_EASING.dragLift).toBe('enter');
    expect(DRAG_MOTION_EASING.dragDrop).toBe('exit');
    expect(DRAG_MOTION_EASING.dragSnap).toBe('standard');

    expect(dragMotion('dragLift')).toMatchObject({
      durationMs: 80,
      easing: bezier('enter'),
      reduced: false,
      iterations: 'once',
    });
    expect(dragMotion('dragDrop')).toMatchObject({
      durationMs: 140,
      easing: bezier('exit'),
    });
    expect(dragMotion('dragSnap')).toMatchObject({
      durationMs: 240,
      easing: bezier('standard'),
    });
  });

  it('reduced-motion и snapshot схлопывают всё в 0ms (без FLIP/lift-кадров)', () => {
    for (const verb of ['dragLift', 'dragDrop', 'dragSnap'] as const) {
      expect(dragMotion(verb, { reducedMotion: true }).durationMs).toBe(0);
      expect(dragMotion(verb, { reducedMotion: true }).reduced).toBe(true);
      expect(dragMotion(verb, { snapshot: true }).durationMs).toBe(0);
    }
  });
});
