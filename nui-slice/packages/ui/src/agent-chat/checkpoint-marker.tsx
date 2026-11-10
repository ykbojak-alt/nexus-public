import styles from './agent-chat.module.css';

/** Состояние отката — как его видит хост. 'unavailable' — откат в этом
 *  месте невозможен (без кнопки, честная подпись). */
export type CheckpointState = 'ready' | 'restoring' | 'restored' | 'unavailable';

export interface CheckpointMarkerProps {
  className?: string;
  /** Идентификатор чекпоинта из прогона (verbatim). */
  checkpointId: string;
  /** Подпись рядом с маркером (напр. «Чекпоинт перед правками»). */
  label?: string;
  /** Время из события, уже отформатированное вызывающим — часы не выдумываем. */
  at?: string;
  state?: CheckpointState;
  onRewind?: () => void;
  rewindLabel?: string;
}

/** Маркер чекпоинта в ленте прогона: точка + волосина + кнопка отката.
 *  Откат — явное действие пользователя; при restoring кнопка гасится. */
export function CheckpointMarker({
  className, checkpointId, label, at,
  state = 'ready', onRewind, rewindLabel = 'Откатить',
}: CheckpointMarkerProps) {
  const canRewind = state === 'ready' && onRewind != null;
  return (
    <div
      className={[styles.checkpoint, className].filter(Boolean).join(' ')}
      role="group"
      aria-label={label ?? `Чекпоинт ${checkpointId}`}
      data-testid="checkpoint-marker"
      data-state={state}
    >
      <span className={styles.checkpointDot} aria-hidden="true" />
      <span className={styles.checkpointLabel}>{label ?? 'Чекпоинт'}</span>
      <span className={styles.checkpointId}>{checkpointId}</span>
      {at != null && <span>{at}</span>}
      {state === 'unavailable' ? (
        <span>откат недоступен</span>
      ) : state === 'restored' ? (
        <span>восстановлено</span>
      ) : (
        <button
          type="button"
          className={styles.rewindBtn}
          onClick={onRewind}
          disabled={!canRewind}
          aria-label={`${rewindLabel} к чекпоинту ${checkpointId}`}
        >
          {state === 'restoring' ? 'Откатываю…' : rewindLabel}
        </button>
      )}
    </div>
  );
}
