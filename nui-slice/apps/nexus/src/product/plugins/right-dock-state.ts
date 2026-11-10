/**
 * Правая докинг-панель NEU (волна XVI, п.2.3 спеки): три режима
 * скрыта/push/fullscreen, вкладки из keyed-слота `rightbar.tabs`,
 * разделение двух вкладок, состояние на сессию (sessionStorage),
 * ширина по образцу DSH: по умолчанию 45% окна, до 70%, центр
 * никогда не уже 400 px. Хоткей Ctrl/Cmd+B.
 *
 * Состояние и панель разнесены: AppShell держит хук/кнопку в общем
 * бандле, а разметка панели грузится лениво — по умолчанию док скрыт и
 * на первом кадре не нужен (perf-budget W4).
 */
'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { dockMotion } from '@nexus/motion';
import { matchesShortcut } from '../keyboard-shortcuts';

export type DockMode = 'hidden' | 'slim' | 'push' | 'fullscreen';

export interface DockState {
  mode: DockMode;
  /** открытые вкладки (ключи `rightbar.tabs`) */
  open: string[];
  active: string | null;
  /** вторая вкладка рядом — разделение панели */
  split: string | null;
  /** запомненная ширина px (null = 45% окна) */
  width: number | null;
}

const SESSION_KEY = 'nexus.rightbar.v1';
export const MIN_W = 320;
const CENTER_MIN = 400;
const EMPTY_STATE: DockState = { mode: 'hidden', open: [], active: null, split: null, width: null };

// Статик-экспорт рендерит на сервере — useLayoutEffect там noop+warning.
export const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/** Чат-композитор — дефолтный invoker при закрытии панели клавиатурой,
 *  когда явный invoker не зарегистрирован (NQ-104). */
const COMPOSER_SELECTOR = 'textarea[aria-label="Текст задачи"], textarea[id$="-task"]';

function readState(): DockState {
  const base: DockState = { mode: 'hidden', open: [], active: null, split: null, width: null };
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (raw == null) return base;
    const p = JSON.parse(raw) as Partial<DockState>;
    return {
      mode: p.mode === 'push' || p.mode === 'fullscreen' || p.mode === 'slim' ? p.mode : 'hidden',
      open: Array.isArray(p.open) ? p.open.filter((x): x is string => typeof x === 'string') : [],
      active: typeof p.active === 'string' ? p.active : null,
      split: typeof p.split === 'string' ? p.split : null,
      width: typeof p.width === 'number' && p.width > 0 ? p.width : null,
    };
  } catch {
    return base;
  }
}

function persist(st: DockState): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(st));
  } catch { /* приватный режим — состояние живёт в памяти */ }
}

/** Потолок ширины: min(70% окна, окно − левая колонка − 400px центра). */
export function maxWidth(): number {
  const vw = window.innerWidth;
  const left = document.querySelector<HTMLElement>('[class*="frameLeft"]');
  const leftW = left?.getBoundingClientRect().width ?? 0;
  return Math.max(MIN_W, Math.min(Math.round(vw * 0.7), vw - leftW - CENTER_MIN));
}

export function defaultWidth(): number {
  return Math.min(Math.round(window.innerWidth * 0.45), maxWidth());
}

/** Текущая ширина панели px — читается оболочкой для колонки aside.
 *  slim — тонкая иконополоса 48 px; fullscreen читается кадром целиком. */
export function rightDockWidth(state: DockState): number {
  if (typeof window === 'undefined') return MIN_W;
  if (state.mode === 'slim') return 48;
  return state.width ?? defaultWidth();
}

export interface RightDockApi {
  state: DockState;
  triggerRef: RefObject<HTMLButtonElement | null>;
  /** Внутренний флаг: открытие инициировано пользователем — панель при
   *  монтировании забирает фокус (NQ-104). Session-restore его не ставит. */
  openFocusRef: RefObject<boolean>;
  setInvoker(element: HTMLElement): void;
  setMode(mode: DockMode): void;
  openTab(key: string): void;
  closeTab(key: string): void;
  activate(key: string): void;
  toggleSplit(key: string): void;
  setWidth(px: number): void;
}

/** Состояние + реакции панели — выносится из разметки для кнопки
 *  топбара и хоткея; поднимается в AppShell. */
