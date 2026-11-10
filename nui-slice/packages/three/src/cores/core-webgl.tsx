/**
 * WebGL renderer for CoreSceneState — the 3D twin of CoreFallbackSvg.
 * Same deterministic state → same composition, only the medium differs.
 * Colors resolve from generated --nexus-chart-series-* CSS vars at
 * mount (getComputedStyle); in non-DOM contexts a neutral token-safe
 * fallback is used so testMode never depends on real stylesheets.
 */

import { Canvas, useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group } from 'three';
import type { CoreSceneState } from './core-state';
import { FrameStatsProbe } from '../runtime/frame-stats';

const PALETTE_VARS = Array.from({ length: 8 }, (_, i) => `--nexus-chart-series-${i + 1}`);
const FALLBACK_HEX = ['#8ea2ff', '#9aa3b2', '#ffb35c', '#b58cff', '#7fd8a8', '#ff7d7d', '#e6c76a', '#8f9aa8'];

/** Resolve a generated token to a concrete color for WebGL materials. */
export function tokenColor(toneIndex: number): string {
  const slot = ((toneIndex % 8) + 8) % 8;
  if (typeof window !== 'undefined' && typeof getComputedStyle === 'function') {
    const v = getComputedStyle(document.documentElement).getPropertyValue(PALETTE_VARS[slot]).trim();
    if (v) return v;
  }
  return FALLBACK_HEX[slot];
}

export function CoreWebGL({ state, frozen }: { state: CoreSceneState; frozen: boolean }) {
  const group = useRef<Group>(null);
  useFrame((_s, delta) => {
    if (!frozen && group.current) group.current.rotation.z += delta * 0.05;
  });
  return (
    <group ref={group}>
      {state.rings.map((ring, i) => (
        <mesh key={`ring-${i}`} rotation={[-Math.PI / 3, 0, 0]}>
          <torusGeometry args={[ring.radius, 0.006, 8, 96]} />
          <meshBasicMaterial color={tokenColor(ring.toneIndex)} transparent opacity={ring.opacity} />
        </mesh>
      ))}
      {state.layers.map((layer) => (
        <mesh key={`layer-${layer.index}`} rotation={[layer.index * 0.35, layer.index * 0.5, 0]}>
          <boxGeometry args={[layer.size, layer.size, layer.size * 0.08]} />
          <meshBasicMaterial color={tokenColor(layer.toneIndex)} transparent opacity={0.15 + layer.progress * 0.6} wireframe />
        </mesh>
      ))}
      {state.spokes.map((s, i) => {
        const geo = new Float32Array([0, 0, 0, Math.cos(s.angle) * s.length, Math.sin(s.angle) * s.length, 0]);
        return (
          <lineSegments key={`spoke-${i}`}>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[geo, 3]} />
            </bufferGeometry>
            <lineBasicMaterial color={tokenColor(s.toneIndex)} transparent opacity={0.8} />
          </lineSegments>
        );
      })}
      {state.facets.map((f, i) => (
        <mesh key={`facet-${i}`} position={[Math.cos(f.angle) * f.dist, Math.sin(f.angle) * f.dist, 0]}>
          <octahedronGeometry args={[f.size]} />
          <meshBasicMaterial color={tokenColor(f.toneIndex)} transparent opacity={0.4 + state.pulse * 0.45} />
        </mesh>
      ))}
      {state.orbiters.map((o, i) => (
        <mesh key={`orb-${i}`} position={[Math.cos(o.angle) * o.radius, Math.sin(o.angle) * o.radius, 0]}>
          <sphereGeometry args={[o.size, 16, 16]} />
          <meshBasicMaterial color={tokenColor(o.toneIndex)} />
        </mesh>
      ))}
      <mesh>
        <sphereGeometry args={[0.09, 24, 24]} />
        <meshBasicMaterial color={tokenColor(0)} transparent opacity={0.5 + state.pulse * 0.5} />
      </mesh>
    </group>
  );
}

/** Canvas wrapper — DPR-capped, deterministic when frozen. */
export function CoreCanvas({
  state,
  frozen,
  dprCap,
  width,
  height,
  onCreated,
}: {
  state: CoreSceneState;
  frozen: boolean;
  dprCap: number;
  width: number;
  height: number;
  onCreated?: () => void;
}) {
  const frameloop = frozen ? 'never' : 'always';
  return (
    <Canvas
      dpr={Math.min(dprCap, 2)}
      frameloop={frameloop}
      gl={{ antialias: true, alpha: true }}
      camera={{ position: [0, 0, 2.2], fov: 42 }}
      onCreated={() => onCreated?.()}
      style={{ width, height }}
      aria-hidden
    >
      <CoreWebGL state={state} frozen={frozen} />
      <FrameStatsProbe />
    </Canvas>
  );
}
