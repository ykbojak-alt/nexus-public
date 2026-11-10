/**
 * Reduced-motion resolution — spec §10/§14: orbit/camera motion
 * collapses to fade/static; functionality is preserved, motion is not
 * the only carrier of information.
 */

import { DURATION_MS, MOTION_PRESETS, type MotionDuration, type MotionPreset, type MotionPresetName } from './presets';

/** Verbs that carry spatial/camera motion — stripped under reduced-motion. */
const SPATIAL_VERBS = new Set(['slide', 'orbit', 'camera', 'pulse', 'breathe', 'converge', 'glow']);

export interface ResolvedMotion {
  preset: MotionPresetName;
  /** Allowed verbs after reduction. */
  verbs: readonly string[];
  /** Resolved duration in ms (preserved — fades keep timing). */
  durationMs: number;
  /** True when spatial verbs were stripped to fade-only. */
  reduced: boolean;
}

/**
 * Resolve a preset for the current motion preference.
 * reducedMotion=true → every preset degrades to fade-only (still animated
 * opacity so state changes remain perceivable without spatial motion).
 */
export function resolveMotion(preset: MotionPresetName, opts: { reducedMotion?: boolean } = {}): ResolvedMotion {
  const p: MotionPreset = MOTION_PRESETS[preset];
  if (!opts.reducedMotion) {
    return { preset, verbs: p.verbs, durationMs: durationMsOf(p.duration), reduced: false };
  }
  const verbs = p.verbs.filter((v) => !SPATIAL_VERBS.has(v));
  return {
    preset,
    verbs: verbs.length > 0 ? verbs : ['fade'],
    durationMs: durationMsOf(p.duration),
    reduced: true,
  };
}

function durationMsOf(d: MotionDuration): number {
  return DURATION_MS[d];
}
