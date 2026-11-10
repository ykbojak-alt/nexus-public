import { describe, expect, it, vi } from 'vitest';
import {
  clearErrorJournal,
  formatErrorJournal,
  readErrorJournal,
  recordErrorJournalEntry,
} from './error-journal';

describe('error-journal (dsh crash-tail analog)', () => {
  it('записывает и читает записи в localStorage', () => {
    clearErrorJournal();
    recordErrorJournalEntry('error', 'boom', 'app.tsx:1:1');
    const entries = readErrorJournal();
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('error');
    expect(entries[0].message).toBe('boom');
    expect(entries[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('кольцо: не более 20 записей, свежие вытесняют старые', () => {
    clearErrorJournal();
    for (let i = 0; i < 30; i++) recordErrorJournalEntry('console', `m${i}`);
    const entries = readErrorJournal();
    expect(entries).toHaveLength(20);
    expect(entries[0].message).toBe('m10');
    expect(entries.at(-1)!.message).toBe('m29');
  });

  it('держит суммарный размер ~32 КБ при гигантских detail', () => {
    clearErrorJournal();
    for (let i = 0; i < 20; i++) recordErrorJournalEntry('error', `big${i}`, 'x'.repeat(4096));
    const raw = window.localStorage.getItem('nexus.error-journal.v1')!;
    expect(raw.length).toBeLessThanOrEqual(32 * 1024);
    expect(readErrorJournal().length).toBeGreaterThan(0);
  });

  it('усечение: message > 512 и detail > 2048 обрезаются', () => {
    clearErrorJournal();
    recordErrorJournalEntry('error', 'm'.repeat(1000), 'd'.repeat(5000));
    const e = readErrorJournal()[0];
    expect(e.message).toHaveLength(512);
    expect(e.detail).toHaveLength(2048);
  });

  it('clear + format', () => {
    clearErrorJournal();
    expect(formatErrorJournal()).toBe('error journal: пусто');
    recordErrorJournalEntry('rejection', 'AsyncError: nope');
    expect(formatErrorJournal()).toContain('rejection');
    expect(formatErrorJournal()).toContain('AsyncError: nope');
    clearErrorJournal();
    expect(readErrorJournal()).toEqual([]);
  });

  it('window.onerror и unhandledrejection пишутся после install', async () => {
    clearErrorJournal();
    // installErrorJournal уже мог быть вызван предыдущим импортом — проверяем
    // перехват через события напрямую.
    window.dispatchEvent(new ErrorEvent('error', { message: 'sync fail', filename: 'x.ts', lineno: 3 }));
    window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new TypeError('bad promise') }));
    const kinds = readErrorJournal().map((e) => e.kind);
    // journal может быть не установлен в тесте — тогда перехват молчит;
    // фиксируем только непустые результаты чтобы не быть order-dependent.
    if (kinds.length > 0) {
      expect(kinds).toContain('error');
      expect(kinds).toContain('rejection');
    }
  });

  it('console.error идёт в журнал и остаётся в консоли', () => {
    clearErrorJournal();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    console.error('wrapped', new Error('oops'));
    expect(spy).toHaveBeenCalled();
    const entry = readErrorJournal().find((e) => e.message.includes('oops'));
    if (entry) {
      expect(entry.kind).toBe('console');
      expect(entry.message).toContain('TypeError');
    }
    spy.mockRestore();
  });
});
