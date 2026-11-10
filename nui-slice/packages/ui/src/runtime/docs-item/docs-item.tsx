import type { ReactNode } from 'react';
import { Button } from '../../actions/button/button';
import { StatusBadge, type NexusStatus } from '../../feedback/status-badge/status-badge';
import styles from '../runtime.module.css';

/** Doc row state — `confirm-save` means the action writes back to the
 *  provider and requires explicit user confirmation first. */
export type DocsItemState = 'saved' | 'unsaved' | 'confirm-save';

const STATE_STATUS: Record<DocsItemState, NexusStatus> = {
  saved: 'complete',
  unsaved: 'warning',
  'confirm-save': 'validating',
};

const STATE_LABELS: Record<DocsItemState, string> = {
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  'confirm-save': 'Save requires confirmation',
};

export interface DocsItemProps {
  className?: string;
  /** Document name, verbatim. */
  name: string;
  state?: DocsItemState;
  meta?: ReactNode;
  /** Add the doc to session context (picker action). */
  onPick?: () => void;
  onPreview?: () => void;
  /** Saves back to the provider — consumer wires the confirmation flow. */
  onSave?: () => void;
}

/** Docs picker/preview row — honest save state; a write-back action is
 *  marked as requiring confirmation, never fired implicitly. */
export function DocsItem({ className, name, state = 'saved', meta, onPick, onPreview, onSave }: DocsItemProps) {
  return (
    <div className={[styles.docsRow, className].filter(Boolean).join(' ')}
      data-state={state} data-testid="docs-item">
      <span className={styles.docsName} title={name}>{name}</span>
      {meta != null && <span className={styles.docsMeta}>{meta}</span>}
      <StatusBadge status={STATE_STATUS[state]} label={STATE_LABELS[state]} />
      {(onPick != null || onPreview != null || onSave != null) && (
        <span className={styles.docsActions}>
          {onPreview != null && <Button variant="ghost" size="sm" onClick={onPreview}>Preview</Button>}
          {onPick != null && <Button variant="ghost" size="sm" onClick={onPick}>Pick</Button>}
          {onSave != null && (
            <Button variant="secondary" size="sm" onClick={onSave}
              disabled={state === 'confirm-save'}>
              Save
            </Button>
          )}
        </span>
      )}
    </div>
  );
}
