/**
 * Visual quality tiers — spec §10: 'high | balanced | reduced'.
 * 'reduced' (or missing WebGL) must render the static 2D/DOM fallback,
 * never a broken canvas. DPR is capped; inactive scenes suspend.
 */

export type VisualQuality = 'high' | 'balanced' | 'reduced';

export interface QualityInput {
  /** Requested tier from props; default 'balanced'. */
  requested?: VisualQuality;
  /** Result of WebGL support detection. */
  webglAvailable?: boolean;
  /** prefers-reduced-motion: spatial motion freezes to a static frame
   *  (spec §10 — tier stays, animation stops). */
  reducedMotion?: boolean;
  /** Device pixel ratio cap from the perf budget (perf-budgets.json). */
  dprCap?: number;
}

export interface ResolvedQuality {
  /** Effective tier — never higher than requested. */
  quality: VisualQuality;
  /** True when the caller must render the 2D/DOM fallback. */
  useFallback: boolean;
  /** True when orbit/camera/particle motion must freeze (reduced-motion). */
  frozen: boolean;
  /** Effective DPR cap for the renderer (≤2 by default). */
  dprCap: number;
}

/** Resolve effective quality — degrades tier, never upgrades. */
export function resolveQuality(input: QualityInput = {}): ResolvedQuality {
  const requested = input.requested ?? 'balanced';
  const webgl = input.webglAvailable ?? true;
  const frozen = input.reducedMotion === true;

  if (!webgl || requested === 'reduced') {
    return { quality: 'reduced', useFallback: true, frozen: true, dprCap: 1 };
  }
  return {
    quality: requested,
    useFallback: false,
    frozen,
    dprCap: Math.min(input.dprCap ?? 2, 2),
  };
}
