import type { HTMLAttributes } from 'react';
import { renderCoreState, type CoreKind } from './core-state';
import { CoreCanvas } from './core-webgl';
import { CoreFallbackSvg } from '../fallbacks/core-fallback';
import { resolveDeterminism, type DeterministicProps } from '../runtime/determinism';
import { resolveQuality, type VisualQuality } from '../runtime/quality';
import { resolveReducedMotion } from '../runtime/reduced-motion';
import { detectWebGLBrowser, hasWebGL, type WebGLSupport } from '../runtime/webgl-support';

export interface CoreVizProps extends HTMLAttributes<HTMLDivElement>, DeterministicProps {
  kind: CoreKind;
  title: string;
  description?: string;
  visualQuality?: VisualQuality;
  /** Injectable for tests — defaults to browser detection. */
  webglSupport?: WebGLSupport;
  /** prefers-reduced-motion — freezes pose without degrading tier. */
  reducedMotion?: boolean;
  /**
   * Inactive-scene policy (spec §10): suspends the frame loop without
   * unmounting — GL context stays, no GPU ticks. Consumers set it from
   * their own visibility/focus signals.
   */
  suspended?: boolean;
  width?: number;
  height?: number;
}

/**
 * Shared core-scene frame: resolves determinism + WebGL support +
 * quality tier, then renders WebGL or the SVG fallback twin.
 */
export function CoreViz({
  kind,
  title,
  description,
  visualQuality,
  webglSupport,
  reducedMotion,
  suspended = false,
  testMode,
  seed,
  animationTime,
  width = 320,
  height = 320,
  ...rest
}: CoreVizProps) {
  const det = resolveDeterminism({ testMode, seed, animationTime });
  const support = webglSupport ?? detectWebGLBrowser();
  const q = resolveQuality({
    requested: visualQuality,
    webglAvailable: hasWebGL(support),
    reducedMotion: resolveReducedMotion(reducedMotion),
  });
  const state = renderCoreState(kind, det);

  return (
    <div
      data-testid={`core-${kind}`}
      data-quality={q.quality}
      data-frozen={q.frozen || suspended || undefined}
      data-suspended={suspended || undefined}
      data-testmode={det.testMode || undefined}
      role="img"
      aria-label={title}
      {...rest}
    >
      {q.useFallback ? (
        <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden>
          <title>{title}</title>
          {description ? <desc>{description}</desc> : null}
          <CoreFallbackSvg state={state} width={width} height={height} />
        </svg>
      ) : (
        <CoreCanvas state={state} frozen={q.frozen || det.testMode || suspended} dprCap={q.dprCap} width={width} height={height} />
      )}
    </div>
  );
}
