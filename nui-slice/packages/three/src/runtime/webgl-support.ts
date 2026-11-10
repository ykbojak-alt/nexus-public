/**
 * WebGL capability detection — injectable for tests. Detection failure
 * is a normal path (SSR, jsdom, headless, disabled GPU), not an error:
 * callers receive `false` and render the 2D/DOM fallback.
 */

export type WebGLSupport = 'webgl2' | 'webgl1' | 'none';

/** Minimal canvas factory surface — injectable so tests avoid real DOM. */
export interface CanvasLike {
  getContext(name: string): unknown;
}

export function detectWebGL(createCanvas: () => CanvasLike | null): WebGLSupport {
  try {
    const canvas = createCanvas();
    if (!canvas) return 'none';
    if (canvas.getContext('webgl2')) return 'webgl2';
    if (canvas.getContext('webgl')) return 'webgl1';
    return 'none';
  } catch {
    return 'none';
  }
}

/** Browser default — safe to call in any environment. */
export function detectWebGLBrowser(): WebGLSupport {
  if (typeof document === 'undefined') return 'none';
  return detectWebGL(() => document.createElement('canvas'));
}

/** Whether the detected support can host a scene at all. */
export function hasWebGL(support: WebGLSupport): boolean {
  return support !== 'none';
}
