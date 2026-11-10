// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  CHAT_COMPRESSED_CHARS,
  parseTab,
  readChatSnapshot,
  sceneAgeLabel,
  sceneAgeSeconds,
  sceneUpdatedLabel,
  stripChatTaskWrapper,
  writeChatSnapshot,
} from './shared';

describe('shared — parseTab', () => {
  it('возвращает raw, если он в visible', () => {
    expect(parseTab('process', ['overview', 'process'], true)).toBe('process');
    expect(parseTab('overview', ['overview', 'history'], false)).toBe('overview');
  });
  it('при hasRun и видимом process → process', () => {
    expect(parseTab(null, ['overview', 'process'], true)).toBe('process');
    expect(parseTab('foo', ['overview', 'process'], true)).toBe('process');
  });
  it('без process → первая видимая (или overview)', () => {
    expect(parseTab(null, ['overview'], false)).toBe('overview');
    expect(parseTab(null, ['history'], false)).toBe('history');
    expect(parseTab(null, [], true)).toBe('overview');
  });
});

describe('shared — scene labels', () => {
  it('sceneUpdatedLabel: null → “нет данных”', () => {
    expect(sceneUpdatedLabel(null)).toBe('нет данных');
  });
  it('sceneUpdatedLabel: число → строка времени (HH:MM:SS)', () => {
    expect(sceneUpdatedLabel(0)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
  it('sceneAgeSeconds: null → null', () => {
    expect(sceneAgeSeconds(null, Date.now())).toBeNull();
  });
  it('sceneAgeSeconds: положительное число секунд', () => {
    const now = 1_000_000_000;
    expect(sceneAgeSeconds((now - 5000) / 1000, now)).toBe(5);
  });
  it('sceneAgeLabel: пороги', () => {
    expect(sceneAgeLabel(null)).toBe('возраст данных неизвестен');
    expect(sceneAgeLabel(3)).toBe('обновлено только что');
    expect(sceneAgeLabel(30)).toBe('обновлено 30 с назад');
    expect(sceneAgeLabel(120)).toBe('обновлено 2 мин назад');
  });
});

describe('shared — compress / strip / snapshot', () => {
  it('stripChatTaskWrapper: убирает хвост после делителя', () => {
    const delim = '\n\nТекущее сообщение: ';
    expect(stripChatTaskWrapper('контекст' + delim + 'вопрос')).toBe('вопрос');
    expect(stripChatTaskWrapper('без делителя')).toBe('без делителя');
    expect(stripChatTaskWrapper(null)).toBe('');
  });
  it('readChatSnapshot/writeChatSnapshot roundtrip (sessionStorage)', () => {
    const store: Record<string, string> = {};
    const ss = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    } as unknown as Storage;
    (globalThis as { sessionStorage?: Storage }).sessionStorage = ss;
    writeChatSnapshot({ chat: [{ id: '1', role: 'user', status: 'done', ts: 1 } as never], traces: {}, answers: {} });
    const snap = readChatSnapshot();
    expect(snap.chat).toHaveLength(1);
    expect(snap.chat[0].id).toBe('1');
    delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
  });
  it('readChatSnapshot: мусор → пустой снапшот', () => {
    const ss = { getItem: () => '{bad json', setItem: () => {} } as unknown as Storage;
    (globalThis as { sessionStorage?: Storage }).sessionStorage = ss;
    const snap = readChatSnapshot();
    expect(snap.chat).toEqual([]);
    expect(snap.traces).toEqual({});
    delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
  });
});
