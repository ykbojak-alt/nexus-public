import type { CSSProperties } from 'react';
import { iconRegistry, type IconDef, type NexusIconName } from './registry';

export interface NexusIconProps {
  name: NexusIconName;
  /** px size or CSS length (e.g. var(--nexus-icon-size-sm)); default 16. */
  size?: number | string;
  /** Decorative by default; pass label for meaningful icons. */
  label?: string;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
}

export function NexusIcon({ name, size = 16, label, strokeWidth = 1.5, className, style }: NexusIconProps) {
  const def: IconDef | undefined = iconRegistry[name];
  if (!def) return null;
  const px = typeof size === 'number' ? size : undefined;
  const css = typeof size === 'string' ? size : undefined;
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill={def.filled ? 'currentColor' : 'none'}
      stroke={def.filled ? 'none' : 'currentColor'}
      strokeWidth={def.filled ? undefined : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={className}
      style={{ verticalAlign: '-0.125em', ...style, ...(css ? { width: css, height: css } : undefined) }}
      data-icon={name}
      dangerouslySetInnerHTML={{ __html: def.body }}
    />
  );
}
