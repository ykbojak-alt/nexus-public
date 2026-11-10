'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './newf-float-pane.module.css';
import { useZIndex } from './newf-zorder';

export interface FloatRect { x: number; y: number; w: number; h: number; }

export const DEFAULT_RECT: FloatRect = { x: 120, y: 80, w: 360, h: 220 };

const CASCADE_STEP = 28;
const CASCADE_WRAP = 8;
let cascadeCounter = 0;

export function nextDefaultRect(): FloatRect {
  const i = cascadeCounter++ % CASCADE_WRAP;
  return {
    ...DEFAULT_RECT,
    x: DEFAULT_RECT.x + i * CASCADE_STEP,
    y: DEFAULT_RECT.y + i * CASCADE_STEP,
  };
}

export function dockedKey(address: string) { return `dock:${address}`; }

export interface FloatingPaneProps {
  address: string;
  title: string;
  children?: React.ReactNode;
  initialRect?: FloatRect;
  onDetach?: (address: string) => void;
  onDockBack?: (address: string, rect: FloatRect) => void;
  onClose?: (address: string) => void;
  /** W7: прямоугольник слота (viewport) для drop-zone подсветки. */
  slotRect?: FloatRect;
}

export default function FloatingPane({ address, title, children, initialRect, onDetach, onDockBack, onClose, slotRect }: FloatingPaneProps) {
  const [rect, setRect] = useState<FloatRect>(() => initialRect ?? nextDefaultRect());
  const [docked, setDocked] = useState(false);
  const [dragging, setDragging] = useState(false);
  // W7: подсветка drop-zone, когда окно перетаскивается над своим слотом.
  const [overSlot, setOverSlot] = useState(false);
  const { zIndex, raise } = useZIndex();
  const start = useRef<{ mx: number; my: number; rx: number; ry: number } | null>(null);

  // persist layout by address
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('newf.float.v1');
      if (!raw) return;
      const map = JSON.parse(raw) as Record<string, FloatRect>;
      if (map[address]) setRect(map[address]);
    } catch { /* ignore */ }
  }, [address]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('newf.float.v1');
      const map = raw ? (JSON.parse(raw) as Record<string, FloatRect>) : {};
      map[address] = rect;
      window.localStorage.setItem('newf.float.v1', JSON.stringify(map));
    } catch { /* ignore */ }
  }, [address, rect]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      if (!start.current) return;
      const dx = e.clientX - start.current.mx;
      const dy = e.clientY - start.current.my;
      setRect((r) => ({ ...r, x: start.current!.rx + dx, y: start.current!.ry + dy }));
      // W7: hover над слотом → подсветка drop-zone.
      if (slotRect) {
        setOverSlot(
          e.clientX >= slotRect.x && e.clientX <= slotRect.x + slotRect.w
          && e.clientY >= slotRect.y && e.clientY <= slotRect.y + slotRect.h,
        );
      }
    };
    const onUp = () => {
      if (overSlot && onDockBack) {
        setDocked(true);
        onDockBack(address, rect);
      }
      setOverSlot(false);
      setDragging(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, slotRect, overSlot, onDockBack, address, rect]);

  const beginDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    start.current = { mx: e.clientX, my: e.clientY, rx: rect.x, ry: rect.y };
    setDragging(true);
  };

  if (docked) return null;

  return (
    <>
      {overSlot && slotRect && (
        <div
          className={styles.dropZone}
          data-testid={`drop-zone-${address}`}
          style={{ left: slotRect.x, top: slotRect.y, width: slotRect.w, height: slotRect.h }}
        >drop to dock</div>
      )}
      <div
        data-testid={`float-pane-${address}`}
        className={styles.floating}
        style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex, ...(overSlot ? { outline: '2px dashed var(--nx-done)' } : {}) }}
        onPointerDownCapture={raise}
      >
      <header className={styles.titleBar} onMouseDown={beginDrag} data-testid="float-title">
        <span>{title}</span>
        <span className={styles.controls}>
          <button data-testid="float-dockback" onClick={() => { setDocked(true); onDockBack?.(address, rect); }}>dock</button>
          <button data-testid="float-close" onClick={() => onClose?.(address)}>×</button>
        </span>
      </header>
      <div className={styles.body}>{children}</div>
      <div
        className={styles.resize}
        onMouseDown={(e) => {
          e.preventDefault();
          const origin = { mx: e.clientX, my: e.clientY, w: rect.w, h: rect.h };
          const onMove = (ev: MouseEvent) => {
            setRect((r) => ({ ...r, w: Math.max(120, origin.w + ev.clientX - origin.mx), h: Math.max(80, origin.h + ev.clientY - origin.my) }));
          };
          const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        }}
      />
      </div>
    </>
  );
}