import { NexusIcon } from '@nexus/icons';
import styles from '../ai.module.css';
import type { Freshness } from '../types';

const ICONS: Record<Freshness, string> = { live: 'status.dot', stale: 'status.warn', archived: 'status.info' };

/** Memory freshness indicator — live / stale / archived. */
export function MemoryState({className,  freshness, label }: { className?: string; freshness: Freshness; label?: string }) {
  return (
    <span className={[styles.memState, className].filter(Boolean).join(' ')} data-freshness={freshness} data-testid="memory-state">
      <NexusIcon name={ICONS[freshness] as 'status.dot'} size="var(--nexus-icon-size-xs)" />
      <span>{label ?? freshness}</span>
    </span>
  );
}
