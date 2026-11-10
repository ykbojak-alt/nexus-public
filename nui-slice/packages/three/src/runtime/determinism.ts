/**
 * Deterministic test mode — spec §11/Task 13: R3F scenes accept
 * `testMode`, `seed`, `animationTime`; screenshots must never flap.
 * Fixed seed + fixed time + fixed step = identical rendered state.
 */

export interface DeterministicProps {
  /** Freeze animation at a deterministic pose. */
  testMode?: boolean;
  /** Seed for all scene randomness (particles, jitter). */
  seed?: number;
  /** Virtual animation time in ms — replaces the wall clock. */
  animationTime?: number;
}

/** Deterministic RNG (mulberry32) — same seed, same sequence. */
export function createSeededRandom(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DeterministicClock {
  /** Current virtual time in ms. */
  now(): number;
  /** Advance the virtual clock by one fixed frame step. */
  tick(): number;
  /** Fixed frame step (60 FPS canonical). */
  readonly stepMs: number;
}

/**
 * Virtual clock for test mode — starts at `animationTime`, advances in
 * fixed 16.666…ms steps, unaffected by wall clock.
 */
export function createDeterministicClock(startMs = 0, stepMs = 1000 / 60): DeterministicClock {
  let t = startMs;
  return {
    now: () => t,
    tick: () => (t += stepMs),
    stepMs,
  };
}

export interface ResolvedDeterminism {
  /** Whether the scene renders a frozen deterministic pose. */
  testMode: boolean;
  /** Effective seed (default 1 for reproducibility when testMode on). */
  seed: number;
  /** Virtual animation time in ms. */
  animationTime: number;
  /** RNG bound to the seed — use for every scene random draw. */
  random: () => number;
  /** Virtual clock bound to animationTime. */
  clock: DeterministicClock;
}

/** Normalize DeterministicProps into a resolved, always-safe form. */
export function resolveDeterminism(props: DeterministicProps = {}): ResolvedDeterminism {
  const testMode = props.testMode === true;
  const seed = props.seed ?? 1;
  const animationTime = props.animationTime ?? 0;
  return {
    testMode,
    seed,
    animationTime,
    random: createSeededRandom(seed),
    clock: createDeterministicClock(animationTime),
  };
}
