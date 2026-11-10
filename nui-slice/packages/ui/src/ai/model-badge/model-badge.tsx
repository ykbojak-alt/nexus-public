import styles from '../ai.module.css';

/** Model identity tag — name + optional provider; mono font per spec. */
export function ModelBadge({className,  model, provider }: { className?: string; model: string; provider?: string }) {
  return (
    <span className={[styles.tag, className].filter(Boolean).join(' ')} data-testid="model-badge">
      {model}{provider != null && <span style={{ opacity: 0.6 }}>· {provider}</span>}
    </span>
  );
}
