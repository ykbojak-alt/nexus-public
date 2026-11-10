/**
 * Shared x-normalization for continuous charts (line/area).
 * numeric/Date x → value; string x → categorical index position.
 */

export function xValue(p: { x: number | string | Date }): number {
  if (p.x instanceof Date) return p.x.getTime();
  if (typeof p.x === 'string') return Number.NaN;
  return p.x;
}

export function isCategoricalX(series: readonly { points: readonly { x: number | string | Date }[] }[]): boolean {
  return series.some((s) => s.points.some((p) => typeof p.x === 'string'));
}

/** All x positions in scale domain order (index positions for categorical). */
export function xPositions(
  series: readonly { points: readonly { x: number | string | Date }[] }[],
  categorical: boolean,
): number[] {
  const xs: number[] = [];
  for (const s of series) {
    s.points.forEach((p, i) => xs.push(categorical ? i : xValue(p)));
  }
  return xs.filter(Number.isFinite);
}

export function formatTick(v: number): string {
  const abs = Math.abs(v);
  if (abs !== 0 && (abs >= 1_000_000 || abs < 0.01)) return v.toExponential(1);
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
}
