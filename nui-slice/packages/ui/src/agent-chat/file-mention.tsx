import styles from './agent-chat.module.css';

export interface FileMentionProps {
  className?: string;
  /** Путь файла, как передан адаптером — дословно. */
  path: string;
  /** Открыть файл (в тексте сообщения упоминание — ссылка/кнопка). */
  onOpen?: () => void;
}

/** Упоминание файла «#путь»: чип в тексте ответа или в композиторе.
 *  Кликабельно только когда есть onOpen — иначе честный статичный чип. */
export function FileMention({ className, path, onOpen }: FileMentionProps) {
  const cls = [styles.mention, className].filter(Boolean).join(' ');
  const inner = (<><span className={styles.mentionHash} aria-hidden="true">#</span>{path}</>);
  if (onOpen != null) {
    return (
      <button
        type="button"
        className={cls}
        onClick={onOpen}
        aria-label={`Открыть файл ${path}`}
        title={path}
        style={{ border: 0, cursor: 'pointer' }}
        data-testid="file-mention"
      >
        {inner}
      </button>
    );
  }
  return <span className={cls} title={path} data-testid="file-mention">{inner}</span>;
}
