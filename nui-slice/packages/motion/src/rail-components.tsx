import type { HTMLAttributes, ReactNode } from 'react';
import styles from './rail-motion.module.css';

/**
 * Rail-моушн-компоненты (волна XIV, W4) — визуальный слой для узкой
 * иконочной полосы и колоды выбора ассистента. Разметка/логика полосы —
 * W3 (app-shell `rail-strip`, navMode); здесь только движение.
 * Спека — `rail-motion.ts`; prefers-reduced-motion гасится CSS-блоком.
 *
 * Подключение (для W3):
 *  - подсветка активного раздела: внутри кнопки/ссылки раздела
 *    `{active && <RailMarker />}` — золотая кромка slide-in 200ms;
 *  - всплывающая подпись: кнопке добавить `className={railTipHost}` и
 *    `<RailTip label={s.label} />` рядом с иконкой — показывается на
 *    hover/focus-visible за 140ms (заменяет медленный native title);
 *  - ширина колонки strip↔full↔hidden уже анимируется 220ms на
 *    `.shellWrap [class*='frameLeft']` (внутри брифовой полосы 180–240);
 *  - колода выбора ассистента: каждую AssistantCard обернуть в
 *    `<DeckItem index={i} deckKey={themeId}>` — стаггер 60ms/карта,
 *    `deckKey` в key перезапускает проявление при смене стиля;
 *  - полоса загрузки по реальным этапам: `BootProgress` из
 *    `./boot-components` (та же честная доля + shimmer при unknown).
 */

/** Маркер активного раздела — золотая кромка слева от иконки. */
export function RailMarker({ animated = true, ...rest }: HTMLAttributes<HTMLSpanElement> & { animated?: boolean }) {
  return (
    <span
      className={animated ? styles.marker : styles.markerStatic}
      aria-hidden="true"
      {...rest}
    />
  );
}

/** Плавающая подпись иконки (strip-режим): стекло, сдвиг+fade 140ms.
 *  Визуальный дублёр — имя кнопки несёт aria-label, tip aria-hidden. */
export function RailTip({ label }: { label: string }) {
  return (
    <span className={styles.tip} data-tip="" aria-hidden="true">
      {label}
    </span>
  );
}

/** Класс-хост для кнопки раздела: `:hover`/`:focus-visible` на нём
 *  открывает RailTip внутри. */
export const railTipHost = styles.tipHost;

export interface DeckItemProps extends HTMLAttributes<HTMLDivElement> {
  /** Позиция в колоде — стаггер index*60ms. */
  index?: number;
  /** Смена ключа через prop `key` у владельца перезапускает проявление. */
  animated?: boolean;
  children: ReactNode;
}

/** Стаггер-появление карточки колоды (fade+rise 240ms, delay index*60). */
export function DeckItem({ index = 0, animated = true, className, style, children, ...rest }: DeckItemProps) {
  return (
    <div
      className={[animated ? styles.deckIn : '', className].filter(Boolean).join(' ')}
      style={{ animationDelay: animated ? `${index * 60}ms` : undefined, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}
