import type { CSSProperties } from 'react';

/**
 * Стаггер появления карточек: `--enter-delay` для класса `.enter`
 * (motion.module.css). i — индекс в ряду, step — шаг задержки.
 */
export function staggerDelay(index: number, stepMs = 70): CSSProperties {
  return { '--enter-delay': `${Math.max(0, index) * stepMs}ms` } as CSSProperties;
}
