'use client';

import { cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Kbd } from '../../typography/kbd/kbd';
import styles from '../surfaces.module.css';

export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  className?: string;
  /** Plain-text label — tooltips never carry interactive content. */
  content: string;
  /** Optional keyboard hint rendered next to the label via <Kbd>. */
  kbd?: string | readonly string[];
  position?: TooltipPosition;
  /** Show arrow pointing at the trigger. */
  arrow?: boolean;
  /** Hover delay in ms; focus shows immediately. */
  delay?: number;
  children: ReactNode;
}

/**
 * Tooltip on hover/focus of the wrapped element; pure label — no
 * interactive content. aria-describedby is merged onto the child, Escape
 * dismisses, the tooltip itself never takes focus. Recomputes position on
 * show, flips to the opposite side when the preferred one would overflow.
 */
export function Tooltip({ className, content, kbd, position = 'top', arrow = false, delay = 350, children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [placement, setPlacement] = useState<TooltipPosition>(position);
  const id = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const describedChild = isValidElement(children)
    ? cloneElement(children as ReactElement<{ 'aria-describedby'?: string }>, {
      'aria-describedby': [
        (children.props as { 'aria-describedby'?: string })['aria-describedby'],
        id,
      ].filter(Boolean).join(' '),
    })
    : <span aria-describedby={id} style={{ display: 'contents' }}>{children}</span>;

  const compute = useCallback((): { pos: { left: number; top: number }; placement: TooltipPosition } | null => {
    const el = wrapRef.current;
    const tip = tipRef.current;
    if (!el || !tip) return null;
    const r = el.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    const gap = 8;
    const fits = (p: TooltipPosition) =>
      p === 'top' ? r.top - gap - tr.height >= 0 :
      p === 'bottom' ? r.bottom + gap + tr.height <= window.innerHeight :
      p === 'left' ? r.left - gap - tr.width >= 0 :
      r.right + gap + tr.width <= window.innerWidth;
    const OPPOSITE: Record<TooltipPosition, TooltipPosition> =
      { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
    const placement = fits(position) ? position
      : fits(OPPOSITE[position]) ? OPPOSITE[position] : position;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const pos =
      placement === 'top' ? { left: cx, top: r.top - gap } :
      placement === 'bottom' ? { left: cx, top: r.bottom + gap } :
      placement === 'left' ? { left: r.left - gap, top: cy } :
      { left: r.right + gap, top: cy };
    // Clamp into the viewport so long labels never leave the panel.
    const left = Math.min(Math.max(pos.left, tr.width / 2 + 4), window.innerWidth - tr.width / 2 - 4);
    const top = placement === 'top' || placement === 'bottom'
      ? pos.top
      : Math.min(Math.max(pos.top, tr.height / 2 + 4), window.innerHeight - tr.height / 2 - 4);
    return { pos: placement === 'top' || placement === 'bottom' ? { left, top } : { left: pos.left, top }, placement };
  }, [position]);

  useEffect(() => {
    if (!visible) return;
    const next = compute();
    if (next) { setPos(next.pos); setPlacement(next.placement); }
  }, [visible, compute]);

  function show(instant: boolean) {
    if (timer.current) clearTimeout(timer.current);
    if (instant) setVisible(true);
    else timer.current = setTimeout(() => setVisible(true), delay);
  }
  function hide() {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setVisible(false);
  }

  const transform =
    placement === 'top' ? 'translate(-50%, -100%)' :
    placement === 'bottom' ? 'translate(-50%, 0)' :
    placement === 'left' ? 'translate(-100%, -50%)' :
    'translate(0, -50%)';
  const keyHints = typeof kbd === 'string' ? [kbd] : kbd ?? [];

  return (
    <span
      ref={wrapRef}
      className={className}
      style={{ display: 'inline-flex' }}
      onMouseEnter={() => show(false)}
      onMouseLeave={hide}
      onFocus={() => show(true)}
      onBlur={hide}
      onKeyDown={(e) => { if (e.key === 'Escape') hide(); }}
    >
      {describedChild}
      {visible && (
        <span ref={tipRef} id={id} role="tooltip" className={styles.tooltip}
          data-placement={placement} data-arrow={arrow || undefined}
          style={{ position: 'fixed', left: pos.left, top: pos.top, transform }}>
          {content}
          {keyHints.filter(Boolean).map((hint) => <Kbd key={hint} size="sm">{hint}</Kbd>)}
        </span>
      )}
    </span>
  );
}