export function useRightDock(): RightDockApi {
  const [state, setState] = useState<DockState>(EMPTY_STATE);
  const changedRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const invokerRef = useRef<HTMLElement | null>(null);
  const openFocusRef = useRef(false);
  const focusRestoreRef = useRef<{ kind: 'raf' | 'timeout'; id: number } | null>(null);
  const previousModeRef = useRef(state.mode);

  useEffect(() => {
    if (!changedRef.current) setState(readState());
  }, []);

  const update = useCallback((fn: (s: DockState) => DockState) => {
    changedRef.current = true;
    setState((s) => {
      const next = fn(s);
      persist(next);
      return next;
    });
  }, []);

  // Двойная садка фокуса на инвокер:
  // 1) синхронно в layout-эффекте — клавиатурная гонка NQ-110: rAF-версия
  //    лендилась кадр спустя, замеры читали activeElement=body;
  // 2) re-assert на следующий кадр — pointer-закрытие (outside click)
  //    проигрывает sync-фокусу: дефолтный фокус клика применяется ПОСЛЕ
  //    dispatch и перебивает наш; кадр возвращает фокус триггеру.
  // Кадр отменяемый — при размонтировании владельца не стреляет.
  const restoreInvokerFocus = useCallback(() => {
    const focusTarget = () => {
      const invoker = invokerRef.current;
      const dockEl = document.querySelector('[data-testid="right-dock"]');
      const target =
        invoker?.isConnected && !(dockEl?.contains(invoker) ?? false)
          ? invoker
          : document.querySelector<HTMLElement>(COMPOSER_SELECTOR) ?? triggerRef.current;
      target?.focus();
    };
    focusTarget();
    if (focusRestoreRef.current != null) {
      const pending = focusRestoreRef.current;
      if (pending.kind === 'raf') window.cancelAnimationFrame(pending.id);
      else window.clearTimeout(pending.id);
    }
    const reassert = () => { focusRestoreRef.current = null; focusTarget(); };
    if (typeof window.requestAnimationFrame === 'function') {
      focusRestoreRef.current = { kind: 'raf', id: window.requestAnimationFrame(reassert) };
    } else {
      focusRestoreRef.current = { kind: 'timeout', id: window.setTimeout(reassert, 0) };
    }
  }, []);

  useEffect(() => () => {
    const pending = focusRestoreRef.current;
    if (pending?.kind === 'raf') window.cancelAnimationFrame(pending.id);
    else if (pending?.kind === 'timeout') window.clearTimeout(pending.id);
    focusRestoreRef.current = null;
  }, []);

  useIsoLayoutEffect(() => {
    const previous = previousModeRef.current;
    previousModeRef.current = state.mode;
    if (
      (previous !== 'hidden' && state.mode === 'hidden')
      || (previous === 'slim' && state.mode === 'push')
    ) {
      restoreInvokerFocus();
    }
  }, [restoreInvokerFocus, state.mode]);

  // Ctrl/Cmd+B — скрыта ↔ push. Слушатель в хуке, а не в панели:
  // панель при hidden размонтирована, хоткей обязан её поднимать.
  // Alt+B — дополнительная клавиша док-панели по NQ-097.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!matchesShortcut(e, 'dock.toggle') && !matchesShortcut(e, 'dock.toggle.alt')) return;
      e.preventDefault();
      if (state.mode === 'hidden') {
        // NQ-104: клавиатурное открытие регистрирует pre-hotkey invoker
        // (композитор и т.п.) и просит панель забрать фокус при монтировании.
        // При закрытии invoker не трогаем — фокус в этот момент внутри дока.
        const el = document.activeElement;
        invokerRef.current = el instanceof HTMLElement && el !== document.body ? el : null;
        openFocusRef.current = true;
      }
      update((s) => ({ ...s, mode: s.mode === 'hidden' ? 'push' : 'hidden' }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.mode, update]);

  // Клеймо центра: окно сузили — ширина запомненной панели не должна
  // съесть центр ниже 400 px (п.2.3 спеки).
  useEffect(() => {
    const onResize = () => {
      update((s) => (s.width != null && s.width > maxWidth() ? { ...s, width: maxWidth() } : s));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [update]);

  const api: RightDockApi = {
    state,
    triggerRef,
    openFocusRef,
    setInvoker: (element) => { invokerRef.current = element; },
    setMode: (mode) => update((s) => {
      // Открытие из любого внешнего пути несёт фокус в панель (NQ-104).
      if (s.mode === 'hidden' && mode !== 'hidden') openFocusRef.current = true;
      return { ...s, mode };
    }),
    openTab: (key) => update((s) => {
      if (s.mode === 'hidden') openFocusRef.current = true;
      return {
        ...s,
        mode: s.mode === 'hidden' ? 'push' : s.mode,
        open: s.open.includes(key) ? s.open : [...s.open, key],
        active: s.active ?? key,
      };
    }),
    closeTab: (key) => update((s) => {
      const open = s.open.filter((k) => k !== key);
      return {
        ...s,
        open,
        active: s.active === key ? open[0] ?? null : s.active,
        split: s.split === key ? null : s.split,
        mode: open.length === 0 ? 'hidden' : s.mode,
      };
    }),
    activate: (key) => update((s) => ({ ...s, active: key })),
    toggleSplit: (key) => update((s) => ({
      ...s,
      split: s.split === key ? null : s.active === key ? s.split : key,
    })),
    setWidth: (px) => update((s) => ({ ...s, width: Math.max(MIN_W, Math.min(px, maxWidth())) })),
  };
  return api;
}

/**
 * W4-1008 slideOut keep-alive: при переходе в `hidden` возвращает
 * прежний режим на `dockMotion('slideOut').durationMs` — родитель держит
 * панель смонтированной (`exiting`) на это окно, затем размонтирует.
 * Reduced-motion → 0 → мгновенный unmount, как раньше.
 */
export function useDockExit(dock: RightDockApi): DockMode | null {
  const [exitMode, setExitMode] = useState<DockMode | null>(null);
  const prevModeRef = useRef(dock.state.mode);
  useEffect(() => {
    const prev = prevModeRef.current;
    prevModeRef.current = dock.state.mode;
    if (dock.state.mode !== 'hidden') {
      setExitMode(null); // bail, если уже null — повторного рендера нет
      return;
    }
    if (prev === 'hidden') return;
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const spec = dockMotion('slideOut', { reducedMotion: reduced });
    if (spec.durationMs === 0) return;
    setExitMode(prev);
    const t = window.setTimeout(() => setExitMode(null), spec.durationMs);
    return () => window.clearTimeout(t);
  }, [dock.state.mode]);
  return dock.state.mode === 'hidden' ? exitMode : null;
}
