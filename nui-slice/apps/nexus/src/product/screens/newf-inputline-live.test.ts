// @vitest-environment node
/**
 * V41: контракт InputLine против ЖИВОГО scratch-ядра. Моков тут нет
 * намеренно: существующие тесты (newf-terminals-grid.test.tsx,
 * newf-live.test.ts) уже проверяют выбор sendLine/sendRaw и форму
 * запроса на подставном fetch. Это же проверяет, что ядро реально
 * делает с этим запросом — то есть полный цикл, который InputLine
 * обещает пользователю.
 *
 * Запуск (нужен поднятый scratch-демон; без переменной теста нет):
 *   python reports/QODER-v41/kit/run_live_contract.py
 *   NEWF_LIVE_CORE_URL=http://127.0.0.1:PORT npx vitest run \
 *     src/product/screens/newf-inputline-live.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BridgeUnavailable, createCoreBridge } from './newf-live';

const BASE = process.env.NEWF_LIVE_CORE_URL ?? '';
const TERMINAL = process.env.NEWF_LIVE_SHELL ?? 'cmd';

const nonce = Date.now().toString(36);
const MARK_LINE = `V41LIVE${nonce}`;
const MARK_RAW = `V41RAW${nonce}`;

function occurrences(hay: string, needle: string): number {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

async function poll(
  what: () => Promise<string>,
  pred: (s: string) => boolean,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = await what();
    if (pred(last)) return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  return last;
}

const suite = BASE ? describe : describe.skip;

suite('InputLine контракт против живого scratch (V41)', () => {
  const bridge = createCoreBridge(BASE);
  let address = '';
  const screen = async (): Promise<string> => (await bridge.screen?.(address)) ?? '';

  beforeAll(async () => {
    const args = { name: `v41-${nonce}`, command: [TERMINAL] };
    const run = bridge.run;
    expect(typeof run).toBe('function');
    const res = await run!(args);
    address = res.address;
    expect(address).toContain(`v41-${nonce}`);
    // ConPTY инициализируется не мгновенно.
    await poll(screen, (s) => s.length > 0, 15_000);
  }, 40_000);

  afterAll(async () => {
    if (address && bridge.kill) {
      await bridge.kill(address).catch(() => undefined);
    }
  }, 30_000);

  it('line-режим: строка введена И исполнена (маркер виден дважды)', async () => {
    await bridge.sendLine!(address, `echo ${MARK_LINE}`);
    const s = await poll(screen, (v) => occurrences(v, MARK_LINE) >= 2, 20_000);
    expect(occurrences(s, MARK_LINE)).toBeGreaterThanOrEqual(2);
  }, 45_000);

  it('raw-режим: символы попали, но строка НЕ исполнена', async () => {
    await bridge.sendRaw!(address, `echo ${MARK_RAW}`);
    // Не sleep(n): задержка ConPTY не детерминирована (при 1,5 с маркер
    // иногда ещё не виден). Ждём появления, потом проверяем отсутствие исполнения.
    const seen = await poll(screen, (v) => occurrences(v, MARK_RAW) >= 1, 15_000);
    expect(occurrences(seen, MARK_RAW)).toBe(1);
    await new Promise((r) => setTimeout(r, 2_000));
    expect(occurrences(await screen(), MARK_RAW)).toBe(1);

    // Enter без текста: core отвечает 200 {characters: 0} — мост это не
    // проверяет, проверяем по факту исполнения строки.
    await bridge.sendLine!(address, '');
    const t = await poll(screen, (v) => occurrences(v, MARK_RAW) >= 2, 20_000);
    expect(occurrences(t, MARK_RAW)).toBeGreaterThanOrEqual(2);
  }, 45_000);

  it('input-log: ядро записало enter-флаг так, как его послал мост', async () => {
    const log = await bridge.inputLog!(address, 20);
    const line = log.entries.find((e) => e.text.includes(MARK_LINE));
    const raw = log.entries.find((e) => e.text.includes(MARK_RAW));
    const emptyEnter = log.entries.find((e) => e.text === '' && e.enter === true);
    expect(line?.enter).toBe(true);
    expect(raw?.enter).toBe(false);
    expect(emptyEnter).toBeTruthy();
    expect(log.count).toBeGreaterThanOrEqual(3);
  }, 20_000);

  it('несуществующий терминал: 404 доходит как BridgeUnavailable', async () => {
    const missing = `local/net-takogo-${nonce}`;
    const err = await bridge.sendLine!(missing, 'x').then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(BridgeUnavailable);
    expect(err?.message).toContain('404');
    expect(err?.message).toContain(missing);
  }, 20_000);

  it('мост не молчит, когда ядра нет: bridge unreachable', async () => {
    const dead = createCoreBridge('http://127.0.0.1:1');
    const err = await dead.sendLine!('local/x', 'y').then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(BridgeUnavailable);
    expect(err?.message).toContain('bridge unreachable');
  }, 20_000);
});
