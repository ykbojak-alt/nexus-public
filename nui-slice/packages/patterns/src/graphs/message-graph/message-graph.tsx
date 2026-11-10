import type { HTMLAttributes } from 'react';
import { CHART_CHROME } from '@nexus/ui';
import { GraphFrame, statusVar } from '../graph-frame';
import { columnLayout } from '../layout';
import { capGraphData } from '../caps';
import { CapMarker } from '../cap-marker';
import type { NexusGraphData, NexusGraphEdge, VizState } from '../types';

export interface MessageGraphProps extends HTMLAttributes<HTMLDivElement> {
  data: NexusGraphData;
  title: string;
  description?: string;
  width?: number;
  height?: number;
  selectedId?: string;
  onSelectNode?: (id: string) => void;
  maxNodes?: number;
  maxEdges?: number;
}

const NODE_R = 16;

/** Quadratic arc — pair messages in opposite directions bow apart. */
function arcPath(ax: number, ay: number, bx: number, by: number, bend: number): { d: string; mx: number; my: number } {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  // Perpendicular offset — sign chosen by caller (index parity).
  const cx = mx + (-dy / len) * bend;
  const cy = my + (dx / len) * bend;
  return { d: `M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`, mx: cx, my: cy };
}

function clip(text: string, max = 34): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Run message graph (V-2 / refs3 R-W4.2): run family as nodes (root
 * column → sub column), send_message events as directed edges with
 * timestamp + text preview verbatim from the trace. Edges only appear
 * for observed sends — no inferred channels.
 */
export function MessageGraph({
  data,
  title,
  description,
  width = 720,
  height = 420,
  selectedId,
  onSelectNode,
  maxNodes,
  maxEdges,
  className,
  ...rest
}: MessageGraphProps) {
  const state: VizState = data.state ?? (data.nodes.length === 0 ? 'empty' : 'ready');
  const capped = capGraphData(data, { maxNodes, maxEdges });
  const layout = columnLayout(capped.nodes, capped.edges, {
    kindOrder: ['root', 'sub'],
    width,
    height,
    padX: 120,
    padY: 56,
  });

  const edgeOf = (e: NexusGraphEdge, i: number) => {
    const a = layout.get(e.from);
    const b = layout.get(e.to);
    if (!a || !b) return null;
    const bend = 26 + (i % 3) * 14; // deterministic fan-out for parallel sends
    const { d, mx, my } = arcPath(a.x, a.y, b.x, b.y, bend);
    return (
      <g key={`${e.from}->${e.to}-${i}`} data-edge={`${e.from}->${e.to}`} data-kind={e.kind ?? 'message'}>
        <path d={d} fill="none" stroke={CHART_CHROME.axis} strokeWidth={1.4} markerEnd="url(#msgGraphArrow)" />
        {e.label != null && (
          <text x={mx} y={my - 6} textAnchor="middle" fontSize={9.5} fill={CHART_CHROME.label} opacity={0.85}>
            {clip(e.label)}
          </text>
        )}
      </g>
    );
  };

  return (
    <GraphFrame
      testId="message-graph"
      title={title}
      description={description}
      state={state}
      freshness={data.freshness}
      width={width}
      height={height}
      interactive={onSelectNode !== undefined}
      className={className}
      {...rest}
    >
      <defs>
        <marker id="msgGraphArrow" viewBox="0 0 8 8" refX={7} refY={4} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
          <path d="M 0 0 L 8 4 L 0 8 z" fill={CHART_CHROME.axis} />
        </marker>
      </defs>
      <CapMarker hidden={capped.hidden} width={width} />
      {capped.edges.map(edgeOf)}
      {capped.nodes.map((n) => {
        const p = layout.get(n.id);
        if (!p) return null;
        const tone = n.status != null ? statusVar(n.status) : CHART_CHROME.axis;
        const interactive = onSelectNode !== undefined;
        const select = () => onSelectNode?.(n.id);
        return (
          <g
            key={n.id}
            data-node={n.id}
            data-kind={n.kind}
            data-status={n.status}
            data-selected={n.id === selectedId || undefined}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={`${n.id}: ${n.label}${n.status ? ` · ${n.status}` : ''}`}
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
            <title>{`${n.id}: ${n.label}${n.status ? ` · ${n.status}` : ''}`}</title>
            <circle cx={p.x} cy={p.y} r={NODE_R} fill={tone} fillOpacity={0.18} stroke={tone} strokeWidth={1.25} />
            <circle cx={p.x} cy={p.y} r={NODE_R * 0.45} fill={tone} />
            <text x={p.x} y={p.y + NODE_R + 13} textAnchor="middle" fontSize={10.5} fill={CHART_CHROME.label}>
              {n.label}
            </text>
          </g>
        );
      })}
    </GraphFrame>
  );
}
