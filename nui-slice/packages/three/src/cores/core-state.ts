/**
 * Deterministic core scene state — spec §16 + agent motion signatures.
 * `renderCoreState(kind, {seed, animationTime})` is pure: same input →
 * same geometry. WebGL and SVG-fallback renderers consume this exact
 * state, so the 2D representation is the controlled test twin of the
 * 3D scene — not a different drawing.
 */

import { createSeededRandom, type DeterministicProps } from '../runtime/determinism';

export type CoreKind = 'nexus' | 'alice' | 'mech' | 'forge' | 'codex' | 'arch';

export interface RingElement {
  radius: number; // 0..1 of scene radius
  opacity: number;
  toneIndex: number;
}
export interface OrbiterElement {
  angle: number; // radians at time t
  radius: number;
  size: number;
  toneIndex: number;
}
export interface SpokeElement {
  angle: number;
  length: number; // 0..1
  toneIndex: number;
}
export interface LayerElement {
  index: number;
  size: number; // 0..1
  /** 0..1 — how far the layer has revealed/unfolded at time t. */
  progress: number;
  toneIndex: number;
}
export interface FacetElement {
  angle: number;
  /** 0..1 — distance from center (converges over time for forge). */
  dist: number;
  size: number;
  toneIndex: number;
}

export interface CoreSceneState {
  kind: CoreKind;
  seed: number;
  /** Virtual animation time (ms) the state was rendered at. */
  t: number;
  /** 0..1 pulse phase (breathing/glow intensity). */
  pulse: number;
  rings: RingElement[];
  orbiters: OrbiterElement[];
  spokes: SpokeElement[];
  layers: LayerElement[];
  facets: FacetElement[];
}

const TAU = Math.PI * 2;

/** Breathing pulse — 0..1 triangle wave over ~2.8s, deterministic in t. */
function pulseAt(t: number): number {
  const phase = (t % 2800) / 2800;
  return phase < 0.5 ? phase * 2 : 2 - phase * 2;
}

/**
 * The deterministic scene contract from Task 13 Step 1:
 * `renderCoreState({testMode,seed,animationTime})` — identical output
 * for identical input; time drives pose, seed drives layout.
 */
export function renderCoreState(kind: CoreKind, det: DeterministicProps = {}): CoreSceneState {
  const seed = det.seed ?? 1;
  const t = det.animationTime ?? 0;
  const rng = createSeededRandom(seed);
  const state: CoreSceneState = { kind, seed, t, pulse: pulseAt(t), rings: [], orbiters: [], spokes: [], layers: [], facets: [] };

  switch (kind) {
    case 'nexus': {
      // NEXUS signature: orbital — nested rings + counter-rotating orbiters.
      for (let i = 0; i < 3; i++) {
        state.rings.push({ radius: 0.34 + i * 0.22, opacity: 0.35 + 0.2 * i, toneIndex: i });
      }
      for (let i = 0; i < 4; i++) {
        const dir = i % 2 === 0 ? 1 : -1;
        state.orbiters.push({
          angle: rng() * TAU + dir * (t / 1600) * (0.6 + i * 0.15),
          radius: 0.34 + (i % 3) * 0.22,
          size: 0.045 + rng() * 0.02,
          toneIndex: i % 8,
        });
      }
      break;
    }
    case 'alice': {
      // ALICE signature: breathing/radial — halo ring + radial spokes.
      state.rings.push({ radius: 0.5 + state.pulse * 0.06, opacity: 0.5 + state.pulse * 0.3, toneIndex: 0 });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU + rng() * 0.05;
        state.spokes.push({ angle: a, length: 0.3 + state.pulse * 0.18 + rng() * 0.08, toneIndex: i % 4 });
      }
      break;
    }
    case 'mech': {
      // MECH signature: precise/linear — scan bar sweeping a regular ring.
      state.rings.push({ radius: 0.7, opacity: 0.6, toneIndex: 1 });
      const sweep = (t / 2400) % 1;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        const active = Math.abs((((a / TAU) - sweep + 1) % 1)) < 0.08;
        state.orbiters.push({ angle: a, radius: 0.7, size: active ? 0.075 : 0.045, toneIndex: active ? 2 : 1 });
      }
      state.spokes.push({ angle: sweep * TAU, length: 0.7, toneIndex: 2 });
      break;
    }
    case 'forge': {
      // FORGE signature: build-up/convergence — facets spiral inward.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + (t / 3000);
        const converge = 0.5 + 0.5 * Math.cos((t / 1400 + i * 0.7) % TAU);
        state.facets.push({ angle: a, dist: 0.25 + converge * 0.45, size: 0.09 + rng() * 0.03, toneIndex: 2 + (i % 2) });
      }
      state.rings.push({ radius: 0.22, opacity: 0.7, toneIndex: 2 });
      break;
    }
    case 'codex': {
      // CODEX signature: layer-reveal/orbit — stacked layers revealed in t.
      for (let i = 0; i < 4; i++) {
        const start = i * 900;
        const progress = Math.max(0, Math.min(1, (t - start) / 1200));
        state.layers.push({ index: i, size: 0.9 - i * 0.16, progress, toneIndex: i + 3 });
      }
      state.orbiters.push({ angle: t / 2000, radius: 0.95, size: 0.05, toneIndex: 6 });
      break;
    }
    case 'arch': {
      // ARCH signature: depth/unfolding — nested shells opening over time.
      for (let i = 0; i < 5; i++) {
        const progress = Math.max(0, Math.min(1, t / (800 + i * 500)));
        state.layers.push({ index: i, size: 0.2 + i * 0.17, progress, toneIndex: 7 - i });
      }
      break;
    }
  }
  return state;
}
