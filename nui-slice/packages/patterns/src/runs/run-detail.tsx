import type { DataFreshness } from '@nexus/ui';
import { EventRibbon, StatusBadge, mapRunEvents, maskSecrets } from '@nexus/ui';
import type { RunDetail, RunEventView } from '@nexus/mock-data';
import type { PatternState } from '../agents/agent-types';
import { RUN_STATUS_LABELS, runStatusBadge } from '../agents/status-map';
import { fmtDurationSec } from '../missions/mission-map';
import styles from './runs.module.css';

export interface RunDetailPanelProps {
  /** Composed detail; null + ready = runId unknown to the source. */
  detail: RunDetail | null;
  state?: PatternState;
  /** Freshness of this snapshot — set by the screen when data is live/stale. */
  freshness?: DataFreshness;
  /** Opens another run (parent chain). Callback only — no navigation inside. */
  onOpenRun?: (runId: string) => void;
  /** Cancel is offered only for a live run and only when the caller passes it. */
  onCancel?: (runId: string) => void;
  onBack?: () => void;
  title?: string;
}

function fmtTs(ts: number | null): string {
  if (ts == null || ts === 0) return '—';
  return new Date(ts * 1000).toLocaleString('ru-RU', { hour12: false });
}

function bodySnippet(body: unknown): string {
  try {
    const s = JSON.stringify(maskSecrets(body));
    return s.length > 140 ? `${s.slice(0, 140)}…` : s;
  } catch {
    return String(body);
  }
}

/**
 * Run detail — stored facts only. The event log is the persisted server
 * log verbatim (seq-ordered); a live run attaches no fabricated events.
 * Result section appears only when the source returned a stored result.
 */
