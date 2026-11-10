'use client';

import { useId } from 'react';
import type { ActivityRidgeSeries } from './types';
import styles from './alice-home-template.module.css';

const W = 320;
const H = 88;
const PAD = 8;

type Pt = readonly [number, number];

/** Catmull-Rom → кубические Безье: сглаживаем реальные точки, не добавляя
 *  выдуманных — кривая проходит через каждую наблюдаемую точку. */
function smoothPath(pts: readonly Pt[]): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

function toPoints(data: readonly number[]): Pt[] {
  const n = data.length;
  return data.map((v, i) => [
    (i / (n - 1)) * W,
    H - PAD - (Math.min(Math.max(v, 0), 100) / 100) * (H - 2 * PAD),
  ] as const);
}

/** Три перекрывающиеся светящиеся гряды активности (референс «Поток
 *  активности»): CPU — циан, Память — золото, Диск — смешанный тон.
 *  Фиксированный домен 0–100 %: проценты не масштабируются сами по себе. */
export function ActivityRidges({
  series,
  label,
}: {
  series: readonly ActivityRidgeSeries[];
  label: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const shown = series.filter((s) => s.data.length >= 2);
  if (shown.length === 0) return null;
  const description = `${label}: ${shown
    .map((s) => `${s.label} ${Math.round(s.data[s.data.length - 1])} %`)
    .join(', ')} — последние наблюдения.`;
  return (
    <svg
      className={styles.ridges}
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label={description}
      data-testid="activity-ridges"
      data-series={shown.map((s) => s.id).join(' ')}
    >
      {shown.map((s) => {
        const pts = toPoints(s.data);
        const line = smoothPath(pts);
        const area = `${line} L ${W} ${H} L 0 ${H} Z`;
        let peak = pts[0];
        for (const p of pts) if (p[1] < peak[1]) peak = p;
        const gid = `ridge-fill-${uid}-${s.id}`;
        return (
          <g key={s.id} data-ridge={s.id}>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" className={styles.ridgeStopTop} />
              <stop offset="100%" className={styles.ridgeStopBottom} />
            </linearGradient>
            <path className={styles.ridgeArea} d={area} fill={`url(#${gid})`} />
            <path className={styles.ridgeLine} d={line} />
            <circle className={styles.ridgePeak} cx={peak[0]} cy={peak[1]} r="2.2" />
          </g>
        );
      })}
      <line className={styles.ridgeBaseline} x1="0" y1={H - 1} x2={W} y2={H - 1} />
    </svg>
  );
}
