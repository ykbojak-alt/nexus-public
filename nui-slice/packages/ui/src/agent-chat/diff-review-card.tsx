import type { ReactNode } from 'react';
import { FileDiffRow } from '../runtime/file-diff-row/file-diff-row';
import type { FileDiffState } from '../runtime/types';
import styles from './agent-chat.module.css';

export interface DiffReviewFile {
  path: string;
  additions?: number | null;
  deletions?: number | null;
  state?: FileDiffState;
  onAccept?: () => void;
  onReject?: () => void;
  onRestore?: () => void;
  onOpen?: () => void;
}

export interface DiffReviewCardProps {
  className?: string;
  /** Заголовок карточки, дословно (напр. «Изменённые файлы»). */
  title?: ReactNode;
  files: DiffReviewFile[];
  /** Честное пустое состояние — без него пустой список не рисуется. */
  emptyLabel?: ReactNode;
}

/** Карточка дифф-ревью: заголовок со сводкой +/− и список FileDiffRow.
 *  Сводка считается по реальным полям — отсутствующие счётчики не
 *  выдумываются (0 не подставляется). */
export function DiffReviewCard({ className, title = 'Изменённые файлы', files, emptyLabel }: DiffReviewCardProps) {
  const additionsKnown = files.every((f) => f.additions != null);
  const deletionsKnown = files.every((f) => f.deletions != null);
  const adds = additionsKnown ? files.reduce((n, f) => n + f.additions!, 0) : null;
  const dels = deletionsKnown ? files.reduce((n, f) => n + f.deletions!, 0) : null;
  const regionLabel = typeof title === 'string' ? title : 'Изменённые файлы';
  if (files.length === 0) {
    return emptyLabel != null
      ? (
        <section className={[styles.diffCard, className].filter(Boolean).join(' ')}
          role="group" aria-label={regionLabel} data-testid="diff-review-card" data-state="empty">
          <div className={styles.diffHeader}>{title}</div>
          <p className={styles.diffEmpty}>{emptyLabel}</p>
        </section>
      )
      : null;
  }
  return (
    <section className={[styles.diffCard, className].filter(Boolean).join(' ')}
      role="group" aria-label={regionLabel} data-testid="diff-review-card" data-state="ready">
      <div className={styles.diffHeader}>
        <span>{title}</span>
        <span className={styles.diffTotals} aria-label="Сводка изменений">
          {adds != null
            ? <span className={styles.diffAdd}>+{adds}</span>
            : <span className={styles.diffUnknown}>Добавления: нет данных</span>}
          {dels != null
            ? <span className={styles.diffDel}>−{dels}</span>
            : <span className={styles.diffUnknown}>Удаления: нет данных</span>}
        </span>
      </div>
      <ul className={styles.diffList}>
        {files.map((f) => (
          <li key={f.path}>
            <FileDiffRow {...f} />
          </li>
        ))}
      </ul>
    </section>
  );
}
