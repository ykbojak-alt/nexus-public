/**
 * Insufficient-data rules (spec §13): never draw a decorative fake
 * curve — when data cannot support the visualization, the chart shows
 * an honest insufficient-data state instead.
 */

import type { NexusSeries, NexusSeriesPoint, VizState } from './types';

/** Minimum points for a continuous series visualization (line/area). */
export const MIN_SERIES_POINTS = 2;

/** Minimum points for a single-value chart that shows anything at all. */
export const MIN_DISCRETE_POINTS = 1;

function usablePoints(points: readonly NexusSeriesPoint[]): number {
  return points.filter((p) => Number.isFinite(p.y)).length;
}

/**
 * Does any series carry enough usable points for a continuous chart?
 * y values that are NaN/±Infinity do not count.
 */
export function hasSufficientData(
  series: readonly NexusSeries[],
  min: number = MIN_SERIES_POINTS,
): boolean {
  return series.some((s) => usablePoints(s.points) >= min);
}

/** Resolve the honest state for a chart given its loading/error/data flags. */
export function resolveVizState(opts: {
  loading?: boolean;
  error?: boolean;
  series: readonly NexusSeries[];
  min?: number;
}): VizState {
  if (opts.loading) return 'loading';
  if (opts.error) return 'error';
  if (opts.series.length === 0) return 'empty';
  return hasSufficientData(opts.series, opts.min) ? 'ready' : 'insufficient';
}
