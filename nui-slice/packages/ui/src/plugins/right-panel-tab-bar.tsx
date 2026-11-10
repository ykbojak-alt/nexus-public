import { useRef } from 'react';
import { Tooltip } from '../surfaces/tooltip/tooltip';
import styles from './plugins.module.css';

export interface RightPanelTab {
  /** id вкладки — verbatim из реестра типов. */
  id: string;
  /** Заголовок вкладки — verbatim. */
  title: string;
  /** Вкладку можно закрыть (встроенные могут быть не закрываемыми). */
  closable?: boolean;
}

export type RightPanelMode = 'push' | 'fullscreen';

export interface RightPanelTabBarProps {
  className?: string;
  /** Вкладки докинг-панели — verbatim. */
  tabs: RightPanelTab[];
  /** Активная вкладка; null → ни одна не выбрана. */
  activeId?: string | null;
  /** Режим панели: push (доля окна) или fullscreen. */
  mode?: RightPanelMode;
  onActivate?: (id: string) => void;
  onClose?: (id: string) => void;
  onSplit?: () => void;
  onFullscreen?: (fullscreen: boolean) => void;
}

/** Шапка вкладок правой докинг-панели (S: вкладка, закрытие, разделение,
 *  полноэкранный режим). Семантика tablist/tab, стрелки — roving tabindex. */
export function RightPanelTabBar({
  className, tabs, activeId, mode = 'push', onActivate, onClose, onSplit, onFullscreen,
}: RightPanelTabBarProps) {
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' || tabs.length === 0) return;
    // roving: стрелки двигают фокус (выбор — через activate), считаем
    // от сфокусированной вкладки, а не от активной
    const btns = listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]');
    if (!btns?.length) return;
    const focused = [...btns].indexOf(document.activeElement as HTMLElement);
    const cur = focused >= 0 ? focused : Math.max(0, tabs.findIndex((t) => t.id === activeId));
    const next = e.key === 'ArrowRight'
      ? (cur + 1) % tabs.length
      : (cur - 1 + tabs.length) % tabs.length;
    btns[next].focus();
    onActivate?.(tabs[next].id);
    e.preventDefault();
  };

  return (
    <div className={[styles.tabBar, className].filter(Boolean).join(' ')}
      data-mode={mode} data-testid="right-panel-tab-bar">
      <div className={styles.tabList} role="tablist" aria-label="Вкладки панели"
        onKeyDown={onKeyDown} ref={listRef}>
        {tabs.map((t) => {
          const active = t.id === activeId;
          return (
            <div key={t.id} className={styles.tab} data-active={active || undefined}>
              <button
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                className={styles.tabBtn}
                onClick={() => onActivate?.(t.id)}
              >
                {t.title}
              </button>
              {t.closable !== false && onClose != null && (
                <button
                  type="button"
                  className={styles.tabClose}
                  aria-label={`Закрыть вкладку «${t.title}»`}
                  onClick={() => onClose(t.id)}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className={styles.tabActions}>
        {onSplit != null && (
          <Tooltip content="Разделить панель" arrow>
            <button type="button" className={styles.tabAction}
              aria-label="Разделить панель"
              onClick={onSplit}>
              ◫
            </button>
          </Tooltip>
        )}
        {onFullscreen != null && (
          <Tooltip content={mode === 'fullscreen' ? 'Выйти из полноэкранного режима' : 'Панель во весь экран'} arrow>
            <button type="button" className={styles.tabAction}
              aria-label={mode === 'fullscreen' ? 'Выйти из полноэкранного режима' : 'Панель во весь экран'}
              aria-pressed={mode === 'fullscreen'}
              onClick={() => onFullscreen(mode !== 'fullscreen')}>
              ⛶
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
