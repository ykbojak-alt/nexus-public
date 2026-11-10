'use client';

/** Модульные бары NUE (приоритет 18.10): каждый бар оболочки — сворачиваемый,
 *  закрываемый, перемещаемый между краями и растягиваемый. Состояние живёт
 *  в профиле (localStorage), правило одного бара на край держится swap'ом:
 *  бар, пришедший на занятую сторону, меняет стороны с владельцем. */
import { useCallback, useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { dragMotion } from '@nexus/motion';
import { useProfile, updateProfile } from './profile/profile-store';
import type { UserProfile } from './profile/profile-types';
import styles from './app-shell.module.css';

export type BarMode = 'full' | 'slim' | 'hidden';
export type BarId = 'top' | 'bottom' | 'nav' | 'dock';
type Bars = NonNullable<UserProfile['bars']>;

/** Инвариант: два вертикальных бара не делят край — move это swap. */
function moveSide(bars: Bars, id: 'nav' | 'dock'): Bars {
  const side = (bars[id]?.side ?? (id === 'nav' ? 'left' : 'right')) === 'left' ? 'right' : 'left';
  const other: 'nav' | 'dock' = id === 'nav' ? 'dock' : 'nav';
  const otherSide = bars[other]?.side ?? (other === 'nav' ? 'left' : 'right');
  return {
    ...bars,
    [id]: { ...bars[id], side },
    // Приехали на занятый край — владелец уезжает на освободившийся.
    ...(otherSide === side ? { [other]: { ...bars[other], side: side === 'left' ? 'right' : 'left' } } : {}),
  };
}

function moveHSide(bars: Bars, id: 'top' | 'bottom'): Bars {
  const side = (bars[id]?.side ?? id) === 'top' ? 'bottom' : 'top';
  const other: 'top' | 'bottom' = id === 'top' ? 'bottom' : 'top';
  const otherSide = bars[other]?.side ?? other;
  const from = bars[id]?.side ?? id;
  return {
    ...bars,
    [id]: { ...bars[id], side },
    // Переехали на занятый край — владелец уезжает на освободившийся.
    ...(otherSide === side ? { [other]: { ...bars[other], side: from } } : {}),
  };
}

export interface ModularBars {
  nav: { side: 'left' | 'right'; width: number | null };
  dockSide: 'left' | 'right';
  top: { mode: BarMode; side: 'top' | 'bottom'; height: number | null };
  bottom: { mode: BarMode; side: 'bottom' | 'top'; height: number | null };
  positions: Record<BarId, { x: number; y: number } | null>;
  setTopMode: (m: BarMode) => void;
  setBottomMode: (m: BarMode) => void;
  setNavWidth: (px: number) => void;
  setTopHeight: (px: number | null) => void;
  setBottomHeight: (px: number | null) => void;
  setPosition: (id: BarId, position: { x: number; y: number } | null) => void;
  setSide: (id: BarId, side: 'top' | 'bottom' | 'left' | 'right') => void;
  move: (id: BarId) => void;
}

export function useModularBars(): ModularBars {
  const { profile } = useProfile();
  // #418 (wave #418-2, 03.11): SSR/first-frame returns profile=null →
  // bars=null; client first frame reads localStorage → real bars.
  // Gate all render-time bar values on `mounted` so the header's
  // data-bar-mode / nav side / width agree SSR+CSR (accept (b)).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const mBars = mounted ? profile?.bars : undefined;
  const bars = mBars;

  const merge = useCallback((patch: Partial<Bars>) => {
    const cur = profile?.bars ?? {};
    updateProfile({
      bars: {
        ...cur,
        ...(patch.top != null ? { top: { ...cur.top, ...patch.top } } : {}),
        ...(patch.bottom != null ? { bottom: { ...cur.bottom, ...patch.bottom } } : {}),
        ...(patch.nav != null ? { nav: { ...cur.nav, ...patch.nav } } : {}),
        ...(patch.dock != null ? { dock: { ...cur.dock, ...patch.dock } } : {}),
      },
    });
  }, [profile]);

  return {
    nav: {
      side: bars?.nav?.side === 'right' ? 'right' : 'left',
      width: typeof bars?.nav?.width === 'number' ? bars.nav.width : null,
    },
    dockSide: bars?.dock?.side === 'left' ? 'left' : 'right',
    top: {
      mode: bars?.top?.mode ?? 'full',
      side: bars?.top?.side === 'bottom' ? 'bottom' : 'top',
      height: typeof bars?.top?.height === 'number' ? bars.top.height : null,
    },
    bottom: {
      mode: bars?.bottom?.mode ?? 'full',
      side: bars?.bottom?.side === 'top' ? 'top' : 'bottom',
      height: typeof bars?.bottom?.height === 'number' ? bars.bottom.height : null,
    },
    positions: {
      top: bars?.top?.position ?? null,
      bottom: bars?.bottom?.position ?? null,
      nav: bars?.nav?.position ?? null,
      dock: bars?.dock?.position ?? null,
    },
    setTopMode: (m) => merge({ top: { mode: m } }),
    setBottomMode: (m) => merge({ bottom: { mode: m } }),
    setTopHeight: (px) => merge({ top: { height: px == null ? null : Math.max(44, Math.min(120, Math.round(px))) } }),
    setBottomHeight: (px) => merge({ bottom: { height: px == null ? null : Math.max(22, Math.min(72, Math.round(px))) } }),
    setNavWidth: (px) => merge({ nav: { width: Math.max(200, Math.min(480, Math.round(px))) } }),
    setPosition: (id, position) => merge({ [id]: { position } }),
    setSide: (id, side) => {
      if (id === 'nav' || id === 'dock') {
        const current = id === 'nav'
          ? bars?.nav?.side ?? 'left'
          : bars?.dock?.side ?? 'right';
        if (current === side) {
          merge({ [id]: { position: null } });
          return;
        }
        const other: 'nav' | 'dock' = id === 'nav' ? 'dock' : 'nav';
        const next = moveSideTo(profile?.bars ?? {}, id, side as 'left' | 'right');
        updateProfile({
          bars: {
            ...(profile?.bars ?? {}),
            [id]: { ...next[id], position: null },
            ...(next[other] != null ? { [other]: next[other] } : {}),
          },
        });
      } else {
        const current = id === 'top'
          ? bars?.top?.side ?? 'top'
          : bars?.bottom?.side ?? 'bottom';
        if (current === side) {
          merge({ [id]: { position: null } });
          return;
        }
        const next = moveHSideTo(profile?.bars ?? {}, id, side as 'top' | 'bottom');
        updateProfile({
          bars: {
            ...(profile?.bars ?? {}),
            [id]: { ...next[id], position: null },
            [id === 'top' ? 'bottom' : 'top']: next[id === 'top' ? 'bottom' : 'top'],
          },
        });
      }
    },
    move: (id) => {
      if (id === 'nav' || id === 'dock') {
        const next = moveSide(profile?.bars ?? {}, id);
        updateProfile({
          bars: {
            ...(profile?.bars ?? {}),
            nav: id === 'nav' ? { ...next.nav, position: null } : next.nav,
            dock: id === 'dock' ? { ...next.dock, position: null } : next.dock,
          },
        });
      } else {
        const next = moveHSide(profile?.bars ?? {}, id);
        updateProfile({
          bars: {
            ...(profile?.bars ?? {}),
            [id]: { ...next[id], position: null },
            [id === 'top' ? 'bottom' : 'top']: next[id === 'top' ? 'bottom' : 'top'],
          },
        });
      }
    },
  };
}

function moveSideTo(bars: Bars, id: 'nav' | 'dock', side: 'left' | 'right'): Bars {
  const other: 'nav' | 'dock' = id === 'nav' ? 'dock' : 'nav';
  const otherSide = bars[other]?.side ?? (other === 'nav' ? 'left' : 'right');
  const from = bars[id]?.side ?? (id === 'nav' ? 'left' : 'right');
  return {
    ...bars,
    [id]: { ...bars[id], side },
    ...(bars[other]?.position == null && otherSide === side ? { [other]: { ...bars[other], side: from } } : {}),
  };
}

function moveHSideTo(bars: Bars, id: 'top' | 'bottom', side: 'top' | 'bottom'): Bars {
  const other: 'top' | 'bottom' = id === 'top' ? 'bottom' : 'top';
  const otherSide = bars[other]?.side ?? other;
  const from = bars[id]?.side ?? id;
  return {
    ...bars,
    [id]: { ...bars[id], side },
    ...(bars[other]?.position == null && otherSide === side ? { [other]: { ...bars[other], side: from } } : {}),
  };
}

/** Start moving a bar surface; docked bars become floating after a 4px drag. */
export function beginBarMove(
  e: ReactPointerEvent<HTMLElement>,
  opts: {
    id: BarId;
    orientation: 'horizontal' | 'vertical';
    shell: HTMLElement | null;
    floating: boolean;
    onFloat: (position: { x: number; y: number }) => void;
    onDock: (side: 'top' | 'bottom' | 'left' | 'right') => void;
  },
): void {
  if (e.button != null && e.button !== 0 || opts.shell == null) return;
  const surface = e.currentTarget.closest<HTMLElement>('[data-bar-surface]');
  if (surface == null) return;
  e.preventDefault();
  e.stopPropagation();
  const rect = surface.getBoundingClientRect();
  const shellRect = opts.shell.getBoundingClientRect();
  const origin = { x: rect.left, y: rect.top };
  const pointer = { x: e.clientX, y: e.clientY };
  const originalCss = surface.style.cssText;
  const ancestorOverflows: Array<[HTMLElement, string]> = [];
  let parent = surface.parentElement;
  while (parent != null && parent !== opts.shell) {
    ancestorOverflows.push([parent, parent.style.overflow]);
    parent.style.overflow = 'visible';
    parent = parent.parentElement;
  }
  let dragged = opts.floating;
  let raf = 0;
  let next = origin;
  const clamp = () => {
    next.x = Math.max(shellRect.left, Math.min(shellRect.right - rect.width, next.x));
    next.y = Math.max(shellRect.top, Math.min(shellRect.bottom - rect.height, next.y));
  };
  const paint = () => {
    raf = 0;
    if (!dragged) return;
    surface.style.left = `${next.x}px`;
    surface.style.top = `${next.y}px`;
  };
  const onMove = (ev: PointerEvent) => {
    next = { x: origin.x + ev.clientX - pointer.x, y: origin.y + ev.clientY - pointer.y };
    clamp();
    if (!dragged && Math.hypot(ev.clientX - pointer.x, ev.clientY - pointer.y) < 4) return;
    if (!dragged) {
      dragged = true;
      surface.style.position = 'fixed';
      surface.style.left = `${origin.x}px`;
      surface.style.top = `${origin.y}px`;
      surface.style.width = `${rect.width}px`;
      surface.style.height = `${rect.height}px`;
      surface.style.zIndex = '110';
      // dragLift: scale+shadow affordance (CSS transition on the attr).
      surface.setAttribute('data-drag-lift', '');
    }
    if (raf === 0) raf = requestAnimationFrame(paint);
  };
  const cleanup = () => {
    if (raf !== 0) cancelAnimationFrame(raf);
    raf = 0;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    document.body.removeAttribute('data-bar-floating-drag');
    // dragDrop: снятие lift-атрибута — CSS переход опускает scale/shadow.
    surface.removeAttribute('data-drag-lift');
    for (const [node, overflow] of ancestorOverflows) node.style.overflow = overflow;
    if (!surface.isConnected) return;
    surface.style.cssText = originalCss;
  };
  const prefersReduced = () =>
    globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  /** dragSnap FLIP: после восстановления в док переводим поверхность
   *  к точке сброса и анимируем transform → none за dragSnap-миллисекунд. */
  const snapToDock = () => {
    const snap = dragMotion('dragSnap', { reducedMotion: prefersReduced() });
    if (snap.durationMs === 0 || !surface.isConnected) return;
    const after = surface.getBoundingClientRect();
    const dx = next.x - after.left;
    const dy = next.y - after.top;
    if (dx === 0 && dy === 0) return;
    surface.style.transition = 'none';
    surface.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
    void surface.offsetHeight;
    surface.style.transition = `transform ${snap.durationMs}ms ${snap.easing}`;
    surface.style.transform = '';
    setTimeout(() => {
      if (surface.isConnected) surface.style.transition = '';
    }, snap.durationMs + 30);
  };
  const onUp = (ev: PointerEvent) => {
    if (raf !== 0) cancelAnimationFrame(raf);
    raf = 0;
    if (dragged) {
      next = { x: origin.x + ev.clientX - pointer.x, y: origin.y + ev.clientY - pointer.y };
      clamp();
      paint();
    }
    cleanup();
    if (!dragged) return;
    const x = next.x - shellRect.left;
    const y = next.y - shellRect.top;
    const edge = 40;
    if (opts.orientation === 'horizontal') {
      if (next.y - shellRect.top <= edge) { snapToDock(); opts.onDock('top'); }
      else if (shellRect.bottom - (next.y + rect.height) <= edge) { snapToDock(); opts.onDock('bottom'); }
      else {
        // Float-commit: инлайним точку сброса до React-коммита новой
        // позиции — иначе кадр мелькнёт на старой (только re-drag
        // уже-плавающей поверхности; docked→float даёт новый узел).
        if (opts.floating) {
          surface.style.left = `${next.x}px`;
          surface.style.top = `${next.y}px`;
        }
        opts.onFloat({ x: Math.round(x), y: Math.round(y) });
      }
    } else {
      if (next.x - shellRect.left <= edge) { snapToDock(); opts.onDock('left'); }
      else if (shellRect.right - (next.x + rect.width) <= edge) { snapToDock(); opts.onDock('right'); }
      else {
        if (opts.floating) {
          surface.style.left = `${next.x}px`;
          surface.style.top = `${next.y}px`;
        }
        opts.onFloat({ x: Math.round(x), y: Math.round(y) });
      }
    }
  };
  const onCancel = () => cleanup();
  document.body.setAttribute('data-bar-floating-drag', '');
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
}

export function BarDragGrip({
  label,
  onPointerDown,
  onKeyDown,
}: {
  label: string;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className={styles.barDragGrip}
      aria-label={label}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <span aria-hidden="true">⠿</span>
    </button>
  );
}

/** Кнопки хрома бара: ⇄ переместить, ▾/▴ свернуть, × закрыть. Показываются
 *  при наведении/фокусе внутри бара — статичного шума в эталоне нет. */
export function BarTools({
  onMove, onToggleSlim, onClose, slim, moveLabel, slimLabel, closeLabel,
}: {
  onMove?: () => void;
  onToggleSlim?: () => void;
  onClose?: () => void;
  slim?: boolean;
  moveLabel: string;
  slimLabel: string;
  closeLabel: string;
}) {
  return (
    <span className={styles.barTools}>
      {onMove != null && (
        <button type="button" className={styles.barBtn} title={moveLabel} aria-label={moveLabel} onClick={onMove}>⇄</button>
      )}
      {onToggleSlim != null && (
        <button type="button" className={styles.barBtn} title={slimLabel} aria-label={slimLabel} onClick={onToggleSlim}>
          {slim ? '▴' : '▾'}
        </button>
      )}
      {onClose != null && (
        <button type="button" className={styles.barBtn} title={closeLabel} aria-label={closeLabel} onClick={onClose}>×</button>
      )}
    </span>
  );
}

/** Тонкая полоса у закрытого края — всегда доступный путь открыть бар
 *  обратно (иначе при закрытой шапке вернуть что-либо было бы нечем). */
export function BarEdge({ side, label, onRestore, nativeTitle = true }: {
  side: 'top' | 'bottom' | 'left' | 'right';
  label: string;
  onRestore: () => void;
  nativeTitle?: boolean;
}) {
  return (
    <button
      type="button"
      className={`${styles.barEdge} ${styles[`barEdge_${side}`]}`}
      title={nativeTitle ? label : undefined}
      aria-label={label}
      onClick={onRestore}
      data-testid={`bar-edge-${side}`}
    >
      <span aria-hidden="true">
        {side === 'left' ? '❭' : side === 'right' ? '❬' : side === 'top' ? '▾' : '▴'}
      </span>
    </button>
  );
}

/** Перетаскивание кромки: ось + направление, границы — у вызывающего.
 *  Без transition на время драга решает владелец (атрибут data-resizing). */
export function beginBarDrag(
  e: ReactPointerEvent<HTMLElement>,
  opts: {
    axis: 'x' | 'y'; start: number; min: number; max: number; sign: 1 | -1;
    /** Применение значения: каждый кадр, если нет `live`; финал — если нет `commit`. */
    apply: (px: number) => void;
    /** Дешёвый путь на кадр (CSS var на элементе) — без записи в профиль,
        localStorage и ре-рендера оболочки на каждый pointermove. */
    live?: (px: number) => void;
    /** Однократная фиксация на pointerup (updateProfile → localStorage). */
    commit?: (px: number) => void;
  },
): void {
  // button может быть undefined у сред без PointerEvent (jsdom) —
  // отсекаем только явную не-основную кнопку.
  if (e.button != null && e.button !== 0) return;
  e.preventDefault();
  const startPos = opts.axis === 'x' ? e.clientX : e.clientY;
  // pointermove идёт чаще кадра: применение коалесцируем в rAF — максимум
  // одно применение на кадр; с live — вообще без ре-рендера до pointerup.
  let raf = 0;
  let pending = NaN;
  let lastLive = NaN;
  const clamp = (v: number) => Math.max(opts.min, Math.min(opts.max, Math.round(v)));
  const flush = (fn: (px: number) => void) => {
    if (!Number.isFinite(pending)) return;
    const next = clamp(pending);
    pending = NaN;
    lastLive = next;
    fn(next);
  };
  const apply = (ev: PointerEvent) => {
    const pos = opts.axis === 'x' ? ev.clientX : ev.clientY;
    // Синтетические события без координат (тесты, композитные жесты)
    // не должны уводить размер в NaN.
    if (typeof pos !== 'number' || typeof startPos !== 'number' || !Number.isFinite(pos) || !Number.isFinite(startPos)) return;
    pending = opts.start + (pos - startPos) * opts.sign;
    if (raf === 0) {
      raf = requestAnimationFrame(() => { raf = 0; flush(opts.live ?? opts.apply); });
    }
  };
  const up = () => {
    if (raf !== 0) cancelAnimationFrame(raf);
    raf = 0;
    if (Number.isFinite(pending)) {
      flush(opts.commit ?? opts.apply);
    } else if (opts.commit && Number.isFinite(lastLive)) {
      // live уже применял значения по кадрам — фиксируем финал один раз.
      opts.commit(lastLive);
    }
    window.removeEventListener('pointermove', apply);
    window.removeEventListener('pointerup', up);
    document.body.removeAttribute('data-bar-resizing');
  };
  document.body.setAttribute('data-bar-resizing', '');
  window.addEventListener('pointermove', apply);
  window.addEventListener('pointerup', up);
}

/** Ручка-кромка внутри бара (абсолютная у внутреннего края).
 *  Клавиатура: Arrow-клавиши двигают размер шагом stepPx (a11y — без
 *  мыши бар тоже растягивается/стягивается).
 *  ARIA: фокусируемый `separator` — это window splitter, и axe требует
 *  `aria-valuenow` (плюс min/max) — без них каждый маршрут падал на
 *  `aria-required-attr` (critical). */
export function BarHandle({ edge, label, onDragStart, onKeyStep, value, min, max }: {
  edge: 'left' | 'right' | 'top';
  label: string;
  onDragStart: (e: ReactPointerEvent<HTMLElement>) => void;
  /** dir −1 — уменьшить, +1 — увеличить (ось задаёт вызывающий). */
  onKeyStep?: (dir: 1 | -1) => void;
  /** Текущий размер по оси (текущее значение сплиттера). */
  value?: number;
  /** Границы диапазона — те же, что у перетаскивания. */
  min?: number;
  max?: number;
}) {
  return (
    <span
      className={`${styles.barHandle} ${styles[`barHandle_${edge}`]}`}
      role="separator"
      aria-label={label}
      aria-orientation={edge === 'top' ? 'horizontal' : 'vertical'}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={onKeyStep != null ? 0 : undefined}
      onPointerDown={onDragStart}
      onKeyDown={onKeyStep == null ? undefined : (e) => {
        const grow = edge === 'top' ? e.key === 'ArrowDown' : e.key === 'ArrowRight';
        const shrink = edge === 'top' ? e.key === 'ArrowUp' : e.key === 'ArrowLeft';
        if (!grow && !shrink) return;
        e.preventDefault();
        onKeyStep(grow ? 1 : -1);
      }}
    />
  );
}

/** Пустой узел для читаемой композиции баров в слоте. */
export function barList(...nodes: (ReactNode | false | undefined)[]): ReactNode {
  const live = nodes.filter((n): n is ReactNode => n != null && n !== false);
  if (live.length === 0) return undefined;
  return live.length === 1 ? live[0] : <>{live}</>;
}
