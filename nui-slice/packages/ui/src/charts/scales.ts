/**
 * Scale helpers — deterministic geometry computed outside JSX
 * (spec §13: layout math is separated from rendering).
 *
 * These cover the linear/band cases v1 charts need with a
 * d3-compatible surface (domain/range/ticks). When `d3-scale` lands in
 * the workspace, this module re-exports real d3 behind the same API —
 * component code does not change.
 */

export interface LinearScale {
  (value: number): number;
  domain(): [number, number];
  range(): [number, number];
  ticks(count?: number): number[];
  /** Nice tick step (1/2/5 × 10^n), d3-style. */
  tickStep(count?: number): number;
}

/** Linear continuous scale — d3-scale compatible subset. */
export function linearScale(domain: [number, number], range: [number, number]): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  const fn = ((v: number) => r0 + ((v - d0) / span) * (r1 - r0)) as LinearScale;

  fn.domain = () => domain;
  fn.range = () => range;
  fn.tickStep = (count = 5) => tickStep(d0, d1, count);
  fn.ticks = (count = 5) => ticks(d0, d1, count);
  return fn;
}

function tickStep(d0: number, d1: number, count: number): number {
  const raw = Math.abs(d1 - d0) / Math.max(1, count);
  if (raw === 0 || !Number.isFinite(raw)) return 1;
  const power = Math.floor(Math.log10(raw));
  const base = 10 ** power;
  const err = raw / base;
  const factor = err >= Math.sqrt(50) ? 10 : err >= Math.sqrt(10) ? 5 : err >= Math.sqrt(2) ? 2 : 1;
  return factor * base;
}

function ticks(d0: number, d1: number, count: number): number[] {
  const step = tickStep(d0, d1, count);
  const start = Math.ceil(d0 / step);
  const stop = Math.floor(d1 / step);
  const out: number[] = [];
  for (let i = start; i <= stop && out.length < 100; i++) out.push(i * step);
  return out;
}

export interface BandScale {
  (value: string): number;
  domain(): string[];
  range(): [number, number];
  bandwidth(): number;
  step(): number;
}

/** Categorical band scale — d3-scale band subset (padding inner only). */
export function bandScale(domain: string[], range: [number, number], padding = 0.2): BandScale {
  const [r0, r1] = range;
  const n = domain.length;
  const width = Math.abs(r1 - r0);
  const step = n > 0 ? width / Math.max(1, n + padding * (n - 1)) : 0;
  const bw = step * (1 - padding);
  const sign = r1 >= r0 ? 1 : -1;
  const index = new Map(domain.map((v, i) => [v, i]));
  const fn = ((v: string) => r0 + sign * step * (index.get(v) ?? 0)) as BandScale;
  fn.domain = () => domain;
  fn.range = () => range;
  fn.bandwidth = () => bw;
  fn.step = () => step;
  return fn;
}

/** Numeric domain extent across series, with zero-baseline option. */
export function seriesExtent(
  series: readonly { points: readonly { y: number }[] }[],
  opts: { includeZero?: boolean } = {},
): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const s of series) {
    for (const p of s.points) {
      if (!Number.isFinite(p.y)) continue;
      if (p.y < min) min = p.y;
      if (p.y > max) max = p.y;
    }
  }
  if (!Number.isFinite(min)) return [0, 1];
  const clampedLow = opts.includeZero && min > 0;
  const clampedHigh = opts.includeZero && max < 0;
  if (clampedLow) min = 0;
  if (clampedHigh) max = 0;
  if (min === max) return [min - 0.5, max + 0.5];
  // 5% headroom keeps strokes off the frame edge — but never pads a
  // clamped zero baseline back below/above zero.
  const pad = (max - min) * 0.05;
  return [clampedLow ? min : min - pad, clampedHigh ? max : max + pad];
}
