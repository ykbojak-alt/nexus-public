import { DURATION_MS, EASING_BEZIER, type MotionEasing } from './presets';

/**
 * Right-dock mode transitions (W4-1008): hidden/slim/push/fullscreen.
 *
 * - `slideIn` — panel mounts from hidden: opacity + translateX toward the
 *   docked edge (side-aware, 20px — subtle, not a page slide).
 * - `slideOut` — panel exits to hidden through a keep-alive window of
 *   `durationMs`: the parent keeps the panel mounted (inert) for that long,
 *   then unmounts. `dockMotion('slideOut').durationMs` is the JS contract
 *   for the keep-alive timer; reduced-motion resolves 0 → instant unmount.
 * - `slimCollapse` — push↔slim on the SAME element (data-mode flip, no
 *   remount): `width` transition 48px ↔ N px. Pointer drag-resize is exempt
 *   via `body[data-bar-resizing]` (live drag must stay 1:1).
 * - `fullscreenExpand` — push→fullscreen data-mode flip: opacity + slight
 *   scale settle; position:fixed itself does not animate.
 */
export type DockMotionVerb =
  | 'slideIn'
  | 'slideOut'
  | 'slimCollapse'
  | 'fullscreenExpand';

export const DOCK_MOTION_MS: Record<DockMotionVerb, number> = {
  slideIn: DURATION_MS.normal,
  slideOut: DURATION_MS.fast,
  slimCollapse: DURATION_MS.normal,
  fullscreenExpand: DURATION_MS.normal,
};

export const DOCK_MOTION_EASING: Record<DockMotionVerb, MotionEasing> = {
  slideIn: 'enter',
  slideOut: 'exit',
  slimCollapse: 'standard',
  fullscreenExpand: 'enter',
};

export interface DockMotionSpec {
  durationMs: number;
  delayMs: number;
  easing: string;
  reduced: boolean;
  iterations: 'once' | 'infinite';
}

export function dockMotion(
  verb: DockMotionVerb,
  opts: { reducedMotion?: boolean; snapshot?: boolean } = {},
): DockMotionSpec {
  const reduced = opts.reducedMotion === true || opts.snapshot === true;
  const bezier = EASING_BEZIER[DOCK_MOTION_EASING[verb]];
  return {
    durationMs: reduced ? 0 : DOCK_MOTION_MS[verb],
    delayMs: 0,
    easing: `cubic-bezier(${bezier.join(', ')})`,
    reduced,
    iterations: 'once',
  };
}
