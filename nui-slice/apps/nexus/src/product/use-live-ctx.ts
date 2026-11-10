'use client';

import { useContext } from 'react';
import { LiveContext, type LiveCtx } from './screens/newf';

export type { LiveCtx };

/**
 * NEWF-PACT §5: единая точка потребления LiveContext.
 * Бросает invariant-ошибку при ctx === null — использовать ТОЛЬКО
 * в панелях, гарантированно рендерящихся внутри shell-провайдера
 * (мод-панели newf). Для опциональных контекстов — useLiveCtxOrNull.
 */
export function useLiveCtx(): LiveCtx {
  const ctx = useContext(LiveContext);
  if (ctx == null) {
    throw new Error('useLiveCtx: LiveContext is null — component rendered outside the newf shell provider');
  }
  return ctx;
}

/**
 * Мягкий вариант для shared/standalone-компонентов и тестов:
 * возвращает null вместо throw — вызывающий обязан ветвиться.
 */
export function useLiveCtxOrNull(): LiveCtx | null {
  return useContext(LiveContext);
}
