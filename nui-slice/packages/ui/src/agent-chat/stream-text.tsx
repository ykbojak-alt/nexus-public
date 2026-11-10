import styles from './agent-chat.module.css';

export interface StreamTextProps {
  className?: string;
  /** Накопленный текст ответа — verbatim из дельт seam'а (W1). */
  text: string;
  /** true — поток идёт (каретка + aria-busy); false — финальный текст. */
  streaming: boolean;
}

/** Потоковый текст ассистента в ленте (S4): показывает ровно те символы,
 *  что пришли по seam — без «дорисовки» и имитации набора. Каретка —
 *  чисто визуальный маркер `aria-hidden`, для AT блок помечен aria-busy. */
export function StreamText({ className, text, streaming }: StreamTextProps) {
  return (
    <p
      className={[styles.streamText, className].filter(Boolean).join(' ')}
      data-streaming={streaming ? 'true' : undefined}
      aria-busy={streaming || undefined}
      data-testid="stream-text"
    >
      {text}
      {streaming && (
        <span className={styles.streamCaret} aria-hidden="true">
          ▍
        </span>
      )}
    </p>
  );
}
