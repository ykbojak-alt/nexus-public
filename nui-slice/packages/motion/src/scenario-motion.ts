/** Motion contract for the confirmation and change-review steps S5–S6. */

export type ScenarioMotionVerb = 'confirmation' | 'diffRow' | 'checkpoint' | 'rewind';
export type ScenarioMotionEasing = 'enter' | 'exit' | 'standard';

export const SCENARIO_MOTION_MS: Record<ScenarioMotionVerb, number> = {
  confirmation: 180,
  diffRow: 240,
  checkpoint: 420,
  rewind: 240,
};

export const SCENARIO_MOTION_EASING: Record<ScenarioMotionEasing, string> = {
  enter: 'cubic-bezier(0, 0, 0.2, 1)',
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
};

export interface ScenarioMotionSpec {
  durationMs: number;
  delayMs: number;
  easing: string;
  reduced: boolean;
}

export function scenarioMotion(
  verb: ScenarioMotionVerb,
  easing: ScenarioMotionEasing = 'enter',
  opts: { reducedMotion?: boolean; snapshot?: boolean; index?: number } = {},
): ScenarioMotionSpec {
  const reduced = opts.reducedMotion === true || opts.snapshot === true;
  return {
    durationMs: reduced ? 0 : SCENARIO_MOTION_MS[verb],
    delayMs: reduced || verb !== 'diffRow' ? 0 : Math.max(0, Math.min(5, opts.index ?? 0)) * 40,
    easing: SCENARIO_MOTION_EASING[easing],
    reduced,
  };
}

export type ConfirmationMotionState =
  | 'awaiting' | 'deferred' | 'allow' | 'deny'
  | 'allowed' | 'denied' | 'timeout';

export type CheckpointMotionState = 'ready' | 'restoring' | 'restored' | 'unavailable';
