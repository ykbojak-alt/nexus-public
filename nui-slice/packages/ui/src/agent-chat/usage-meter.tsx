import styles from './agent-chat.module.css';

const NO_DATA = 'нет данных';

export interface UsageMeterProps {
  className?: string;
  /** Токены прогона (вход+выход суммарно — как отдаёт адаптер). */
  tokens?: number | null;
  /** Стоимость в USD, если адаптер её отдаёт. */
  costUsd?: number | null;
  /** Занято контекста — в тех же единицах, что contextTotal. */
  contextUsed?: number | null;
  contextTotal?: number | null;
  /** Пороги подкраски шкалы (доля 0..1). По умолчанию warn 0.7, error 0.9. */
  warnAt?: number;
  errorAt?: number;
}

/** Индикатор использования: токены, стоимость, заполнение контекста.
 *  Каждое поле честное — null/undefined рисуется «нет данных», ноль не
 *  подставляется. Шкала только при обеих границах контекста. */
export function UsageMeter({
  className, tokens, costUsd, contextUsed, contextTotal,
  warnAt = 0.7, errorAt = 0.9,
}: UsageMeterProps) {
  const hasFill = contextUsed != null && contextTotal != null && contextTotal > 0;
  const frac = hasFill ? Math.min(1, contextUsed / contextTotal) : null;
  const tone = frac == null ? undefined : frac >= errorAt ? 'error' : frac >= warnAt ? 'warn' : undefined;
  return (
    <div className={[styles.usage, className].filter(Boolean).join(' ')} data-testid="usage-meter">
      <div className={styles.usageRow}>
        <span>Токены</span>
        <span className={styles.usageValue}>{tokens != null ? tokens.toLocaleString('ru-RU') : NO_DATA}</span>
      </div>
      <div className={styles.usageRow}>
        <span>Стоимость</span>
        <span className={styles.usageValue}>{costUsd != null ? `$${costUsd.toFixed(4)}` : NO_DATA}</span>
      </div>
      <div className={styles.usageRow}>
        <span>Контекст</span>
        <span className={styles.usageValue}>
          {contextUsed != null && contextTotal != null
            ? `${contextUsed.toLocaleString('ru-RU')} / ${contextTotal.toLocaleString('ru-RU')}`
            : NO_DATA}
        </span>
      </div>
      {frac != null && (
        <div
          className={styles.usageTrack}
          role="meter"
          aria-label="Заполнение контекста"
          aria-valuenow={Math.round(frac * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className={styles.usageFill} data-tone={tone} style={{ width: `${frac * 100}%` }} />
        </div>
      )}
    </div>
  );
}
