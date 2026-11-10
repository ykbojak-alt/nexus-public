/**
 * Tone → token mapping for charts (spec §13 + semantic/chart.tokens.json).
 *
 * Every returned value is a CSS custom property emitted by the token
 * pipeline (`--nexus-*`). Components resolve tone roles to these vars;
 * arbitrary color props are forbidden by contract.
 */

import type { ChartTone } from './types';

/** Ordered multi-series palette size (semantic/chart.tokens.json: series.1..8). */
export const SERIES_PALETTE_SIZE = 8;

/** Tone → generated CSS var (exported for the generated-tokens test). */
export const TONE_VARS: Record<ChartTone, string> = {
  primary: 'var(--nexus-accent-primary)',
  secondary: 'var(--nexus-accent-metal)',
  energy: 'var(--nexus-accent-energy)',
  violet: 'var(--nexus-accent-violet)',
  positive: 'var(--nexus-chart-positive)',
  negative: 'var(--nexus-chart-negative)',
  threshold: 'var(--nexus-chart-threshold)',
  neutral: 'var(--nexus-chart-axis)',
};

/** CSS var reference for a semantic tone. */
export function toneVar(tone: ChartTone): string {
  return TONE_VARS[tone];
}

/**
 * Auto palette slot for a series index — deterministic, wraps after 8.
 * Index 0 → chart.series.1 (first slot), matching the ordered palette.
 */
export function seriesVar(index: number): string {
  const slot = (Math.abs(Math.trunc(index)) % SERIES_PALETTE_SIZE) + 1;
  return `var(--nexus-chart-series-${slot})`;
}

/** Resolve a series color: explicit tone wins, otherwise auto palette. */
export function seriesColor(tone: ChartTone | undefined, index: number): string {
  return tone === undefined ? seriesVar(index) : toneVar(tone);
}

/** Quiet scaffolding tokens shared by all charts. */
export const CHART_CHROME = {
  grid: 'var(--nexus-chart-grid)',
  gridMajor: 'var(--nexus-chart-grid-major)',
  axis: 'var(--nexus-chart-axis)',
  label: 'var(--nexus-chart-label)',
} as const;
