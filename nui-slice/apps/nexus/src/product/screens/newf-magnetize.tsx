'use client';

/**
 * W42/W45/W46/W48: Magnetize — панели NEWF grabbable/free-movable +
 * snap-to-home + detach-кнопка + layout persist v2 + настройки.
 *
 * - drag-хэндл в заголовке; drag → fixed-позиция free placement;
 * - кнопка «⌂» / double-click → домой; кнопка «⧉» → detach (float);
 * - snap при близости к home (< threshold, default 24px);
 * - persist в localStorage «newf.layout.v1» (формат v2):
 *   {panelId: {x,y,w,h,detached:boolean}} — home-размеры тоже хранятся;
 * - порог snap настраивается: localStorage «newf.settings.v1» {snapDistance}.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentType, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import floatStyles from './newf-float-pane.module.css';
import { useZIndex } from './newf-zorder';

export const MAGNET_LAYOUT_KEY = 'newf.layout.v1';
export const MAGNET_SETTINGS_KEY = 'newf.settings.v1';
export const DEFAULT_SNAP_DISTANCE = 24;

export interface MagnetRect { x: number; y: number; w: number; h: number; }
export interface MagnetEntry { x: number; y: number; w: number; h: number; detached: boolean; pinned?: boolean; }
export interface MagnetSettings { snapDistance: number; }

/* ---------- settings (W48) ---------- */

export function readMagnetSettings(): MagnetSettings {
  try {
    const raw = window.localStorage.getItem(MAGNET_SETTINGS_KEY);
    if (!raw) return { snapDistance: DEFAULT_SNAP_DISTANCE };
    const parsed = JSON.parse(raw) as Partial<MagnetSettings>;
    const snap = typeof parsed.snapDistance === 'number' && Number.isFinite(parsed.snapDistance) && parsed.snapDistance > 0
      ? parsed.snapDistance
      : DEFAULT_SNAP_DISTANCE;
    return { snapDistance: snap };
  } catch { return { snapDistance: DEFAULT_SNAP_DISTANCE }; }
}

export function writeMagnetSettings(settings: MagnetSettings): void {
  try { window.localStorage.setItem(MAGNET_SETTINGS_KEY, JSON.stringify(settings)); } catch { /* noop */ }
}

/* ---------- layout persist v2 (W46) ---------- */

export function readMagnetLayout(): Record<string, MagnetEntry> {
  try {
    const raw = window.localStorage.getItem(MAGNET_LAYOUT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, MagnetEntry> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v && typeof v === 'object') {
        const r = v as { x?: unknown; y?: unknown; w?: unknown; h?: unknown; detached?: unknown; pinned?: unknown };
        // совместимость с v1: чистый rect = detached
        out[k] = {
          x: typeof r.x === 'number' ? r.x : 0,
          y: typeof r.y === 'number' ? r.y : 0,
          w: typeof r.w === 'number' ? r.w : 360,
          h: typeof r.h === 'number' ? r.h : 220,
          detached: r.detached === true,
          pinned: r.pinned === true,
        };
      }
    }
    return out;
  } catch { return {}; }
}

export function writeMagnetLayout(map: Record<string, MagnetEntry>): void {
  try { window.localStorage.setItem(MAGNET_LAYOUT_KEY, JSON.stringify(map)); } catch { /* noop */ }
}

/* ---------- shell ---------- */

export interface MagnetizeHandleProps {
  title: string;
  floating: boolean;
  minimized?: boolean;
  maximized?: boolean;
  pinned?: boolean;
  onHome: () => void;
  onDetach: () => void;
  onMin?: () => void;
  onMax?: () => void;
  onPin?: () => void;
  onClose?: () => void;
  onBeginDrag: (e: ReactMouseEvent) => void;
  children?: ReactNode;
}

