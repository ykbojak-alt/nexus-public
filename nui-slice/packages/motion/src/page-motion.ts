import { DURATION_MS, EASING_BEZIER, type MotionEasing } from './presets';

/**
 * Переходы экранов (W4-1005): единый enter на монтировании корня
 * `[data-screen]` — subtle fade+lift, без view-transitions. `pageExit`
 * задан спекой, но пока не имеет потребителя: App Router снимает старое
 * дерево мгновенно, применять негде — глагол ждёт keep-alive/view-transition
 * хоста, значения уже зафиксированы.
 */
export type PageMotionVerb = 'pageEnter' | 'pageExit';

export const PAGE_MOTION_MS: Record<PageMotionVerb, number> = {
  pageEnter: DURATION_MS.normal,
  pageExit: DURATION_MS.fast,
};

export const PAGE_MOTION_EASING: Record<PageMotionVerb, MotionEasing> = {
  pageEnter: 'enter',
  pageExit: 'exit',
};

export interface PageMotionSpec {
  durationMs: number;
  delayMs: number;
  easing: string;
  reduced: boolean;
  iterations: 'once' | 'infinite';
}

export function pageMotion(
  verb: PageMotionVerb,
  opts: { reducedMotion?: boolean; snapshot?: boolean } = {},
): PageMotionSpec {
  const reduced = opts.reducedMotion === true || opts.snapshot === true;
  const bezier = EASING_BEZIER[PAGE_MOTION_EASING[verb]];
  return {
    durationMs: reduced ? 0 : PAGE_MOTION_MS[verb],
    delayMs: 0,
    easing: `cubic-bezier(${bezier.join(', ')})`,
    reduced,
    iterations: 'once',
  };
}
