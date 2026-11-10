import { NexusIcon, type NexusIconName } from '@nexus/icons';
import { Switch } from '../inputs/switch/switch';
import { PluginStatusBadge, type PluginStatus } from './plugin-status-badge';
import styles from './plugins.module.css';

export interface PluginCardProps {
  className?: string;
  /** id плагина из манифеста — verbatim. */
  id: string;
  /** Название из локали манифеста — verbatim. */
  title: string;
  /** Описание — verbatim; null → «нет описания». */
  description?: string | null;
  /** Иконка из реестра @nexus/icons. */
  icon?: NexusIconName;
  /** Бандл включён (факт патча профиля). */
  enabled: boolean;
  /** Статус плагина; null → неизвестен, бейдж не рисуем. */
  status?: PluginStatus | null;
  /** Встроенный плагин — выключить нельзя, переключатель disabled. */
  builtin?: boolean;
  /** Меняет enabled (seam W1: plugins.setEnabled). */
  onToggle?: (enabled: boolean) => void;
  /** Открыть страницу настроек плагина. */
  onOpen?: () => void;
}

/** Карточка плагина в менеджере «Плагины» (S: иконка, название, описание,
 *  статус, переключатель). Факты verbatim; у встроенного бандла
 *  переключатель недоступен — честный disabled, не скрытый. */
export function PluginCard({
  className, id, title, description, icon, enabled, status, builtin,
  onToggle, onOpen,
}: PluginCardProps) {
  const canToggle = !builtin && onToggle != null;
  const body = (
    <>
      <span className={styles.cardIcon} aria-hidden="true">
        {icon != null && <NexusIcon name={icon} size="var(--nexus-icon-size-md)" />}
      </span>
      <span className={styles.cardMain}>
        <span className={styles.cardTitle}>{title}</span>
        <span className={styles.cardDesc}>
          {description ?? 'Нет описания'}
        </span>
      </span>
      <span className={styles.cardSide}>
        {status != null && <PluginStatusBadge status={status} />}
        {onToggle != null && (
          <Switch
            checked={enabled}
            onCheckedChange={onToggle}
            disabled={!canToggle}
            aria-label={builtin
              ? `Плагин «${title}» встроенный — выключить нельзя`
              : `Плагин «${title}»: ${enabled ? 'включён' : 'выключен'}`}
          />
        )}
      </span>
    </>
  );
  return onOpen != null ? (
    <div className={[styles.card, className].filter(Boolean).join(' ')}
      data-plugin-id={id} data-enabled={enabled || undefined} data-testid="plugin-card">
      <button type="button" className={styles.cardOpen} onClick={onOpen}
        aria-label={`Открыть настройки плагина «${title}»`}>
        {body}
      </button>
    </div>
  ) : (
    <div className={[styles.card, className].filter(Boolean).join(' ')}
      data-plugin-id={id} data-enabled={enabled || undefined} data-testid="plugin-card">
      {body}
    </div>
  );
}
