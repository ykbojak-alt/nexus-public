import type { ReactNode } from 'react';
import { NexusIcon, type NexusIconName } from '@nexus/icons';
import styles from '../navigation.module.css';

export interface RailSection {
  id: string;
  label: string;
  icon?: NexusIconName;
  href?: string;
  badge?: ReactNode;
  /** Эмблема раздела из `public/art/nav/crest-<id>.png` — водяной знак
   *  за строкой рейла (list-вариант). id = basename после `crest-`. */
  crest?: string;
  /** Подэкраны раздела — раскрываются у активного раздела. Листовая ссылка
   *  несёт aria-current="page"; родитель без собственной страницы — кнопка. */
  children?: readonly RailSection[];
}

export interface IconRailProps {
  className?: string;
  sections: readonly RailSection[];
  /** Currently open leaf — section id, or child id for nested routes. The leaf
   *  link gets aria-current="page"; the owning section gets the accent marker. */
  activeId?: string;
  onSelect?: (id: string) => void;
  /** UI-5: прогрев маршрутов при наведении/фокусе — «следующий экран уже
   *  в кэше», пока пользователь ещё на рейле. Опционален: вызовы обёрнуты
   *  в try/catch, отсутствие хука — no-op. */
  onPrefetch?: (href: string) => void;
  /** Top slot — rail wordmark/brand (ref NUE1/MAIN: «NEXUS» над списком разделов). */
  header?: ReactNode;
  /** Bottom slot — operator profile card, settings link. */
  footer?: ReactNode;
  /** 'rail' — compact icon column; 'list' — full-width rows (icon left of label). */
  variant?: 'rail' | 'list';
  /** Icon-strip mode (WindowFrame nav='strip', 56px): labels collapse to
   *  aria-label + title tooltips; tap zone stays 40px per iconStrip tokens. */
  compact?: boolean;
  'aria-label'?: string;
}

/** Compact section rail (ref MAIN): one row per top-level section —
 *  icon + short label; the contextual sub-list expands under the active
 *  section. Clicking a section opens its first screen; the caller owns
 *  routing via href (anchor) or onSelect. */
export function IconRail({ className, sections, activeId, onSelect, onPrefetch, header, footer, variant = 'rail', compact = false, 'aria-label': ariaLabel }: IconRailProps) {
  const rowCls = variant === 'list' ? styles.railItemRow : undefined;
  const itemCls = [styles.railItem, rowCls].filter(Boolean).join(' ');
  const labelProps = (label: string) =>
    compact ? { 'aria-label': label, title: label } : {};
  const prefetchOn = (href?: string) => ({
    onMouseEnter: onPrefetch == null || href == null ? undefined : () => onPrefetch(href),
    onFocus: onPrefetch == null || href == null ? undefined : () => onPrefetch(href),
  });
  /** UI-5: раздел-родитель греет и свой href, и подэкраны. */
  const prefetchSectionOn = (s: RailSection) => ({
    onMouseEnter: onPrefetch == null ? undefined : () => {
      if (s.href != null) onPrefetch(s.href);
      for (const c of s.children ?? []) if (c.href != null) onPrefetch(c.href);
    },
    onFocus: onPrefetch == null ? undefined : () => {
      if (s.href != null) onPrefetch(s.href);
      for (const c of s.children ?? []) if (c.href != null) onPrefetch(c.href);
    },
  });
  return (
    <nav className={[styles.iconRail, className].filter(Boolean).join(' ')}
      data-variant={variant}
      data-compact={compact || undefined}
      aria-label={ariaLabel ?? 'Разделы'} data-testid="icon-rail">
      {header != null && <div className={styles.iconRailHeader}>{header}</div>}
      <ul className={styles.iconRailList}>
        {sections.map((s) => {
          const active = s.id === activeId;
          const sectionActive = active || (s.children?.some((c) => c.id === activeId) ?? false);
          const inner = (
            <>
              {s.icon != null && <NexusIcon name={s.icon} size={compact ? "var(--nexus-icon-strip-icon-size)" : "var(--nexus-icon-size-md)"} />}
              <span className={styles.railLabel}>{s.label}</span>
              {s.badge}
            </>
          );
          const sub = s.children ?? [];
          return (
            <li key={s.id}>
              {sub.length > 0 ? (
                <>
                  <button type="button" className={itemCls} data-active={sectionActive || undefined}
                    data-crest={s.crest}
                    aria-expanded={sectionActive} aria-controls={`rail-sub-${s.id}`}
                    {...labelProps(s.label)}
                    {...prefetchSectionOn(s)}
                    onClick={onSelect == null ? undefined : () => onSelect(s.id)}>
                    {inner}
                    <NexusIcon name="act.chevron" size="var(--nexus-icon-size-xs)" />
                  </button>
                  {sectionActive && (
                    <ul className={styles.railSub} id={`rail-sub-${s.id}`}>
                      {sub.map((c) => (
                        <li key={c.id}>
                          <a className={[itemCls, styles.railSubItem].join(' ')} href={c.href}
                            data-active={c.id === activeId || undefined}
                            aria-current={c.id === activeId ? 'page' : undefined}
                            {...prefetchOn(c.href)}
                            onClick={onSelect == null ? undefined : (e) => {
                              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                              e.preventDefault(); onSelect(c.id);
                            }}>
                            {c.icon != null && <NexusIcon name={c.icon} size="var(--nexus-icon-size-sm)" />}
                            <span className={styles.railLabel}>{c.label}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : s.href != null ? (
                <a className={itemCls} href={s.href} data-active={active || undefined} data-crest={s.crest}
                  aria-current={active ? 'page' : undefined}
                  {...labelProps(s.label)}
                  {...prefetchOn(s.href)}
                  onClick={onSelect == null ? undefined : (e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                    e.preventDefault(); onSelect(s.id);
                  }}>
                  {inner}
                </a>
              ) : (
                <button type="button" className={itemCls} data-active={active || undefined} data-crest={s.crest}
                  {...labelProps(s.label)}
                  onClick={onSelect == null ? undefined : () => onSelect(s.id)}>
                  {inner}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {footer != null && <div className={styles.iconRailFooter}>{footer}</div>}
    </nav>
  );
}
