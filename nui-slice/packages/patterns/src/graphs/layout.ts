/**
 * Deterministic graph layouts — pure geometry, no DOM, no force sim.
 * Column layout for directed flows (agent→step→output, role→model);
 * radial rings for cluster graphs (project hub → day/source → notes).
 * Same input always yields the same coordinates (spec §13).
 */

import type { NexusGraphEdge, NexusGraphNode } from './types';

export interface GraphPoint {
  x: number;
  y: number;
}

export type GraphLayout = Map<string, GraphPoint>;

export interface ColumnLayoutOpts {
  /** Columns in left→right order; unknown kinds go to a trailing column. */
  kindOrder: string[];
  width: number;
  height: number;
  padX?: number;
  padY?: number;
}

/**
 * Layered column layout: each kind gets a column; nodes inside a
 * column are ordered by topological depth (edge distance from a root)
 * then first-seen order — deterministic regardless of input ordering
 * only to the extent inputs are deterministic.
 */
export function columnLayout(
  nodes: readonly NexusGraphNode[],
  edges: readonly NexusGraphEdge[],
  opts: ColumnLayoutOpts,
): GraphLayout {
  const { kindOrder, width, height } = opts;
  const padX = opts.padX ?? 48;
  const padY = opts.padY ?? 24;
  const kindCol = new Map(kindOrder.map((k, i) => [k, i]));
  const cols = Math.max(1, kindOrder.length + 1); // +1 trailing for unknown kinds

  const colOf = (n: NexusGraphNode) => kindCol.get(n.kind ?? '') ?? kindOrder.length;

  // Topological depth: longest path from any source. Cycles degrade to 0.
  const depth = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.from) ?? [];
    list.push(e.to);
    adj.set(e.from, list);
  }
  const resolveDepth = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0;
    if (depth.has(id)) return depth.get(id)!;
    seen.add(id);
    let d = 0;
    for (const to of adj.get(id) ?? []) {
      d = Math.max(d, resolveDepth(to, seen) + 1);
    }
    seen.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const n of nodes) resolveDepth(n.id, new Set());

  // Buckets per column, sorted by depth asc then first-seen order.
  const buckets = new Map<number, NexusGraphNode[]>();
  nodes.forEach((n, i) => {
    const c = colOf(n);
    const list = buckets.get(c) ?? [];
    list.push(n);
    buckets.set(c, list);
  });
  for (const list of buckets.values()) {
    list.sort((a, b) => (depth.get(b.id) ?? 0) - (depth.get(a.id) ?? 0));
  }

  const layout: GraphLayout = new Map();
  for (const [c, list] of buckets) {
    const x = cols === 1 ? width / 2 : padX + (c / (cols - 1)) * (width - padX * 2);
    list.forEach((n, i) => {
      const y = list.length === 1 ? height / 2 : padY + (i / (list.length - 1)) * (height - padY * 2);
      layout.set(n.id, { x, y });
    });
  }
  return layout;
}

export interface LayeredLayoutOpts {
  width: number;
  height: number;
  padX?: number;
  padY?: number;
}

/**
 * Plan-DAG layout (neu-ux V-1 / refs3 R-W4.1): column = topological
 * depth — the longest depends_on chain from a root (roots sit at layer
 * 0, their dependents at layer 1, …). Nodes inside a layer keep
 * first-seen order — deterministic for deterministic inputs. Cycles
 * degrade gracefully: the cyclic edge contributes depth 0 (no infinite
 * recursion, no fabricated level).
 */
export function layeredLayout(
  nodes: readonly NexusGraphNode[],
  edges: readonly NexusGraphEdge[],
  opts: LayeredLayoutOpts,
): GraphLayout {
  const { width, height } = opts;
  const padX = opts.padX ?? 96;
  const padY = opts.padY ?? 40;

  // Edge direction: from = dependency (left), to = dependent (right).
  const deps = new Map<string, string[]>();
  for (const e of edges) {
    const list = deps.get(e.to) ?? [];
    list.push(e.from);
    deps.set(e.to, list);
  }
  const depth = new Map<string, number>();
  const resolveDepth = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    let d = 0;
    for (const dep of deps.get(id) ?? []) {
      d = Math.max(d, resolveDepth(dep, seen) + 1);
    }
    seen.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const n of nodes) resolveDepth(n.id, new Set());

  const layers = new Map<number, NexusGraphNode[]>();
  let maxDepth = 0;
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    maxDepth = Math.max(maxDepth, d);
    const list = layers.get(d) ?? [];
    list.push(n);
    layers.set(d, list);
  }

  const cols = maxDepth + 1;
  const layout: GraphLayout = new Map();
  for (const [d, list] of layers) {
    const x = cols === 1 ? width / 2 : padX + (d / (cols - 1)) * (width - padX * 2);
    list.forEach((n, i) => {
      const y = list.length === 1 ? height / 2 : padY + (i / (list.length - 1)) * (height - padY * 2);
      layout.set(n.id, { x, y });
    });
  }
  return layout;
}

export interface RadialLayoutOpts {
  /** Rings innermost→outermost by kind; unknown kinds go outermost. */
  ringOrder: string[];
  width: number;
  height: number;
  /** 0..1 — how far the innermost ring sits from center. */
  innerRatio?: number;
}

/**
 * Concentric ring layout: first ring kind sits near center, outer
 * kinds spread on a larger ring. Angle is index/density — deterministic.
 */
export function radialLayout(nodes: readonly NexusGraphNode[], opts: RadialLayoutOpts): GraphLayout {
  const { ringOrder, width, height } = opts;
  const inner = opts.innerRatio ?? 0.18;
  const cx = width / 2;
  const cy = height / 2;
  const rMax = Math.min(width, height) / 2 - 40;
  const ringOf = (n: NexusGraphNode) => {
    const i = ringOrder.indexOf(n.kind ?? '');
    return i < 0 ? ringOrder.length : i;
  };
  const rings = Math.max(1, ringOrder.length + 1);

  const byRing = new Map<number, NexusGraphNode[]>();
  for (const n of nodes) {
    const r = ringOf(n);
    const list = byRing.get(r) ?? [];
    list.push(n);
    byRing.set(r, list);
  }

  const layout: GraphLayout = new Map();
  for (const [r, list] of byRing) {
    const frac = rings === 1 ? 0 : inner + (r / (rings - 1)) * (1 - inner);
    const radius = r === 0 && list.length === 1 ? 0 : rMax * frac;
    list.forEach((n, i) => {
      const a = -Math.PI / 2 + (i / list.length) * Math.PI * 2;
      layout.set(n.id, { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
    });
  }
  return layout;
}
