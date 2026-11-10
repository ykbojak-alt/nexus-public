/**
 * SVG/DOM fallback for core scenes — renders the same CoreSceneState
 * the WebGL path consumes (spec §10: reduced quality / no WebGL must
 * still be an honest, branded visual, never a broken canvas).
 * Colors come from generated --nexus-chart-series-* vars.
 */

import { seriesVar } from '@nexus/ui';
import type { CoreSceneState } from '../cores/core-state';

export function CoreFallbackSvg({
  state,
  width,
  height,
}: {
  state: CoreSceneState;
  width: number;
  height: number;
}) {
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 2 - 8;

  return (
    <g data-core-kind={state.kind}>
      {state.rings.map((ring, i) => (
        <circle
          key={`ring-${i}`}
          data-el="ring"
          cx={cx}
          cy={cy}
          r={ring.radius * r}
          fill="none"
          stroke={seriesVar(ring.toneIndex)}
          strokeOpacity={ring.opacity}
          strokeWidth={1.5}
        />
      ))}
      {state.layers.map((layer) => (
        <rect
          key={`layer-${layer.index}`}
          data-el="layer"
          x={cx - (layer.size * r) / 2}
          y={cy - (layer.size * r) / 2}
          width={layer.size * r}
          height={layer.size * r}
          fill="none"
          stroke={seriesVar(layer.toneIndex)}
          strokeOpacity={0.2 + layer.progress * 0.7}
          strokeWidth={1.25}
          transform={`rotate(${layer.index * 9} ${cx} ${cy})`}
        />
      ))}
      {state.spokes.map((s, i) => (
        <line
          key={`spoke-${i}`}
          data-el="spoke"
          x1={cx}
          y1={cy}
          x2={cx + Math.cos(s.angle) * s.length * r}
          y2={cy + Math.sin(s.angle) * s.length * r}
          stroke={seriesVar(s.toneIndex)}
          strokeOpacity={0.8}
          strokeWidth={1.25}
        />
      ))}
      {state.facets.map((f, i) => {
        const d = f.dist * r;
        return (
          <circle
            key={`facet-${i}`}
            data-el="facet"
            cx={cx + Math.cos(f.angle) * d}
            cy={cy + Math.sin(f.angle) * d}
            r={f.size * r}
            fill={seriesVar(f.toneIndex)}
            fillOpacity={0.35 + state.pulse * 0.4}
          />
        );
      })}
      {state.orbiters.map((o, i) => (
        <circle
          key={`orb-${i}`}
          data-el="orbiter"
          cx={cx + Math.cos(o.angle) * o.radius * r}
          cy={cy + Math.sin(o.angle) * o.radius * r}
          r={o.size * r}
          fill={seriesVar(o.toneIndex)}
        />
      ))}
      <circle data-el="nucleus" cx={cx} cy={cy} r={r * 0.09} fill={seriesVar(0)} fillOpacity={0.5 + state.pulse * 0.5} />
    </g>
  );
}
