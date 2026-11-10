/**
 * Nexus chart data contracts — spec §13, owned by Window 4 (Task 12).
 *
 * Contracts separate data computation from rendering: D3 computes
 * scales/layout/geometry, React/visx/SVG render, tokens own style.
 * Components never accept arbitrary color props — tone roles only.
 */

/** Live-data freshness for any visualization that streams (spec §13). */
export type DataFreshness = 'live' | 'stale' | 'syncing' | 'disconnected';

/**
 * Shared component state union used by charts/graphs/patterns (plan §C-14).
 * 'insufficient' = data arrived but cannot support the visualization
 * (spec §13 honest-state rule — never a decorative fake curve).
 */
export type VizState = 'loading' | 'ready' | 'empty' | 'error' | 'stale' | 'insufficient';

/**
 * Semantic color role for a series or emphasis element.
 * Maps to semantic tokens — never a raw hex value (spec §13).
 */
export type ChartTone =
  | 'primary'    // accent.primary — main series / emphasis
  | 'secondary'  // accent.metal — quiet secondary series
  | 'energy'     // accent.energy — active/live series
  | 'violet'     // accent.violet — analytical/insight series
  | 'positive'   // chart.positive → state.success
  | 'negative'   // chart.negative → state.error
  | 'threshold'  // chart.threshold → state.warning (lines/bands)
  | 'neutral';   // chart.axis — quiet reference elements

export interface NexusSeriesPoint {
  /** Numeric domain for time/scatter, string for banded categories. */
  x: number | string | Date;
  y: number;
}

export interface NexusSeries {
  id: string;
  label: string;
  points: NexusSeriesPoint[];
  /** Optional semantic tone; absent → auto-assign from chart.series palette. */
  tone?: ChartTone;
}

/**
 * Graph node/edge contracts live in `@nexus/patterns/graphs` (their
 * canonical home). Dependency direction: patterns → ui — graphs import
 * VizState/DataFreshness FROM this module; ui never imports patterns.
 * Consumers (mock-data, product, apps) also import from `@nexus/ui` —
 * the direction is accepted and locked in window4-contracts.md (NQ-006).
 */

/** Accessible text alternative — required for every chart (spec §14). */
export interface ChartA11y {
  /** Short title exposed via role="img" + aria-label or <title>. */
  title: string;
  /** Optional longer summary of the data trend for screen readers. */
  description?: string;
}