export function MagnetizeShell({ title, floating, minimized, maximized, pinned, onHome, onDetach, onMin, onMax, onPin, onClose, onBeginDrag, children }: MagnetizeHandleProps) {
  return (
    <>
      <div
        className={floatStyles.titleBar}
        data-testid="magnet-handle"
        data-floating={floating ? 'true' : 'false'}
        data-minimized={minimized ? 'true' : undefined}
        data-maximized={maximized ? 'true' : undefined}
        data-pinned={pinned ? 'true' : undefined}
        onMouseDown={onBeginDrag}
        onDoubleClick={onHome}
      >
        <span>{title}</span>
        <span className={floatStyles.controls}>
          {onMin && <button type="button" data-testid="magnet-min" onClick={onMin} title="Свернуть в чип" aria-label="Свернуть в чип">–</button>}
          {onMax && <button type="button" data-testid="magnet-max" onClick={onMax} title={maximized ? 'Вернуть из максимума' : 'На весь canvas'} aria-pressed={maximized} aria-label="На весь canvas">▢</button>}
          {onPin && <button type="button" data-testid="magnet-pin" onClick={onPin} title={pinned ? 'Открепить (не всегда поверх)' : 'Закрепить (всегда поверх)'} aria-pressed={pinned} aria-label="Закрепить (всегда поверх)">📌</button>}
          <button type="button" data-testid="magnet-detach" onClick={onDetach} title="Открепить в float">⧉</button>
          <button type="button" data-testid="magnet-home" onClick={onHome} title="Вернуть домой">⌂</button>
          {onClose && <button type="button" data-testid="magnet-close" onClick={onClose} title="Закрыть панель" aria-label="Закрыть панель">×</button>}
        </span>
      </div>
      <div className={floatStyles.body}>{children}</div>
    </>
  );
}

