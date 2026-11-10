import type { DataFreshness, NexusStatus } from '@nexus/ui';
import { StatusBadge } from '@nexus/ui';
import type { PatternState } from '../agents/agent-types';
import styles from './images.module.css';

/**
 * Contract-shaped image result — mirrors `Ai2GeneratedImage`
 * (integrations/ai2/contracts/images.ts) without importing the app layer.
 * `costUsd: null` means the provider reported no price — rendered as
 * "стоимость неизвестна", never as 0 or hidden.
 */
export interface GeneratedImage {
  /** Base64-encoded image bytes (PNG/JPEG/WebP). */
  imageB64: string;
  mime: string;
  bytes: number;
  /** Provider model that produced the image (may differ from request). */
  model: string;
  costUsd: number | null;
  prompt: string;
  enrichedPrompt: string | null;
  /** True only when enrichment actually produced a different prompt. */
  enriched: boolean;
}

/** Card state — PatternState plus 'unavailable' (host capability absent). */
export type GeneratedImageState = PatternState | 'unavailable';

export interface GeneratedImageCardProps {
  image: GeneratedImage | null;
  state?: GeneratedImageState;
  freshness?: DataFreshness;
  /** Host capability reason when state='unavailable' — shown verbatim. */
  unavailableReason?: string;
  title?: string;
}

const STATE_BADGE: Record<GeneratedImageState, { status: NexusStatus; label: string }> = {
  ready: { status: 'online', label: 'ГОТОВО' },
  loading: { status: 'syncing', label: 'ГЕНЕРАЦИЯ…' },
  empty: { status: 'info', label: 'НЕТ ИЗОБРАЖЕНИЯ' },
  unavailable: { status: 'offline', label: 'НЕДОСТУПНО' },
  error: { status: 'warning', label: 'ОШИБКА' },
  stale: { status: 'warning', label: 'УСТАРЕЛО' },
};

function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Generated-image card (INT-23 visual seam). Honest semantics:
 * - `costUsd: null` → "стоимость неизвестна" (unknown ≠ zero);
 * - `enriched` → original and enriched prompts shown verbatim, no invented diff;
 * - `unavailable` → host reason verbatim; no hidden call, no fabricated image;
 * - no `image` + ready → empty, not a broken `<img>`.
 */
export function GeneratedImageCard({
  image,
  state = 'ready',
  freshness,
  unavailableReason,
  title = 'Изображение',
}: GeneratedImageCardProps) {
  const badge = STATE_BADGE[state];
  const src = image != null ? `data:${image.mime};base64,${image.imageB64}` : null;

  return (
    <section className={styles.root} data-state={state} data-freshness={freshness} data-testid="generated-image-card">
      <header className={styles.head}>
        <h3 className={styles.title}>{title}</h3>
        <StatusBadge status={badge.status} label={badge.label} />
      </header>

      {state === 'unavailable' && (
        <p className={styles.muted} data-testid="generated-image-reason">
          {unavailableReason ?? 'Генерация изображений не настроена на хосте'}
        </p>
      )}
      {state === 'loading' && <p className={styles.muted}>Запрос выполняется…</p>}
      {state === 'error' && <p className={styles.muted}>Генерация завершилась ошибкой — см. ответ хоста</p>}
      {state === 'empty' && <p className={styles.muted}>Изображение не возвращено</p>}

      {src != null && image != null && (state === 'ready' || state === 'empty' || state === 'stale') && (
        <>
          <img className={styles.image} src={src} alt={image.prompt} data-testid="generated-image" />
          <dl className={styles.meta}>
            <dt>Модель</dt><dd data-testid="generated-image-model">{image.model}</dd>
            <dt>Размер</dt><dd>{fmtBytes(image.bytes)}</dd>
            <dt>Стоимость</dt>
            <dd data-testid="generated-image-cost">
              {image.costUsd == null ? 'неизвестна' : `$${image.costUsd.toFixed(4)}`}
            </dd>
          </dl>
          <details className={styles.prompts}>
            <summary>Промпт</summary>
            <p className={styles.muted} data-testid="generated-image-prompt">{image.prompt}</p>
            {image.enriched && image.enrichedPrompt != null && (
              <>
                <p className={styles.muted}>Обогащённый промпт:</p>
                <p className={styles.muted} data-testid="generated-image-enriched">{image.enrichedPrompt}</p>
              </>
            )}
          </details>
        </>
      )}
    </section>
  );
}
