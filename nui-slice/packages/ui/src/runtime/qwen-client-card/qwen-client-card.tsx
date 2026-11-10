import type { ReactNode } from 'react';
import { Button } from '../../actions/button/button';
import { StatusBadge, type NexusStatus } from '../../feedback/status-badge/status-badge';
import styles from '../runtime.module.css';

/** Жизненное состояние клиента на хосте — verbatim от пробника, не выдумка. */
export type QwenClientState =
  | 'ready' | 'running' | 'unavailable' | 'not-installed' | 'unknown';

/** Подсистемы Qwen Code по инвентарю rc-clients (расширяемость: mcp,
 *  hooks, extensions, channel). */
export type QwenSubsystemKind = 'mcp' | 'hooks' | 'extensions' | 'channels';

/** Состояние подсистемы: 'configured' — конфиг есть, живость не проверена;
 *  'unknown' — пробник не смог определить (честное «нет данных»). */
export type QwenSubsystemState =
  | 'active' | 'configured' | 'disabled' | 'unavailable' | 'unknown';

export interface QwenSubsystemStatus {
  kind: QwenSubsystemKind;
  state: QwenSubsystemState;
  /** Verbatim detail — имена серверов/хуков/расширений, количество. */
  detail?: string;
}

export const QWEN_CLIENT_STATE_LABELS: Record<QwenClientState, string> = {
  'ready': 'Готов',
  'running': 'Выполняет прогон',
  'unavailable': 'Недоступен',
  'not-installed': 'Не установлен',
  'unknown': 'Нет данных',
};

const CLIENT_STATUS: Record<QwenClientState, NexusStatus> = {
  'ready': 'online',
  'running': 'executing',
  'unavailable': 'offline',
  'not-installed': 'offline',
  'unknown': 'waiting',
};

export const QWEN_SUBSYSTEM_LABELS: Record<QwenSubsystemKind, string> = {
  'mcp': 'MCP',
  'hooks': 'Хуки',
  'extensions': 'Расширения',
  'channels': 'Каналы',
};

export const QWEN_SUBSYSTEM_STATE_LABELS: Record<QwenSubsystemState, string> = {
  'active': 'Активно',
  'configured': 'Настроено',
  'disabled': 'Отключено',
  'unavailable': 'Недоступно',
  'unknown': 'Нет данных',
};

const SUBSYS_STATUS: Record<QwenSubsystemState, NexusStatus> = {
  'active': 'online',
  'configured': 'info',
  'disabled': 'offline',
  'unavailable': 'offline',
  'unknown': 'waiting',
};

export interface QwenClientCardProps {
  className?: string;
  /** Display name — default 'Qwen Code'. */
  name?: string;
  /** Installed version verbatim (e.g. '0.24.7') — rendered only when the
   *  probe actually returned it. */
  version?: string;
  /** Client liveness — default 'unknown' (нет данных, не «готов»). */
  state?: QwenClientState;
  /** Verbatim reason for unavailable/not-installed/unknown. */
  reason?: string;
  /** Subsystem rows — verbatim from the probe. Absent rows are not shown:
   *  карта никогда не рисует «OK» для того, что не проверено. */
  subsystems?: QwenSubsystemStatus[];
  /** Capability chips verbatim from the adapter (approval modes, протоколы). */
  capabilities?: string[];
  onOpen?: () => void;
  icon?: ReactNode;
  children?: ReactNode;
}

/** Карточка клиента Qwen Code для каталога Runtime Clients (wave C):
 *  живость клиента + строки подсистем (MCP/хуки/расширения/каналы) — всё
 *  verbatim из пробника; недоступность честная, без выдуманных статусов. */
export function QwenClientCard({
  className, name = 'Qwen Code', version, state = 'unknown', reason,
  subsystems, capabilities, onOpen, icon, children,
}: QwenClientCardProps) {
  return (
    <div className={[styles.serviceCard, className].filter(Boolean).join(' ')}
      data-state={state} data-client="qwen" data-testid="qwen-client-card">
      <div className={styles.serviceHead}>
        {icon != null && <span className={styles.serviceIcon} aria-hidden="true">{icon}</span>}
        <span className={styles.serviceName}>{name}</span>
        {version != null && <span className={styles.clientVersion}>v{version}</span>}
        <span className={styles.serviceMode} aria-hidden="true" />
        <StatusBadge status={CLIENT_STATUS[state]} label={QWEN_CLIENT_STATE_LABELS[state]} />
      </div>
      {reason != null && <p className={styles.serviceReason}>{reason}</p>}
      {subsystems != null && subsystems.length > 0 && (
        <ul className={styles.clientSubsys} aria-label="Подсистемы клиента">
          {subsystems.map((s) => (
            <li key={s.kind} className={styles.clientSubsysRow} data-state={s.state}>
              <span className={styles.clientSubsysLabel}>{QWEN_SUBSYSTEM_LABELS[s.kind]}</span>
              <StatusBadge status={SUBSYS_STATUS[s.state]} label={QWEN_SUBSYSTEM_STATE_LABELS[s.state]} />
              {s.detail != null && <span className={styles.clientSubsysDetail}>{s.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      {capabilities != null && capabilities.length > 0 && (
        <ul className={styles.serviceScopes} aria-label="Возможности клиента">
          {capabilities.map((c) => <li key={c}>{c}</li>)}
        </ul>
      )}
      {children}
      {onOpen != null && (
        <div className={styles.serviceActions}>
          <Button variant="secondary" size="sm" onClick={onOpen}>Открыть</Button>
        </div>
      )}
    </div>
  );
}
