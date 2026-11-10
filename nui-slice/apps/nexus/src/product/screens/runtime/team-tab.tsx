'use client';

/** Вкладка «Команда» Runtime (выделено из runtime.tsx). */
import { GlassPanel } from '@nexus/ui';
import styles from '../screens.module.css';

/**
 * Team level: the concept's queue/approvals/policies/audit all require a
 * real shared identity/RBAC backend (W1-13 OPEN). Until it exists the tab
 * shows an honest unavailable state — no fictitious users or events.
 */
export function TeamTab() {
  return (
    <GlassPanel className={styles.panel} data-state="unavailable" data-testid="tab-team">
      <h2 className={styles.panelTitle}>Командное пространство</h2>
      <p className={styles.emptyHint}>
        Общая очередь, роли, согласования, политики и аудит команды требуют подключённого
        identity/RBAC-слоя. Командное пространство сейчас не подключено — фиктивные
        пользователи и события не отображаются.
      </p>
      <p className={styles.emptyHint}>
        Одиночные прогоны остаются доступны на вкладках Процесс, Результаты и История —
        уровень интерфейса меняет навигацию, но не полномочия.
      </p>
    </GlassPanel>
  );
}
