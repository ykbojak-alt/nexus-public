import type { HTMLAttributes } from 'react';
import type { ChartTone } from '@nexus/ui';
import { GraphFrame } from '../graph-frame';
import { radialLayout } from '../layout';
import { EdgeLine, NodeDot } from '../graph-nodes';
import { capGraphData } from '../caps';
import { CapMarker } from '../cap-marker';
import type { NexusGraphData, VizState } from '../types';

export interface KnowledgeGraphProps extends HTMLAttributes<HTMLDivElement> {
  data: NexusGraphData;
  title: string;
  description?: string;
  width?: number;
  height?: number;
  /** Selected node id — mirrored by GraphList (VIS-W4-03). */
  selectedId?: string;
  onSelectNode?: (id: string) => void;
  /** W4-07 bounded render: defaults keep the SVG <=500 nodes/<=1000 edges;
   *  hidden counts surface via the "+N — capped" marker, never silently. */
  maxNodes?: number;
  maxEdges?: number;
}

const KIND_TONE: Record<string, ChartTone> = {
  project: 'primary',
  day: 'secondary',
  source: 'energy',
  note: 'violet',
};

/**
 * Knowledge/memory structure — concentric rings: project hub at
 * center, day/source mid-ring, notes outer. `contains` edges solid,
 * `similar`/`refs` hairline dashed (view-model-contracts §3).
 */
export function KnowledgeGraph({ data, title, description, width = 640, height = 480, selectedId, onSelectNode, maxNodes, maxEdges, ...rest }: KnowledgeGraphProps) {
  const state: VizState = data.state ?? (data.nodes.length === 0 ? 'empty' : 'ready');
  const capped = capGraphData(data, { maxNodes, maxEdges });
  const layout = radialLayout(capped.nodes, { ringOrder: ['project', 'day', 'source', 'note'], width, height });
  return (
    <GraphFrame
      testId="knowledge-graph"
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
        <NodeDot
          key={n.id}
          node={n}
          layout={layout}
          kindTone={KIND_TONE}
          r={n.kind === 'note' ? 10 : 16}
          selected={n.id === selectedId}
          onSelectNode={onSelectNode}
        />
      ))}
    </GraphFrame>
  );
}
