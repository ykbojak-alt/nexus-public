import type { CSSProperties } from 'react';

export interface ProgressArcProps {
  className?: string;
  /** 0..100 */
  value: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
}

/** Circular progress — SVG, token colors via currentColor/var(). */
export function ProgressArc({className,  value, size = 48, strokeWidth = 4, label }: ProgressArcProps) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, value));
  const dash = (clamped / 100) * c;
  const style: CSSProperties = { color: 'var(--nexus-accent-primary, #C9A45C)' };
  return (
    <svg
      width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      role="progressbar" aria-label={label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={clamped}
      style={style}
     className={className}>
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="var(--nexus-border-subtle, rgba(246,240,228,0.06))"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}
