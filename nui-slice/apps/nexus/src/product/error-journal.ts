// Crash-forensics для рендерера — аналог dsh-desktop crash-*.log + renderer
// console tail (BORROWED.md): window.onerror / unhandledrejection / console.error
// пишутся в ограниченный журнал в localStorage, чтобы падение экрана оставляло
// след после перезагрузки окна. Лимиты — как у хвоста консоли dsh: 20 записей,
// ~32 КБ суммарно; старые записи вытесняются (кольцо).

const JOURNAL_KEY = 'nexus.error-journal.v1';
const MAX_ENTRIES = 20;
const MAX_BYTES = 32 * 1024;
const MAX_DETAIL = 2048;

export type ErrorJournalKind = 'error' | 'rejection' | 'console' | 'boundary';

export interface ErrorJournalEntry {
  ts: string;
  kind: ErrorJournalKind;
  message: string;
  detail?: string;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readErrorJournal(): ErrorJournalEntry[] {
  const store = storage();
  if (store == null) return [];
  try {
    const raw = store.getItem(JOURNAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((e) => e && typeof e.message === 'string') : [];
  } catch {
    return [];
  }
}

export function clearErrorJournal(): void {
  try {
    storage()?.removeItem(JOURNAL_KEY);
  } catch { /* хранилище недоступно — журнал просто не пишется */ }
}

export function recordErrorJournalEntry(
  kind: ErrorJournalKind,
  message: string,
  detail?: string,
): void {
  const store = storage();
  if (store == null) return;
  const entry: ErrorJournalEntry = {
    ts: new Date().toISOString(),
    kind,
    message: String(message).slice(0, 512),
  };
  if (detail) entry.detail = String(detail).slice(0, MAX_DETAIL);
  const entries = [...readErrorJournal(), entry].slice(-MAX_ENTRIES);
  let payload = JSON.stringify(entries);
  // Суммарный потолок: вытесняем старейшие записи, пока не влезет.
  while (payload.length > MAX_BYTES && entries.length > 1) {
    entries.shift();
    payload = JSON.stringify(entries);
  }
  try {
    store.setItem(JOURNAL_KEY, payload);
  } catch { /* quota/приватный режим — журнал опционален, не роняем */ }
}

export function formatErrorJournal(): string {
  const entries = readErrorJournal();
  if (entries.length === 0) return 'error journal: пусто';
  return entries
    .map((e) => `${e.ts}  ${e.kind.padEnd(9)}  ${e.message}${e.detail ? `\n  ${e.detail}` : ''}`)
    .join('\n');
}

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

let installed = false;

/** Вешает глобальные перехватчики; идемпотентно, безопасно вызывать из эффекта. */
export function installErrorJournal(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event) => {
    recordErrorJournalEntry(
      'error',
      event.message || 'window.onerror',
      `${event.filename ?? ''}:${event.lineno ?? 0}:${event.colno ?? 0}`,
    );
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    recordErrorJournalEntry('rejection', describe(reason), reason instanceof Error ? reason.stack : undefined);
  });
  // Ограниченный хвост console.error — как renderer console tail у dsh:
  // перехватываем, не подавляя исходный вывод.
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    try {
      recordErrorJournalEntry('console', args.map(describe).join(' '));
    } finally {
      originalError.apply(console, args);
    }
  };
}
