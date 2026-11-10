'use client';

/**
 * W3-158 — единый toast-стек для ошибок API.
 *
 * До этого ошибки send/compaction/settings/history жили разрозненными
 * inline-строками или тихими catch'ами. Здесь — один регион:
 * `ToastRegion` из @nexus/ui (слой `--nexus-layer-overlay`, W2-149),
 * честный текст из ApiError (kind+message verbatim), retry-действие
 * для transient-ошибок, липкий toast для ошибок, авто-dismiss для
 * успехов. Dedup по тексту — повторная та же ошибка не плодит стек.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { ToastRegion, type ToastData } from '@nexus/ui';
import { isAi2ApiError } from '../integrations/ai2/api/errors';

const MAX_VISIBLE = 4;

/** Честный текст тоста: реальная причина из ApiError, без «что-то пошло не так». */
export function apiErrorToastText(err: unknown, prefix: string): string {
  if (isAi2ApiError(err)) {
    const detail = err.message?.trim();
    return `${prefix} (HTTP ${err.status}${detail ? ` · ${detail}` : ''})`;
  }
  const detail = err instanceof Error && err.message.trim() ? err.message.trim() : null;
  return detail != null ? `${prefix}: ${detail}` : `${prefix}. Проверьте подключение и повторите.`;
}

export interface ApiToastOptions {
  /** Повтор операции — transient-ошибки получают кнопку действия. */
  retry?: () => void;
  retryLabel?: string;
}

export interface ApiToastApi {
  notifyApiError: (err: unknown, prefix: string, opts?: ApiToastOptions) => void;
  /** Успех — авто-dismiss, действий нет. */
  notifySuccess: (message: string) => void;
}

const ApiToastContext = createContext<ApiToastApi | null>(null);

/** Может отсутствовать (баре-рендеры, тесты экранов без shell) — null, не throw. */
export function useApiToast(): ApiToastApi | null {
  return useContext(ApiToastContext);
}

export function ApiToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((next: Omit<ToastData, 'id'>) => {
    setToasts((cur) => {
      // Dedup по тексту+действию: та же ошибка повторно стек не плодит —
      // существующий тост просто остаётся на месте.
      if (cur.some((t) => t.message === next.message && t.tone === next.tone)) return cur;
      const toast: ToastData = { ...next, id: `api-${++counter.current}` };
      const list = [...cur, toast];
      return list.length > MAX_VISIBLE ? list.slice(list.length - MAX_VISIBLE) : list;
    });
  }, []);

  const api = useMemo<ApiToastApi>(() => ({
    notifyApiError: (err, prefix, opts) => {
      push({
        tone: 'error',
        message: apiErrorToastText(err, prefix),
        durationMs: 0, // ошибки — липкие: закрытие только явное
        action: opts?.retry != null
          ? { label: opts.retryLabel ?? 'Повторить', onAction: opts.retry }
          : undefined,
      });
    },
    notifySuccess: (message) => push({ tone: 'success', message, durationMs: 5000 }),
  }), [push]);

  return (
    <ApiToastContext.Provider value={api}>
      {children}
      <ToastRegion toasts={toasts} onDismiss={dismiss} />
    </ApiToastContext.Provider>
  );
}
