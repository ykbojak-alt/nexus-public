import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SCENARIO_MOTION_EASING,
  SCENARIO_MOTION_MS,
  scenarioMotion,
} from './scenario-motion';

const css = readFileSync(new URL('./scenario-motion.module.css', import.meta.url), 'utf8');

describe('scenarioMotion — S5/S6 confirmation and review', () => {
  it('sets entrance and outcome timing for confirmation, diff and checkpoint', () => {
    expect(SCENARIO_MOTION_MS).toEqual({
      confirmation: 180,
      diffRow: 240,
      checkpoint: 420,
      rewind: 240,
    });
    expect(scenarioMotion('confirmation').easing).toBe(SCENARIO_MOTION_EASING.enter);
    expect(scenarioMotion('checkpoint').durationMs).toBe(420);
  });

  it('staggers changed rows in a bounded order and does not stagger other surfaces', () => {
    expect(scenarioMotion('diffRow', 'enter', { index: 3 }).delayMs).toBe(120);
    expect(scenarioMotion('diffRow', 'enter', { index: 200 }).delayMs).toBe(200);
    expect(scenarioMotion('rewind', 'enter', { index: 3 }).delayMs).toBe(0);
  });

  it('reduced-motion and snapshots are immediate', () => {
    for (const verb of ['confirmation', 'diffRow', 'checkpoint', 'rewind'] as const) {
      expect(scenarioMotion(verb, 'standard', { reducedMotion: true })).toMatchObject({
        durationMs: 0,
        delayMs: 0,
        reduced: true,
      });
      expect(scenarioMotion(verb, 'enter', { snapshot: true }).durationMs).toBe(0);
    }
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('keeps the review entrance on the shared 240ms tempo with a reachable end-state', () => {
    expect(css).toContain('animation: reviewIn 240ms cubic-bezier(0, 0, 0.2, 1) both');
    expect(css).toContain('animation: diffRowIn 240ms cubic-bezier(0, 0, 0.2, 1) both');
    expect(css).toContain('to { opacity: 1; transform: none; }');
  });

  it('uses host status for outcome visuals and leaves unavailable checkpoints static', () => {
    expect(css).toContain(".confirmation[data-confirm-state='timeout']::after");
    expect(css).toContain(".checkpoint[data-checkpoint-state='restoring']::after");
    expect(css).toContain(".checkpoint[data-checkpoint-state='unavailable']");
    expect(css).toContain("[data-testid='diff-review-card'] > ul > li");
  });
});
