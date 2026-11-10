'use client';

/** Вкладка «Процесс» — чат и управление прогоном. Композиция: состояние —
 * use-process-tab, секции — process-chat-feed/-command/-side. Поведение,
 * тексты и testid без изменений (split wave-XVI). */
import { ProcessChatFeed } from './process-chat-feed';
import { ProcessCommandPanel } from './process-command';
import { ProcessSidePanels } from './process-side';
import { useProcessTab } from './use-process-tab';
import styles from '../screens.module.css';

export function ProcessTab({ freeze = false }: { freeze?: boolean }) {
  const c = useProcessTab({ freeze });
  return (
    <div className={styles.chatGrid} data-freeze={freeze || undefined}>
      <div className={styles.chatCol}>
        <ProcessChatFeed c={c} />
        <ProcessCommandPanel c={c} />
      </div>
      <ProcessSidePanels c={c} />
    </div>
  );
}
