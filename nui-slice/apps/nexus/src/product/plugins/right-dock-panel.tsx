/**
 * Разметка правой докинг-панели NEU. Вынесена из `right-dock.tsx` в
 * отдельный модуль: AppShell статически держит только состояние и кнопку
 * топбара, а сама панель грузится лениво (`next/dynamic`) — по умолчанию
 * док скрыт и на первом кадре не нужен (perf-budget W4).
 */
'use client';

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { RightPanelTabBar, Tooltip } from '@nexus/ui';
import { shortcutHint } from '../keyboard-shortcuts';
import { BarDragGrip, beginBarDrag } from '../modular-bars';
import { useSlot, type RightbarTabDef } from './plugin-host';
import './builtin';
import styles from './right-dock.module.css';
import { defaultWidth, maxWidth, MIN_W, useIsoLayoutEffect, type RightDockApi } from './right-dock-state';

/** Фокусируемые элементы панели — общий селектор для Tab-ловушки и
 *  переноса фокуса при открытии (NQ-104). */
const FOCUSABLE_SEL =
  'button:not([disabled]):not([tabindex="-1"]), a[href]:not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])';

export function RightDockPanel({ dock, side = 'right', onMove, onDragStart, onDragKeyDown, onSurfacePointerDown, floating = false, exiting = false }: {
  dock: RightDockApi;
  /** Край стыковки (модульные бары NUE): left — ресайз-кромка справа. */
  side?: 'left' | 'right';
  /** Кнопка ⇄ — перенос панели на другой край (swap с рейлом разделов). */
  onMove?: () => void;
  onDragStart?: (e: ReactPointerEvent<HTMLElement>) => void;
  onDragKeyDown?: (e: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onSurfacePointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
  floating?: boolean;
  /** W4-1008: keep-alive exit — панель инертна и отыгрывает slideOut. */
  exiting?: boolean;
}) {
  const entries = useSlot<RightbarTabDef>('rightbar.tabs');
  const { state } = dock;
  const rootRef = useRef<HTMLDivElement>(null);
  const previousModeRef = useRef(state.mode);

  // NQ-104: открытие пользователем (hotkey/клик/программный openTab) несёт
  // фокус В панель. Панель существует только пока открыта — переход
  // hidden→open для неё это mount, поэтому ловим именно маунт по флагу
  // openFocusRef; session-restore флаг не ставит и фокус не крадёт.
  useEffect(() => {
    if (exiting || !dock.openFocusRef.current) return;
    dock.openFocusRef.current = false;
    const focus = () => {
      const root = rootRef.current;
      if (root == null) return;
      const target =
        root.querySelector<HTMLElement>(`.${styles.dockHead} ${FOCUSABLE_SEL}`) ??
        root.querySelector<HTMLElement>(FOCUSABLE_SEL);
      target?.focus();
    };
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(focus);
    else window.setTimeout(focus, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- одноразовый consume при монтировании
  }, []);

  // Вкладки-сироты (плагин выключили): закрываем честно.
  useEffect(() => {
    const keys = new Set(entries.map((e) => e.key));
    for (const k of [...state.open]) {
      if (k != null && !keys.has(k)) dock.closeTab(k);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- реагируем на состав слота
  }, [entries]);

  const width = state.width ?? (typeof window === 'undefined' ? MIN_W : defaultWidth());
  const activeEntry = entries.find((e) => e.key === state.active) ?? null;
  const splitEntry = entries.find((e) => e.key === state.split && e.key !== state.active) ?? null;
  const visibleTabs = entries.filter((e) => state.open.includes(e.key as string));

  const beginResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Справа панель растёт влево; состыкованная слева — вправо.
    beginBarDrag(e, {
      axis: 'x',
      start: width,
      min: MIN_W,
      max: maxWidth(),
      sign: side === 'right' ? -1 : 1,
      apply: dock.setWidth,
      // Live: ширина на самой панели + колоночная var на shellWrap —
      // без sessionStorage и ре-рендеров на каждый pointermove;
      // состояние дока фиксируется однократно на pointerup.
      live: (px) => {
        const el = rootRef.current;
        if (!el) return;
        el.style.width = `${px}px`;
        el.closest<HTMLElement>('[data-bar-id="dock"]')?.style.setProperty('width', `${px}px`);
        if (!floating) {
          const shell = el.closest<HTMLElement>('[data-nav]');
          shell?.style.setProperty(
            side === 'left' ? '--nexus-frame-left' : '--nexus-window-frame-right-width',
            `${px}px`,
          );
        }
      },
      commit: dock.setWidth,
    });
  };

  const onDockKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      dock.setMode('hidden');
      return;
    }
    if (e.key !== 'Tab') return;
    const root = rootRef.current;
    if (root == null) return;
    const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SEL))
      .filter((el) => el.getAttribute('aria-hidden') !== 'true' && el.closest('[aria-hidden="true"]') == null);
    if (focusable.length === 0) {
      e.preventDefault();
      root.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !root.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !root.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  // Клавиатурный контракт при сворачивании (флак NQ-класса): фокус обязан
  // оказаться внутри slim-полосы ДО первого кадра нового режима — layout-
  // эффект срабатывает синхронно после commit; rAF-версия проигрывала гонку
  // замерам («insideAfterCollapse=false»). Re-assert кадр поверх: pointer-
  // сворачивание отдаёт фокус дефолту клика позже dispatch — кадр возвращает.
  const slimFrameRef = useRef<number | null>(null);
  useIsoLayoutEffect(() => {
    const previous = previousModeRef.current;
    previousModeRef.current = state.mode;
    if (previous !== 'slim' && state.mode === 'slim') {
      const pick = () => rootRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"]), a[href]:not([tabindex="-1"])',
      );
      pick()?.focus();
      if (typeof window.requestAnimationFrame === 'function') {
        slimFrameRef.current = window.requestAnimationFrame(() => {
          slimFrameRef.current = null;
          // Текущий режим читаем из DOM — стейт-замыкание застыло на 'slim',
          // а за кадр мог прийти переход slim→push (фокус у инвокера).
          const mode = rootRef.current?.getAttribute('data-mode');
          if (mode === 'slim' && !(rootRef.current?.contains(document.activeElement) ?? false)) {
            pick()?.focus();
          }
        });
      }
    }
    return () => {
      if (slimFrameRef.current != null) {
        window.cancelAnimationFrame(slimFrameRef.current);
        slimFrameRef.current = null;
      }
    };
  }, [state.mode]);

  useEffect(() => {
    if (state.mode === 'hidden') return;
    const onOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target) || dock.triggerRef.current?.contains(target)) return;
      dock.setMode('hidden');
    };
    document.addEventListener('pointerdown', onOutsidePointerDown);
    return () => document.removeEventListener('pointerdown', onOutsidePointerDown);
  }, [dock, state.mode]);

  const fullscreen = state.mode === 'fullscreen';
  const slim = state.mode === 'slim';
  if (slim) {
    // Свернутая полоса: иконки открытых вкладок + разворот. Панель остаётся
    // видимым аффордансом — это «свернуть», а не «закрыть».
    return (
      <div ref={rootRef} className={styles.dock} data-bar-surface={!floating ? 'dock' : undefined}
        data-mode="slim" data-side={side} data-testid="right-dock"
        data-exit={exiting || undefined} inert={exiting || undefined}
        onPointerDown={onSurfacePointerDown}
        role="complementary" aria-label="Правая панель — свёрнута" onKeyDown={onDockKeyDown}>
        <div className={styles.slimCol}>
          {onDragStart != null && (
            <Tooltip content="Переместить панель плагинов" kbd="↑ / ↓">
              <BarDragGrip label="Переместить панель плагинов; стрелки ↑/↓ двигают на 16 px"
                onPointerDown={onDragStart} onKeyDown={onDragKeyDown} />
            </Tooltip>
          )}
          {visibleTabs.map((e) => (
            <button key={e.key} type="button" className={styles.slimTab}
              title={`${e.value.title} — развернуть панель`}
              aria-label={`${e.value.title} — развернуть панель`}
              onClick={() => { dock.activate(e.key as string); dock.setMode('push'); }}>
              {e.value.title.trim().charAt(0) || '·'}
            </button>
          ))}
          <button type="button" className={styles.slimTab}
            title="Развернуть панель" aria-label="Развернуть панель"
            onClick={() => dock.setMode('push')}>❬</button>
          <button type="button" className={styles.slimTab}
            title={`Закрыть панель (${shortcutHint('dock.toggle')})`} aria-label="Закрыть панель"
            onClick={() => dock.setMode('hidden')}>×</button>
        </div>
      </div>
    );
  }
  return (
    <div
      ref={rootRef}
      className={styles.dock}
      data-bar-surface={!floating ? 'dock' : undefined}
      data-mode={state.mode}
      data-side={side}
      data-testid="right-dock"
      data-exit={exiting || undefined}
      onPointerDown={onSurfacePointerDown}
      inert={exiting || undefined}
      role="complementary"
      aria-label="Правая панель"
      style={fullscreen ? undefined : { width }}
      onKeyDown={onDockKeyDown}
    >
      {!fullscreen && (
        <div
          className={styles.resizer}
          data-side={side}
          role="separator"
          aria-orientation="vertical"
          aria-label="Ширина панели — тянуть или стрелки ←/→"
          aria-valuenow={width}
          aria-valuemin={MIN_W}
          tabIndex={0}
          onPointerDown={beginResize}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            // Справа: ← шире, → уже. Слева — наоборот.
            const dir = (e.key === 'ArrowRight' ? 1 : -1) * (side === 'right' ? -1 : 1);
            dock.setWidth(width + dir * 24);
          }}
        />
      )}
      <div className={styles.dockHead}>
        {onDragStart != null && (
          <Tooltip content="Переместить панель плагинов" kbd="↑ / ↓">
            <BarDragGrip label="Переместить панель плагинов; стрелки ↑/↓ двигают на 16 px"
              onPointerDown={onDragStart} onKeyDown={onDragKeyDown} />
          </Tooltip>
        )}
        {visibleTabs.length === 0 ? (
          <span className={styles.tabNote}>Вкладок нет — плагины панели не активны.</span>
        ) : (
          <RightPanelTabBar
            className={styles.tabBar}
            tabs={visibleTabs.map((e) => ({ id: e.key as string, title: e.value.title }))}
            activeId={state.active}
            mode={fullscreen ? 'fullscreen' : 'push'}
            onActivate={(id) => dock.activate(id)}
            onClose={(id) => dock.closeTab(id)}
            onSplit={visibleTabs.length > 1 ? () => {
              const candidate = visibleTabs.find((e) => e.key !== state.active)?.key ?? null;
              dock.toggleSplit(state.split == null ? (candidate as string) : state.split);
            } : undefined}
            onFullscreen={(fs) => dock.setMode(fs ? 'fullscreen' : 'push')}
          />
        )}
        <div className={styles.headTools}>
          {entries.filter((e) => !state.open.includes(e.key as string)).length > 0 && (
            <select
              className={styles.addTab}
              aria-label="Открыть вкладку"
              value=""
              onChange={(ev) => { if (ev.target.value !== '') dock.openTab(ev.target.value); }}
            >
              <option value="">+ вкладка</option>
              {entries.filter((e) => !state.open.includes(e.key as string)).map((e) => (
                <option key={e.key} value={e.key}>{e.value.title}</option>
              ))}
            </select>
          )}
          {onMove != null && (
            <button
              type="button"
              className={styles.modeBtn}
              aria-label={side === 'right' ? 'Переместить панель на левый край' : 'Переместить панель на правый край'}
              title={side === 'right' ? 'Переместить на левый край' : 'Переместить на правый край'}
              onClick={onMove}
            >
              ⇄
            </button>
          )}
          <button
            type="button"
            className={styles.modeBtn}
            aria-label="Свернуть панель в полосу"
            title="Свернуть в полосу"
            onClick={() => dock.setMode('slim')}
          >
            ▸
          </button>
          <button
            type="button"
            className={styles.modeBtn}
            aria-label={`Закрыть панель (${shortcutHint('dock.toggle')}, ${shortcutHint('dock.toggle.alt')})`}
            title="Закрыть панель"
            onClick={() => dock.setMode('hidden')}
          >
            ×
          </button>
        </div>
      </div>
      <div className={styles.dockBody} data-split={splitEntry != null || undefined}>
        <section className={styles.pane} role="tabpanel" aria-label={activeEntry?.value.title ?? 'Пустая вкладка'}>
          {activeEntry != null ? <activeEntry.value.component /> : (
            <p className={styles.tabNote}>Выберите вкладку — список выше.</p>
          )}
        </section>
        {splitEntry != null && (
          <section className={styles.pane} role="tabpanel" aria-label={`${splitEntry.value.title} — разделение`}>
            <splitEntry.value.component />
          </section>
        )}
      </div>
    </div>
  );
}
