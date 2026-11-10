import { DURATION_MS, EASING_BEZIER, type MotionEasing } from './presets';
import { FEED_MOTION_MS } from './feed-motion';

export type CompactionMotionVerb =
  | 'compactOut'
  | 'compactIn'
  | 'rowStagger'
  | 'badgePop'
  | 'contextPulse';

export const COMPACTION_MOTION_MS: Record<CompactionMotionVerb, number> = {
  compactOut: DURATION_MS.normal,
  compactIn: DURATION_MS.normal,
  rowStagger: 0,
  badgePop: DURATION_MS.fast,
  contextPulse: FEED_MOTION_MS.wait,
};

export const COMPACTION_MOTION_EASING: Record<CompactionMotionVerb, MotionEasing> = {
  compactOut: 'exit',
  compactIn: 'enter',
  rowStagger: 'standard',
  badgePop: 'pop',
  contextPulse: 'dissolve',
};

export interface CompactionMotionSpec {
  durationMs: number;
  delayMs: number;
  easing: string;
  reduced: boolean;
  iterations: 'once' | 'infinite';
}

export function compactionMotion(
  verb: CompactionMotionVerb,
  opts: { reducedMotion?: boolean; snapshot?: boolean; batch?: boolean; index?: number } = {},
): CompactionMotionSpec {
  const reduced = opts.reducedMotion === true || opts.snapshot === true;
  const staggerIndex = Math.max(0, Math.trunc(opts.index ?? 0));
  const delayMs = !reduced && verb === 'rowStagger' && opts.batch
    ? Math.min(5, staggerIndex) * 40
    : 0;
  const bezier = EASING_BEZIER[COMPACTION_MOTION_EASING[verb]];
  return {
    durationMs: reduced ? 0 : COMPACTION_MOTION_MS[verb],
    delayMs,
    easing: `cubic-bezier(${bezier.join(', ')})`,
    reduced,
    iterations: verb === 'contextPulse' && !reduced ? 'infinite' : 'once',
  };
}
