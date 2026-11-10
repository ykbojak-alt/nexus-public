import { StatusBadge, type NexusStatus } from '../feedback/status-badge/status-badge';

/** Доменные статусы плагина NEU (спека §2.4) — закрытый словарь. */
export type PluginStatus = 'active' | 'failed' | 'overridden' | 'restart-required';

const STATUS_MAP: Record<PluginStatus, { status: NexusStatus; label: string }> = {
  active: { status: 'active', label: 'Активен' },
  failed: { status: 'error', label: 'Ошибка' },
  overridden: { status: 'warning', label: 'Переопределён' },
  'restart-required': { status: 'paused', label: 'Нужен перезапуск' },
};

export interface PluginStatusBadgeProps {
  status: PluginStatus;
  className?: string;
}

/** Бейдж состояния плагина: доменный словарь → канонический StatusBadge
 *  (контраст гарантирован state-контрактом во всех темах). */
export function PluginStatusBadge({ status, className }: PluginStatusBadgeProps) {
  const mapped = STATUS_MAP[status];
  return (
    <StatusBadge
      status={mapped.status}
      label={mapped.label}
      className={className}
      data-plugin-status={status}
    />
  );
}
