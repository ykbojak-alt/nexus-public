import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '../../actions/button/button';
import { StatusBadge, type NexusStatus } from '../status-badge/status-badge';
import styles from './approval-request.module.css';

/** Post-decision states — a queue surface renders these verbatim; the
 *  component never invents or delays them. */
export type ApprovalState = 'pending' | 'approved' | 'denied' | 'deferred' | 'revoked' | 'expired';

const STATE_STATUS: Record<Exclude<ApprovalState, 'pending'>, NexusStatus> = {
  approved: 'complete',
  denied: 'error',
  deferred: 'warning',
  revoked: 'warning',
  expired: 'offline',
};
const STATE_LABEL: Record<Exclude<ApprovalState, 'pending'>, string> = {
  approved: 'Разрешено',
  denied: 'Отклонено',
  deferred: 'Отложено',
  revoked: 'Отозвано',
  expired: 'Время истекло',
};

export interface ApprovalRequestProps {
  className?: string;
  title: string;
  detail?: ReactNode;
  onApprove: () => void;
  onReject: () => void;
  approveLabel?: string;
  rejectLabel?: string;
  approveDisabled?: boolean;
  rejectDisabled?: boolean;
  resolvedLabel?: string;
  /** Visual severity of the requested action. */
  severity?: 'normal' | 'destructive';
  /** Decision state — 'pending' (default) renders actions; resolved states
   *  render a status badge instead of buttons. */
  state?: ApprovalState;
  /** Exact action requested, verbatim (e.g. 'write', 'exec', 'network'). */
  action?: string;
  /** What the action applies to — path, command or resource id. */
  target?: string;
  /** Grant scope for the decision (e.g. 'workspace:root', 'session'). */
  scope?: string;
  /** Caller-formatted expiry — no invented clocks. */
  expiresAt?: string;
}

/**
 * Agent-approval semantic pattern (spec §14): approve and reject are
 * separate callbacks and never share a generic "confirm" handler.
 * Resolved requests show their decision state, not dead buttons.
 */
export function ApprovalRequest({ className,
  title, detail, onApprove, onReject,
  approveLabel = 'Разрешить', rejectLabel = 'Отклонить', severity = 'normal',
  approveDisabled = false, rejectDisabled = false, resolvedLabel,
  state = 'pending', action, target, scope, expiresAt,
}: ApprovalRequestProps) {
  const resolved = state !== 'pending';
  const meta = [action, target, scope, expiresAt != null ? `до ${expiresAt}` : undefined]
    .filter(Boolean).join(' · ');
  const rootRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  // Focus restore: resolving in place unmounts the focused button — hand focus
  // to the resolved status instead of dropping it to document body. Snapshot
  // during render: the DOM still holds the pending buttons at this point, so
  // activeElement tells us whether the user was operating this request.
  const focusWasInside = rootRef.current?.contains(document.activeElement) ?? false;
  useEffect(() => {
    if (resolved && focusWasInside) statusRef.current?.focus();
  }, [resolved, focusWasInside]);
  return (
    <div ref={rootRef} className={[styles.root, className].filter(Boolean).join(' ')}
      role={resolved ? 'status' : 'alert'}
      data-testid="approval-request" data-severity={severity} data-state={state}>
      <div className={styles.title}>{title}</div>
      {meta !== '' && <div className={styles.meta}>{meta}</div>}
      {detail != null && <div className={styles.detail}>{detail}</div>}
      {resolved ? (
        <span ref={statusRef} tabIndex={-1} className={styles.resolved}>
          <StatusBadge
            status={STATE_STATUS[state as Exclude<ApprovalState, 'pending'>]}
            label={resolvedLabel ?? STATE_LABEL[state as Exclude<ApprovalState, 'pending'>]}
          />
        </span>
      ) : (
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" onClick={onReject} disabled={rejectDisabled}>{rejectLabel}</Button>
          <Button variant={severity === 'destructive' ? 'danger' : 'primary'} size="sm" onClick={onApprove} disabled={approveDisabled}>{approveLabel}</Button>
        </div>
      )}
    </div>
  );
}
