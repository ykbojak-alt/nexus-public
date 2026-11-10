import styles from '../ai.module.css';

/** Capability/tool tag — plain mono chip, no color props. */
export function ToolBadge({className,  name }: { className?: string; name: string }) {
  return <span className={[styles.tag, className].filter(Boolean).join(' ')}>{name}</span>;
}
