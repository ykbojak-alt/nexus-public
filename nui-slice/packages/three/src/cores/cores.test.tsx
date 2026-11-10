import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { renderCoreState } from './core-state';
import { NexusCore } from './nexus-core';
import { AliceHalo } from './alice-halo';
import { MechCore } from './mech-core';
import { ForgeCrystal } from './forge-crystal';
import { CodexGeometry } from './codex-geometry';
import { ArchMemoryCore } from './arch-memory-core';
import type { CoreKind } from './core-state';

afterEach(cleanup);

const KINDS: CoreKind[] = ['nexus', 'alice', 'mech', 'forge', 'codex', 'arch'];

describe('renderCoreState — deterministic contract (Task 13 Step 1)', () => {
  it('freezes core state in test mode: identical props → identical state', () => {
    const a = renderCoreState('nexus', { testMode: true, seed: 42, animationTime: 0 });
    const b = renderCoreState('nexus', { testMode: true, seed: 42, animationTime: 0 });
    expect(a).toEqual(b);
  });

  it('every kind produces a deterministic, non-degenerate state', () => {
    for (const kind of KINDS) {
      const s = renderCoreState(kind, { seed: 7, animationTime: 1500 });
      const total = s.rings.length + s.orbiters.length + s.spokes.length + s.layers.length + s.facets.length;
      expect(total, kind).toBeGreaterThan(0);
      expect(s.pulse).toBeGreaterThanOrEqual(0);
      expect(s.pulse).toBeLessThanOrEqual(1);
    }
  });

  it('different seeds produce different layouts; different time shifts pose', () => {
    const a = renderCoreState('nexus', { seed: 1, animationTime: 0 });
    const b = renderCoreState('nexus', { seed: 2, animationTime: 0 });
    expect(a.orbiters[0].angle).not.toBe(b.orbiters[0].angle);
    const c = renderCoreState('nexus', { seed: 1, animationTime: 800 });
    expect(c.orbiters[0].angle).not.toBe(a.orbiters[0].angle);
  });

  // W4-04: canonical capture requires ≥3 identical renders — verify state
  // is byte-identical across three calls for every signature kind.
  it.each(KINDS)('kind "%s" yields byte-identical state across 3 captures', (kind) => {
    const det = { testMode: true, seed: 42, animationTime: 1200 } as const;
    const shots = [1, 2, 3].map(() => JSON.stringify(renderCoreState(kind, det)));
    expect(shots[0]).toBe(shots[1]);
    expect(shots[1]).toBe(shots[2]);
  });
});

describe('core components — quality/fallback contract', () => {
  it('renders SVG fallback (role=img) when WebGL is unavailable', () => {
    render(<NexusCore webglSupport="none" />);
    const img = screen.getByRole('img', { name: /nexus core/i });
    expect(img).toHaveAttribute('data-quality', 'reduced');
    expect(img.querySelector('[data-core-kind="nexus"]')).toBeInTheDocument();
  });

  it('visualQuality="reduced" forces the DOM/SVG fallback even with WebGL', () => {
    render(<AliceHalo visualQuality="reduced" webglSupport="webgl2" />);
    expect(screen.getByRole('img', { name: /alice halo/i })).toHaveAttribute('data-quality', 'reduced');
  });

  it('marks testMode and frozen pose attributes deterministically', () => {
    render(<MechCore webglSupport="none" testMode seed={42} animationTime={1200} />);
    const img = screen.getByRole('img', { name: /mech core/i });
    expect(img).toHaveAttribute('data-testmode', 'true');
    const svg = img.querySelector('[data-core-kind="mech"]')!;
    expect(svg.querySelectorAll('[data-el="orbiter"]')).toHaveLength(8);
  });

  it('marks the frozen pose on the DOM (tier preservation is a resolveQuality contract)', () => {
    // jsdom has no ResizeObserver/WebGL — the Canvas path is exercised in
    // e2e (Task 18). Here we assert data-frozen plumbing reaches the DOM;
    // "reducedMotion doesn't demote tier" is covered in runtime.test.ts.
    render(<ForgeCrystal webglSupport="none" reducedMotion />);
    expect(screen.getByRole('img', { name: /forge/i })).toHaveAttribute('data-frozen', 'true');
  });

  it('suspended marks data-suspended/data-frozen without unmounting', () => {
    render(<NexusCore webglSupport="none" suspended />);
    const img = screen.getByRole('img', { name: /nexus core/i });
    expect(img).toHaveAttribute('data-suspended', 'true');
    expect(img).toHaveAttribute('data-frozen', 'true');
    expect(img.querySelector('[data-core-kind="nexus"]')).toBeInTheDocument();
  });

  it('all six cores render distinct deterministic kinds', () => {
    render(
      <>
        <NexusCore webglSupport="none" />
        <AliceHalo webglSupport="none" />
        <MechCore webglSupport="none" />
        <ForgeCrystal webglSupport="none" />
        <CodexGeometry webglSupport="none" />
        <ArchMemoryCore webglSupport="none" />
      </>,
    );
    for (const kind of KINDS) {
      expect(document.querySelector(`[data-core-kind="${kind}"]`)).toBeInTheDocument();
    }
  });
});
