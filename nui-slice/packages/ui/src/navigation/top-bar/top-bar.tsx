import type { ReactNode } from 'react';
import styles from '../navigation.module.css';

export function TopBar({className,  leading, center, trailing }: { className?: string; leading?: ReactNode; center?: ReactNode; trailing?: ReactNode }) {
  return (
    <header className={[styles.topBar, className].filter(Boolean).join(' ')} data-testid="top-bar">
      {leading != null && <div style={{ display: 'flex', alignItems: 'center', gap: 'inherit' }}>{leading}</div>}
      {center != null && <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>{center}</div>}
      {trailing != null && <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'inherit' }}>{trailing}</div>}
    </header>
  );
}
