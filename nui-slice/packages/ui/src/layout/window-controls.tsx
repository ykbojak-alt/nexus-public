import type { ButtonHTMLAttributes } from 'react';
import styles from './layout.module.css';

export interface WindowControlsProps {
  className?: string;
  maximized?: boolean;
  onMinimize?: () => void;
  onToggleMaximize?: () => void;
  onClose?: () => void;
}

type ControlButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  glyph: string;
};

function ControlButton({ label, glyph, className, ...props }: ControlButtonProps) {
  return (
    <button
      type="button"
      className={[styles.windowControl, className].filter(Boolean).join(' ')}
      aria-label={label}
      title={label}
      {...props}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

/** Хост-управляемые кнопки окна. Неактивные действия не отображаются. */
export function WindowControls({
  className, maximized = false, onMinimize, onToggleMaximize, onClose,
}: WindowControlsProps) {
  if (onMinimize == null && onToggleMaximize == null && onClose == null) return null;
  return (
    <div className={[styles.windowControls, className].filter(Boolean).join(' ')}
      role="group" aria-label="Управление окном">
      {onMinimize != null && (
        <ControlButton label="Свернуть окно" glyph="−" onClick={onMinimize} />
      )}
      {onToggleMaximize != null && (
        <ControlButton
          label={maximized ? 'Восстановить окно' : 'Развернуть окно'}
          glyph={maximized ? '▣' : '□'}
          aria-pressed={maximized}
          onClick={onToggleMaximize}
        />
      )}
      {onClose != null && (
        <ControlButton label="Закрыть окно" glyph="×" className={styles.windowControlClose}
          onClick={onClose} />
      )}
    </div>
  );
}
