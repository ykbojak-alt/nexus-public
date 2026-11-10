import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const rendererLifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));

vi.mock('../cores/core-webgl', async () => {
  const React = await import('react');
  return {
    CoreCanvas: ({ onCreated }: { onCreated?: () => void }) => {
      React.useEffect(() => {
        rendererLifecycle.mounts += 1;
        onCreated?.();
        return () => { rendererLifecycle.unmounts += 1; };
      }, []);
      return React.createElement('canvas', { 'data-testid': 'scene-preview-canvas' });
    },
  };
});

import { ScenePreview } from './scene-preview';

afterEach(() => {
  cleanup();
  rendererLifecycle.mounts = 0;
  rendererLifecycle.unmounts = 0;
});

describe('ScenePreview renderer lifecycle', () => {
  it('keeps WebGL out of inactive previews and disposes/reopens one deterministic canvas', async () => {
    const props = {
      persona: 'alice',
      bridge: 'connected' as const,
      webglSupport: 'webgl2' as const,
      testMode: true,
      seed: 42,
      animationTime: 1200,
    };
    const { container, rerender } = render(
      <ScenePreview {...props} visible={false} />,
    );
    const initialSvg = container.querySelector('svg')?.outerHTML;
    expect(screen.getByTestId('scene-preview')).toHaveAttribute('data-renderer-state', 'inactive');
    expect(screen.queryByTestId('scene-preview-canvas')).not.toBeInTheDocument();
    expect(rendererLifecycle.mounts).toBe(0);

    rerender(<ScenePreview {...props} visible />);
    expect(screen.getByTestId('scene-preview')).toHaveAttribute('data-renderer-state', 'loading');
    expect(screen.getByTestId('scene-preview-loading')).toBeInTheDocument();
    const firstCanvas = await screen.findByTestId('scene-preview-canvas');
    await waitFor(() => expect(screen.getByTestId('scene-preview')).toHaveAttribute('data-renderer-state', 'ready'));
    expect(rendererLifecycle.mounts).toBe(1);
    expect(screen.queryByTestId('scene-preview-loading')).not.toBeInTheDocument();

    // A theme/persona rerender updates the scene without replacing its renderer.
    rerender(
      <ScenePreview
        {...props}
        persona="mech"
        personaLabel="M.E.C.H."
        visible
        className="theme-dark"
      />,
    );
    expect(screen.getByTestId('scene-preview-canvas')).toBe(firstCanvas);
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
    expect(rendererLifecycle.mounts).toBe(1);

    rerender(<ScenePreview {...props} visible={false} />);
    await waitFor(() => expect(screen.queryByTestId('scene-preview-canvas')).not.toBeInTheDocument());
    expect(rendererLifecycle.unmounts).toBe(1);
    expect(screen.getByTestId('scene-preview')).toHaveAttribute('data-core', 'alice');

    rerender(<ScenePreview {...props} visible />);
    expect(await screen.findByTestId('scene-preview-canvas')).toBeInTheDocument();
    expect(rendererLifecycle.mounts).toBe(2);
    rerender(<ScenePreview {...props} visible={false} />);
    await waitFor(() => expect(screen.queryByTestId('scene-preview-canvas')).not.toBeInTheDocument());
    expect(container.querySelector('svg')?.outerHTML).toBe(initialSvg);
    expect(rendererLifecycle.unmounts).toBe(2);
  });

  it('preserves honest loading, bridge, and unavailable states', async () => {
    const { rerender } = render(
      <ScenePreview persona="forge" bridge="starting" webglSupport="webgl2" />,
    );
    expect(screen.getByTestId('scene-preview-note')).toHaveTextContent('Сцена запускается');
    await waitFor(() => expect(screen.getByTestId('scene-preview')).toHaveAttribute('data-renderer-state', 'ready'));

    rerender(<ScenePreview persona="forge" bridge="unavailable" webglSupport="none" />);
    expect(screen.getByTestId('scene-preview')).toHaveAttribute('data-renderer-state', 'svg');
    expect(screen.getByTestId('scene-preview-note')).toHaveTextContent('Мост сцены недоступен');
    expect(screen.queryByTestId('scene-preview-loading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scene-preview-canvas')).not.toBeInTheDocument();

    rerender(<ScenePreview persona="unknown" bridge="connected" webglSupport="webgl2" />);
    expect(screen.getByTestId('scene-preview')).toHaveAttribute('data-renderer-state', 'unavailable');
    expect(screen.queryByTestId('scene-preview-canvas')).not.toBeInTheDocument();
    expect(screen.getByTestId('scene-preview-note')).toHaveTextContent('Ассистент не определён');
  });
});
