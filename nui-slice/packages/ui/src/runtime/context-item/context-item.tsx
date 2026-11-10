import type { ReactNode } from 'react';
import { IconButton } from '../../actions/icon-button/icon-button';
import styles from '../runtime.module.css';

export interface ContextItemProps {
  className?: string;
  /** Item label — file name, folder, note title… */
  label: string;
  /** Kind hint, e.g. 'file' | 'folder' | 'selection'. */
  kind?: string;
  /** Verbatim meta — size, path fragment, line range… */
  meta?: ReactNode;
  /** Remove the item from session context. */
  onRemove?: () => void;
  icon?: ReactNode;
}

/** A single attached context item in a local session — a file, folder or
 *  selection the user added. Removing detaches it from context; it never
 *  implies the file was read or shared beyond the granted workspace. */
export function ContextItem({ className, label, kind, meta, onRemove, icon }: ContextItemProps) {
  return (
    <div className={[styles.contextRow, className].filter(Boolean).join(' ')}
      data-testid="context-item" data-kind={kind}>
      {icon != null && <span className={styles.contextIcon} aria-hidden="true">{icon}</span>}
      <span className={styles.contextLabel} title={label}>{label}</span>
      {kind != null && <span className={styles.contextKind}>{kind}</span>}
      {meta != null && <span className={styles.contextMeta}>{meta}</span>}
      {onRemove != null && (
        <IconButton icon="act.close" aria-label={`Remove ${label}`} onClick={onRemove} />
      )}
    </div>
  );
}
