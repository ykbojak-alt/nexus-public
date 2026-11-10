import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react';
import { staggerDelay } from './motion-helpers';
import styles from './motion.module.css';

/**
 * Движение Copilot-компонентов NEU (волна XII, W4) — примитивы, которые
 * W3 подключает к карточкам по спеке `docs/product/copilot-patterns-spec.md`:
 * ToolCallCard/SubagentCard (раскрытие), вложенные вызовы (появление),
 * стриминг вывода, пульс busy у SessionList, подтверждение у DelegationChip.
 * Длительности — шкала токенов packages/motion (80/140/240/420/700),
 * значения продублированы в motion.module.css (CSS не читает TS-пакет).
 * Всё гасится prefers-reduced-motion и prop `animated`.
 */

export interface ExpandRegionProps extends HTMLAttributes<HTMLDivElement> {
  /** Раскрыто ли тело карточки. */
  open: boolean;
  /** false — без анимации (probe/скриншоты). */
  animated?: boolean;
  /** Класс внутренней обёртки (padding/типографика владельца). */
  innerClassName?: string;
}

/**
 * Сворачиваемое тело ToolCallCard/SubagentCard: grid-rows 0fr→1fr,
 * дети сохраняют состояние (DOM не демонтируется). Контрол — кнопка
 * `aria-expanded` у владельца.
 */
export function ExpandRegion({ open, animated = true, className, innerClassName, children, ...rest }: ExpandRegionProps) {
  return (
    <div
      className={[styles.expand, className].filter(Boolean).join(' ')}
      data-open={open || undefined}
      data-animated={animated ? undefined : 'false'}
      {...rest}
    >
      <div className={[styles.expandInner, innerClassName].filter(Boolean).join(' ')}>
        {children}
      </div>
    </div>
  );
}

export interface NestedRevealProps extends HTMLAttributes<HTMLDivElement> {
  /** Вложенные вызовы видны только когда родитель раскрыт — появление
   *  играется при каждом раскрытии (как у субагентов Copilot). */
  open: boolean;
  /** Позиция в группе — стаггер. */
  index?: number;
  animated?: boolean;
}

/** Появление одного вложенного вызова внутри раскрытой карточки. */
export function NestedReveal({ open, index = 0, animated = true, className, style, children, ...rest }: NestedRevealProps) {
  if (!open) return null;
  return (
    <div
      className={[animated ? styles.nestIn : '', className].filter(Boolean).join(' ')}
      style={{ ...staggerDelay(index, 60), ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface StreamingTextProps extends HTMLAttributes<HTMLDivElement> {
  /** Уже пришедший текст — показывается verbatim. */
  text: string;
  /** Поток идёт → мигающий каретка-курсор; false/завершён → статичный текст. */
  active?: boolean;
}

/**
 * Стриминг вывода инструмента: verbatim-текст + мигающая каретка, пока
 * `active`. Каретка — единственная «добавка»; сам текст не анимируется
 * и не выдумывается. reduced-motion → каретка статична.
 */
export function StreamingText({ text, active = false, className, ...rest }: StreamingTextProps) {
  return (
    <div className={[styles.streamText, className].filter(Boolean).join(' ')} {...rest}>
      <span className={styles.streamBody}>{text}</span>
      {active && <span className={styles.streamCaret} aria-hidden="true" />}
    </div>
  );
}

export interface BusyDotProps extends HTMLAttributes<HTMLSpanElement> {
  /** Сессия занята — пульс; иначе статичная точка в тоне статуса. */
  busy: boolean;
}

/**
 * Пульс статуса `busy` для строк SessionList: точка в тоне
 * `state.executing` + дышащее кольцо (NX-BUSY-PULSE). reduced-motion →
 * статичная точка, статус остаётся читаемым по цвету/подписи.
 */
export function BusyDot({ busy, className, ...rest }: BusyDotProps) {
  return (
    <span
      className={[styles.busyDot, className].filter(Boolean).join(' ')}
      data-busy={busy || undefined}
      aria-hidden="true"
      {...rest}
    />
  );
}

export interface SendFlashProps extends HTMLAttributes<HTMLSpanElement> {
  /** Меняй на переходе queued→sent/answered — перемонтирует вспышку.
   *  Обычно `flashKey={delegation.state}`. */
  flashKey: React.Key;
  children: ReactNode;
}

/**
 * Одноразовое подтверждение отправки у DelegationChip: короткая вспышка
 * (scale+tint, 420ms) при каждой смене `flashKey`. Без смены ключа
 * анимация не повторяется — вспышка означает реальный переход состояния.
 */
export function SendFlash({ flashKey, className, children, ...rest }: SendFlashProps) {
  return (
    <span
      key={flashKey}
      className={[styles.sendFlash, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </span>
  );
}

/**
 * Хук для DelegationChip: возвращает ключ, который меняется при каждом
 * переходе `state` в `sent`/`answered` — передать в `SendFlash.flashKey`.
 */
export function useSendConfirm(state: string): React.Key {
  const [key, setKey] = useState<React.Key>(0);
  useEffect(() => {
    if (state === 'sent' || state === 'answered') setKey((k) => String(k) + '.' + state);
  }, [state]);
  return key;
}
