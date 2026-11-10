import type { HTMLAttributes } from 'react';
import { StatusBadge } from '../../feedback/status-badge/status-badge';
import styles from './assistant-card.module.css';

/** HTMLElement-хэндлеры: интерактивная карточка — нативный <button>
 *  (контракт app-shell: Tab должен падать на настоящий интерактивный тег),
 *  неинтерактивная — <div>. */
export interface AssistantCardProps extends HTMLAttributes<HTMLElement> {
  /** Verbatim assistant name, e.g. "AGENT-A" */
  name: string;
  /** Role line — verbatim from the registry, no marketing copy. */
  subtitle?: string;
  /** Portrait art — absent renders an honest monogram tile, not a fake face.
   *  width/height are intrinsic hints for CLS; the rendered box is pinned to
   *  .art aspect-ratio 4/5, so defaults match that ratio. */
  art?: { src: string; alt?: string; width?: number; height?: number };
  /** Capability tags verbatim from the assistant spec. */
  tags?: readonly string[];
  /** Presence truth from the host: available | active | offline | unknown. */
  status?: 'available' | 'active' | 'offline';
  /** RU label for the status line, e.g. 'Доступен'. */
  statusLabel?: string;
  selected?: boolean;
  onSelect?: () => void;
}

const STATUS_TONE = {
  available: 'online',
  active: 'active',
  offline: 'offline',
} as const;

/**
 * Assistant card (visual-3 V2, agent-select canon): chamfered portrait card
 * with accent hairline; selected state glows via accent.* roles — the same
 * geometry serves all five assistant palettes. No art → monogram tile
 * (initial), never an invented portrait.
 */
export function AssistantCard({
  name, subtitle, art, tags, status, statusLabel, selected, onSelect, className, ...rest
}: AssistantCardProps) {
  const interactive = onSelect != null;
  const shell = {
    className: [styles.edge, className].filter(Boolean).join(' '),
    'data-selected': selected || undefined,
    'aria-pressed': interactive ? selected === true : undefined,
    onClick: interactive ? onSelect : undefined,
    'data-testid': 'assistant-card',
    ...rest,
  } as const;
  const body = (
    <div className={styles.card}>
      {art != null ? (
        <img className={styles.art} src={art.src} alt={art.alt ?? ''}
          width={art.width ?? 400} height={art.height ?? 500}
          aria-hidden={art.alt == null || undefined} loading="lazy" decoding="async" />
      ) : (
        <div className={styles.artFallback} aria-hidden="true">{name.slice(0, 1)}</div>
      )}
      <div className={styles.meta}>
        <span className={styles.name} translate="no">{name}</span>
        {subtitle != null && <span className={styles.subtitle}>{subtitle}</span>}
        {tags != null && tags.length > 0 && (
          <ul className={styles.tags} aria-label="Возможности">
            {tags.map((t) => <li key={t} className={styles.tag}>{t}</li>)}
          </ul>
        )}
        {status != null && (
          <StatusBadge status={STATUS_TONE[status]} label={statusLabel ?? status} />
        )}
      </div>
    </div>
  );
  return interactive
    ? <button type="button" {...shell}>{body}</button>
    : <div {...shell}>{body}</div>;
}
