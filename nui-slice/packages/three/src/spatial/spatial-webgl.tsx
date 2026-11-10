/** WebGL renderer for SpatialSceneState — points + arcs over a hull. */

import { Canvas, useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group } from 'three';
import { tokenColor } from '../cores/core-webgl';
import { FrameStatsProbe } from '../runtime/frame-stats';
import type { SpatialSceneState } from './spatial-state';

function Scene({ state, frozen }: { state: SpatialSceneState; frozen: boolean }) {
  const group = useRef<Group>(null);
  useFrame((_s, delta) => {
    if (!frozen && group.current) group.current.rotation.y += delta * 0.08;
  });
  const pos = new Map(state.nodes.map((n) => [n.id, n]));
  return (
    <group ref={group}>
      <mesh>
        <sphereGeometry args={[1, 32, 32]} />
        <meshBasicMaterial color={tokenColor(state.kind === 'sphere' ? 3 : 0)} transparent opacity={0.06} wireframe />
      </mesh>
      {state.edges.map((e, i) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) return null;
        const geo = new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z]);
        return (
          <lineSegments key={`${e.from}->${e.to}-${i}`}>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[geo, 3]} />
            </bufferGeometry>
            <lineBasicMaterial color={tokenColor(7)} transparent opacity={0.55} />
          </lineSegments>
        );
      })}
      {state.nodes.map((n) => (
        <mesh key={n.id} position={[n.x, n.y, n.z]}>
          <sphereGeometry args={[n.size, 12, 12]} />
          <meshBasicMaterial color={tokenColor(n.toneIndex)} />
        </mesh>
      ))}
    </group>
  );
}

export function SpatialWebGL({
  state,
  frozen,
  dprCap,
  width,
  height,
}: {
  state: SpatialSceneState;
  frozen: boolean;
  dprCap: number;
  width: number;
  height: number;
}) {
  return (
    <Canvas
      dpr={Math.min(dprCap, 2)}
      frameloop={frozen ? 'never' : 'always'}
      gl={{ antialias: true, alpha: true }}
      camera={{ position: [0, 0, 2.6], fov: 40 }}
      style={{ width, height }}
      aria-hidden
    >
      <Scene state={state} frozen={frozen} />
      <FrameStatsProbe />
    </Canvas>
  );
}
