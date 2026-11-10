import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { previewCoreFor, ScenePreview, type ScenePreviewBridge } from './scene-preview';

afterEach(cleanup);

const BRIDGES: ScenePreviewBridge[] = [
  'connected', 'starting', 'disconnected', 'stale', 'error', 'not-installed', 'unknown', 'unavailable',
];

describe('ScenePreview — light static preview for the scene-launch tile (XV W4)', () => {
  it('known persona without WebGL renders the SVG twin with an honest static note', () => {
    render(<ScenePreview persona="alice" bridge="disconnected" webglSupport="none" />);
    const el = screen.getByTestId('scene-preview');
    expect(el).toHaveAttribute('data-visual', 'svg');
    expect(el).toHaveAttribute('data-core', 'alice');
    expect(el).toHaveAttribute('data-quality', 'reduced');
    expect(el.querySelector('[data-core-kind="alice"]')).toBeInTheDocument();
    expect(screen.getByTestId('scene-preview-note')).toHaveTextContent('Статичный предпросмотр');
    expect(el).toHaveAttribute('role', 'img');
  });

  it('reduced quality forces the SVG twin even when WebGL is available (never a broken canvas)', () => {
    render(<ScenePreview persona="mech" bridge="connected" webglSupport="webgl2" visualQuality="reduced" />);
    expect(screen.getByTestId('scene-preview')).toHaveAttribute('data-visual', 'svg');
  });

  it.each(['unknown', 'unavailable'] as const)(
    'bridge "%s" (no answer): composition stays, note says the bridge is down',
    (bridge) => {
      render(<ScenePreview persona="forge" bridge={bridge} webglSupport="none" />);
      const el = screen.getByTestId('scene-preview');
      expect(el).toHaveAttribute('data-bridge', bridge);
      expect(el).toHaveAttribute('data-state', bridge);
      expect(el.querySelector('[data-core-kind="forge"]')).toBeInTheDocument();
      expect(screen.getByTestId('scene-preview-note')).toHaveTextContent(
        'Мост сцены недоступен · статичный предпросмотр',
      );
    },
  );

  it('bridge state is exposed verbatim on data-bridge for all host states', () => {
    for (const bridge of BRIDGES) {
      cleanup();
      render(<ScenePreview persona="codex" bridge={bridge} webglSupport="none" />);
      expect(screen.getByTestId('scene-preview')).toHaveAttribute('data-bridge', bridge);
    }
  });

  it('maps all six assistant personas (trim + case-insensitive); unknown id → honest empty state', () => {
    const cases: Array<[string, string]> = [
      ['nexus', 'nexus'],
      ['alice', 'alice'],
      ['  MECH ', 'mech'],
      ['forge', 'forge'],
      ['codex', 'codex'],
      ['arch', 'arch'],
    ];
    for (const [persona, kind] of cases) {
      cleanup();
      render(<ScenePreview persona={persona} bridge="disconnected" webglSupport="none" />);
      expect(screen.getByTestId('scene-preview').querySelector(`[data-core-kind="${kind}"]`)).toBeInTheDocument();
    }
    cleanup();
    expect(previewCoreFor('unknown-assistant')).toBeNull();
    expect(previewCoreFor(undefined)).toBeNull();
    render(<ScenePreview persona="unknown-assistant" bridge="disconnected" webglSupport="none" />);
    const el = screen.getByTestId('scene-preview');
    expect(el).toHaveAttribute('data-state', 'unavailable');
    expect(el).not.toHaveAttribute('data-core');
    expect(el).not.toHaveAttribute('data-visual');
    expect(el.querySelector('svg')).toBeNull();
    expect(screen.getByTestId('scene-preview-note')).toHaveTextContent('Ассистент не определён');
  });

  it('is frozen by construction — static composition, no animation loop to flake', () => {
    render(<ScenePreview persona="alice" bridge="connected" webglSupport="none" />);
    expect(screen.getByTestId('scene-preview')).toHaveAttribute('data-frozen', 'true');
  });

  it('deterministic capture: identical props → byte-identical markup', () => {
    const shots: string[] = [];
    for (let i = 0; i < 3; i++) {
      cleanup();
      const { container } = render(
        <ScenePreview persona="arch" bridge="stale" webglSupport="none" testMode seed={42} animationTime={1200} />,
      );
      shots.push(container.innerHTML);
    }
    expect(shots[0]).toBe(shots[1]);
    expect(shots[1]).toBe(shots[2]);
  });

  it('accessible name uses the persona label when provided, and stays Russian by default', () => {
    render(<ScenePreview persona="alice" personaLabel="AGENT-A" bridge="connected" webglSupport="none" />);
    expect(screen.getByRole('img', { name: 'Предпросмотр сцены · AGENT-A' })).toBeInTheDocument();
    cleanup();
    render(<ScenePreview persona="nexus" bridge="connected" webglSupport="none" />);
    expect(screen.getByRole('img', { name: 'Предпросмотр сцены' })).toBeInTheDocument();
  });
});
