import type { HTMLAttributes, ReactNode } from 'react';
import { WindowControls, type WindowControlsProps } from './window-controls';
import styles from './layout.module.css';

export interface WindowFrameProps extends HTMLAttributes<HTMLDivElement> {
  /** Top band, left: brand mark + product title. */
  brand?: ReactNode;
  /** Top band, center: primary tabs — centered in the band. */
  tabs?: ReactNode;
  /** Top band, right: search / notifications / profile / settings cluster. */
  tools?: ReactNode;
  /** Native window actions; buttons only render for callbacks supplied by host. */
  windowControls?: Pick<WindowControlsProps, 'onMinimize' | 'onToggleMaximize' | 'onClose' | 'maximized'>;
  /** Left column — section menu (IconRail / nav list). Collapses when absent. */
  left?: ReactNode;
  /** Rail state: 'full' — wide section rail (iconRail.width), 'strip' —
   *  56px icon column (iconStrip.width), 'hidden' — column collapses to 0
   *  and drops out of the a11y tree. One column animates its width; the
   *  content right of it never jumps. */
  nav?: 'full' | 'strip' | 'hidden';
  /** Which side column hosts the nav (modular bars NUE): data-nav lands on
   *  that column; the other one is a plain aside for the dock/panel. */
  navSide?: 'left' | 'right';
  /** Right column — assistant/context card. Collapses when absent. */
  right?: ReactNode;
  /** Bottom strip — versions/status tabs. Collapses when absent. */
  bottom?: ReactNode;
  /** Модульные бары NUE: тонкая полоса под шапкой — нижний бар, перенесённый
   *  наверх пользователем. Слот схлопывается, когда пуст. */
  belowTop?: ReactNode;
  /** Props for the top-band <header> — e.g. pywebview-drag-region class/title
   *  in the frameless desktop host. */
  topProps?: HTMLAttributes<HTMLElement> & { 'data-bar-surface'?: string; 'data-bar-mode'?: string };
  children?: ReactNode;
}

/**
 * NEU window frame (runtime-2 A0): floating panel with rounded corners and
 * a thin accent hairline — canon frame geometry, identical across all five
 * assistant styles. Palette comes from `accent.*`/`surface.*` tokens, so the
 * frame recolors with the active assistant theme without a style prop.
 * Regions are slots; empty ones collapse (data-no-*).
 */
export function WindowFrame({
  brand, tabs, tools, windowControls, left, nav, navSide = 'left', right, bottom, belowTop, topProps, children, className, ...rest
}: WindowFrameProps) {
  const hasWindowControls = windowControls != null && (
    windowControls.onMinimize != null ||
    windowControls.onToggleMaximize != null ||
    windowControls.onClose != null
  );
  const hasTop = brand != null || tabs != null || tools != null || hasWindowControls;
  const { className: topClass, ...topRest } = topProps ?? {};
  return (
    <div className={[styles.frameShadow, className].filter(Boolean).join(' ')}>
      <div className={styles.frameEdge} data-testid="window-frame" {...rest}>
        <div className={styles.frame}>
          {hasTop && (
            <header className={[styles.frameTop, topClass].filter(Boolean).join(' ')} {...topRest}>
              <div className={styles.frameBrand}>{brand}</div>
              <div className={styles.frameTabs}>{tabs}</div>
              <div className={styles.frameTools}>
                {tools}
                {windowControls != null && hasWindowControls && <WindowControls {...windowControls} />}
              </div>
            </header>
          )}
          {belowTop != null && <div className={styles.frameBelowTop}>{belowTop}</div>}
          <div className={styles.frameBody}
            data-no-left={left == null || undefined}
            data-no-right={right == null || undefined}>
            {left != null && (
              <aside
                className={styles.frameLeft}
                data-nav={navSide === 'left' ? nav : undefined}
                aria-hidden={navSide === 'left' && nav === 'hidden' || undefined}
              >
                {left}
              </aside>
            )}
            <main className={styles.frameMain} tabIndex={0} aria-label="Основная область">{children}</main>
            {right != null && (
              <aside
                className={styles.frameRight}
                data-nav={navSide === 'right' ? nav : undefined}
                aria-hidden={navSide === 'right' && nav === 'hidden' || undefined}
              >
                {right}
              </aside>
            )}
          </div>
          {bottom != null && <footer className={styles.frameBottom}>{bottom}</footer>}
        </div>
      </div>
    </div>
  );
}
