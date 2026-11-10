import { useFrame } from '@react-three/fiber';

/**
 * Perf-measurement probe (W4-08): publishes the renderer's per-frame
 * stats to `window.__nexusGL` so the e2e harness can read honest
 * draw-call/triangle counts. No-ops where `window` is absent.
 * `gl.info` resets each render — a useFrame read yields the
 * previous frame's numbers, which is exactly what we want.
 */
export interface NexusGLFrameStats {
  frame: number;
  calls: number;
  triangles: number;
  points: number;
  lines: number;
  geometries: number;
  textures: number;
  programs: number;
}

export function FrameStatsProbe() {
  useFrame(({ gl }) => {
    (window as unknown as { __nexusGL?: NexusGLFrameStats }).__nexusGL = {
      frame: gl.info.render.frame,
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      points: gl.info.render.points,
      lines: gl.info.render.lines,
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      programs: gl.info.programs?.length ?? 0,
    };
  });
  return null;
}
