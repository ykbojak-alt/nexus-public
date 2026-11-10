/**
 * SVG fallback for spatial scenes — orthographic projection of the
 * same 3D positions the WebGL path renders (spec §10/§16).
 */

import { CHART_CHROME, seriesVar } from '@nexus/ui';
import { projectNode, type SpatialSceneState } from '../spatial/spatial-state';

const EDGE_DASH: Record<string, string> = { fallback: '5 4', similar: '3 3', waits: '5 4' };

export function SpatialFallbackSvg({
  state,
  width,
  height,
}: {
  state: SpatialSceneState;
  width: number;
  height: number;
}) {
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 2 - 28;
  const projected = new Map(state.nodes.map((n) => [n.id, projectNode(n, state.rotation, cx, cy, r)]));
  const tone = state.kind === 'sphere' ? 3 : state.kind === 'orb' ? 4 : 0;

  return (
    <g data-spatial-kind={state.kind}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={seriesVar(tone)} strokeOpacity={0.35} data-el="hull" />
      {state.kind === 'orb' &&
        [0.6, 0.78, 0.96].map((f, i) => (
          <ellipse key={i} data-el="ring" cx={cx} cy={cy} rx={r * f} ry={r * f * 0.42} fill="none" stroke={seriesVar(i + 4)} strokeOpacity={0.4} />
        ))}
      {state.edges.map((e, i) => {
        const a = projected.get(e.from);
        const b = projected.get(e.to);
        if (!a || !b) return null;
        return (
          <line
            key={`${e.from}->${e.to}-${i}`}
            data-edge={`${e.from}->${e.to}`}
            data-kind={e.kind}
            x1={a.px}
            y1={a.py}
            x2={b.px}
            y2={b.py}
            stroke={CHART_CHROME.axis}
            strokeOpacity={0.3 + Math.min(a.depth, b.depth) * 0.6}
            strokeDasharray={EDGE_DASH[e.kind ?? '']}
          />
        );
      })}
      {[...projected.values()]
        .sort((a, b) => a.depth - b.depth) // back first — front nodes paint on top
        .map((n) => (
          <g key={n.id} data-node={n.id} data-kind={n.kind}>
            <circle
              cx={n.px}
              cy={n.py}
              r={n.size * r * (0.5 + n.depth * 0.8)}
              fill={seriesVar(n.toneIndex)}
              fillOpacity={0.35 + n.depth * 0.65}
            />
            {n.label ? (
              <text x={n.px} y={n.py + n.size * r + 11} textAnchor="middle" fontSize={10} fill={CHART_CHROME.label} fillOpacity={0.4 + n.depth * 0.6}>
                {n.label}
              </text>
            ) : null}
          </g>
        ))}
    </g>
  );
}
