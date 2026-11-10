import styles from './agent-chat.module.css';

export interface AttachmentItem {
  id: string;
  /** Имя файла, как отдал пользователь/адаптер — дословно. */
  name: string;
  /** Тип для подписи; icon-слот решает вызывающий при необходимости. */
  kind?: 'image' | 'file' | string;
  /** Размер/тип подписью (напр. «12 КБ»), уже отформатировано. */
  meta?: string;
}

export interface AttachmentListProps {
  className?: string;
  items: AttachmentItem[];
  /** Снять вложение до отправки. Без колбэка креста нет. */
  onRemove?: (id: string) => void;
  /** aria-label списка. */
  label?: string;
}

/** Вложения композитора: чипы имён файлов с крестом снятия.
 *  Превью не рисуем — адаптер отдаёт имя, не картинку. */
export function AttachmentList({ className, items, onRemove, label = 'Вложения' }: AttachmentListProps) {
  if (items.length === 0) return null;
  return (
    <ul className={[styles.attachList, className].filter(Boolean).join(' ')} aria-label={label} data-testid="attachment-list">
      {items.map((it) => (
        <li key={it.id} className={styles.attachChip} data-kind={it.kind}>
          <span className={styles.attachIcon} aria-hidden="true">
            {it.kind === 'image' ? '◱' : '≡'}
          </span>
          <span className={styles.attachName} title={it.name}>{it.name}</span>
          {it.meta != null && <span className={styles.attachMeta}>{it.meta}</span>}
          {onRemove != null && (
            <button
              type="button"
              className={styles.attachRemove}
              onClick={() => onRemove(it.id)}
              aria-label={`Снять вложение ${it.name}`}
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
