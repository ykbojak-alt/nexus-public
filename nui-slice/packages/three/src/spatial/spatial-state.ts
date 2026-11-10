/**
 * Deterministic spatial scene state — spec §16 specialized 3D.
 * Scene models produce 3D positions from seed + input data; the SVG
 * fallback orthographically projects the same positions to 2D, so
 * reduced-quality output is the true flattened scene, not a picture.
 */

import { createSeededRandom, type DeterministicProps } from '../runtime/determinism';

export interface SpatialNodeInput {
  id: string;
  label?: string;
  kind?: string;
  status?: string;
}
export interface SpatialEdgeInput {
  from: string;
  to: string;
  kind?: string;
}
/** Structural match for NexusGraphData — callers pass graph data directly. */
export interface SpatialInput {
  nodes: SpatialNodeInput[];
  edges?: SpatialEdgeInput[];
}

export interface SpatialNode3 extends SpatialNodeInput {
  x: number;
  y: number;
  z: number;
  size: number;
  toneIndex: number;
}
export interface SpatialSceneState {
  kind: 'constellation' | 'globe' | 'sphere' | 'orb';
  seed: number;
  t: number;
  nodes: SpatialNode3[];
  edges: SpatialEdgeInput[];
  /** Slow Y-rotation angle at time t (radians). */
  rotation: number;
}

const TAU = Math.PI * 2;

/** Stable per-id hash — position must not depend on array order alone. */
function idHash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Fibonacci sphere point — even, deterministic distribution. */
function fibonacciPoint(i: number, n: number, jitter: () => number): [number, number, number] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (i / Math.max(1, n - 1)) * 2;
  const rr = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = golden * i + jitter() * 0.3;
  return [Math.cos(theta) * rr, y + jitter() * 0.06, Math.sin(theta) * rr];
}

export type SpatialKind = SpatialSceneState['kind'];

/** Deterministic spatial scene — pure for a given (kind, data, seed, t). */
export function renderSpatialState(kind: SpatialKind, data: SpatialInput, det: DeterministicProps = {}): SpatialSceneState {
  const seed = det.seed ?? 1;
  const t = det.animationTime ?? 0;
  const rng = createSeededRandom(seed);
  const rotation = kind === 'globe' || kind === 'constellation' ? (t / 12000) * TAU : 0;
  const nodes: SpatialNode3[] = [];
  const edges = data.edges ?? [];

  data.nodes.forEach((n, i) => {
    const jr = createSeededRandom(seed ^ idHash(n.id));
    let x = 0;
    let y = 0;
    let z = 0;
    switch (kind) {
      case 'constellation': {
        // AgentConstellation — seeded star-field on a unit sphere.
        [x, y, z] = fibonacciPoint(i, data.nodes.length, jr);
        break;
      }
      case 'globe': {
        // MissionGlobe — id-derived lat/long on the sphere.
        const lat = ((idHash(n.id) % 160) - 80) * (Math.PI / 180);
        const lon = (((idHash(n.id) >>> 8) % 360) - 180) * (Math.PI / 180);
        x = Math.cos(lat) * Math.cos(lon);
        y = Math.sin(lat);
        z = Math.cos(lat) * Math.sin(lon);
        break;
      }
      case 'sphere': {
        // MemorySphere — dense uniform field, small radius spread.
        [x, y, z] = fibonacciPoint(i, data.nodes.length, jr);
        const rr = 0.82 + jr() * 0.16;
        x *= rr; y *= rr; z *= rr;
        break;
      }
      case 'orb': {
        // KnowledgeOrb — nodes distributed over 3 tilted rings.
        const ring = i % 3;
        const a = (i / Math.max(1, data.nodes.length)) * TAU * 3 + ring * 0.7;
        const rr = 0.6 + ring * 0.18;
        x = Math.cos(a) * rr;
        y = Math.sin(a) * rr * (0.25 + ring * 0.3);
        z = Math.sin(a + ring) * 0.2;
        break;
      }
    }
    nodes.push({ ...n, x, y, z, size: n.kind === 'project' || n.kind === 'agent' ? 0.07 : 0.045, toneIndex: idHash(n.id) % 8 });
  });

  return { kind, seed, t, nodes, edges, rotation };
}

export interface ProjectedNode extends SpatialNode3 {
  /** Screen position for the orthographic 2D projection. */
  px: number;
  py: number;
  /** 0..1 depth (1 = front). */
  depth: number;
}

/** Rotate around Y by `rotation`, project orthographically to 2D. */
export function projectNode(n: SpatialNode3, rotation: number, cx: number, cy: number, r: number): ProjectedNode {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const x = n.x * cos - n.z * sin;
  const z = n.x * sin + n.z * cos;
  return { ...n, px: cx + x * r, py: cy - n.y * r, depth: (z + 1) / 2 };
}
