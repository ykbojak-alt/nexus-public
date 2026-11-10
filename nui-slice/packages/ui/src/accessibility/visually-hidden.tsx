import type { CSSProperties, ReactNode } from 'react';

const hiddenStyle: CSSProperties = {
  position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px',
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

/** Screen-reader-only content (spec §14 — DOM remains the information carrier). */
export function VisuallyHidden({className,  children }: { className?: string; children: ReactNode }) {
  return <span className={className} style={hiddenStyle}>{children}</span>;
}
