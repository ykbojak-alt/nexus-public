import styles from '../navigation.module.css';

export interface PaginationProps {
  className?: string;
  page: number;          // 1-based
  pageCount: number;
  onChange: (page: number) => void;
}

export function Pagination({className,  page, pageCount, onChange }: PaginationProps) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label="Pagination" className={[styles.pagination, className].filter(Boolean).join(' ')} data-testid="pagination">
      <button type="button" className={styles.pageBtn} disabled={page <= 1} aria-label="Previous page" onClick={() => onChange(page - 1)}>‹</button>
      {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
        <button
          key={p}
          type="button"
          className={styles.pageBtn}
          aria-current={p === page ? 'page' : undefined}
          onClick={() => onChange(p)}
        >
          {p}
        </button>
      ))}
      <button type="button" className={styles.pageBtn} disabled={page >= pageCount} aria-label="Next page" onClick={() => onChange(page + 1)}>›</button>
    </nav>
  );
}
