import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assessFeedPerformance, feedMotion, feedWindow,
  FEED_MOTION_MS, FEED_MOTION_EASING, FEED_PERF_BUDGET,
} from './feed-motion';
import { DURATION_MS } from './presets';

const stylesheet = readFileSync(new URL('./feed-motion.module.css', import.meta.url), 'utf8');

describe('feedMotion — спека ленты агента (волна XIV W4)', () => {
  it('все глаголы заданы, длительности на токен-шкале', () => {
    for (const v of ['feedIn', 'stream', 'collapse', 'checkpoint', 'mode', 'wait', 'runBar'] as const) {
      expect(FEED_MOTION_MS[v]).toBeGreaterThan(0);
    }
    expect(FEED_MOTION_MS.feedIn).toBe(240);
    expect(FEED_MOTION_MS.collapse).toBe(DURATION_MS.normal);
    expect(FEED_MOTION_MS.mode).toBe(DURATION_MS.fast);
    expect(FEED_MOTION_MS.collapse).toBe(240);
    expect(FEED_MOTION_MS.mode).toBe(140);
    expect(FEED_MOTION_MS.checkpoint).toBe(420);
  });

  it('reduced-motion и snapshot → 0ms', () => {
    for (const v of ['feedIn', 'stream', 'collapse', 'checkpoint', 'mode', 'wait', 'runBar'] as const) {
      expect(feedMotion(v, 'glide', { reducedMotion: true }).durationMs).toBe(0);
      expect(feedMotion(v, 'launch', { snapshot: true }).reduced).toBe(true);
    }
    const r = feedMotion('mode', 'pop');
    expect(r.easing).toBe(FEED_MOTION_EASING.pop);
    expect(r.durationMs).toBe(DURATION_MS.fast);
  });

  it('uses shared CSS duration tokens for the mode-toggle mirror', () => {
    expect(stylesheet).toContain('transition: transform var(--nexus-duration-fast)');
    expect(stylesheet).toContain('transition: color var(--nexus-duration-fast)');
    expect(stylesheet).toContain('collapse var(--nexus-duration-normal)');
  });

  it('keeps the waiting pulse on compositor-friendly properties', () => {
    expect(stylesheet).toContain('@keyframes waitPulse');
    expect(stylesheet).toContain('transform: scale(2.1)');
    expect(stylesheet).not.toMatch(/@keyframes waitPulse\s*\{[^}]*box-shadow/s);
  });
});

describe('feedWindow — окно виртуализации', () => {
  const base = { rowHeight: 44, viewportHeight: 400, scrollTop: 0 };

  it('короткая лента — окно не активно (все строки рендерятся)', () => {
    const w = feedWindow({ ...base, count: 100 });
    expect(w.active).toBe(false);
    expect(w.start).toBe(0);
    expect(w.end).toBe(99);
    expect(w.topPad + w.bottomPad).toBe(0);
  });

  it('лента 500 событий — активно, видны только строки вьюпорта', () => {
    const w = feedWindow({ ...base, count: 500, scrollTop: 4400 });
    expect(w.active).toBe(true);
    expect(w.end - w.start + 1).toBeLessThan(500);
    expect(w.start).toBeGreaterThan(0);
    // позиция: scrollTop 4400 / 44 = строка 100, минус overscan
    expect(w.start).toBe(100 - FEED_PERF_BUDGET.overscan);
    expect(w.topPad).toBe(w.start * 44);
  });

  it('хвост ленты зажат в count-1, паддинг не уходит в минус', () => {
    const w = feedWindow({ ...base, count: 500, scrollTop: 44 * 500 });
    expect(w.end).toBe(499);
    expect(w.bottomPad).toBe(0);
  });

  it('force=true включает окно и на короткой ленте', () => {
    const w = feedWindow({ ...base, count: 60, scrollTop: 440 }, { force: true });
    expect(w.active).toBe(true);
    expect(w.end).toBeLessThan(59);
  });

  it('дегенеративный ввод — без падения и без выдуманных индексов', () => {
    const w = feedWindow({ count: 0, rowHeight: 44, scrollTop: 0, viewportHeight: 400 }, { force: true });
    expect(w.end).toBe(-1);
    const w2 = feedWindow({ count: 500, rowHeight: 0, scrollTop: 0, viewportHeight: 400 });
    expect(w2.end).toBe(499);
  });
});

describe('assessFeedPerformance — honest browser metrics', () => {
  it('keeps missing metrics null instead of reporting zero', () => {
    expect(assessFeedPerformance(null, null)).toEqual({
      fps: null,
      longTasks: null,
      overBudget: null,
      availability: 'unavailable',
    });
  });

  it('marks unsupported Long Tasks as partial while evaluating observed FPS', () => {
    expect(assessFeedPerformance(60, null)).toEqual({
      fps: 60,
      longTasks: null,
      overBudget: false,
      availability: 'partial',
    });
  });

  it('raises the budget flag only for observed thresholds', () => {
    expect(assessFeedPerformance(54, 0).overBudget).toBe(true);
    expect(assessFeedPerformance(60, 5).overBudget).toBe(true);
    expect(assessFeedPerformance(60, 0).overBudget).toBe(false);
    expect(assessFeedPerformance(null, 0).availability).toBe('partial');
  });
});
