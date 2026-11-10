import { useEffect, useRef } from 'react';
import type { CSSProperties, HTMLAttributes } from 'react';

export interface AmbientCanvasProps extends HTMLAttributes<HTMLCanvasElement> {
  /** Число световых пятен (3–8 разумно). */
  density?: number;
  /** Скорость дрейфа, множитель (1 = номинал ~40с цикл). */
  speed?: number;
  /** false — один статичный кадр (probe/скриншоты/reduced-motion). */
  animated?: boolean;
}

interface Blob { x: number; y: number; r: number; hue: number; ph: number; }

/**
 * Мягкое свечение и дымка — лёгкий canvas-слой (visual-3 V4). Несколько
 * радиальных пятен дрейфуют по синусоидному полю; additive-composite даёт
 * «туман», не перекрывающий контент. Декоративно: aria-hidden, никаких
 * данных. DPR кап 1.5, пауза вне вьюпорта/в фоне, prefers-reduced-motion
 * и animated=false рисуют один статичный кадр.
 */
export function AmbientCanvas({ density = 5, speed = 1, animated = true,
  style, ...rest }: AmbientCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const still = reduced || !animated;

    let w = 0, h = 0, dpr = 1, raf = 0, visible = true;
    const blobs: Blob[] = [];

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(globalThis.devicePixelRatio || 1, 1.5);
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const seed = () => {
      blobs.length = 0;
      const n = Math.max(3, Math.min(8, density));
      // детерминированная раскладка — кадр не зависит от рандома
      for (let i = 0; i < n; i++) {
        const t = i / n;
        blobs.push({
          x: 0.15 + 0.7 * ((i * 0.618) % 1),   // golden-ratio spread
          y: 0.12 + 0.76 * ((i * 0.377 + 0.21) % 1),
          r: 0.28 + 0.22 * ((i * 0.71 + 0.35) % 1),
          hue: 38 + 14 * ((i * 0.53) % 1),      // золотой диапазон под тему
          ph: t * Math.PI * 2,
        });
      }
    };

    const draw = (timeMs: number) => {
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      const t = (timeMs / 1000) * 0.16 * speed;  // ~40с полный цикл
      for (const b of blobs) {
        const bx = (b.x + Math.sin(t + b.ph) * 0.05) * w;
        const by = (b.y + Math.cos(t * 0.83 + b.ph * 1.3) * 0.05) * h;
        const br = b.r * Math.max(w, h);
        const breathe = 0.75 + 0.25 * Math.sin(t * 1.7 + b.ph * 2);
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        g.addColorStop(0, `hsla(${b.hue}, 55%, 62%, ${0.10 * breathe})`);
        g.addColorStop(0.55, `hsla(${b.hue}, 45%, 50%, ${0.045 * breathe})`);
        g.addColorStop(1, 'hsla(40, 40%, 50%, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const tick = (now: number) => {
      if (visible) draw(now);
      raf = requestAnimationFrame(tick);
    };

    resize();
    seed();
    const ro = new ResizeObserver(() => { resize(); if (still) draw(0); });
    ro.observe(canvas);

    if (still) {
      draw(0);
      return () => ro.disconnect();
    }
    const io = new IntersectionObserver((es) => {
      visible = es[0]?.isIntersecting !== false;
    });
    io.observe(canvas);
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, [density, speed, animated]);

  const merged: CSSProperties = {
    position: 'absolute', inset: 0, width: '100%', height: '100%',
    pointerEvents: 'none', ...style,
  };
  return <canvas ref={ref} style={merged} aria-hidden="true" {...rest} />;
}
