import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useState,
  type ErrorInfo,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { renderCoreState, type CoreKind } from '../cores/core-state';
import { CoreFallbackSvg } from '../fallbacks/core-fallback';
import { resolveDeterminism, type DeterministicProps } from '../runtime/determinism';
import { resolveQuality, type VisualQuality } from '../runtime/quality';
import { detectWebGLBrowser, hasWebGL, type WebGLSupport } from '../runtime/webgl-support';

const LazyCoreCanvas = lazy(() =>
  import('../cores/core-webgl').then(({ CoreCanvas }) => ({ default: CoreCanvas })),
);

class WebGLPreviewBoundary extends Component<{
  children: ReactNode;
  fallback: ReactNode;
  onError: () => void;
}, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    this.props.onError();
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * XV W4 — light static preview of the assistant scene for the
 * scene-launch tile on /home. The composition is the assistant's
 * deterministic core state (the same identity the UE scene switches
 * by); nothing here invents scene contents, coordinates or statuses.
 *
 * Bridge states come from the host tile verbatim. `unavailable` — the
 * seam is missing in this source (mock/app); `unknown` — the bridge did
 * not answer; the rest mirror `UnrealSceneStatus` 1:1. The preview never
 * upgrades a bridge state locally.
 */
export type ScenePreviewBridge =
  | 'connected'
  | 'starting'
  | 'disconnected'
  | 'stale'
  | 'error'
  | 'not-installed'
  | 'unknown'
  | 'unavailable';

/** Bridge states that mean "the scene bridge did not answer". */
const BRIDGE_NOT_ANSWERING: ReadonlySet<ScenePreviewBridge> = new Set(['unknown', 'unavailable']);

/** Persona id → deterministic core kind; unknown ids stay unknown. */
const PERSONA_CORES: Readonly<Record<string, CoreKind>> = {
  nexus: 'nexus',
  alice: 'alice',
  mech: 'mech',
  forge: 'forge',
  codex: 'codex',
  arch: 'arch',
};

/** Map a product persona id to a core kind; null when the id is unknown. */
export function previewCoreFor(persona?: string | null): CoreKind | null {
  if (persona == null) return null;
  return PERSONA_CORES[persona.trim().toLowerCase()] ?? null;
}

export interface ScenePreviewProps extends HTMLAttributes<HTMLDivElement>, DeterministicProps {
  /** Active assistant from product data; an unknown id renders the honest empty state. */
  persona?: string;
  /** Verbatim bridge state from the scene-launch tile — never upgraded here. */
  bridge: ScenePreviewBridge;
  /** Assistant display name from product data; only used in the accessible name. */
  personaLabel?: string;
  visualQuality?: VisualQuality;
  /** Injectable for tests — defaults to browser detection. */
  webglSupport?: WebGLSupport;
  /** Parent visibility signal; inactive previews retain only the SVG twin. */
  visible?: boolean;
  /** Scene selection/request signal; false prevents a WebGL mount. */
  requested?: boolean;
  width?: number;
  height?: number;
  /** Accessible name override; defaults to a Russian label built from the persona. */
  title?: string;
}

/**
 * Static scene preview: assistant core state, frozen by construction
 * (no frame loop, no wall clock), so `prefers-reduced-motion` is honoured
 * without a separate branch. Without WebGL (or at `reduced` quality) the
 * SVG twin of the exact same state is rendered — never a broken canvas.
 * When the bridge does not answer, the local composition stays but the
 * caption says so; the preview never pretends to be the live scene.
 */
export function ScenePreview({
  persona,
  bridge,
  personaLabel,
  visualQuality,
  webglSupport,
  visible = true,
  requested = true,
  testMode,
  seed,
  animationTime,
  width = 240,
  height = 160,
  title,
  className,
  ...rest
}: ScenePreviewProps) {
  const det = resolveDeterminism({ testMode, seed, animationTime });
  const support = webglSupport ?? detectWebGLBrowser();
  const q = resolveQuality({
    requested: visualQuality,
    webglAvailable: hasWebGL(support),
    reducedMotion: true,
  });
  const core = previewCoreFor(persona);
  const state = core == null ? null : renderCoreState(core, { seed: det.seed, animationTime: det.animationTime });
  const canUseWebGL = core != null && visible && requested && !q.useFallback;
  const [rendererReady, setRendererReady] = useState(false);
  const [rendererFailed, setRendererFailed] = useState(false);
  const markRendererReady = useCallback(() => setRendererReady(true), []);
  const markRendererFailed = useCallback(() => setRendererFailed(true), []);

  useEffect(() => {
    if (!canUseWebGL) {
      setRendererReady(false);
      setRendererFailed(false);
    }
  }, [canUseWebGL, core]);

  const name = personaLabel?.trim() || null;
  const label =
    title ??
    (core == null
      ? 'Предпросмотр сцены недоступен'
      : `Предпросмотр сцены${name != null ? ` · ${name}` : ''}`);
  const note =
    core == null
      ? 'Ассистент не определён — сцена не выбрана'
      : BRIDGE_NOT_ANSWERING.has(bridge)
        ? 'Мост сцены недоступен · статичный предпросмотр'
        : bridge === 'starting'
          ? 'Сцена запускается · статичный предпросмотр'
          : bridge === 'stale'
            ? 'Состояние моста устарело · статичный предпросмотр'
            : 'Статичный предпросмотр';
  const rendererState =
    core == null ? 'unavailable'
      : !visible || !requested ? 'inactive'
        : !canUseWebGL ? 'svg'
          : rendererFailed ? 'unavailable'
            : rendererReady ? 'ready' : 'loading';
  const svgFallback = state == null ? null : (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden>
      <CoreFallbackSvg state={state} width={width} height={height} />
    </svg>
  );

  return (
    <div
      data-testid="scene-preview"
      data-bridge={bridge}
      data-core={core ?? undefined}
      data-persona={persona ?? undefined}
      data-visual={
        state == null
          ? undefined
          : canUseWebGL && rendererReady && !rendererFailed
            ? 'webgl'
            : 'svg'
      }
      data-quality={q.quality}
      data-frozen="true"
      data-state={core == null ? 'unavailable' : bridge}
      data-renderer-state={rendererState}
      data-testmode={det.testMode || undefined}
      role="img"
      aria-label={label}
      className={className}
      {...rest}
    >
      {state == null ? null : !canUseWebGL || !rendererReady || rendererFailed ? svgFallback : null}
      {canUseWebGL && !rendererFailed && state != null && (
        <WebGLPreviewBoundary fallback={null} onError={markRendererFailed}>
          <Suspense fallback={null}>
            <LazyCoreCanvas
              state={state}
              frozen
              dprCap={q.dprCap}
              width={width}
              height={height}
              onCreated={markRendererReady}
            />
          </Suspense>
        </WebGLPreviewBoundary>
      )}
      {rendererState === 'loading' && (
        <span role="status" data-testid="scene-preview-loading">Подготовка 3D-предпросмотра</span>
      )}
      {rendererFailed && (
        <span role="status" data-testid="scene-preview-renderer-unavailable">
          3D-рендерер недоступен · показан статичный предпросмотр
        </span>
      )}
      <span data-testid="scene-preview-note">{note}</span>
    </div>
  );
}
