import { DURATION_MS, EASING_BEZIER, type MotionEasing } from './presets';

/**
 * Drag motion (W4-1011): pointer-drag of bars/dock/bubbles
 * (`beginBarMove`, chat-feed `beginMove`).
 *
 * - `dragLift` — pickup after the 4px threshold: scale + deeper shadow on
 *   the held surface (`[data-drag-lift]` attribute set by the drag helper).
 *   Fast enter — the pickup affordance must feel immediate.
 * - `dragDrop` — release: lift affordance settles back (attr removed).
 * - `dragSnap` — positional snap: dock-return FLIP — the surface is
 *   restored to its docked slot while a `translate()` keeps it visually at
 *   the drop point, then animates to none over `durationMs`. The JS side
 *   resolves `dragMotion('dragSnap', { reducedMotion })` → 0 skips the
 *   FLIP entirely (instant return).
 *
 * Live pointer tracking itself is never animated (1:1 with the cursor);
 * `body[data-bar-floating-drag]` / `body[data-message-drag]` mark the
 * active gesture for consumers that need to exempt transitions.
 *
 * Reduced-motion/snapshot → 0ms on every verb.
 */
export type DragMotionVerb =
  | 'dragLift'
  | 'dragDrop'
  | 'dragSnap';

export const DRAG_MOTION_MS: Record<DragMotionVerb, number> = {
  dragLift: DURATION_MS.instant,
  dragDrop: DURATION_MS.fast,
  dragSnap: DURATION_MS.normal,
};

export const DRAG_MOTION_EASING: Record<DragMotionVerb, MotionEasing> = {
  dragLift: 'enter',
  dragDrop: 'exit',
  dragSnap: 'standard',
};

export interface DragMotionSpec {
  durationMs: number;
  delayMs: number;
  easing: string;
  reduced: boolean;
  iterations: 'once' | 'infinite';
}

export function dragMotion(
  verb: DragMotionVerb,
  opts: { reducedMotion?: boolean; snapshot?: boolean } = {},
): DragMotionSpec {
  const reduced = opts.reducedMotion === true || opts.snapshot === true;
  const bezier = EASING_BEZIER[DRAG_MOTION_EASING[verb]];
  return {
    durationMs: reduced ? 0 : DRAG_MOTION_MS[verb],
    delayMs: 0,
    easing: `cubic-bezier(${bezier.join(', ')})`,
    reduced,
    iterations: 'once',
  };
}
