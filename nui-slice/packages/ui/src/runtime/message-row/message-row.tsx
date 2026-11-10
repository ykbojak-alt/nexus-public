import styles from '../runtime.module.css';

export type MessageDirection = 'incoming' | 'outgoing';
export type MessageSendState = 'sending' | 'sent' | 'failed';

export interface MessageRowProps {
  className?: string;
  /** Message body — rendered verbatim from the provider. */
  text: string;
  /** 'outgoing' = sent by the local user. */
  direction: MessageDirection;
  /** Caller-formatted meta line (time, delivery detail). */
  meta?: string;
  /** Send state — only rendered when supplied; nothing is invented. */
  state?: MessageSendState;
  /** Provider-supplied failure reason, verbatim. */
  failedReason?: string;
}

/** One message bubble in a provider chat (Telegram, provider DM).
 *  Shows send state only when the adapter reports it — 'sending' stays
 *  readable (full contrast), 'failed' surfaces the verbatim reason. */
export function MessageRow({ className, text, direction, meta, state, failedReason }: MessageRowProps) {
  return (
    <div
      className={[styles.msgRow, className].filter(Boolean).join(' ')}
      data-direction={direction}
      data-state={state}
      data-testid="message-row"
    >
      <span>{text}</span>
      {(meta != null || state != null) && (
        <span className={styles.msgMeta}>
          {state === 'sending' ? 'отправка…' : state === 'sent' ? 'отправлено' : null}
          {state != null && state !== 'failed' && meta != null ? ' · ' : null}
          {meta}
        </span>
      )}
      {state === 'failed' && (
        <span className={styles.msgFailed} role="alert">
          {failedReason ?? 'Не отправлено'}
        </span>
      )}
    </div>
  );
}
