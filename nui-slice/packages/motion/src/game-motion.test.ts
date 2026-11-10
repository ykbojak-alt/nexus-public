import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gameMotion, GAME_MOTION_MS, GAME_MOTION_EASING } from './game-motion';

const generatedCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../tokens/generated/tokens.css'),
  'utf8',
);
function varValue(name: string): string | undefined {
  const m = generatedCss.match(new RegExp(`${name}:\s*([^;]+);`));
  return m?.[1].trim();
}

describe('game-motion family (W4-3 / W2 motion.* tokens)', () => {
  it('returns nominal token durations and named easings', () => {
    expect(gameMotion('deal').durationMs).toBe(660);
    expect(gameMotion('fly', 'launch').easing).toBe('cubic-bezier(0.22, 0.9, 0.35, 1)');
    expect(gameMotion('move', 'arc').durationMs).toBe(340);
    expect(gameMotion('breathe').durationMs).toBe(1800);
  });

  it('covers the observed game literals — no off-scale inventions', () => {
    // durak coverFlyIn 280 → fly; ghostFly 620 → ghost; pairBeat 480 → beat;
    // thinkPulse 1.1s → pulse; handPulse 1.8s → breathe; chess hop 340/420 → move/capture
    expect(GAME_MOTION_MS.fly).toBe(280);
    expect(GAME_MOTION_MS.ghost).toBe(620);
    expect(GAME_MOTION_MS.beat).toBe(480);
    expect(GAME_MOTION_MS.pulse).toBe(1100);
    expect(GAME_MOTION_MS.breathe).toBe(1800);
    expect(GAME_MOTION_MS.move).toBe(340);
    expect(GAME_MOTION_MS.capture).toBe(420);
  });

  it('reduced-motion and snapshot collapse to 0ms — end-state never waits on the clock', () => {
    const r = gameMotion('deal', 'drift', { reducedMotion: true });
    expect(r.durationMs).toBe(0);
    expect(r.reduced).toBe(true);
    expect(gameMotion('attack', 'arc', { snapshot: true }).durationMs).toBe(0);
  });

  it('tempo multiplier scales pacing; jitter stays caller-side', () => {
    expect(gameMotion('deal', 'drift', { tempo: 0.8 }).durationMs).toBe(528);
    expect(gameMotion('deal', 'drift', { tempo: 0 }).durationMs).toBe(0);
  });

  it('every verb/easing registry entry is complete', () => {
    for (const v of Object.keys(GAME_MOTION_MS)) {
      expect(GAME_MOTION_MS[v as keyof typeof GAME_MOTION_MS]).toBeGreaterThan(0);
    }
    for (const e of Object.keys(GAME_MOTION_EASING)) {
      expect(GAME_MOTION_EASING[e as keyof typeof GAME_MOTION_EASING]).toMatch(/^cubic-bezier\(/);
    }
  });
});

// Parity with the generated semantic layer — literals mirror tokens
// exactly (same convention as motion.generated.test.ts for presets).
describe('game-motion ↔ generated tokens (semantic motion.* / easing.*)', () => {
  it('every GAME_MOTION_MS verb equals --nexus-motion-*', () => {
    for (const [key, ms] of Object.entries(GAME_MOTION_MS)) {
      expect(varValue(`--nexus-motion-${key}`), key).toBe(`${ms}ms`);
    }
  });

  it('every GAME_MOTION_EASING equals --nexus-easing-*', () => {
    for (const [key, css] of Object.entries(GAME_MOTION_EASING)) {
      const tuple = css.replace(/^cubic-bezier\(|\)$/g, '').trim();
      expect(varValue(`--nexus-easing-${key}`), key).toBe(tuple);
    }
  });
});
