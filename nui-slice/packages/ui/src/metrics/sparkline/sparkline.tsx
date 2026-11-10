'use client';

import { useId } from 'react';
import styles from '../metrics.module.css';

export interface SparklineProps {
  className?: string;
  data: number[];
  width?: number;
  height?: number;
  area?: boolean;
  label?: string;
  /** Fixed value domain — percentages stay honest (no autoscale). */
  domain?: [number, number];
}

/** Minimal inline trend — SVG polyline, normalized to viewBox; no axes. */
export function Sparkline({ className, data, width = 96, height = 24, area, label, domain }: SparklineProps) {
  const id = useId();
  if (data.length < 2) return null;
  const min = domain?.[0] ?? Math.min(...data);
  const max = domain?.[1] ?? Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * width,
    height - 2 - ((v - min) / span) * (height - 4),
  ] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg className={[styles.spark, className].filter(Boolean).join(' ')} width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {area && <polygon className={styles.sparkArea} points={`0,${height} ${line} ${width},${height}`} />}
      <polyline className={styles.sparkLine} points={line} />
      <title id={id}>{label}</title>
    </svg>
  );
}
