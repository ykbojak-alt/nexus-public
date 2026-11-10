import type { ReactNode } from 'react';
import styles from '../runtime.module.css';

export interface SourceLinkProps {
  className?: string;
  /** Link text — source title, file path or document name. */
  label: string;
  href?: string;
  /** Verbatim origin — domain, tool name or store id. */
  source?: string;
  /** External sources open in a new tab with safe rel. */
  external?: boolean;
  /** Disabled links are rendered as non-interactive content (never fake href). */
  disabled?: boolean;
  onClick?: () => void;
  icon?: ReactNode;
}

/** Evidence/source link — a labelled, accessible anchor that names where a
 *  claim came from. External links carry rel="noopener noreferrer" and open
 *  in the user's browser, never inside a provider frame. */
export function SourceLink({ className, label, href, source, external, disabled, onClick, icon }: SourceLinkProps) {
  const inner = (
    <>
      {icon != null && <span className={styles.sourceIcon} aria-hidden="true">{icon}</span>}
      <span className={styles.sourceLabel}>{label}</span>
      {source != null && <span className={styles.sourceOrigin}>{source}</span>}
    </>
  );
  const cls = [styles.sourceLink, className].filter(Boolean).join(' ');
  if (disabled === true) {
    return (
      <span className={cls} aria-disabled="true" data-state="disabled" data-testid="source-link">
        {inner}
      </span>
    );
  }
  if (href != null) {
    return (
      <a className={cls} href={href} data-testid="source-link"
        target={external === true ? '_blank' : undefined}
        rel={external === true ? 'noopener noreferrer' : undefined}
        onClick={onClick}>
        {inner}
      </a>
    );
  }
  if (onClick != null) {
    return (
      <button type="button" className={cls} data-testid="source-link" onClick={onClick}>
        {inner}
      </button>
    );
  }
  return <span className={cls} data-testid="source-link">{inner}</span>;
}
