import type { CSSProperties, ReactNode } from 'react';
import styles from './reference-frame.module.css';

export type ReferenceMode = 'live' | 'reference' | 'overlay' | 'diff';

export interface ReferenceFrameProps {
  className?: string;
  /** Canonical comparison surface — 1920×1080 by default (spec §8/§11). */
  width?: number;
  height?: number;
  mode: ReferenceMode;
  /** Approved reference image (references/<theme>/<screen>/reference.png). */
  referenceSrc?: string;
  /** Overlay opacity in 'overlay' mode. */
  opacity?: number;
  children?: ReactNode;
  style?: CSSProperties;
}

/**
 * Dev/Storybook pixel-close tool: renders coded UI against the approved
 * reference. `live` shows UI, `reference` the image, `overlay` stacks them,
 * `diff` uses difference blending to expose deltas.
 */
export function ReferenceFrame({ className,
  width = 1920, height = 1080, mode, referenceSrc, opacity = 0.5, children, style,
}: ReferenceFrameProps) {
  return (
    <div
      className={[styles.frame, className].filter(Boolean).join(' ')}
      data-testid="reference-frame"
      data-mode={mode}
      style={{ width, height, ...style }}
    >
      {mode !== 'live' && referenceSrc != null && (
        <img
          src={referenceSrc}
          alt="reference"
          width={width}
          height={height}
          className={styles.ref}
          style={mode === 'overlay' ? { opacity } : undefined}
          draggable={false}
          loading="lazy" decoding="async"
        />
      )}
      {mode !== 'reference' && (
        <div className={mode === 'diff' ? styles.diffLayer : styles.liveLayer}>
          {children}
        </div>
      )}
    </div>
  );
}
