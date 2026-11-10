import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AgentFlow } from './agent-flow/agent-flow';
import { KnowledgeGraph } from './knowledge-graph/knowledge-graph';
import { ModelRouterGraph } from './model-router-graph/model-router-graph';
import { columnLayout, radialLayout } from './layout';
import { capGraphData } from "./caps";
import { statusVar } from './graph-frame';
import { GraphLegend, GraphList } from './graph-list';
import type { NexusGraphData } from './types';

afterEach(cleanup);

const MISSION: NexusGraphData = {
  nodes: [
    { id: 'alice', label: 'ALICE', kind: 'agent', status: 'active' },
    { id: 's1', label: 'plan', kind: 'step', status: 'done' },
    { id: 's2', label: 'build', kind: 'step', status: 'active' },
    { id: 'out', label: 'artifact', kind: 'output' },
  ],
  edges: [
    { from: 'alice', to: 's1', kind: 'delegates' },
    { from: 's1', to: 's2', kind: 'produces' },
    { from: 's2', to: 'out', kind: 'produces' },
  ],
};

const ROUTER: NexusGraphData = {
  nodes: [
    { id: 'planner', label: 'planner', kind: 'role' },
    { id: 'coder', label: 'coder', kind: 'role' },
    { id: 'm1', label: 'model-a', kind: 'model' },
    { id: 'm2', label: 'model-b', kind: 'model' },
  ],
  edges: [
    { from: 'planner', to: 'm1', kind: 'routes' },
    { from: 'planner', to: 'm2', kind: 'fallback' },
    { from: 'coder', to: 'm2', kind: 'routes' },
  ],
};

const MEMORY: NexusGraphData = {
  nodes: [
    { id: 'proj', label: 'ai2', kind: 'project' },
    { id: 'd1', label: '2026-10-11', kind: 'day' },
    { id: 'd2', label: '2026-10-12', kind: 'day' },
    { id: 'n1', label: 'note', kind: 'note' },
    { id: 'n2', label: 'note2', kind: 'note' },
  ],
  edges: [
    { from: 'proj', to: 'd1', kind: 'contains' },
    { from: 'proj', to: 'd2', kind: 'contains' },
    { from: 'd1', to: 'n1', kind: 'contains' },
    { from: 'n1', to: 'n2', kind: 'similar' },
  ],
};

