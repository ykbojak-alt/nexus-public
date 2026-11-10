import type { ReactNode } from 'react';
import { NexusIcon } from '@nexus/icons';
import { Skeleton } from '../../feedback/skeleton/skeleton';
import styles from '../runtime.module.css';

/** One row of provider search output — verbatim fields, no enrichment. */
export interface SearchResultItem {
  id: string;
  title: string;
  /** Verbatim meta — channel, author, date… */
  meta?: ReactNode;
}

export type ProviderSearchState = 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'unavailable';

export interface ProviderSearchResultsProps {
  className?: string;
  /** Source attribution shown verbatim — contract requires the provider be
   *  named, e.g. 'YouTube Data API'. */
  source: string;
  /** Result origin — 'mock' renders an honest label next to the source. */
  origin?: 'live' | 'mock';
  items?: SearchResultItem[];
  state?: ProviderSearchState;
  /** Verbatim reason for error/unavailable — never invented. */
  reason?: string;
  onSelect?: (id: string) => void;
  selectedId?: string;
}

const statePresentation = {
  loading: { label: 'Загружаем результаты', icon: 'status.dot' },
  empty: { label: 'Ничего не найдено', icon: 'status.info' },
  error: { label: 'Ошибка поиска', icon: 'status.error' },
  unavailable: { label: 'Поиск недоступен', icon: 'status.offline' },
} as const;

function resultCountLabel(count: number): string {
  const tens = count % 100;
  const units = count % 10;
  const noun = tens >= 11 && tens <= 14 ? 'результатов'
    : units === 1 ? 'результат'
      : units >= 2 && units <= 4 ? 'результата' : 'результатов';
  return `${count} ${noun}`;
}

/** Provider search results with mandatory source attribution and honest
 *  loading/empty/error/unavailable states. The 'unavailable' state covers
 *  a missing adapter or quota — the component never fabricates results. */
export function ProviderSearchResults({
  className, source, origin, items = [], state = 'ready', reason,
  onSelect, selectedId,
}: ProviderSearchResultsProps) {
  const originLabel = origin === 'mock' ? ' · демонстрационные данные' : '';
  const status = state in statePresentation ? statePresentation[state as keyof typeof statePresentation] : null;
  const statusReason = state === 'empty' ? reason : (state === 'error' || state === 'unavailable' ? reason : undefined);
  return (
    <div className={[styles.searchResults, className].filter(Boolean).join(' ')}
      data-state={state} data-testid="provider-search-results">
      <p className={styles.searchSource}>
        Источник: {source}{originLabel}
        {state === 'ready' && items.length > 0 && ` · ${resultCountLabel(items.length)}`}
      </p>
      {status != null && (
        <div
          className={[styles.searchStatus, styles[`searchStatus_${state}`]].join(' ')}
          data-status={state}
          role={state === 'error' ? 'alert' : 'status'}
          aria-atomic="true"
        >
          <NexusIcon name={status.icon} size="var(--nexus-icon-size-md)" className={styles.searchStatusIcon} aria-hidden="true" />
          <div className={styles.searchStatusText}>
            <strong className={styles.searchStatusTitle}>{status.label}</strong>
            {statusReason != null && <p className={styles.searchStatusReason}>{statusReason}</p>}
          </div>
        </div>
      )}
      {state === 'loading' && (
        <div className={styles.searchSkeletons} aria-hidden="true">
          <Skeleton /><Skeleton /><Skeleton />
        </div>
      )}
      {state === 'ready' && items.length > 0 && (
        <ul className={styles.searchList}>
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" className={styles.searchRow}
                data-selected={item.id === selectedId || undefined}
                onClick={() => onSelect?.(item.id)}>
                <span className={styles.searchRowTitle} title={item.title}>{item.title}</span>
                {item.meta != null && <span className={styles.searchRowMeta}>{item.meta}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
