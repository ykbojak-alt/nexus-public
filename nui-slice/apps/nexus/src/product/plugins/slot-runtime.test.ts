/**
 * Волна XVI — рантайм слотов: виды single/list/keyed/chain, проверка
 * объявлений, выгрузка плагина без утечек. Чистая логика, без DOM.
 */
import { describe, expect, it } from 'vitest';
import { SlotRuntime } from './slot-runtime';

describe('SlotRuntime', () => {
  it('объявляет слоты четырёх видов; повтор с тем же видом идемпотентен', () => {
    const rt = new SlotRuntime();
    rt.declareSlot('a', 'single');
    rt.declareSlot('b', 'list');
    rt.declareSlot('c', 'keyed');
    rt.declareSlot('d', 'chain');
    rt.declareSlot('a', 'single'); // повтор — ок
    expect(rt.slotKind('a')).toBe('single');
    expect(rt.declaredSlots()).toHaveLength(4);
    expect(rt.issues).toHaveLength(0);
  });

  it('конфликт вида при повторном объявлении фиксируется в issues', () => {
    const rt = new SlotRuntime();
    rt.declareSlot('a', 'single');
    rt.declareSlot('a', 'list');
    expect(rt.slotKind('a')).toBe('single');
    expect(rt.issues[0]?.message).toContain('повторное объявление');
  });

  it('запись в необъявленный слот отклоняется с диагностикой', () => {
    const rt = new SlotRuntime();
    const dispose = rt.contribute('nope', { pluginId: 'p', rowId: 'r', value: 1 });
    expect(rt.entries('nope')).toHaveLength(0);
    expect(rt.issues[0]?.message).toContain('не объявлен');
    dispose(); // безопасный noop
  });

  it('list: записи упорядочены по order, затем по регистрации', () => {
    const rt = new SlotRuntime();
    rt.declareSlot('s', 'list');
    rt.contribute('s', { pluginId: 'p1', rowId: 'b', order: 20, value: 'b' });
    rt.contribute('s', { pluginId: 'p1', rowId: 'a', order: 10, value: 'a' });
    rt.contribute('s', { pluginId: 'p2', rowId: 'c', order: 10, value: 'c' });
    expect(rt.entries<string>('s').map((e) => e.value)).toEqual(['a', 'c', 'b']);
  });

  it('single: видна последняя запись; при её выгрузке всплывает предыдущая', () => {
    const rt = new SlotRuntime();
    rt.declareSlot('s', 'single');
    rt.contribute('s', { pluginId: 'p1', rowId: 'a', value: 'first' });
    const d2 = rt.contribute('s', { pluginId: 'p2', rowId: 'b', value: 'second' });
    expect(rt.entries<string>('s').map((e) => e.value)).toEqual(['second']);
    d2();
    expect(rt.entries<string>('s').map((e) => e.value)).toEqual(['first']);
  });

  it('keyed: запись без ключа отклоняется; entry() адресуется ключом', () => {
    const rt = new SlotRuntime();
    rt.declareSlot('s', 'keyed');
    rt.contribute('s', { pluginId: 'p1', rowId: 'bad', value: 1 });
    rt.contribute('s', { pluginId: 'p1', rowId: 'ok', key: 'k1', value: 7 });
    expect(rt.issues.some((i) => i.message.includes('без ключа'))).toBe(true);
    expect(rt.entry<number>('s', 'k1')?.value).toBe(7);
    expect(rt.entry<number>('s', 'missing')).toBeNull();
  });

  it('chain: первая запись, вернувшая значение, выигрывает', () => {
    const rt = new SlotRuntime();
    rt.declareSlot('s', 'chain');
    rt.contribute<(i: number) => string | undefined>('s', {
      pluginId: 'p1', rowId: 'a', value: (i) => (i > 5 ? 'high' : undefined),
    });
    rt.contribute<(i: number) => string | undefined>('s', {
      pluginId: 'p2', rowId: 'b', value: (i) => (i > 0 ? 'low' : undefined),
    });
    expect(rt.runChain<number, string>('s', 10)).toBe('high');
    expect(rt.runChain<number, string>('s', 1)).toBe('low');
    expect(rt.runChain<number, string>('s', 0)).toBeUndefined();
  });

  it('chain: не-функция отклоняется с диагностикой', () => {
    const rt = new SlotRuntime();
    rt.declareSlot('s', 'chain');
    rt.contribute('s', { pluginId: 'p1', rowId: 'bad', value: 'строка' });
    expect(rt.issues.some((i) => i.message.includes('не функция'))).toBe(true);
  });

  it('unloadPlugin снимает все записи плагина без утечек', () => {
    const rt = new SlotRuntime();
    rt.declareSlot('a', 'list');
    rt.declareSlot('b', 'keyed');
    rt.contribute('a', { pluginId: 'p1', rowId: 'r1', value: 1 });
    rt.contribute('a', { pluginId: 'p1', rowId: 'r2', value: 2 });
    rt.contribute('b', { pluginId: 'p1', rowId: 'r3', key: 'k', value: 3 });
    rt.contribute('a', { pluginId: 'p2', rowId: 'r4', value: 4 });
    expect(rt.pluginEntryCount('p1')).toBe(3);
    rt.unloadPlugin('p1');
    expect(rt.pluginEntryCount('p1')).toBe(0);
    expect(rt.entries('a').map((e) => e.value)).toEqual([4]);
    expect(rt.entries('b')).toHaveLength(0);
  });

  it('disposer удаляет регистрацию из lifecycle-набора немедленно', () => {
    const rt = new SlotRuntime();
    rt.declareSlot('s', 'list');
    const dispose = rt.contribute('s', { pluginId: 'p', rowId: 'r', value: 1 });
    dispose();
    expect(rt.pluginEntryCount('p')).toBe(0);
    rt.unloadPlugin('p');
    expect(rt.entries('s')).toHaveLength(0);
  });

  it('выгрузка владельца слота очищает вклады других плагинов и уведомляет подписчиков', () => {
    const rt = new SlotRuntime();
    rt.declareSlot('owned', 'list', 'owner');
    rt.contribute('owned', { pluginId: 'contributor', rowId: 'r', value: 1 });
    let calls = 0;
    rt.subscribe('owned', () => { calls += 1; });

    rt.unloadPlugin('owner');

    expect(rt.slotKind('owned')).toBeNull();
    expect(rt.pluginEntryCount('contributor')).toBe(0);
    expect(rt.entries('owned')).toHaveLength(0);
    expect(calls).toBeGreaterThan(0);
  });

  it('подписка уведомляет об изменениях слота', () => {
    const rt = new SlotRuntime();
    rt.declareSlot('s', 'list');
    let calls = 0;
    const off = rt.subscribe('s', () => { calls += 1; });
    const d = rt.contribute('s', { pluginId: 'p', rowId: 'r', value: 1 });
    d();
    off();
    rt.contribute('s', { pluginId: 'p', rowId: 'r2', value: 2 });
    expect(calls).toBe(2);
  });
});
