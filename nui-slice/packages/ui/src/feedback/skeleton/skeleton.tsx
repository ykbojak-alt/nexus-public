import type { CSSProperties } from 'react';
import styles from '../feedback.module.css';

export function Skeleton({className,  width, height = 16, circle }: { className?: string; width?: number | string; height?: number | string; circle?: boolean }) {
  const style: CSSProperties = {
    width: circle ? height : width ?? '100%',
    height,
    borderRadius: circle ? '50%' : undefined,
  };
  return <div className={[styles.skeleton, className].filter(Boolean).join(' ')} style={style} aria-hidden="true" data-state="loading" />;
}
