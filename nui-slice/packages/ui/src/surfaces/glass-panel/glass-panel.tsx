import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import styles from './glass-panel.module.css';

export interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  /** Depth layer (spec §8); maps to depth.* tokens. */
  elevation?: 'panel' | 'elevated' | 'overlay';
  /** Glow level — restrained by contract (spec §9). */
  glow?: 'none' | 'soft' | 'active' | 'core';
  children?: ReactNode;
  style?: CSSProperties;
}

const ELEVATION_CLASS = { panel: styles.panel, elevated: styles.elevated, overlay: styles.overlay } as const;
const GLOW_CLASS = { none: '', soft: styles.glowSoft, active: styles.glowActive, core: styles.glowCore } as const;

export function GlassPanel({ elevation = 'panel', glow = 'none', children, className, ...rest }: GlassPanelProps) {
  return (
    <div
      data-testid="glass-panel"
      className={[styles.root, ELEVATION_CLASS[elevation], GLOW_CLASS[glow], className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </div>
  );
}
