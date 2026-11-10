import { ApprovalRequest, type ApprovalState } from '../feedback/approval-request/approval-request';
import { maskSecrets } from '../runtime/mask-secrets';

/** Решения из SDK/хоста отображаются verbatim в data-status; `allow`/`deny`
 *  соответствуют значениям контракта W1, формы allowed/denied оставлены
 *  для совместимости уже существующих потребителей. */
export type ToolConfirmationStatus =
  | 'awaiting' | 'deferred' | 'allow' | 'deny'
  | 'allowed' | 'denied' | 'timeout';

const STATE_MAP: Record<ToolConfirmationStatus, ApprovalState> = {
  awaiting: 'pending',
  deferred: 'deferred',
  allow: 'approved',
  deny: 'denied',
  allowed: 'approved',
  denied: 'denied',
  timeout: 'expired',
};

export interface ToolConfirmationCardProps {
  className?: string;
  /** Имя инструмента из canUseTool — дословно. */
  toolName: string;
  /** Вход вызова; секреты маскируются перед выводом. */
  input?: unknown;
  status: ToolConfirmationStatus;
  onAllow?: () => void;
  onDeny?: () => void;
  /** Дедлайн решения, отформатирован вызывающим (expiresAt из контракта). */
  expiresAt?: string;
  /** Подписи кнопок — по-русски по умолчанию. */
  allowLabel?: string;
  denyLabel?: string;
}

/** Карточка подтверждения вызова инструмента: awaiting имеет две явные
 *  клавиатурно-доступные команды; deferred/allow/deny/timeout — реальные
 *  исходы хоста. Секреты маскируются до передачи в базовый компонент. */
export function ToolConfirmationCard({
  className, toolName, input, status, onAllow, onDeny, expiresAt,
  allowLabel = 'Разрешить', denyLabel = 'Отклонить',
}: ToolConfirmationCardProps) {
  const mapped = STATE_MAP[status];
  const masked = input !== undefined ? maskSecrets(input) : undefined;
  const detail = masked != null
    ? (typeof masked === 'string' ? masked : JSON.stringify(masked)).slice(0, 400)
    : undefined;
  return (
    <div data-testid="tool-confirmation-card" data-status={status} className={className}>
      <ApprovalRequest
        title={toolName}
        action="Вызов инструмента"
        detail={detail}
        state={mapped}
        expiresAt={expiresAt}
        approveLabel={allowLabel}
        rejectLabel={denyLabel}
        approveDisabled={onAllow == null}
        rejectDisabled={onDeny == null}
        onApprove={onAllow ?? (() => { })}
        onReject={onDeny ?? (() => { })}
      />
    </div>
  );
}
