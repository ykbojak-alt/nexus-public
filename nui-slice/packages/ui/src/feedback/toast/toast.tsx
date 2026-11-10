'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { NexusIcon } from '@nexus/icons';
import { notifyMotion } from '@nexus/motion';
import styles from '../feedback.module.css';
import type { NoticeTone } from '../system-notice/system-notice';

export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface ToastData {
  id: string;
  tone?: NoticeTone;
  message: string;
  /** <=0 — sticky (не уходит сам); ошибки API ставят 0, успехи — авто. */
  durationMs?: number;
  /** Действие тоста (retry transient-ошибок); нажатие = caller обязан
   *  дисмиссить/повторить — сам тост ничего не вызывает. */
  action?: ToastAction;
}

const TONE_ROLE: Record<NoticeTone, 'status' | 'alert'> = {
  info: 'status', success: 'status', warning: 'alert', error: 'alert',
};

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribeMotion(fn: () => void): () => void {
  const mq = globalThis.matchMedia?.(QUERY);
  if (!mq) return () => {};
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
}

function useToastReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => globalThis.matchMedia?.(QUERY).matches === true,
    () => false,
  );
}

export function Toast({ className, toast, onDismiss }: { className?: string; toast: ToastData; onDismiss: (id: string) => void }) {
  const { id, tone = 'info', message, durationMs = 5000 } = toast;
  const reduced = useToastReducedMotion();
  const [exiting, setExiting] = useState(false);
  const dismissed = useRef(false);

  // notifyOut keep-alive: the toast holds itself mounted+inert for the
  // token window, then the caller removes it from the list. Reduced
  // motion resolves 0ms → the caller is notified immediately.
  const beginExit = useCallback(() => {
    if (dismissed.current) return;
    const ms = notifyMotion('notifyOut', { reducedMotion: reduced }).durationMs;
    if (ms === 0) {
      dismissed.current = true;
      onDismiss(id);
      return;
    }
    setExiting(true);
  }, [id, onDismiss, reduced]);

  useEffect(() => {
    if (!exiting) return;
    const ms = notifyMotion('notifyOut', { reducedMotion: reduced }).durationMs;
    // Флип reduced-motion в полёте: окно схлопывается, тост уходит сразу.
    if (ms === 0) {
      dismissed.current = true;
      onDismiss(id);
      return;
    }
    const t = setTimeout(() => { dismissed.current = true; onDismiss(id); }, ms);
    return () => clearTimeout(t);
  }, [exiting, id, onDismiss, reduced]);

  useEffect(() => {
    if (durationMs <= 0) return;
    const t = setTimeout(beginExit, durationMs);
    return () => clearTimeout(t);
  }, [durationMs, beginExit]);

  return (
    <div
      className={[styles.toast, className].filter(Boolean).join(' ')}
      data-tone={tone}
      data-exit={exiting || undefined}
      inert={exiting || undefined}
      role={TONE_ROLE[tone]}
      data-testid={`toast-${id}`}
    >
      <div className={styles.toastClip}>
        <span>{message}</span>
        {toast.action != null && (
          <button
            type="button"
            className={styles.toastAction}
            onClick={() => { toast.action?.onAction(); beginExit(); }}
          >
            {toast.action.label}
          </button>
        )}
        <button type="button" className={styles.toastClose} aria-label="Dismiss" onClick={beginExit}>
          <NexusIcon name="act.close" size="var(--nexus-icon-size-xs)" />
        </button>
      </div>
    </div>
  );
}

/** Fixed region rendering a stack of toasts; state owned by caller. */
export function ToastRegion({ className, toasts, onDismiss }: { className?: string; toasts: ToastData[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return createPortal(
    <div className={[styles.toastRegion, className].filter(Boolean).join(' ')} aria-live="polite" aria-label="Notifications">
      {toasts.map((t) => <Toast key={t.id} toast={t} onDismiss={onDismiss} />)}
    </div>,
    document.body,
  );
}
