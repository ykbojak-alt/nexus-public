import { describe, expect, it } from 'vitest';
import { CHART_CHROME, seriesColor, seriesVar, toneVar } from './palette';
import { hasSufficientData, resolveVizState } from './sufficiency';
import type { ChartTone, NexusSeries } from './types';

describe('tone → token mapping (spec §13 — no arbitrary colors)', () => {
  it.each([
    'primary', 'secondary', 'energy', 'violet',
    'positive', 'negative', 'threshold', 'neutral',
  ] as ChartTone[])('maps %s to a --nexus-* variable', (tone: ChartTone) => {
    expect(toneVar(tone)).toMatch(/^var\(--nexus-/);
  });

  it('auto palette produces ordered series slots and wraps at 8', () => {
    expect(seriesVar(0)).toBe('var(--nexus-chart-series-1)');
    expect(seriesVar(7)).toBe('var(--nexus-chart-series-8)');
    expect(seriesVar(8)).toBe('var(--nexus-chart-series-1)');
  });

  it('explicit tone wins over auto palette', () => {
    expect(seriesColor('energy', 0)).toBe('var(--nexus-accent-energy)');
    expect(seriesColor(undefined, 0)).toBe('var(--nexus-chart-series-1)');
  });

  it('chrome roles are token vars, not literals', () => {
    for (const v of Object.values(CHART_CHROME)) {
      expect(v).toMatch(/^var\(--nexus-/);
    }
  });
});

describe('insufficient data (spec §13 — honest states)', () => {
  const pt = (y: number) => ({ x: 0, y });
  const s = (ys: number[]): NexusSeries => ({ id: 'a', label: 'A', points: ys.map(pt) });

  it('requires ≥2 usable points for a continuous series', () => {
    expect(hasSufficientData([s([1])])).toBe(false);
    expect(hasSufficientData([s([1, 2])])).toBe(true);
  });

  it('ignores NaN/Infinity when counting usable points', () => {
    expect(hasSufficientData([s([NaN, Infinity, 1])])).toBe(false);
    expect(hasSufficientData([s([NaN, 1, 2])])).toBe(true);
  });

  it('resolves loading/error/empty before data checks', () => {
    expect(resolveVizState({ loading: true, series: [] })).toBe('loading');
    expect(resolveVizState({ error: true, series: [s([1, 2])] })).toBe('error');
    expect(resolveVizState({ series: [] })).toBe('empty');
  });

  it('marks insufficient series instead of faking a curve', () => {
    expect(resolveVizState({ series: [s([1])] })).toBe('insufficient');
    expect(resolveVizState({ series: [s([1, 2])] })).toBe('ready');
  });
});
