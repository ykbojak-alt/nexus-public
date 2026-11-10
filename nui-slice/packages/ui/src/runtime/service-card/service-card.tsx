import type { ReactNode } from 'react';
import { Button } from '../../actions/button/button';
import { StatusBadge, type NexusStatus } from '../../feedback/status-badge/status-badge';
import styles from '../runtime.module.css';

/** How the provider is reached — distinct paths, never merged with state. */
export type ServiceAccessMode = 'web' | 'api' | 'native-app' | 'business-api';

/** Provider connection truth — contract vocabulary verbatim. `connected`
 *  means a verified auth path, never just "the site opened". */
export type ServiceConnectionState =
  | 'not-connected' | 'opening' | 'connected' | 'needs-review'
  | 'needs-permission' | 'read-only' | 'write-confirmation-required'
  | 'rate-limited' | 'region-unavailable' | 'revoked' | 'error' | 'mock';

export const ACCESS_MODE_LABELS: Record<ServiceAccessMode, string> = {
  'web': 'Веб',
  'api': 'API',
  'native-app': 'Приложение',
  'business-api': 'Бизнес-API',
};

const STATE_STATUS: Record<ServiceConnectionState, NexusStatus> = {
  'not-connected': 'offline',
  'opening': 'syncing',
  'connected': 'online',
  'needs-review': 'warning',
  'needs-permission': 'warning',
  'read-only': 'info',
  'write-confirmation-required': 'warning',
  'rate-limited': 'waiting',
  'region-unavailable': 'offline',
  'revoked': 'offline',
  'error': 'error',
  'mock': 'thinking',
};

export const SERVICE_STATE_LABELS: Record<ServiceConnectionState, string> = {
  'not-connected': 'Не подключено',
  'opening': 'Открывается',
  'connected': 'Подключено',
  'needs-review': 'Нужна проверка',
  'needs-permission': 'Нужно разрешение',
  'read-only': 'Только чтение',
  'write-confirmation-required': 'Нужно подтверждение',
  'rate-limited': 'Ограничение запросов',
  'region-unavailable': 'Недоступно в регионе',
  'revoked': 'Доступ отозван',
  'error': 'Ошибка',
  'mock': 'Макет',
};

const DISCONNECT_LABELS: Record<'local' | 'remote', string> = {
  'local': 'Отключить здесь',
  'remote': 'Отключить и отозвать доступ',
};

export interface ServiceCardProps {
  className?: string;
  /** Provider name shown verbatim. */
  name: string;
  /** Access path this card represents — a provider may need separate cards
   *  for web vs API vs seller/business access. */
  mode: ServiceAccessMode;
  state?: ServiceConnectionState;
  /** Verbatim reason for needs-review/revoked/error/rate-limited — never invented. */
  reason?: string;
  /** Granted permission scopes — verbatim strings from the adapter. */
  scopes?: string[];
  /** What the provider offers — verbatim capability text. */
  summary?: ReactNode;
  onOpen?: () => void;
  onConnect?: () => void;
  /** Local disconnect — the label/handler must state whether the provider
   *  token is revoked remotely or only dropped locally. */
  onDisconnect?: () => void;
  /** 'local' (default) — credentials are dropped on this device only;
   *  'remote' — the provider token is revoked remotely too. The button
   *  label reflects the scope so the user never guesses. */
  disconnectScope?: 'local' | 'remote';
  icon?: ReactNode;
  children?: ReactNode;
}

/** Provider card for the Runtime services catalog: access-mode badge, honest
 *  connection state, scope summary and separate Open/Connect/Disconnect
 *  controls. Write/financial/VPN actions are never rendered by this card —
 *  consumers attach their own confirmed flows in `children`. */
export function ServiceCard({
  className, name, mode, state = 'not-connected', reason, scopes,
  summary, onOpen, onConnect, onDisconnect, disconnectScope = 'local',
  icon, children,
}: ServiceCardProps) {
  const connected = state === 'connected' || state === 'read-only'
    || state === 'write-confirmation-required';
  return (
    <div className={[styles.serviceCard, className].filter(Boolean).join(' ')}
      data-state={state} data-mode={mode} data-testid="service-card">
      <div className={styles.serviceHead}>
        {icon != null && <span className={styles.serviceIcon} aria-hidden="true">{icon}</span>}
        <span className={styles.serviceName}>{name}</span>
        <span className={styles.serviceMode}>{ACCESS_MODE_LABELS[mode]}</span>
        <StatusBadge status={STATE_STATUS[state]} label={SERVICE_STATE_LABELS[state]} />
      </div>
      {reason != null && <p className={styles.serviceReason}>{reason}</p>}
      {summary != null && <div className={styles.serviceSummary}>{summary}</div>}
      {scopes != null && scopes.length > 0 && (
        <ul className={styles.serviceScopes} aria-label="Выданные разрешения">
          {scopes.map((s) => <li key={s}>{s}</li>)}
        </ul>
      )}
      {children}
      {(onOpen != null || onConnect != null || onDisconnect != null) && (
        <div className={styles.serviceActions}>
          {onOpen != null && (
            <Button variant="secondary" size="sm" onClick={onOpen}
              disabled={state === 'opening'} loading={state === 'opening'}>
              Открыть
            </Button>
          )}
          {onConnect != null && !connected && (
            <Button variant="primary" size="sm" onClick={onConnect}
              disabled={state === 'opening'}>
              Подключить
            </Button>
          )}
          {onDisconnect != null && connected && (
            <Button variant="ghost" size="sm" onClick={onDisconnect}>
              {DISCONNECT_LABELS[disconnectScope]}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
