import type { ReactNode } from 'react';
import { EmptyState } from '../feedback/empty-state/empty-state';
import styles from './plugins.module.css';

export interface PluginGroupProps {
  className?: string;
  /** Заголовок группы — verbatim («Встроенные»/«Локальные»). */
  title: string;
  /** Число записей в группе — факт списка; null → не показываем. */
  count?: number | null;
  /** Подпись пустой группы — verbatim; null → пустой блок не рисуем. */
  emptyLabel?: string | null;
  children?: ReactNode;
}

/** Группа списка плагинов («Встроенные»/«Локальные», спека §2.4):
 *  заголовок + счётчик + роли list. Пустая группа — честная подпись,
 *  а не выдуманные записи. */
export function PluginGroup({ className, title, count, emptyLabel, children }: PluginGroupProps) {
  const isEmpty = children == null || (Array.isArray(children) && children.length === 0);
  return (
    <section className={[styles.group, className].filter(Boolean).join(' ')}
      data-testid="plugin-group">
      <h3 className={styles.groupTitle}>
        {title}
        {count != null && <span className={styles.groupCount}>{count}</span>}
      </h3>
      {isEmpty
        ? emptyLabel != null && <EmptyState variant="inline" title={emptyLabel} />
        : <div className={styles.groupList} role="list">{children}</div>}
    </section>
  );
}
