import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { renderSpatialState, projectNode } from './spatial-state';
import { AgentConstellation } from './agent-constellation';
import { MissionGlobe } from './mission-globe';
import { MemorySphere } from './memory-sphere';
import { KnowledgeOrb } from './knowledge-orb';

afterEach(cleanup);

const NODES = [
  { id: 'alice', label: 'ALICE', kind: 'agent', status: 'active' },
  { id: 'mech', label: 'MECH', kind: 'agent' },
  { id: 'codex', label: 'CODEX', kind: 'agent' },
  { id: 'task', label: 'task', kind: 'step' },
];
const EDGES = [
  { from: 'alice', to: 'task', kind: 'delegates' },
  { from: 'mech', to: 'task', kind: 'delegates' },
];

describe('renderSpatialState — deterministic contract', () => {
  it('same (kind,data,seed,t) → identical positions', () => {
    const a = renderSpatialState('constellation', { nodes: NODES, edges: EDGES }, { testMode: true, seed: 42, animationTime: 0 });
    const b = renderSpatialState('constellation', { nodes: NODES, edges: EDGES }, { testMode: true, seed: 42, animationTime: 0 });
    expect(a).toEqual(b);
  });

  it('node positions are id-stable across input order', () => {
    const a = renderSpatialState('globe', { nodes: NODES }, { seed: 1 });
    const b = renderSpatialState('globe', { nodes: [...NODES].reverse() }, { seed: 1 });
    const pa = a.nodes.find((n) => n.id === 'alice')!;
    const pb = b.nodes.find((n) => n.id === 'alice')!;
    expect(pa.x).toBeCloseTo(pb.x, 10);
    expect(pa.y).toBeCloseTo(pb.y, 10);
  });

  // W4-05: canonical capture — byte-identical state across 3 renders,
  // every spatial kind. Positions already proven id-stable above.
  it.each(['constellation', 'globe', 'sphere', 'orb'] as const)(
    'kind "%s" yields byte-identical state across 3 captures',
    (kind) => {
      const det = { testMode: true, seed: 42, animationTime: 2400 } as const;
      const shots = [1, 2, 3].map(() => JSON.stringify(renderSpatialState(kind, { nodes: NODES, edges: EDGES }, det)));
      expect(shots[0]).toBe(shots[1]);
      expect(shots[1]).toBe(shots[2]);
    },
  );

  it('projects to 2D orthographically — Y-rotation moves projected x', () => {
    // Direct unit test of the projection math — fibonacci node[0] sits on
    // the pole by construction, so we project an explicit off-pole point.
    const n = { id: 'p', x: 0.8, y: 0.2, z: 0.3, size: 0.05, toneIndex: 0 };
    const p0 = projectNode(n, 0, 100, 100, 80);
    const p1 = projectNode(n, Math.PI / 2, 100, 100, 80);
    expect(p0.px).not.toBeCloseTo(p1.px, 3);
    expect(p0.px).toBeCloseTo(100 + 0.8 * 80, 3);
    expect(p1.px).toBeCloseTo(100 - 0.3 * 80, 3); // x' = -z after 90°
    expect(p0.depth).toBeCloseTo((0.3 + 1) / 2, 5);
    expect(p1.depth).toBeCloseTo((0.8 + 1) / 2, 5); // z' = x after 90°
  });
});

describe('spatial components — fallback contract (Task 13 Step 1)', () => {
  it('uses DOM/SVG fallback when quality is reduced', () => {
    render(<AgentConstellation visualQuality="reduced" nodes={NODES} edges={EDGES} webglSupport="webgl2" />);
    const img = screen.getByRole('img', { name: /agent constellation/i });
    expect(img).toHaveAttribute('data-quality', 'reduced');
    expect(document.querySelectorAll('[data-node]')).toHaveLength(4);
    expect(document.querySelector('line[data-edge="alice->task"]')).toBeInTheDocument();
  });

  it('falls back when WebGL is unavailable (jsdom path)', () => {
    render(<MissionGlobe nodes={NODES} />);
    expect(screen.getByRole('img', { name: /mission globe/i })).toHaveAttribute('data-quality', 'reduced');
  });

  it('empty data still renders the hull honestly', () => {
    render(<MemorySphere nodes={[]} webglSupport="none" />);
    expect(document.querySelector('[data-el="hull"]')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-node]')).toHaveLength(0);
  });

  it('suspended marks data-suspended without dropping the scene', () => {
    render(<AgentConstellation nodes={NODES} edges={EDGES} webglSupport="none" suspended />);
    const img = screen.getByRole('img', { name: /agent constellation/i });
    expect(img).toHaveAttribute('data-suspended', 'true');
    expect(document.querySelectorAll('[data-node]')).toHaveLength(4);
  });

  it('knowledge orb draws ring scaffolding', () => {
    render(<KnowledgeOrb nodes={NODES} webglSupport="none" />);
    expect(document.querySelectorAll('ellipse[data-el="ring"]')).toHaveLength(3);
  });
});