describe('columnLayout (deterministic, spec §13)', () => {
  it('places kinds into ordered columns, same input → same output', () => {
    const a = columnLayout(MISSION.nodes, MISSION.edges, { kindOrder: ['agent', 'step', 'output'], width: 720, height: 420 });
    const b = columnLayout(MISSION.nodes, MISSION.edges, { kindOrder: ['agent', 'step', 'output'], width: 720, height: 420 });
    expect(a.get('alice')!.x).toBeLessThan(a.get('s1')!.x);
    expect(a.get('s1')!.x).toBeLessThan(a.get('out')!.x);
    expect(a.get('out')!.x).toBeGreaterThan(a.get('alice')!.x);
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it('sends unknown kinds to the trailing column', () => {
    const nodes = [{ id: 'x', label: 'x', kind: 'mystery' }];
    const l = columnLayout(nodes, [], { kindOrder: ['agent', 'step'], width: 600, height: 400 });
    expect(l.get('x')!.x).toBeGreaterThan(300);
  });
});

describe('radialLayout', () => {
  it('puts hub kinds inner, outer kinds on the large ring, centered lone hub', () => {
    const l = radialLayout(MEMORY.nodes, { ringOrder: ['project', 'day', 'source', 'note'], width: 640, height: 480 });
    const proj = l.get('proj')!;
    expect(proj.x).toBeCloseTo(320);
    expect(proj.y).toBeCloseTo(240);
    const note = l.get('n1')!;
    const day = l.get('d1')!;
    const dNote = Math.hypot(note.x - 320, note.y - 240);
    const dDay = Math.hypot(day.x - 320, day.y - 240);
    expect(dNote).toBeGreaterThan(dDay);
  });
});

describe('AgentFlow', () => {
  it('renders nodes in columns, edges as kind-typed lines, accessible svg', () => {
    render(<AgentFlow data={MISSION} title="Mission" />);
    const root = screen.getByTestId('agent-flow');
    expect(root).toHaveAttribute('data-state', 'ready');
    expect(screen.getByRole('img', { name: 'Mission' })).toBeInTheDocument();
    expect(document.querySelectorAll('g[data-node]')).toHaveLength(4);
    expect(document.querySelector('line[data-edge="s1->s2"]')).toBeInTheDocument();
    const waits = document.querySelector('line[data-kind="delegates"]');
    expect(waits).not.toHaveAttribute('stroke-dasharray');
  });

  it('honours explicit state and freshness from the view-model', () => {
    render(<AgentFlow data={{ nodes: [], edges: [], state: 'loading', freshness: 'syncing' }} title="M" />);
    const root = screen.getByTestId('agent-flow');
    expect(root).toHaveAttribute('data-state', 'loading');
    expect(root).toHaveAttribute('data-freshness', 'syncing');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});

describe('ModelRouterGraph', () => {
  it('renders role→model routes solid, fallback dashed', () => {
    render(<ModelRouterGraph data={ROUTER} title="Router" />);
    expect(document.querySelectorAll('g[data-node]')).toHaveLength(4);
    const route = document.querySelector('line[data-kind="routes"]')!;
    const fallback = document.querySelector('line[data-kind="fallback"]')!;
    expect(route).not.toHaveAttribute('stroke-dasharray');
    expect(fallback).toHaveAttribute('stroke-dasharray', '5 4');
  });
});

describe('KnowledgeGraph', () => {
  it('renders radial structure — hub centered, similar edges dashed', () => {
    render(<KnowledgeGraph data={MEMORY} title="Memory" />);
    expect(document.querySelectorAll('g[data-node]')).toHaveLength(5);
    const similar = document.querySelector('line[data-kind="similar"]')!;
    expect(similar).toHaveAttribute('stroke-dasharray', '3 3');
    const contains = document.querySelector('line[data-kind="contains"]')!;
    expect(contains).not.toHaveAttribute('stroke-dasharray');
  });
});

describe('VIS-W4-03 — DOM/list alternative + selection sync', () => {
  it('GraphList renders every node with status as text and every edge', () => {
    render(<GraphList data={MISSION} />);
    const root = document.querySelector('[data-graph-list]')!;
    expect(root.querySelectorAll('[aria-label="Nodes"] button')).toHaveLength(4);
    expect(root.querySelectorAll('[aria-label="Edges"] li')).toHaveLength(3);
    expect(screen.getAllByText('active')).toHaveLength(2); // status text, not color-only
    expect(root.querySelector('[data-edge="alice->s1"]')!.textContent).toContain('(delegates)');
  });

  it('selection is mirrored between canvas and list', () => {
    const onSelectNode = vi.fn();
    render(
      <>
        <AgentFlow data={MISSION} title="M" selectedId="s2" onSelectNode={onSelectNode} />
        <GraphList data={MISSION} selectedId="s2" onSelectNode={onSelectNode} />
      </>,
    );
    expect(document.querySelector('g[data-node="s2"]')).toHaveAttribute('data-selected');
    expect(document.querySelector('circle[data-selection-ring]')).toBeInTheDocument();
    const listBtn = document.querySelector('[data-graph-list] button[data-node="s2"]')!;
    expect(listBtn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(listBtn);
    expect(onSelectNode).toHaveBeenCalledWith('s2');
  });

  it('svg nodes are keyboard-operable when onSelectNode is set', () => {
    const onSelectNode = vi.fn();
    render(<AgentFlow data={MISSION} title="M" onSelectNode={onSelectNode} />);
    const node = document.querySelector('g[data-node="s1"]')!;
    expect(node).toHaveAttribute('role', 'button');
    fireEvent.keyDown(node, { key: 'Enter' });
    expect(onSelectNode).toHaveBeenCalledWith('s1');
  });

  it('GraphLegend lists kinds, statuses and edge kinds as text+swatch', () => {
    render(<GraphLegend data={ROUTER} />);
    const legend = document.querySelector('[data-graph-legend]')!;
    expect(legend.querySelector('[data-legend-kind="role"]')).toBeInTheDocument();
    expect(legend.querySelector('[data-legend-kind="model"]')).toBeInTheDocument();
    expect(legend.querySelector('[data-legend-edge="fallback"]')).toBeInTheDocument();
    render(<GraphLegend data={MISSION} />);
    expect(document.querySelector('[data-legend-status="active"]')).toBeInTheDocument();
    expect(document.querySelector('[data-legend-status="done"]')).toBeInTheDocument();
  });

  it('node confidence is a declarative contract field, not a fabricated color', () => {
    const data: NexusGraphData = {
      nodes: [{ id: 'm1', label: 'lake memory', kind: 'note', confidence: 'moderate' }],
      edges: [],
    };
    render(<GraphList data={data} />);
    expect(document.querySelector('button[data-node="m1"]')).toBeInTheDocument();
  });

  it('maxNodes/maxEdges cap the DOM with honest "+N more" markers (W4-07)', () => {
    render(<GraphList data={MISSION} maxNodes={2} maxEdges={1} />);
    expect(document.querySelectorAll('[data-node]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-edge]')).toHaveLength(1);
    expect(screen.getByText(`+${MISSION.nodes.length - 2} more nodes`)).toBeInTheDocument();
    expect(screen.getByText(`+${MISSION.edges.length - 1} more edges`)).toBeInTheDocument();
  });
});

describe('statusVar', () => {
  it('maps mission states to generated state tokens', () => {
    expect(statusVar('active')).toBe('var(--nexus-state-active)');
    expect(statusVar('done')).toBe('var(--nexus-state-complete)');
    expect(statusVar('failed')).toBe('var(--nexus-state-error)');
    expect(statusVar('skipped')).toBe('var(--nexus-state-offline)');
    expect(statusVar('pending')).toBe('var(--nexus-state-waiting)');
    expect(statusVar(undefined)).toBe('var(--nexus-chart-axis)');
  });
});

describe('W4-07 SVG caps (capGraphData)', () => {
  it('caps nodes and drops dangling edges to hidden nodes', () => {
    const big: NexusGraphData = {
      nodes: Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, label: `n${i}` })),
      edges: [
        { from: 'n0', to: 'n1' },   // survives
        { from: 'n4', to: 'n5' },   // dangling after cap — must not render
      ],
    };
    const capped = capGraphData(big, { maxNodes: 3 });
    expect(capped.nodes).toHaveLength(3);
    expect(capped.edges).toHaveLength(1); // dangling edge dropped, not drawn
    expect(capped.hidden.nodes).toBe(3);
  });

  it('SVG canvas surfaces truncation as a text marker', () => {
    const big: NexusGraphData = {
      nodes: Array.from({ length: 4 }, (_, i) => ({ id: `n${i}`, label: `n${i}`, kind: 'agent' })),
      edges: [{ from: 'n0', to: 'n3' }],
    };
    render(<AgentFlow data={big} title="t" maxNodes={2} />);
    expect(document.querySelector('[data-truncated]')?.textContent).toContain('+2 nodes');
    expect(document.querySelector('[data-truncated]')?.textContent).toContain('capped');
  });

  it('under the cap nothing is marked as truncated', () => {
    render(<AgentFlow data={MISSION} title="t" />);
    expect(document.querySelector('[data-truncated]')).toBeNull();
  });
});
