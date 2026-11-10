import { describe, expect, it } from 'vitest';
import { bandScale, linearScale, seriesExtent } from './scales';

describe('linearScale (d3-compatible subset)', () => {
  it('maps domain to range linearly', () => {
    const s = linearScale([0, 10], [0, 100]);
    expect(s(0)).toBe(0);
    expect(s(5)).toBe(50);
    expect(s(10)).toBe(100);
  });

  it('supports inverted ranges (svg y-axis)', () => {
    const s = linearScale([0, 10], [100, 0]);
    expect(s(0)).toBe(100);
    expect(s(10)).toBe(0);
  });

  it('produces d3-style 1/2/5 tick steps inside the domain', () => {
    const s = linearScale([0, 100], [0, 1]);
    const t = s.ticks(5);
    expect(t).toContain(0);
    expect(t).toContain(100);
    expect(t.every((v) => v % 20 === 0)).toBe(true);
    // step 20 for a 100-domain with ~5 ticks
    expect(s.tickStep(5)).toBe(20);
  });

  it('handles degenerate (empty-span) domains', () => {
    const s = linearScale([5, 5], [0, 10]);
    expect(s(5)).toBe(0);
    // single-value domain → single tick at the value (d3 behaviour)
    expect(s.ticks(5)).toEqual([5]);
  });
});

describe('bandScale', () => {
  it('places categories in order with bandwidth', () => {
    const s = bandScale(['a', 'b', 'c'], [0, 300]);
    expect(s('a')).toBe(0);
    expect(s('b')).toBeGreaterThan(s('a'));
    expect(s('c')).toBeGreaterThan(s('b'));
    expect(s.bandwidth()).toBeGreaterThan(0);
    expect(s.bandwidth()).toBeLessThan(s.step());
  });
});

describe('seriesExtent', () => {
  it('computes min/max across series with headroom', () => {
    const [min, max] = seriesExtent([{ points: [{ y: 10 }, { y: 20 }] }], { includeZero: false });
    expect(min).toBeLessThan(10);
    expect(max).toBeGreaterThan(20);
  });

  it('includes zero baseline when requested', () => {
    const [min] = seriesExtent([{ points: [{ y: 10 }, { y: 20 }] }], { includeZero: true });
    expect(min).toBe(0);
  });

  it('ignores non-finite values and survives empty input', () => {
    expect(seriesExtent([{ points: [{ y: NaN }, { y: Infinity }] }])).toEqual([0, 1]);
  });
});
