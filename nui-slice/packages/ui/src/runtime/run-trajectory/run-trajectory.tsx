import { useMemo, useState, type ReactNode } from 'react';
import { StatusBadge, type NexusStatus } from '../../feedback/status-badge/status-badge';
import { maskSecrets } from '../mask-secrets';
import { staggerDelay } from '../../motion/motion-helpers';
import { ExpandRegion } from '../../motion/motion-copilot';
import motion from '../../motion/motion.module.css';
import styles from '../runtime.module.css';

/**
 * ToolCall-событие прогона — контракт волны XI (задаёт W1):
 * `{callId, parentCallId?, name, input, output?, startedAt, durationMs?, status}`.
 * Вложенность через `parentCallId`, как у субагентов Copilot.
 *
 * `startedAt` — epoch seconds (как RunEventView.ts у хоста).
 */
export interface TrajectoryCall {
  callId: string;
  parentCallId?: string;
  name: string;
  input?: unknown;
  output?: unknown;
  startedAt?: number;
  durationMs?: number;
  status: TrajectoryCallStatus;
}

/** 'open' — вызов записан, результата в трейсе нет (лог-разрыв или live). */
export type TrajectoryCallStatus = 'queued' | 'running' | 'done' | 'error' | 'open';

const STATUS_VIEW: Record<TrajectoryCallStatus, { status: NexusStatus; label: string }> = {
  queued: { status: 'waiting', label: 'В ОЧЕРЕДИ' },
  running: { status: 'executing', label: 'ВЫПОЛНЯЕТСЯ' },
  done: { status: 'complete', label: 'ГОТОВО' },
  error: { status: 'error', label: 'ОШИБКА' },
  open: { status: 'paused', label: 'НЕТ РЕЗУЛЬТАТА' },
};

interface TrajectoryNode {
  call: TrajectoryCall;
  children: TrajectoryNode[];
}

/**
 * Плоский список вызовов → дерево по `parentCallId`. Порядок — порядок входа
 * (seq трейса). Сироты (родителя нет в списке) честно поднимаются в корень
 * с пометкой — не выдумываем родителя и не прячем вызов.
 */
