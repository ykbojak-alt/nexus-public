import { CHART_CHROME, seriesVar, toneVar, type ChartTone } from '@nexus/ui';
import type { GraphLayout } from './layout';
import { statusVar } from './graph-frame';
import type { NexusGraphEdge, NexusGraphNode } from './types';

export const EDGE_KIND_STROKE: Record<string, { dash?: string; width: number }> = {
  delegates: { width: 1.75 },
  produces: { width: 1.75 },
  waits: { dash: '5 4', width: 1.25 },
  routes: { width: 1.75 },
  fallback: { dash: '5 4', width: 1.25 },
  contains: { width: 1.5 },
  similar: { dash: '3 3', width: 1 },
  refs: { dash: '3 3', width: 1 },
};

const DEFAULT_EDGE = { width: 1.25 };

export function EdgeLine({
  edge,
  layout,
}: {
  edge: NexusGraphEdge;
  layout: GraphLayout;
}) {
  const a = layout.get(edge.from);
  const b = layout.get(edge.to);
  if (!a || !b) return null;
  const style = EDGE_KIND_STROKE[edge.kind ?? ''] ?? DEFAULT_EDGE;
  return (
    <line
      data-edge={`${edge.from}->${edge.to}`}
      data-kind={edge.kind}
      x1={a.x}
      y1={a.y}
      x2={b.x}
      y2={b.y}
      stroke={CHART_CHROME.axis}
      strokeWidth={style.width}
      strokeDasharray={style.dash}
    />
  );
}

export function NodeDot({
  node,
  layout,
  kindTone,
  r = 14,
  selected = false,
  onSelectNode,
}: {
  node: NexusGraphNode;
  layout: GraphLayout;
  /** kind → tone override; falls back to ordered series palette by index. */
  kindTone?: Record<string, ChartTone>;
  r?: number;
  /** Mirrors GraphList selection — same id lights both surfaces (VIS-W4-03). */
  selected?: boolean;
  onSelectNode?: (id: string) => void;
}) {
  const p = layout.get(node.id);
  if (!p) return null;
  const kind = node.kind ?? '';
  const fill = kindTone?.[kind] ? toneVar(kindTone[kind]) : seriesVar(hashIndex(kind));
  const interactive = onSelectNode !== undefined;
  const select = () => onSelectNode?.(node.id);
  return (
    <g
      data-node={node.id}
      data-kind={node.kind}
      data-status={node.status}
      data-selected={selected || undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? selected : undefined}
      aria-label={interactive ? node.label : undefined}
      onClick={interactive ? select : undefined}
      onKeyDown={
        interactive
          ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              select();
            }
          }
          : undefined
      }
      style={interactive ? { cursor: 'pointer' } : undefined}
    >
      <circle cx={p.x} cy={p.y} r={r} fill={fill} fillOpacity={0.22} />
      <circle cx={p.x} cy={p.y} r={r * 0.45} fill={node.status ? statusVar(node.status) : fill} />
      {selected ? (
        <circle
          data-selection-ring
          cx={p.x}
          cy={p.y}
          r={r + 4}
          fill="none"
          stroke={CHART_CHROME.label}
          strokeWidth={1.5}
        />
      ) : null}
      <text
        x={p.x}
        y={p.y + r + 12}
        textAnchor="middle"
        fontSize={11}
        fill={CHART_CHROME.label}
      >
        {node.label}
      </text>
    </g>
  );
}

/** Deterministic palette slot for unknown kinds — stable across renders. */
function hashIndex(kind: string): number {
  let h = 0;
  for (let i = 0; i < kind.length; i++) h = (h * 31 + kind.charCodeAt(i)) >>> 0;
  return h;
}
