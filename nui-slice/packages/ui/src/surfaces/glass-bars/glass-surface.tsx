import type { HTMLAttributes, KeyboardEvent } from 'react';
import styles from './glass-bars.module.css';

export type GlassVariant = 'rail' | 'topbar' | 'card' | 'statusbar';
export type GlassTone = 'alice' | 'mech' | 'forge' | 'codex' | 'arch' | 'nexus';

export interface GlassSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  /** Layer variant — rail | topbar | card | statusbar (glass.* tokens). */
  variant?: GlassVariant;
  /** Persona edge tint: binds --nexus-glass-tone via [data-persona]. */
  tone?: GlassTone;
  /** Enable a keyboard-scrollable content viewport for height-constrained surfaces. */
  scrollable?: boolean;
}

/**
 * Translucent bar layer (wave-XVI, refs NEU/Alice/*): backdrop blur 14–28px,
 * saturate 1.2, 1px inner hairline, top light catch, directional shadow.
 * Opaque fallbacks: missing backdrop-filter support,
 * prefers-reduced-transparency, forced-colors. Contrast ≥4.5:1 on the theme's
 * own substrates is contract-tested in @nexus/tokens (glass-bars.test.ts);
 * glass.minOpacity is the correction floor. Budget: ≤4 simultaneous glass
 * layers per screen (glass.maxBlurLayers = 4).
 */
export function GlassSurface({ variant = 'card', tone, scrollable = false, className, children, ...rest }: GlassSurfaceProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    rest.onKeyDown?.(event);
    if (!scrollable || event.defaultPrevented || event.target !== event.currentTarget) return;

    const region = event.currentTarget;
    let nextTop: number | undefined;
    switch (event.key) {
      case 'ArrowDown': nextTop = region.scrollTop + 40; break;
      case 'ArrowUp': nextTop = region.scrollTop - 40; break;
      case 'PageDown': nextTop = region.scrollTop + region.clientHeight; break;
      case 'PageUp': nextTop = region.scrollTop - region.clientHeight; break;
      case 'Home': nextTop = 0; break;
      case 'End': nextTop = region.scrollHeight; break;
      default: return;
    }

    event.preventDefault();
    region.scrollTop = Math.max(0, Math.min(nextTop, region.scrollHeight - region.clientHeight));
  };

  return (
    <div
      className={[styles.root, styles[variant], scrollable && styles.scrollable, className].filter(Boolean).join(' ')}
      data-persona={tone}
      {...rest}
      onKeyDown={onKeyDown}
      role={scrollable ? rest.role ?? 'region' : rest.role}
      tabIndex={scrollable ? rest.tabIndex ?? 0 : rest.tabIndex}
      aria-label={scrollable ? rest['aria-label'] ?? 'Содержимое панели' : rest['aria-label']}
    >
      {children}
    </div>
  );
}
