import { useEffect, useRef } from 'react';
import type { HTMLAttributes } from 'react';
import styles from './motion.module.css';

export interface ParallaxLayerProps extends HTMLAttributes<HTMLDivElement> {
  /** Глубина 0..1 — сдвиг слоя от указателя (px = depth × 18). */
  depth?: number;
  /** false — слой статичен (probe/скриншоты). */
  animated?: boolean;
}

/**
 * Лёгкий параллакс (visual-3 V4): слой слегка дрейфует за указателем
 * относительно центра окна — CSS-var `--nx-px/--nx-py`, rAF-lerp, без
 * библиотек. prefers-reduced-motion и animated=false — статичный слой.
 * Декоративно: статус/данные никогда не живут только в этом слое.
 */
export function ParallaxLayer({ depth = 0.35, animated = true,
  className, children, ...rest }: ParallaxLayerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !animated) return;
    const reduced = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
    const range = 18 * Math.max(0, Math.min(1, depth));
    const onMove = (e: PointerEvent) => {
      tx = (e.clientX / window.innerWidth - 0.5) * 2 * range;
      ty = (e.clientY / window.innerHeight - 0.5) * 2 * range;
    };
    const tick = () => {
      cx += (tx - cx) * 0.06;   // lerp → мягкий ход, без резких скачков
      cy += (ty - cy) * 0.06;
      el.style.transform = `translate3d(${cx.toFixed(2)}px, ${cy.toFixed(2)}px, 0)`;
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(raf);
      el.style.transform = '';
    };
  }, [depth, animated]);

  return (
    <div ref={ref} className={[styles.parallax, className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </div>
  );
}
