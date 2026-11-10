import styles from '../ai.module.css';

/** External integration/plugin chip — active state via tone token. */
export function IntegrationBadge({className,  name, active, signed }: { className?: string; name: string; active?: boolean; signed?: boolean }) {
  return (
    <span className={[styles.tag, className].filter(Boolean).join(' ')}
      data-tone={active === false ? 'off' : signed === false ? 'warn' : undefined}
      data-testid="integration-badge">
      {name}{signed === false && ' (unsigned)'}
    </span>
  );
}
