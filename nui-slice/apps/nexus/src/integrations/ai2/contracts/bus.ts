/**
 * Wave XI — шина окон NEU (/v1/bus/*). Контракты заданы диспетчем волны
 * (wave-XI-2026-10-16.md §«Единые контракты») и отдаются хостом verbatim —
 * поля на проводе уже camelCase, маппинг только валидирует.
 *
 * Session.status: locked — Devin ответил `session_locked` (окно открыто в UI);
 * busy — задача в inbox ждёт ответа; unknown — каталог шины не читается.
 * Delegation.state: queued — файл в inbox; sent — send.ps1 отработал, ответа
 * нет; answered — ответ в outbox; locked — ответ session_locked; failed —
 * транспорт упал (поле error — причина verbatim).
 */

export type BusSessionStatus = 'idle' | 'busy' | 'locked' | 'unknown';
export type BusSessionKind = 'desktop' | 'tui' | 'cloud';
export type DelegationState = 'queued' | 'sent' | 'answered' | 'locked' | 'failed';

export interface BusSession {
  id: string;
  window: string;
  title: string;
  kind: BusSessionKind | 'unknown';
  status: BusSessionStatus;
  lastActivityAt: number | null;
}

export interface BusDelegation {
  id: string;
  to: string;
  taskPath: string;
  state: DelegationState;
  answerPath: string | null;
  createdAt: number;
  /** host-side reason for failed/queued-without-sender — verbatim, never UI text. */
  error?: string;
}

export interface DelegateTaskInput {
  window: string;
  task: string;
}

/**
 * Wave XIV — GET /v1/bus/overview (docs/product/bus-overview-contract.md):
 * обзор шины окон W1–W5, только чтение файлов каталога AI2_NEXUS_BUS.
 * `status: 'ok'` — каталог читается; `'unknown'` — env не задан/каталога
 * нет (при этом windows/watch пусты, ответ всё равно 200). Значения `state`
 * хоста — закрытый словарь, но поле читается verbatim: неизвестное значение
 * показывается как текст, а не прячется за 'idle'.
 */
export type BusWindowState = 'working' | 'long' | 'waiting' | 'idle';

export interface BusOverviewWindow {
  window: string;
  /** verbatim хоста; вне словаря — показываем как есть. */
  state: BusWindowState | (string & {});
  queue: number;
  sent: number;
  outbox: number;
  currentTask: string | null;
  sendAgeMin: number | null;
  lastAnswerAt: number | null;
}

export interface BusWatchEntry {
  time: string | null;
  window: string | null;
  file: string | null;
  event: string;
}

export interface BusOverview {
  status: 'ok' | 'unknown' | (string & {});
  generatedAt: number;
  windows: BusOverviewWindow[];
  watch: BusWatchEntry[];
}
