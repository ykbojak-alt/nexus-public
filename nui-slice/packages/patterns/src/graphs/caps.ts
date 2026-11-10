import type { NexusGraphData, NexusGraphEdge, NexusGraphNode } from './types';

/**
 * SVG graph caps (W4-07): the canvas stays bounded — above these defaults
 * the DOM list (GraphList) is the intended surface for full data.
 */
export const SVG_GRAPH_MAX_NODES = 500;
export const SVG_GRAPH_MAX_EDGES = 1000;

export interface GraphCaps {
  maxNodes?: number;
  maxEdges?: number;
}

export interface CappedGraph {
  nodes: NexusGraphNode[];
  edges: NexusGraphEdge[];
  /** Counts dropped by the caps — surfaced to the user, never silent. */
  hidden: { nodes: number; edges: number };
}

/**
 * Apply node/edge caps honestly: nodes are truncated in input order
 * (upstream view-models decide the ordering), edges are kept only when
 * both endpoints survive — a dangling edge to a hidden node is never
 * drawn, and the drop counts are always reported.
 */
export function capGraphData(
  data: NexusGraphData,
  caps: GraphCaps = {},
): CappedGraph {
  const maxNodes = caps.maxNodes ?? SVG_GRAPH_MAX_NODES;
  const maxEdges = caps.maxEdges ?? SVG_GRAPH_MAX_EDGES;

  const nodes =
    maxNodes < data.nodes.length ? data.nodes.slice(0, Math.max(0, maxNodes)) : data.nodes;
  const keep = new Set(nodes.map((n) => n.id));
  const linked = data.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  const edges =
    maxEdges < linked.length ? linked.slice(0, Math.max(0, maxEdges)) : linked;

  return {
    nodes,
    edges,
    hidden: {
      nodes: data.nodes.length - nodes.length,
      edges: data.edges.length - edges.length,
    },
  };
}

/** Honest truncation label for the SVG canvas — text, never color-only. */
export function capMarkerText(hidden: CappedGraph['hidden']): string | null {
  const parts: string[] = [];
  if (hidden.nodes > 0) parts.push(`+${hidden.nodes} nodes`);
  if (hidden.edges > 0) parts.push(`+${hidden.edges} edges`);
  return parts.length ? `${parts.join(', ')} — capped` : null;
}
