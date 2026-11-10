import { useState } from 'react';
import type { PatternState } from '../agents/agent-types';
import styles from './memory.module.css';

export interface MemoryTemplateProps {
  state?: PatternState;
  /** Project scope the note lands in — server requires it. */
  project?: string;
  /** Saving is a callback — the pattern never fetches (POST /v1/memory). */
  onSave?: (text: string) => void;
  title?: string;
}

/**
 * Memory composer — create-only by design. Server has POST /v1/memory but
 * no PATCH: a saved note can be deleted, never edited (missing-api-list §2.2).
 */
export function MemoryTemplate({ state = 'ready', project, onSave, title = 'Новая запись' }: MemoryTemplateProps) {
  const [text, setText] = useState('');
  const canSave = text.trim().length > 0 && state === 'ready';
  return (
    <section className={styles.root} data-state={state} data-testid="memory-template" aria-label={title}>
      <h3 className={styles.title}>{title}</h3>
      {state === 'loading' && <p className={styles.muted}>Подготовка формы…</p>}
      {state === 'error' && <p className={styles.muted}>Форма недоступна.</p>}
      {state === 'empty' && <p className={styles.muted}>Проект не выбран — записать некуда.</p>}
      {(state === 'ready' || state === 'stale') && (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSave) return;
            onSave?.(text.trim());
            setText('');
          }}
        >
          <textarea
            className={styles.textarea}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Факт, решение или наблюдение для памяти проекта…"
            rows={3}
            aria-label="Текст записи"
          />
          <div className={styles.formRow}>
            <span className={styles.muted}>проект: {project ?? '—'}</span>
            <button type="submit" className={styles.submit} disabled={!canSave}>
              Сохранить в память
            </button>
          </div>
          <p className={styles.muted}>Созданная запись не редактируется — API памяти: создание и удаление.</p>
        </form>
      )}
    </section>
  );
}
