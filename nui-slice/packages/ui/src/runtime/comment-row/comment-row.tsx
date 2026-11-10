import styles from '../runtime.module.css';

export interface CommentRowProps {
  className?: string;
  /** Comment body — verbatim from the provider. */
  text: string;
  /** Author handle/name — verbatim. */
  author: string;
  /** Caller-formatted meta line (e.g. relative time). */
  meta?: string;
}

/** One provider comment row (Instagram media comments and similar).
 *  Read-only surface — writes go through Composer + explicit confirm. */
export function CommentRow({ className, text, author, meta }: CommentRowProps) {
  return (
    <div className={[styles.commentRow, className].filter(Boolean).join(' ')} data-testid="comment-row">
      <span className={styles.rowMain}>
        <span title={text}>{text}</span>
        <span className={styles.rowSub} title={meta != null ? `${author} · ${meta}` : author}>
          {author}
          {meta != null ? ` · ${meta}` : null}
        </span>
      </span>
    </div>
  );
}
