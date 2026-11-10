import type { HTMLAttributes } from 'react';
import styles from './art-panel.module.css';

export interface ArtPanelProps extends HTMLAttributes<HTMLDivElement> {
  /** Artwork behind the content — decorative by default (alt="").
   *  Absent art renders an honest plain panel, never a fake image.
   *  `loading: 'lazy'` for below-fold / decorative backdrops (art-manifest).
   *  width/height are explicit dims required by interface guidelines; the
   *  image is absolute `inset:0; object-fit:cover`, so the values are an
   *  intrinsic hint — pass the real asset size when known. */
  art?: { src: string; alt?: string; loading?: 'lazy' | 'eager'; width?: number; height?: number };
  /** Scrim direction under the content — keeps text readable on art. */
  scrim?: 'bottom' | 'left' | 'none';
}

/**
 * Panel with authored art background (visual-3 V2): image under a
 * theme-invariant dark scrim (surface.art role) + inner edge highlight.
 * Text on art uses text.onArt* roles — the scrim is pinned dark, so
 * legibility does not depend on the shell theme.
 */
export function ArtPanel({ art, scrim = 'bottom', className, children, ...rest }: ArtPanelProps) {
  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')}
      data-scrim={scrim} data-has-art={art != null || undefined}
      data-testid="art-panel" {...rest}>
      {art != null && (
        <img className={styles.art} src={art.src} alt={art.alt ?? ''}
          width={art.width ?? 1600} height={art.height ?? 900}
          aria-hidden={art.alt == null || undefined}
          loading={art.loading} decoding="async" />
      )}
      {art != null && scrim !== 'none' && <div className={styles.scrim} aria-hidden="true" />}
      <div className={styles.body}>{children}</div>
    </div>
  );
}
