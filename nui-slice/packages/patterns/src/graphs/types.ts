/**
 * Nexus graph data contracts — spec §13, owned by Window 4 (Task 12).
 * Consumed by KnowledgeGraph, ModelRouterGraph, AgentFlow and by
 * product view-models (docs/product/view-model-contracts.md §2–4).
 *
 * Graphs render 2D/SVG only — D3/force computes geometry, never WebGL
 * without an accessible DOM fallback.
 */

import type { DataFreshness, VizState } from '@nexus/ui';

/**
 * Bounded node-status vocabulary (NQ-007) — the set statusVar() maps to
 * generated `--nexus-state-*` tokens. Unknown product statuses still
 * compile (`string & {}`) but render with the neutral chart-axis tone,
 * never a fabricated color.
 */
export type GraphNodeStatus =
  | 'active'
  | 'executing'
  | 'busy'
  | 'done'
  | 'complete'
  | 'failed'
  | 'error'
  | 'skipped'
  | 'offline'
  | 'paused'
  | 'waiting'
  | 'pending'
  | 'idle'
  | 'syncing'
  | 'thinking'
  | 'validating'
  | 'warning'
  | 'info'
  | 'online';

export interface NexusGraphNode {
  id: string;
  label: string;
  /** Semantic kind per product contract ('agent'|'step'|'output'|'note'|…). */
  kind?: string;
  /** Bounded status vocab — see GraphNodeStatus (NQ-007). */
  status?: GraphNodeStatus | (string & {});
  /** Optional grouping hint for layout (column/lane/cluster). */
  group?: string;
  /**
   * Provenance confidence (A.R.C.H. inspector: Low/Moderate/High).
   * Declarative — consumers decide how to surface it; never rendered
   * as a fabricated color.
   */
  confidence?: 'low' | 'moderate' | 'high';
}

export interface NexusGraphEdge {
  from: string;
  to: string;
  label?: string;
  /** Semantic kind per product contract ('delegates'|'produces'|'similar'|…). */
  kind?: string;
}

/** Graph-level state: shared VizState plus live freshness (view-model §8.3). */
export interface NexusGraphData {
  nodes: NexusGraphNode[];
  edges: NexusGraphEdge[];
  state?: VizState;
  freshness?: DataFreshness;
}

export type { DataFreshness, VizState };
