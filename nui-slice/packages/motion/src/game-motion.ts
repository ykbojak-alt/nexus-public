/**
 * Game-motion family — dispatch wave-4 W4-3, paired with the W2
 * semantic layer `motion.*` / `easing.*` (tokens/src/semantic/
 * motion.tokens.json + primitives/motion.tokens.json).
 *
 * Games choreograph on an authored rhythm — like authored-art colors
 * these values are theme-invariant. They live OUTSIDE the frozen UI
 * scale (80/140/240/420/700): deal/fly/hop/attack have their own
 * pacing band (180–1800ms). Jitter (durak `rnd(560,760)`) and tempo
 * multipliers stay caller-side — the token names below are the
 * contract, literals here mirror them (same convention as presets.ts;
 * replaced by generated imports once @nexus/tokens re-exports land).
 *
 * Boundary (W4-1007): `gameMotion`/`GAME_MOTION_*` are imported only by
 * game screens (durak/chess/games/oracle). UI code takes `DURATION_MS`
 * presets or a dedicated family; a UI component may still reference a
 * `--nexus-motion-*` var in CSS for a conscious authored moment
 * (ambient loop, entrance, emphasis) — never for default interaction
 * feedback. The reverse flow is legal: UI chrome on game screens uses
 * `duration.*` freely.
 *
 * Reduced-motion: game choreography collapses to instant placement —
 * the deal/hop/flip still happens, at duration 0, so game state is
 * never motion-dependent. Snapshot mode returns the settled end-state.
 */

/** Semantic pacing verbs — token names `motion.<verb>` (W2). */
export type GameMotionVerb =
  | 'snappy'   // 180ms — choice-in popups, hit flashes
  | 'fly'      // 280ms — card entry, cover fly-in (launch easing)
  | 'promote'  // 320ms — piece promotion / upgrade cue
  | 'move'     // 340ms — chess piece move
  | 'reveal'   // 400ms — flip reveal, hand show
  | 'capture'  // 420ms — capture hop / piece removal accent
  | 'beat'     // 480ms — pair/turn accent beat
  | 'ring'     // 560ms — lower bound of deal jitter band
  | 'ghost'    // 620ms — ghost/echo trail
  | 'deal'     // 660ms — nominal deal tempo (rnd band caller-side)
  | 'attack'   // 720ms — attack/throw emphasis
  | 'flip'     // 1040ms — full card flip
  | 'pulse'    // 1100ms — thinking/idle loop
  | 'seek'     // 1400ms — target/searching loop
  | 'glow'     // 1600ms — usable/available glow loop
  | 'breathe'; // 1800ms — slow ambient loop (hand pulse)

/** Named game easings — token names `easing.<name>` (W2 primitives). */
export type GameMotionEasing =
  | 'launch'    // cubic-bezier(0.22,0.9,0.35,1) — entries/flies
  | 'arc'       // cubic-bezier(0.3,0.85,0.35,1) — hop/move arcs
  | 'drift'     // cubic-bezier(0.2,0.75,0.3,1) — deal travel
  | 'glide'     // cubic-bezier(0.25,0.7,0.3,1) — long travel variant
  | 'dissolve'  // cubic-bezier(0.35,0.6,0.4,1) — ghost/fade travel
  | 'pop';      // cubic-bezier(0.3,0.9,0.3,1.15) — overshoot snap

/** `motion.*` token values mirrored (semantic/motion.tokens.json). */
export const GAME_MOTION_MS: Record<GameMotionVerb, number> = {
  snappy: 180,
  fly: 280,
  promote: 320,
  move: 340,
  reveal: 400,
  capture: 420,
  beat: 480,
  ring: 560,
  ghost: 620,
  deal: 660,
  attack: 720,
  flip: 1040,
  pulse: 1100,
  seek: 1400,
  glow: 1600,
  breathe: 1800,
};

/** `easing.*` token values mirrored (primitives/motion.tokens.json). */
export const GAME_MOTION_EASING: Record<GameMotionEasing, string> = {
  launch: 'cubic-bezier(0.22, 0.9, 0.35, 1)',
  arc: 'cubic-bezier(0.3, 0.85, 0.35, 1)',
  drift: 'cubic-bezier(0.2, 0.75, 0.3, 1)',
  glide: 'cubic-bezier(0.25, 0.7, 0.3, 1)',
  dissolve: 'cubic-bezier(0.35, 0.6, 0.4, 1)',
  pop: 'cubic-bezier(0.3, 0.9, 0.3, 1.15)',
};

export interface GameMotionSpec {
  /** WAAPI/CSS-ready duration. 0 under reduced-motion or snapshot. */
  durationMs: number;
  /** `easing.*` bezier — kept verbatim; 0-duration makes it inert. */
  easing: string;
  /** True when the caller asked for reduced/static output. */
  reduced: boolean;
}

/**
 * Resolve a game-motion verb to its authored duration + easing.
 * `tempo` scales pacing (durak speed knob); `jitter` bounds are the
 * caller's — this returns the nominal token value. reducedMotion and
 * snapshot both collapse to 0ms — the end-state is always reachable
 * without waiting on the clock.
 */
export function gameMotion(
  verb: GameMotionVerb,
  easing: GameMotionEasing = 'launch',
  opts: { reducedMotion?: boolean; snapshot?: boolean; tempo?: number } = {},
): GameMotionSpec {
  const reduced = opts.reducedMotion === true || opts.snapshot === true;
  const ms = reduced
    ? 0
    : Math.max(0, Math.round(GAME_MOTION_MS[verb] * (opts.tempo ?? 1)));
  return { durationMs: ms, easing: GAME_MOTION_EASING[easing], reduced };
}
