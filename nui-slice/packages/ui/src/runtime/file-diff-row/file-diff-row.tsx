import { Button } from '../../actions/button/button';
import { StatusBadge, type NexusStatus } from '../../feedback/status-badge/status-badge';
import type { FileDiffState } from '../types';
import styles from '../runtime.module.css';

const STATE_STATUS: Record<FileDiffState, NexusStatus> = {
  pending: 'waiting',
  accepted: 'complete',
  rejected: 'offline',
  restored: 'syncing',
};
const STATE_LABEL: Record<FileDiffState, string> = {
  pending: 'Ожидает проверки',
  accepted: 'Принято',
  rejected: 'Отклонено',
  restored: 'Восстановлено',
};

export interface FileDiffRowProps {
  className?: string;
  /** Workspace-relative path of the changed file. */
  path: string;
  additions?: number | null;
  deletions?: number | null;
  state?: FileDiffState;
  onAccept?: () => void;
  onReject?: () => void;
  /** Restore the file from the session checkpoint. */
  onRestore?: () => void;
  /** Open the diff preview. */
  onOpen?: () => void;
}

/** A changed file awaiting review: path, +/− counts and honest review state,
 *  with accept/reject/restore actions matching the checkpoint contract. */
export function FileDiffRow({
  className, path, additions, deletions, state = 'pending',
  onAccept, onReject, onRestore, onOpen,
}: FileDiffRowProps) {
  const pending = state === 'pending';
  const countLabel = [
    additions != null ? `Добавлено строк: ${additions}` : 'Добавлено строк: нет данных',
    deletions != null ? `Удалено строк: ${deletions}` : 'Удалено строк: нет данных',
  ].join('; ');
  return (
    <div className={[styles.diffRow, className].filter(Boolean).join(' ')}
      data-state={state} data-testid="file-diff-row" role="group" aria-label={`Файл ${path}`}>
      <button type="button" className={styles.diffPath} onClick={onOpen} disabled={onOpen == null}
        aria-label={`Открыть дифф файла ${path}`}
        title={path}>
        {path}
      </button>
      <span className={styles.diffCounts} aria-label={countLabel}>
        {additions != null && <span className={styles.diffAdd}>+{additions}</span>}
        {deletions != null && <span className={styles.diffDel}>−{deletions}</span>}
        {additions == null && deletions == null && <span>нет данных</span>}
      </span>
      <StatusBadge status={STATE_STATUS[state]} label={STATE_LABEL[state]} />
      {(pending || state === 'accepted') && (
        <span className={styles.diffActions}>
          {pending && onAccept != null && <Button variant="secondary" size="sm" onClick={onAccept}>Принять</Button>}
          {pending && onReject != null && <Button variant="ghost" size="sm" onClick={onReject}>Отклонить</Button>}
          {onRestore != null && <Button variant="ghost" size="sm" onClick={onRestore}>Восстановить</Button>}
        </span>
      )}
    </div>
  );
}
