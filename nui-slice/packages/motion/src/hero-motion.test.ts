import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HERO_MOTION_EASING, HERO_MOTION_MS, heroMotion } from './hero-motion';

const stylesheet = readFileSync(new URL('./hero-motion.module.css', import.meta.url), 'utf8');

describe('NEU hero & KPI motion contract (wave XVII)', () => {
  it('entry verbs run once; only breathe loops, and slowly (≥8s)', () => {
    for (const verb of ['heroIn', 'kpiIn', 'kpiValue'] as const) {
      expect(heroMotion(verb).iterations).toBe('once');
    }
    const breathe = heroMotion('breathe');
    expect(breathe.iterations).toBe('infinite');
    expect(breathe.durationMs).toBeGreaterThanOrEqual(8000);
    expect(breathe.properties).toEqual(['opacity']);
    expect(HERO_MOTION_MS.heroIn).toBe(640);
    expect(HERO_MOTION_MS.kpiIn).toBe(420);
    expect(HERO_MOTION_MS.kpiValue).toBe(700);
    expect(HERO_MOTION_MS.kpiStaggerMs).toBe(70);
    expect(HERO_MOTION_EASING).toContain('cubic-bezier');
  });

  it('composited properties only — no layout animation', () => {
    for (const verb of ['heroIn', 'breathe', 'kpiIn', 'kpiValue'] as const) {
      for (const p of heroMotion(verb).properties) {
        expect(['opacity', 'transform']).toContain(p);
      }
    }
    // в CSS-анимациях только transform/opacity внутри keyframes
    const frames = stylesheet.match(/@keyframes[\s\S]*?}/g) ?? [];
    for (const block of stylesheet.matchAll(/@keyframes[^{]+\{([\s\S]*?)\}\s*\}/g)) {
      expect(block[0]).not.toMatch(/width|height|left|top|margin|padding/);
    }
    expect(frames.length).toBe(4);
  });

  it('everything stops under prefers-reduced-motion, end state visible', () => {
    expect(stylesheet).toContain('@media (prefers-reduced-motion: reduce)');
    const rm = stylesheet.slice(stylesheet.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect((rm.match(/animation: none/g) ?? []).length).toBeGreaterThanOrEqual(2);
    for (const verb of ['heroIn', 'breathe', 'kpiIn', 'kpiValue'] as const) {
      expect(heroMotion(verb, { reducedMotion: true }).durationMs).toBe(0);
      expect(heroMotion(verb, { snapshot: true }).durationMs).toBe(0);
    }
    // конечная ширина бара под reduce — inline transform компонента,
    // кейфрейм к var() --nexus-kpi-ratio, не к жёсткой 1:
    expect(stylesheet).toContain('scaleX(var(--nexus-kpi-ratio, 1))');
  });
});
