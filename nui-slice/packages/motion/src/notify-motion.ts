import { DURATION_MS, EASING_BEZIER, type MotionEasing } from './presets';

/**
 * Notification/toast motion (W4-1010): transient surfaces — toasts,
 * notification popovers, approval badges.
 *
 * - `notifyIn` — surface mounts: opacity + small translate along
 *   `--notify-dy` (toasts rise 6px into the stack, the bell popover drops
 *   -6px). For stack items the keyframe also expands the box
 *   (grid-template-rows 0fr→1fr) so siblings shift smoothly on arrival.
 * - `notifyOut` — surface self-dismisses: opacity + slight translate.
 *   `notifyMotion('notifyOut').durationMs` is the JS keep-alive contract:
 *   the owner keeps the node mounted (inert, `data-exit`) for that long,
 *   then removes it. Reduced-motion resolves 0 → instant removal.
 * - `notifyStack` — stack reflow on exit: the outgoing item's box
 *   collapses (grid-template-rows + margin eating its flex gap) so the
 *   items above it glide down instead of jumping at unmount. Runs on the
 *   exiting node simultaneously with notifyOut.
 *
 * Reduced-motion/snapshot → 0ms on every verb: surfaces appear/disappear
 * instantly, no intermediate frames.
 */
export type NotifyMotionVerb =
  | 'notifyIn'
  | 'notifyOut'
  | 'notifyStack';

export const NOTIFY_MOTION_MS: Record<NotifyMotionVerb, number> = {
  notifyIn: DURATION_MS.normal,
  notifyOut: DURATION_MS.fast,
  notifyStack: DURATION_MS.normal,
};

export const NOTIFY_MOTION_EASING: Record<NotifyMotionVerb, MotionEasing> = {
  notifyIn: 'enter',
  notifyOut: 'exit',
  notifyStack: 'standard',
};

export interface NotifyMotionSpec {
  durationMs: number;
  delayMs: number;
  easing: string;
  reduced: boolean;
  iterations: 'once' | 'infinite';
}

export function notifyMotion(
  verb: NotifyMotionVerb,
  opts: { reducedMotion?: boolean; snapshot?: boolean } = {},
): NotifyMotionSpec {
  const reduced = opts.reducedMotion === true || opts.snapshot === true;
  const bezier = EASING_BEZIER[NOTIFY_MOTION_EASING[verb]];
  return {
    durationMs: reduced ? 0 : NOTIFY_MOTION_MS[verb],
    delayMs: 0,
    easing: `cubic-bezier(${bezier.join(', ')})`,
    reduced,
    iterations: 'once',
  };
}
