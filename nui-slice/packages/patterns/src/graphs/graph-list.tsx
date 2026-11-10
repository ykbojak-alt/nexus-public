import type { CSSProperties } from 'react';
import { CHART_CHROME, seriesVar, toneVar, type ChartTone } from '@nexus/ui';
import { statusVar } from './graph-frame';
import { EDGE_KIND_STROKE as EDGE_SAMPLE } from './graph-nodes';
import type { NexusGraphData, NexusGraphNode } from './types';

export interface GraphListProps {
  data: NexusGraphData;
  /** Mirrors the graph canvas selection — same id lights both surfaces. */
  selectedId?: string;
  onSelectNode?: (id: string) => void;
  /** kind → tone override, same map as the SVG NodeDot receives. */
  kindTone?: Record<string, ChartTone>;
  /**
   * Data caps for large graphs (W4-07): render at most N nodes/edges with
   * an honest "+K more" marker — the DOM never grows unboundedly.
   */
  maxNodes?: number;
  maxEdges?: number;
}

const listStyle: CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 };

function kindSwatch(node: NexusGraphNode, kindTone?: Record<string, ChartTone>): string {
  const kind = node.kind ?? '';
  if (kindTone?.[kind]) return toneVar(kindTone[kind]);
  let h = 0;
  for (let i = 0; i < kind.length; i++) h = (h * 31 + kind.charCodeAt(i)) >>> 0;
  return seriesVar(h);
}

/**
 * DOM/list equivalent of a graph canvas (VIS-W4-03): every node and
 * edge readable without color, hover, SVG or WebGL. Selection and
 * focus mirror the SVG surface — a node selected here is the same
 * node selected in the canvas.
 */
export function GraphList({ data, selectedId, onSelectNode, kindTone, maxNodes, maxEdges }: GraphListProps) {
  const nodeById = new Map(data.nodes.map((n) => [n.id, n]));
  const nodes = maxNodes != null ? data.nodes.slice(0, Math.max(0, maxNodes)) : data.nodes;
  const edges = maxEdges != null ? data.edges.slice(0, Math.max(0, maxEdges)) : data.edges;
  return (
    <div data-graph-list data-state={data.state} data-freshness={data.freshness}>
      <ul style={listStyle} aria-label="Nodes">
        {nodes.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              data-node={n.id}
              data-kind={n.kind}
              data-status={n.status}
              aria-pressed={n.id === selectedId}
              aria-current={n.id === selectedId || undefined}
              onClick={onSelectNode ? () => onSelectNode(n.id) : undefined}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
            >
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: 5, background: kindSwatch(n, kindTone) }} />
              <span>{n.label}</span>
              {n.kind ? <span style={{ color: CHART_CHROME.label }}>{n.kind}</span> : null}
              {/* Status as text — readable without color (DoD). */}
              {n.status ? <span data-status-text>{n.status}</span> : null}
            </button>
          </li>
        ))}
        {nodes.length < data.nodes.length ? (
          <li data-truncated style={{ color: CHART_CHROME.label }}>+{data.nodes.length - nodes.length} more nodes</li>
        ) : null}
      </ul>
      <ul style={listStyle} aria-label="Edges">
        {edges.map((e, i) => {
          const a = nodeById.get(e.from);
          const b = nodeById.get(e.to);
          return (
            <li key={`${e.from}->${e.to}-${i}`} data-edge={`${e.from}->${e.to}`} data-kind={e.kind}>
              {a?.label ?? e.from} → {b?.label ?? e.to}
              {e.kind ? ` (${e.kind})` : ''}
              {e.label ? ` — ${e.label}` : ''}
            </li>
          );
        })}
        {edges.length < data.edges.length ? (
          <li data-truncated style={{ color: CHART_CHROME.label }}>+{data.edges.length - edges.length} more edges</li>
        ) : null}
      </ul>
    </div>
  );
}

export interface GraphLegendProps {
  data: NexusGraphData;
  kindTone?: Record<string, ChartTone>;
}

/**
 * Legend derived from the same tokens as the rendered graph: node
 * kinds (kindTone/series), statuses (state tokens) and edge kinds
 * (dash pattern). Colours are decorative — every row also names its
 * meaning in text.
 */
export function GraphLegend({ data, kindTone }: GraphLegendProps) {
  const kinds = [...new Set(data.nodes.map((n) => n.kind).filter(Boolean))] as string[];
  const statuses = [...new Set(data.nodes.map((n) => n.status).filter(Boolean))] as string[];
  const edgeKinds = [...new Set(data.edges.map((e) => e.kind).filter(Boolean))] as string[];
  return (
    <div data-graph-legend style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', color: CHART_CHROME.label }}>
      {kinds.map((k) => (
        <span key={`k:${k}`} data-legend-kind={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            aria-hidden
            style={{ width: 10, height: 10, borderRadius: 5, background: kindSwatch({ id: '', label: '', kind: k }, kindTone) }}
          />
          {k}
        </span>
      ))}
      {statuses.map((s) => (
        <span key={`s:${s}`} data-legend-status={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden style={{ width: 10, height: 10, borderRadius: 5, background: statusVar(s) }} />
          {s}
        </span>
      ))}
      {edgeKinds.map((k) => (
        <span key={`e:${k}`} data-legend-edge={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <svg aria-hidden width={18} height={4}>
            <line
              x1={0}
              y1={2}
              x2={18}
              y2={2}
              stroke={CHART_CHROME.axis}
              strokeWidth={EDGE_SAMPLE[k]?.width ?? 1.25}
              strokeDasharray={EDGE_SAMPLE[k]?.dash}
            />
          </svg>
          {k}
        </span>
      ))}
    </div>
  );
}
