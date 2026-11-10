import styles from './agent-chat.module.css';

export interface SessionRowProps {
  className?: string;
  /** Заголовок сессии — verbatim. */
  title: string;
  /** Модель сессии — verbatim; отсутствие → «нет данных». */
  model?: string | null;
  /** Метка времени от хоста — verbatim строкой; отсутствие → «нет данных». */
  updatedAt?: string | null;
  /** Число сообщений — факт хоста; null → не показываем. */
  messageCount?: number | null;
  /** Активная сессия в панели. */
  selected?: boolean;
  /** Возобновить сессию (seam W1: sessions.resume). */
  onResume?: () => void;
  /** Форк сессии (seam W1: sessions.fork). */
  onFork?: () => void;
}

/** Строка прошлой сессии в панели сессий (S3): факты verbatim,
 *  действия resume/fork — кнопки с русскими метками, доступные
 *  с клавиатуры. Неизвестное честно помечается «нет данных». */
export function SessionRow({
  className, title, model, updatedAt, messageCount, selected, onResume, onFork,
}: SessionRowProps) {
  return (
    <div
      className={[styles.sessionRow, className].filter(Boolean).join(' ')}
      data-selected={selected === true ? 'true' : undefined}
      data-testid="session-row"
    >
      <div className={styles.sessionMain}>
        <span className={styles.sessionTitle} title={title}>{title}</span>
        <span className={styles.sessionMeta}>
          {model ?? 'Модель: нет данных'}
          {' · '}
          {updatedAt ?? 'обновлено: нет данных'}
          {messageCount != null && ` · сообщений: ${messageCount}`}
        </span>
      </div>
      <div className={styles.sessionActions}>
        {onResume != null && (
          <button
            type="button"
            className={styles.sessionBtn}
            onClick={onResume}
            aria-label={`Продолжить сессию «${title}»`}
          >
            Продолжить
          </button>
        )}
        {onFork != null && (
          <button
            type="button"
            className={styles.sessionBtn}
            onClick={onFork}
            aria-label={`Форкнуть сессию «${title}»`}
          >
            Форк
          </button>
        )}
      </div>
    </div>
  );
}
