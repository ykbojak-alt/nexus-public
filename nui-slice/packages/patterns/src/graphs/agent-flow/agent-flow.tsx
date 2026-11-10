import type { HTMLAttributes } from 'react';
import type { ChartTone } from '@nexus/ui';
import { GraphFrame } from '../graph-frame';
import { columnLayout } from '../layout';
import { EdgeLine, NodeDot } from '../graph-nodes';
import { capGraphData } from '../caps';
import { CapMarker } from '../cap-marker';
import type { NexusGraphData, VizState } from '../types';

export interface AgentFlowProps extends HTMLAttributes<HTMLDivElement> {
  data: NexusGraphData;
  title: string;
  description?: string;
  width?: number;
  height?: number;
  /** Selected node id — mirrored by GraphList (VIS-W4-03). */
  selectedId?: string;
  onSelectNode?: (id: string) => void;
  /** W4-07 bounded render: defaults keep the SVG ≤500 nodes/≤1000 edges;
   *  hidden counts surface via the "+N — capped" marker, never silently. */
  maxNodes?: number;
  maxEdges?: number;
}

const KIND_TONE: Record<string, ChartTone> = {
  agent: 'primary',
  step: 'energy',
  output: 'positive',
};

/**
 * Mission flow — agents → steps → outputs as a layered left-to-right
 * DAG. Edge kinds: delegates/produces solid, waits dashed
 * (view-model-contracts §2). 2D/SVG only.
 */
export function AgentFlow({ data, title, description, width = 720, height = 420, selectedId, onSelectNode, maxNodes, maxEdges, ...rest }: AgentFlowProps) {
  const state: VizState = data.state ?? (data.nodes.length === 0 ? 'empty' : 'ready');
  const capped = capGraphData(data, { maxNodes, maxEdges });
  const layout = columnLayout(capped.nodes, capped.edges, { kindOrder: ['agent', 'step', 'output'], width, height });
  return (
    <GraphFrame
      testId="agent-flow"
      title={title}
      description={description}
      state={state}
      freshness={data.freshness}
      width={width}
      height={height}
      interactive={onSelectNode !== undefined}
      {...rest}
    >
      <CapMarker hidden={capped.hidden} width={width} />
      {capped.edges.map((e, i) => (
        <EdgeLine key={`${e.from}->${e.to}-${i}`} edge={e} layout={layout} />
      ))}
      {capped.nodes.map((n) => (
        <NodeDot key={n.id} node={n} layout={layout} kindTone={KIND_TONE} selected={n.id === selectedId} onSelectNode={onSelectNode} />
      ))}
    </GraphFrame>
  );
}