export function withMagnetize(panelId: string, title: string) {
  return function Magnetized<P extends object>(Wrapped: ComponentType<P>): ComponentType<P> {
    return function MagnetizablePanel(props: P) {
      const [floating, setFloating] = useState<MagnetRect | null>(null);
      const [dragging, setDragging] = useState(false);
      const [minimized, setMinimized] = useState(false);
      const [maximized, setMaximized] = useState(false);
      const [pinned, setPinned] = useState(false);
      const [closed, setClosed] = useState(false);
      const { zIndex, raise } = useZIndex();
      const rootRef = useRef<HTMLDivElement | null>(null);
      const homeRef = useRef<MagnetRect>({ x: 0, y: 0, w: 0, h: 0 });
      const dragStart = useRef<{ mx: number; my: number; rect: MagnetRect } | null>(null);

      const snapDistance = readMagnetSettings().snapDistance;
      // W65: первый persist на маунте не должен затирать сохранённые home-размеры
      const skipFirstPersist = useRef(true);

      // home = позиция панели в потоке (когда не floating)
      useLayoutEffect(() => {
        if (floating) return;
        const el = rootRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        homeRef.current = { x: r.left, y: r.top, w: r.width, h: r.height };
      }, [floating]);

      // W5r: resize окна -> home-geometry пересчёт (иначе snap в старую точку)
      useEffect(() => {
        const onResize = () => {
          if (floating) return;
          const el = rootRef.current;
          if (!el) return;
          const r = el.getBoundingClientRect();
          homeRef.current = { x: r.left, y: r.top, w: r.width, h: r.height };
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
      }, [floating]);

      // восстановить из localStorage (v2: detached + размеры + W67 pin/min/max/close)
      useLayoutEffect(() => {
        const saved = readMagnetLayout()[panelId];
        if (saved) {
          setPinned(saved.pinned === true);
        }
        if (saved?.detached) {
          setFloating({ x: saved.x, y: saved.y, w: saved.w, h: saved.h });
        } else if (saved) {
          // home-размеры из сохранённого
          const el = rootRef.current;
          if (el) {
            const r = el.getBoundingClientRect();
            homeRef.current = { x: r.left, y: r.top, w: saved.w || r.width, h: saved.h || r.height };
          }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [panelId]);

      // persist v2
      useLayoutEffect(() => {
        const map = readMagnetLayout();
        const el = rootRef.current;
        if (floating) {
          map[panelId] = { ...floating, detached: true, pinned };
          writeMagnetLayout(map);
          return;
        }
        const prev = map[panelId];
        if (skipFirstPersist.current) {
          skipFirstPersist.current = false;
          // W65: на первом маунте измеренная геометрия ещё не отражает
          // сохранённых home-размеров — не перезаписываем их.
          if (prev && !prev.detached) return;
        }
        const home = el?.getBoundingClientRect();
        if (home) {
          map[panelId] = {
            x: home.left, y: home.top, w: home.width, h: home.height, detached: false, pinned,
          };
        }
        writeMagnetLayout(map);
      }, [floating, panelId, pinned]);

      const beginDrag = (e: ReactMouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        raise();
        const start = floating ?? { ...homeRef.current };
        dragStart.current = { mx: e.clientX, my: e.clientY, rect: { ...start } };
        setFloating({ ...start });
        setDragging(true);
      };

      const finishDrag = () => {
        if (!dragStart.current) return;
        const current = floating;
        if (!current) { setDragging(false); return; }
        const home = homeRef.current;
        const dx = current.x - home.x;
        const dy = current.y - home.y;
        if (Math.hypot(dx, dy) < snapDistance) {
          setFloating(null);
        }
        dragStart.current = null;
        setDragging(false);
      };

      const onMove = (e: MouseEvent) => {
        if (!dragStart.current) return;
        const { mx, my, rect } = dragStart.current;
        setFloating({ ...rect, x: rect.x + e.clientX - mx, y: rect.y + e.clientY - my });
      };
      const onUp = () => finishDrag();

      const goHome = () => { setFloating(null); setDragging(false); dragStart.current = null; };
      const detach = () => {
        setFloating({ ...homeRef.current });
        dragStart.current = null;
        setDragging(false);
      };
      const toggleMin = () => { setMinimized((v) => !v); setMaximized(false); setFloating(null); };
      const toggleMax = () => {
        setMaximized((v) => !v);
        setMinimized(false);
        if (!maximized) { setFloating(null); setDragging(false); dragStart.current = null; }
      };
      const togglePin = () => {
        setPinned((v) => !v);
        if (!pinned) raise();
      };
      const close = () => { setClosed(true); setMinimized(false); setMaximized(false); setFloating(null); };

      if (closed) {
        return (
          <div
            ref={rootRef}
            data-testid={`magnet-${panelId}`}
            data-closed="true"
            className={floatStyles.closedChip}
            title={`${title} — закрыта (клик восстановить)`}
          >
            <button type="button" data-testid={`magnet-reopen-${panelId}`} onClick={() => setClosed(false)}>↺ {title}</button>
          </div>
        );
      }

      const maxStyle = maximized ? {
        position: 'fixed' as const,
        inset: 8,
        width: 'auto',
        zIndex: 70,
        margin: 0,
      } : undefined;
      // W67: pin = всегда поверх (даже в потоке — z-index поверх остальных панелей)
      const pinnedStyle = pinned && !floating && !maximized ? {
        position: 'relative' as const,
        zIndex: 50000,
      } : undefined;

      return (
        <div
          ref={rootRef}
          data-testid={`magnet-${panelId}`}
          data-floating={floating ? 'true' : 'false'}
          data-minimized={minimized ? 'true' : undefined}
          data-maximized={maximized ? 'true' : undefined}
          data-pinned={pinned ? 'true' : undefined}
          data-closed={closed ? 'true' : undefined}
          style={floating
            ? { position: 'fixed', left: floating.x, top: floating.y, width: floating.w, zIndex, margin: 0 }
            : (maxStyle ?? pinnedStyle)}
        >
          {minimized ? (
            <div className={floatStyles.minChip} data-testid={`magnet-chip-${panelId}`}>
              <span>{title}</span>
              <button type="button" data-testid={`magnet-restore-${panelId}`} onClick={toggleMin} aria-label="Восстановить панель">↺</button>
            </div>
          ) : (
            <MagnetizeShell
              title={title}
              floating={floating !== null}
              minimized={minimized}
              maximized={maximized}
              pinned={pinned}
              onHome={goHome}
              onDetach={detach}
              onMin={toggleMin}
              onMax={toggleMax}
              onPin={togglePin}
              onClose={close}
              onBeginDrag={beginDrag}
            >
              <Wrapped {...props} />
            </MagnetizeShell>
          )}
          {dragging && (
            <div
              className={floatStyles.dropZone}
              data-testid="magnet-dropzone"
              style={{ left: homeRef.current.x, top: homeRef.current.y, width: homeRef.current.w, height: homeRef.current.h }}
            >⌂ home</div>
          )}
          {dragging ? <DragListeners onMove={onMove} onUp={onUp} /> : null}
        </div>
      );
    };
  };
}

function DragListeners({ onMove, onUp }: { onMove: (e: MouseEvent) => void; onUp: () => void }) {
  const ref = useRef({ onMove, onUp });
  ref.current = { onMove, onUp };
  useLayoutEffect(() => {
    const move = (e: MouseEvent) => ref.current.onMove(e);
    const up = () => ref.current.onUp();
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    // W5r: blur/pointercancel mid-drag = drop
    window.addEventListener('blur', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('blur', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);
  return null;
}

export default withMagnetize;
