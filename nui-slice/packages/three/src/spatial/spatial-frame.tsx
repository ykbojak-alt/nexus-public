import type { HTMLAttributes } from 'react';
import { renderSpatialState, type SpatialEdgeInput, type SpatialKind, type SpatialNodeInput } from './spatial-state';
import { SpatialWebGL } from './spatial-webgl';
import { SpatialFallbackSvg } from '../fallbacks/spatial-fallback';
import { resolveDeterminism, type DeterministicProps } from '../runtime/determinism';
import { resolveQuality, type VisualQuality } from '../runtime/quality';
import { resolveReducedMotion } from '../runtime/reduced-motion';
import { detectWebGLBrowser, hasWebGL, type WebGLSupport } from '../runtime/webgl-support';

export interface SpatialVizProps extends HTMLAttributes<HTMLDivElement>, DeterministicProps {
  kind: SpatialKind;
  title: string;
  nodes: SpatialNodeInput[];
  edges?: SpatialEdgeInput[];
  visualQuality?: VisualQuality;
  webglSupport?: WebGLSupport;
  reducedMotion?: boolean;
  /** Inactive-scene policy — suspends the frame loop without unmounting. */
  suspended?: boolean;
  width?: number;
  height?: number;
}

/** Shared spatial frame — same quality/fallback contract as CoreViz. */
export function SpatialViz({
  kind,
  title,
  nodes,
  edges,
  visualQuality,
  webglSupport,
  reducedMotion,
  suspended = false,
  testMode,
  seed,
  animationTime,
  width = 480,
  height = 480,
  ...rest
}: SpatialVizProps) {
  const det = resolveDeterminism({ testMode, seed, animationTime });
  const support = webglSupport ?? detectWebGLBrowser();
  const q = resolveQuality({ requested: visualQuality, webglAvailable: hasWebGL(support), reducedMotion: resolveReducedMotion(reducedMotion) });
  const state = renderSpatialState(kind, { nodes, edges }, det);

  return (
    <div
      data-testid={`spatial-${kind}`}
      data-quality={q.quality}
      data-frozen={q.frozen || suspended || undefined}
      data-suspended={suspended || undefined}
      data-testmode={det.testMode || undefined}
      role="img"
      aria-label={title}
      {...rest}
    >
      {q.useFallback || nodes.length === 0 ? (
        <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden>
          <title>{title}</title>
          <SpatialFallbackSvg state={state} width={width} height={height} />
        </svg>
      ) : (
        <SpatialWebGL state={state} frozen={q.frozen || det.testMode || suspended} dprCap={q.dprCap} width={width} height={height} />
      )}
    </div>
  );
}
