import { useCallback, useRef, useState, type HTMLAttributes, type PointerEvent as ReactPointerEvent } from 'react';
import { CHART_CHROME } from '@nexus/ui';
import { GraphFrame, statusVar } from '../graph-frame';
import { layeredLayout } from '../layout';
import { capGraphData } from '../caps';
import { CapMarker } from '../cap-marker';
import type { NexusGraphData, NexusGraphEdge, NexusGraphNode, VizState } from '../types';
import styles from './plan-dag.module.css';

export interface PlanDagProps extends HTMLAttributes<HTMLDivElement> {
  data: NexusGraphData;
  title: string;
  description?: string;
  width?: number;
  height?: number;
  /** Node card size — fixed geometry keeps screenshots deterministic. */
  nodeW?: number;
  nodeH?: number;
  /** Show zoom controls (refs3 R-W4.1). Pan: drag the canvas. */
  zoomable?: boolean;
  /**
   * Active-step pulse animation. Default on; probes pass `false` — the
   * captured frame then equals the reduced-motion render, and Chromium's
   * `transform-box` animation layers can't repaint arcs between shots
   * (documented harness limitation, same class as NQ-047).
   */
  animated?: boolean;
  selectedId?: string;
  onSelectNode?: (id: string) => void;
  maxNodes?: number;
  maxEdges?: number;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.25;

/** Truncate a step label to the card width — title keeps the verbatim text. */
function clip(text: string, max = 26): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** depends_on edge: cubic arc dependency → dependent, arrow at target. */
function arcPath(ax: number, ay: number, bx: number, by: number, nodeW: number): string {
  const x1 = ax + nodeW / 2;
  const x2 = bx - nodeW / 2;
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${ay} C ${mx} ${ay}, ${mx} ${by}, ${x2} ${by}`;
}

/**
 * Plan DAG (V-1): plan steps as a topological graph — columns are
 * dependency layers, arcs are depends_on edges, node color is the
 * verbatim step status. Active step pulses gold (transform-only);
 * reduced-motion renders the same state statically. Empty/error feed
 * GraphFrame honest states — a missing plan is never drawn.
 */
export function PlanDag({
  data,
  title,
  description,
  width = 720,
  height = 420,
  nodeW: nodeWProp = 168,
  nodeH = 46,
  zoomable = false,
  animated = true,
  selectedId,
  onSelectNode,
  maxNodes,
  maxEdges,
  className,
  ...rest
}: PlanDagProps) {
  const state: VizState = data.state ?? (data.nodes.length === 0 ? 'empty' : 'ready');
  const capped = capGraphData(data, { maxNodes, maxEdges });
  // Column spacing must fit the card: deepest layer count sets the gap.
  // Cards never overlap — nodeW clamps to the available spacing.
  const padX = 24;
  const depthOf = new Map<string, number>();
  {
    const deps = new Map<string, string[]>();
    for (const e of capped.edges) {
      const l = deps.get(e.to) ?? [];
      l.push(e.from);
      deps.set(e.to, l);
    }
    const seen = new Set<string>();
    const resolve = (id: string): number => {
      if (depthOf.has(id)) return depthOf.get(id)!;
      if (seen.has(id)) return 0;
      seen.add(id);
      let d = 0;
      for (const dep of deps.get(id) ?? []) d = Math.max(d, resolve(dep) + 1);
      seen.delete(id);
      depthOf.set(id, d);
      return d;
    };
    for (const n of capped.nodes) resolve(n.id);
  }
  const layers = Math.max(1, Math.max(0, ...capped.nodes.map((n) => depthOf.get(n.id) ?? 0)) + 1);
  const nodeW = layers > 1 ? Math.min(nodeWProp, Math.floor((width - padX * 2) / (layers - 1)) - 10) : nodeWProp;
  const layout = layeredLayout(capped.nodes, capped.edges, { width, height, padX: padX + nodeW / 2 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  const zoomIn = useCallback(() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2))), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2))), []);
  const zoomReset = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!zoomable) return;
    drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (drag.current == null) return;
    setPan({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y });
  };
  const onPointerUp = () => { drag.current = null; };

  const nodeOf = (n: NexusGraphNode) => {
    const p = layout.get(n.id);
    if (!p) return null;
    const x = p.x - nodeW / 2;
    const y = p.y - nodeH / 2;
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
        className={styles.node}
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-pressed={interactive ? n.id === selectedId : undefined}
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
        {n.status === 'active' && (
          <rect
            className={styles.pulse}
            x={x - 5}
            y={y - 5}
            width={nodeW + 10}
            height={nodeH + 10}
            rx={10}
            fill="none"
            stroke={tone}
            strokeWidth={2}
          />
        )}
        <rect
          x={x}
          y={y}
          width={nodeW}
          height={nodeH}
          rx={8}
          fill="var(--nexus-surface-panel, #1A1A21)"
          stroke={tone}
          strokeWidth={n.status === 'active' ? 2 : n.id === selectedId ? 2 : 1.25}
          strokeDasharray={n.status === 'skipped' ? '4 3' : undefined}
          opacity={n.status === 'done' ? 0.72 : 1}
        />
        {n.kind === 'check' && (
          <path
            d={`M ${x + 12} ${y + nodeH / 2 - 6} l 6 6 l -6 6 l -6 -6 z`}
            fill="none"
            stroke={tone}
            strokeWidth={1.5}
            aria-hidden
          />
        )}
        <text x={x + (n.kind === 'check' ? 24 : 10)} y={y + 18} fontSize={10} fill={CHART_CHROME.axis} fontFamily="monospace">
          {n.id}
        </text>
        <text x={x + (n.kind === 'check' ? 24 : 10)} y={y + 34} fontSize={11.5} fill={CHART_CHROME.label}>
          {clip(n.label)}
        </text>
      </g>
    );
  };

  const edgeOf = (e: NexusGraphEdge, i: number) => {
    const a = layout.get(e.from);
    const b = layout.get(e.to);
    if (!a || !b) return null;
    return (
      <path
        key={`${e.from}->${e.to}-${i}`}
        data-edge={`${e.from}->${e.to}`}
        data-kind={e.kind ?? 'depends'}
        d={arcPath(a.x, a.y, b.x, b.y, nodeW)}
        fill="none"
        stroke={CHART_CHROME.axis}
        strokeWidth={1.4}
        markerEnd="url(#planDagArrow)"
      />
    );
  };

  return (
    <GraphFrame
      testId="plan-dag"
      title={title}
      description={description}
      state={state}
      freshness={data.freshness}
      width={width}
      height={height}
      interactive={onSelectNode !== undefined}
      className={`${styles.wrap}${className ? ` ${className}` : ''}`}
      data-animated={animated || undefined}
      {...rest}
    >
      <defs>
        <marker id="planDagArrow" viewBox="0 0 8 8" refX={7} refY={4} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
          <path d="M 0 0 L 8 4 L 0 8 z" fill={CHART_CHROME.axis} />
        </marker>
      </defs>
      <g
        // Identity transform omitted — even translate(0) scale(1) switches the
        // raster path and shifts edge antialiasing by a pixel between paints
        // (deterministic-harness breaker, same class as NQ-047).
        transform={zoom === 1 && pan.x === 0 && pan.y === 0 ? undefined : `translate(${pan.x} ${pan.y}) scale(${zoom})`}
        data-zoom={zoom}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <CapMarker hidden={capped.hidden} width={width} />
        {capped.edges.map(edgeOf)}
        {capped.nodes.map(nodeOf)}
      </g>
      {zoomable && state === 'ready' && (
        // SVG-native controls — foreignObject routes through the HTML
        // compositor and repaints the canvas tile differently per shot.
        <g data-zoombar transform={`translate(${width - 100} 8)`}>
          {[
            { label: '−', aria: 'Уменьшить масштаб', act: zoomOut },
            { label: '+', aria: 'Увеличить масштаб', act: zoomIn },
            { label: '⟲', aria: 'Сбросить масштаб', act: zoomReset },
          ].map((b, i) => (
            <g
              key={b.aria}
              role="button"
              tabIndex={0}
              aria-label={b.aria}
              className={styles.zoomBtn}
              transform={`translate(${i * 32} 0)`}
              onClick={b.act}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  b.act();
                }
              }}
            >
              <rect width={28} height={28} rx={6} />
              <text x={14} y={19} textAnchor="middle">{b.label}</text>
            </g>
          ))}
        </g>
      )}
    </GraphFrame>
  );
}