export function RunDetailPanel({
  detail,
  state = 'ready',
  freshness,
  onOpenRun,
  onCancel,
  onBack,
  title = 'Прогон',
}: RunDetailPanelProps) {
  const run = detail?.run ?? null;
  const duration = run != null && run.finishedAt != null
    ? Math.max(0, run.finishedAt - run.createdAt)
    : null;
  const showBody = detail != null && (state === 'ready' || state === 'stale');
  // W3 wave-6 п.7 — plan/control projections of the persisted log. plan.step
  // entries render verbatim (log order); per-step outcome is not stored, so
  // no progress state is invented. checkpoint/replay markers surface on the
  // ribbon (threshold tone) — the count line below states the stored fact.
  const planSteps = (detail?.events ?? [])
    .filter((e) => e.type === 'plan.step')
    .map((e) => {
      const b = (e.body ?? {}) as { step?: unknown; text?: unknown };
      return { seq: e.seq, step: typeof b.step === 'number' ? b.step : null, text: typeof b.text === 'string' ? b.text : bodySnippet(e.body), ts: e.ts };
    });
  const controlCount = (detail?.events ?? []).filter((e) => /^(checkpoint|replay|pause|resume)/.test(e.type)).length;

  return (
    <section
      className={styles.root}
      data-state={detail == null && state === 'ready' ? 'empty' : state}
      data-freshness={freshness}
      data-testid="run-detail"
      aria-label={title}
    >
      <div className={styles.head}>
        {onBack && (
          <button type="button" className={styles.backBtn} onClick={onBack}>
            ← Назад
          </button>
        )}
        <h2 className={styles.title}>{title}</h2>
        {run && <StatusBadge status={runStatusBadge(run.status)} label={RUN_STATUS_LABELS[run.status].toUpperCase()} />}
        {detail?.result && (
          <StatusBadge
            status={detail.result.verified === true ? 'complete' : detail.result.verified === false ? 'warning' : 'info'}
            label={detail.result.verified === true ? 'ПРОВЕРЕН' : detail.result.verified === false ? 'НЕ ПРОВЕРЕН' : 'ПРОВЕРКА Н/Д'}
            data-testid="run-evidence"
          />
        )}
      </div>

      {state === 'loading' && <p className={styles.muted}>Загрузка прогона…</p>}
      {state === 'error' && <p className={styles.muted}>Не удалось загрузить прогон.</p>}
      {detail == null && state === 'ready' && (
        <p className={styles.muted}>Прогон не найден — идентификатор неизвестен источнику данных.</p>
      )}

      {showBody && run && (
        <>
          <p className={styles.task}>{run.taskText}</p>
          {/* W3-06 provenance: each section declares which read produced it.
              The labels name the seam semantics, not endpoints — mock and
              live adapters resolve them differently. */}
          <p className={styles.sectionLabel}>Сведения <span className={styles.srcNote}>· источник: карточка прогона</span></p>
          <dl className={styles.facts} data-origin="run-meta">
            <dt>Прогон</dt><dd className={styles.mono}>{run.runId}</dd>
            <dt>Агент</dt><dd>{run.agent ?? '—'}</dd>
            <dt>Пресет</dt><dd>{run.config}</dd>
            <dt>Проект</dt><dd>{run.project ?? '—'}</dd>
            <dt>Родитель</dt>
            <dd>
              {run.parent == null ? '—' : onOpenRun ? (
                <button type="button" className={styles.linkBtn} onClick={() => onOpenRun(run.parent!)}>
                  {run.parent}
                </button>
              ) : run.parent}
            </dd>
            <dt>Создан</dt><dd>{fmtTs(run.createdAt)}</dd>
            <dt>Завершён</dt><dd>{fmtTs(run.finishedAt)}</dd>
            <dt>Длительность</dt><dd>{duration != null ? fmtDurationSec(duration) : '—'}</dd>
            <dt>Стоимость</dt><dd>{run.costUsd != null ? `$${run.costUsd.toFixed(3)}` : '—'}</dd>
            <dt>stopReason</dt><dd>{run.stopReason ?? '—'}</dd>
          </dl>

          {run.status === 'running' && onCancel && (
            <button type="button" className={styles.cancelBtn} onClick={() => onCancel(run.runId)}>
              Отменить прогон
            </button>
          )}

          {detail.result && (
            <>
              <p className={styles.sectionLabel}>Результат <span className={styles.srcNote}>· источник: сохранённый результат прогона</span></p>
              <dl className={styles.facts} data-origin="run-result">
                <dt>Ответ</dt><dd>{detail.result.answer ?? '—'}</dd>
                <dt>Оценка</dt><dd>{detail.result.score != null ? detail.result.score.toFixed(2) : '—'}</dd>
                <dt>Проверен</dt>
                <dd>{detail.result.verified == null ? '—' : detail.result.verified ? 'да' : 'нет'}</dd>
                <dt>Длительность</dt>
                <dd>{detail.result.durationS != null ? fmtDurationSec(detail.result.durationS) : '—'}</dd>
                <dt>Модель / инструменты</dt>
                <dd>{detail.result.usage.modelCalls} выз. · {detail.result.usage.toolCalls} инстр.</dd>
                <dt>Токены</dt><dd>{detail.result.usage.tokens.toLocaleString('ru-RU')}</dd>
              </dl>
            </>
          )}

          <p className={styles.sectionLabel}>План <span className={styles.srcNote}>· источник: журнал событий прогона (plan.step)</span></p>
          {planSteps.length === 0 ? (
            <p className={styles.muted} data-origin="run-plan">Шаги плана в журнале прогона не записаны.</p>
          ) : (
            <ol className={styles.planList} data-origin="run-plan" data-testid="run-plan">
              {planSteps.map((s) => (
                <li key={s.seq} className={styles.planItem}>
                  <span className={styles.eventSeq}>{s.step != null ? `шаг ${s.step}` : `#${s.seq}`}</span>
                  <span className={styles.eventMain}>
                    <span className={styles.eventBody}>{s.text}</span>
                  </span>
                  <span className={styles.eventTs}>{fmtTs(s.ts)}</span>
                </li>
              ))}
            </ol>
          )}

          {detail.events.length > 0 && (
            <>
              <p className={styles.sectionLabel}>Лента <span className={styles.srcNote}>· источник: журнал событий прогона</span></p>
              <EventRibbon
                events={mapRunEvents(detail.events)}
                a11y={{
                  title: `Лента событий ${run.runId}`,
                  description: 'События прогона по времени и ролям — та же запись, что журнал ниже',
                }}
                freshness={freshness}
                responsive
              />
              <p className={styles.muted} data-testid="run-control-events">
                Контрольные события (checkpoint/replay/pause): {controlCount === 0 ? 'в журнале не записаны' : `${controlCount}`}
              </p>
            </>
          )}

          <p className={styles.sectionLabel}>Журнал событий <span className={styles.srcNote}>· источник: журнал событий прогона</span></p>
          {detail.events.length === 0 ? (
            <p className={styles.muted}>Сохранённых событий нет.</p>
          ) : (
            <ol className={styles.events} data-origin="run-events">
              {detail.events.map((e: RunEventView) => (
                <li key={e.seq} className={styles.event}>
                  <span className={styles.eventSeq}>#{e.seq}</span>
                  <span className={styles.eventMain}>
                    <span className={styles.eventType}>{e.type}{e.role ? ` · ${e.role}` : ''}</span>
                    <span className={styles.eventBody}>{bodySnippet(e.body)}</span>
                  </span>
                  <span className={styles.eventTs}>{fmtTs(e.ts)}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
