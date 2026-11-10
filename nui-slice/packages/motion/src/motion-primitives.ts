/**
 * Motion primitives — week 2 D6/D7: the consumable half of the preset
 * contract. `presets.ts`/`signatures.ts` declare *what* a motion is;
 * these helpers return *applicable* CSS values so components never
 * write raw durations/easings/properties themselves.
 *
 * snapshot mode (D7): `snapshot: true` yields a fully deterministic
 * style — duration 0ms, no transform-space properties — so visual
 * tests capture the settled end-state regardless of the runner clock.
 */

import { DURATION_MS, EASING_BEZIER, MOTION_PRESETS, type MotionEasing, type MotionPresetName } from './presets';
import { AGENT_SIGNATURES, type AgentMotionSignatureId } from './signatures';
import { resolveMotion } from './reduced-motion';

/** Animation verb → CSS transition property it animates. */
const VERB_PROPERTY: Record<string, string> = {
  fade: 'opacity',
  scale: 'transform',
  slide: 'transform',
  orbit: 'transform',
  camera: 'transform',
  pulse: 'opacity',
  breathe: 'opacity',
  converge: 'transform',
  glow: 'opacity',
};

export interface MotionStyle {
  /** CSS `transition-duration` — `'0ms'` in snapshot mode. */
  transitionDuration: string;
  /** CSS `transition-timing-function` — preset bezier. */
  transitionTimingFunction: string;
  /** CSS `transition-property` — properties for the surviving verbs. */
  transitionProperty: string;
  /** Verbs that survived reduction/snapshot (docs/stories/debug). */
  verbs: readonly string[];
}

export interface MotionStyleOpts {
  reducedMotion?: boolean;
  /** Screenshot mode: fully deterministic — 0ms, opacity-only. */
  snapshot?: boolean;
}

function timing(name: MotionEasing): string {
  const b = EASING_BEZIER[name];
  return `cubic-bezier(${b.join(', ')})`;
}

function propertiesFor(verbs: readonly string[], snapshot: boolean): string {
  const props = new Set(
    verbs
      .map((v) => VERB_PROPERTY[v])
      .filter((p): p is string => p != null && (!snapshot || p === 'opacity')),
  );
  return props.size > 0 ? [...props].join(', ') : 'opacity';
}

/**
 * Resolve a named preset into applicable CSS transition values.
 * reduced-motion strips spatial verbs first; snapshot additionally
 * zeroes the duration and keeps opacity only.
 */
export function motionStyle(preset: MotionPresetName, opts: MotionStyleOpts = {}): MotionStyle {
  const resolved = resolveMotion(preset, { reducedMotion: opts.reducedMotion });
  const snapshot = opts.snapshot === true;
  return {
    transitionDuration: `${snapshot ? 0 : resolved.durationMs}ms`,
    transitionTimingFunction: timing(resolved.reduced ? 'standard' : MOTION_PRESETS[preset].easing),
    transitionProperty: propertiesFor(resolved.verbs, snapshot),
    verbs: resolved.verbs,
  };
}

/**
 * Agent motion signature → applicable ambient style (D7 signatures).
 * Same reduction/snapshot rules as presets; unknown ids fall back to
 * the nexus signature — a signature is always emitted.
 */
export function signatureStyle(agentId: string, opts: MotionStyleOpts = {}): MotionStyle {
  const sig = AGENT_SIGNATURES[(agentId as AgentMotionSignatureId)] ?? AGENT_SIGNATURES.nexus;
  const snapshot = opts.snapshot === true;
  const verbs = opts.reducedMotion
    ? sig.verbs.filter((v) => VERB_PROPERTY[v] === 'opacity')
    : sig.verbs;
  return {
    transitionDuration: `${snapshot ? 0 : DURATION_MS[sig.tempo]}ms`,
    transitionTimingFunction: timing(sig.easing),
    transitionProperty: propertiesFor(verbs, snapshot),
    verbs,
  };
}