export function trajectoryTree(calls: TrajectoryCall[]): TrajectoryNode[] {
  const nodes = new Map<string, TrajectoryNode>();
  for (const call of calls) nodes.set(call.callId, { call, children: [] });
  const roots: TrajectoryNode[] = [];
  for (const call of calls) {
    const node = nodes.get(call.callId)!;
    const parent = call.parentCallId != null ? nodes.get(call.parentCallId) : undefined;
    if (parent != null) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function fmtClock(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} мс`;
  return `${(ms / 1000).toFixed(1).replace('.', ',')} с`;
}

const MAX_PAYLOAD_CHARS = 1600;

/** Вход/выход в читаемый текст: секреты маскируются, длинные payload'ы
 *  обрезаются — карточка показывает факт вызова, не дамп. */
function payloadText(value: unknown): { text: string; truncated: boolean } {
  const masked = maskSecrets(value);
  const raw = typeof masked === 'string' ? masked : JSON.stringify(masked, null, 1);
  if (raw == null) return { text: '', truncated: false };
  return raw.length > MAX_PAYLOAD_CHARS
    ? { text: `${raw.slice(0, MAX_PAYLOAD_CHARS)}…`, truncated: true }
    : { text: raw, truncated: false };
}

function CallCard({ node, depth }: { node: TrajectoryNode; depth: number }) {
  const { call, children } = node;
  const expandable = children.length > 0 || call.input !== undefined || call.output !== undefined;
  const [open, setOpen] = useState(false);
  const view = STATUS_VIEW[call.status];
  const input = useMemo(
    () => (call.input !== undefined ? payloadText(call.input) : null),
    [call.input],
  );
  const output = useMemo(
    () => (call.output !== undefined ? payloadText(call.output) : null),
    [call.output],
  );
  const orphan = call.parentCallId != null && depth === 0;

  return (
    <div className={styles.trajItem} data-depth={depth} data-status={call.status}>
      <button
        type="button"
        className={styles.trajHead}
        onClick={() => expandable && setOpen((v) => !v)}
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        data-testid="trajectory-call"
      >
        <span className={styles.trajChevron} aria-hidden="true" data-open={open || undefined}>
          {expandable ? '▸' : '·'}
        </span>
        {call.startedAt != null && <time className={styles.eventTime}>{fmtClock(call.startedAt)}</time>}
        <span className={styles.trajName}>{call.name}</span>
        {call.durationMs != null && <span className={styles.trajDuration}>{fmtDuration(call.durationMs)}</span>}
        <StatusBadge status={view.status} label={view.label} />
      </button>
      {orphan && (
        <p className={styles.trajOrphan}>
          родительский вызов {call.parentCallId} вне этого трейса
        </p>
      )}
      {expandable && (
        <ExpandRegion open={open} innerClassName={styles.trajBodyInner}>
          {input != null && (
            <div className={styles.trajPayload}>
              <div className={styles.trajPayloadLabel}>Вход</div>
              <pre className={styles.trajPayloadText}>{input.text}</pre>
            </div>
          )}
          {output != null && (
            <div className={styles.trajPayload}>
              <div className={styles.trajPayloadLabel}>
                Выход{output.truncated ? ' (обрезан)' : ''}
              </div>
              <pre className={styles.trajPayloadText}>{output.text}</pre>
            </div>
          )}
          {/* вложенные вызовы монтируются при раскрытии — появление
              играется каждый раз (Copilot-модель), reduced-motion мгновенно */}
          {open && children.length > 0 && (
            <ol className={styles.trajChildren}>
              {children.map((child, j) => (
                <li key={child.call.callId} className={motion.nestIn} style={staggerDelay(j, 60)}>
                  <CallCard node={child} depth={depth + 1} />
                </li>
              ))}
            </ol>
          )}
        </ExpandRegion>
      )}
    </div>
  );
}

/**
 * ToolCallCard (спека W2) — карточка одного вызова с вложенными детьми.
 * Тонкая обёртка над CallCard: строит поддерево из плоского списка по
 * `parentCallId` (как RunTrajectory), чтобы карточку можно было рендерить
 * и вне общей шкалы.
 */
export interface ToolCallCardProps {
  call: TrajectoryCall;
  /** Вызовы того же trace — связь ребёнка строится строго по parentCallId. */
  calls?: TrajectoryCall[];
}

export function ToolCallCard({ call, calls = [] }: ToolCallCardProps) {
  const node = useMemo<TrajectoryNode>(() => {
    const byId = new Map<string, TrajectoryNode>();
    for (const c of [call, ...calls]) byId.set(c.callId, { call: c, children: [] });
    const root = byId.get(call.callId)!;
    for (const c of calls) {
      const parent = c.parentCallId != null ? byId.get(c.parentCallId) : undefined;
      if (parent != null) parent.children.push(byId.get(c.callId)!);
    }
    return root;
  }, [call, calls]);
  return (
    <ol className={styles.traj} data-testid="tool-call-card">
      <CallCard node={node} depth={0} />
    </ol>
  );
}

export interface RunTrajectoryProps {
  className?: string;
  /** Плоский список вызовов по контракту ToolCall; вложенность строится здесь. */
  calls: TrajectoryCall[];
  /** false — без анимации появления (probe/скриншоты W5). */
  animated?: boolean;
  /** Текст честного пустого состояния; без него пустой список не рисуется. */
  emptyLabel?: ReactNode;
}

/**
 * «Траектория прогона» — временная шкала вызовов с вложенностью (волна XI,
 * W4). Данные только реальные: что передали в `calls`, то и на шкале; без
 * родителя — плоско, без результата — «нет результата». Раскрытие карточек —
 * grid-rows-анимация в духе MAIN, гасится prefers-reduced-motion.
 */
export function RunTrajectory({ className, calls, animated = true, emptyLabel }: RunTrajectoryProps) {
  const roots = useMemo(() => trajectoryTree(calls), [calls]);
  if (roots.length === 0) {
    return emptyLabel != null
      ? <p className={styles.trajEmpty} data-testid="run-trajectory" data-state="empty">{emptyLabel}</p>
      : null;
  }
  return (
    <ol
      className={[styles.traj, className].filter(Boolean).join(' ')}
      data-testid="run-trajectory"
      data-state="ready"
    >
      {roots.map((node, i) => (
        <li
          key={node.call.callId}
          className={animated ? motion.enter : undefined}
          style={staggerDelay(i, 50)}
        >
          <CallCard node={node} depth={0} />
        </li>
      ))}
    </ol>
  );
}
