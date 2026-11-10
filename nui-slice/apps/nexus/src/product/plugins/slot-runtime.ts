/**
 * Рантайм слотов NEU (волна XVI, по архитектуре DeepSeek Harness —
 * код не копируется, реализация своя). Слот объявляет оболочка,
 * записи регистрируют плагины; выгрузка плагина снимает все его
 * записи через диспозеры — без утечек состояния.
 *
 * Виды слотов:
 *  - `single` — видна одна запись (последняя выигрывает);
 *  - `list`   — все записи, порядок по `order` затем по регистрации;
 *  - `keyed`  — записи адресуются ключом `key`;
 *  - `chain`  — записи-функции применяются по цепочке к входу
 *              (каждая «выбирает себя»: вернула undefined — шаг дальше).
 *
 * Ошибки объявлений (слот не объявлен, конфликт вида, запись без ключа
 * в keyed и т.п.) ловятся на регистрации: пишутся в `issues`, выброс —
 * только для программного вызова `declareSlot` с конфликтом вида.
 */

export type SlotKind = 'single' | 'list' | 'keyed' | 'chain';

export interface SlotDecl {
  name: string;
  kind: SlotKind;
  /** кто объявил — 'shell' для слотов оболочки, id плагина для своих. */
  declaredBy: string;
}

export interface Contribution<T = unknown> {
  pluginId: string;
  /** Строка-плагин в бандле (строка contributes в манифесте). */
  rowId: string;
  /** Ключ записи — обязателен для keyed-слотов. */
  key?: string;
  /** Порядок внутри list/keyed — меньше = раньше. */
  order: number;
  /** Счётчик регистрации — стабильный порядок при равном order. */
  seq: number;
  value: T;
}

export interface SlotIssue {
  message: string;
}

type Listener = () => void;

const noop = () => { };

export class SlotRuntime {
  private decls = new Map<string, SlotDecl>();
  private contribs = new Map<string, Contribution[]>();
  private cache = new Map<string, Contribution[]>();
  private disposersByPlugin = new Map<string, Set<() => void>>();
  private disposerByEntry = new Map<Contribution, () => void>();
  private listeners = new Map<string, Set<Listener>>();
  private declsCache: SlotDecl[] | null = null;
  private seq = 0;
  /** Ошибки объявлений/регистраций — диагностика на странице плагина. */
  readonly issues: SlotIssue[] = [];

  /** Объявление слота. Повторное с тем же видом — идемпотентно;
   *  конфликт вида фиксируется в issues (записи не ломаем). */
  declareSlot(name: string, kind: SlotKind, declaredBy = 'shell'): void {
    const prev = this.decls.get(name);
    if (prev != null) {
      if (prev.kind !== kind) {
        this.fail(`слот «${name}»: повторное объявление с видом «${kind}» (был «${prev.kind}»)`);
      }
      return;
    }
    this.decls.set(name, { name, kind, declaredBy });
    this.declsCache = null;
  }

  slotKind(name: string): SlotKind | null {
    return this.decls.get(name)?.kind ?? null;
  }

  /** Кэшированный снимок объявлений — стабилен до мутации реестра. */
  declaredSlots(): SlotDecl[] {
    if (this.declsCache == null) this.declsCache = [...this.decls.values()];
    return this.declsCache;
  }

  /**
   * Регистрация записи в слоте. Возвращает диспозер (идемпотентный).
   * Невалидная запись фиксируется в issues и не попадает в слот.
   */
  contribute<T>(
    slot: string,
    c: { pluginId: string; rowId: string; key?: string; order?: number; value: T },
  ): () => void {
    const decl = this.decls.get(slot);
    if (decl == null) {
      this.fail(`слот «${slot}» не объявлен — запись ${c.pluginId}:${c.rowId} отклонена`);
      return noop;
    }
    if (decl.kind === 'keyed' && (c.key == null || c.key === '')) {
      this.fail(`слот «${slot}» keyed — запись ${c.pluginId}:${c.rowId} без ключа отклонена`);
      return noop;
    }
    if (decl.kind === 'chain' && typeof c.value !== 'function') {
      this.fail(`слот «${slot}» chain — запись ${c.pluginId}:${c.rowId} не функция`);
      return noop;
    }
    const entry: Contribution<T> = {
      pluginId: c.pluginId,
      rowId: c.rowId,
      key: c.key,
      order: c.order ?? 0,
      seq: this.seq++,
      value: c.value,
    };
    const list = this.contribs.get(slot) ?? [];
    if (decl.kind === 'single') {
      // single: одна видимая запись — новая заменяет чужую (без вызова
      // чужих диспозеров: записи других плагинов остаются в очереди и
      // «всплывут» при выгрузке победителя).
      list.push(entry as Contribution);
    } else {
      list.push(entry as Contribution);
    }
    list.sort((a, b) => a.order - b.order || a.seq - b.seq);
    this.contribs.set(slot, list);
    this.invalidate(slot);

    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      this.disposerByEntry.delete(entry as Contribution);
      const pluginDisposers = this.disposersByPlugin.get(c.pluginId);
      pluginDisposers?.delete(dispose);
      if (pluginDisposers?.size === 0) this.disposersByPlugin.delete(c.pluginId);
      const cur = this.contribs.get(slot);
      if (cur != null) {
        const next = cur.filter((e) => e !== entry);
        if (next.length === 0) this.contribs.delete(slot);
        else this.contribs.set(slot, next);
        this.invalidate(slot);
      }
    };
    this.disposerByEntry.set(entry as Contribution, dispose);
    let set = this.disposersByPlugin.get(c.pluginId);
    if (set == null) {
      set = new Set();
      this.disposersByPlugin.set(c.pluginId, set);
    }
    set.add(dispose);
    return dispose;
  }

  /** Записи слота (кэшированный снимок — стабилен до мутации). */
  entries<T = unknown>(slot: string): Contribution<T>[] {
    const hit = this.cache.get(slot);
    if (hit != null) return hit as Contribution<T>[];
    const decl = this.decls.get(slot);
    let list = [...(this.contribs.get(slot) ?? [])];
    if (decl?.kind === 'single' && list.length > 1) {
      // видна только последняя зарегистрированная запись
      list = list.slice(-1);
    }
    this.cache.set(slot, list);
    return list as Contribution<T>[];
  }

  /** Единичная запись: keyed — по ключу, single — видимая. */
  entry<T = unknown>(slot: string, key?: string): Contribution<T> | null {
    const all = this.entries<T>(slot);
    if (key != null) return all.find((e) => e.key === key) ?? null;
    return all[0] ?? null;
  }

  /**
   * Цепочка: каждая запись — `(input) => output | undefined`; первая
   * вернувшая значение выигрывает. Пустая цепочка → undefined.
   */
  runChain<I, O>(slot: string, input: I): O | undefined {
    for (const e of this.entries<(i: I) => O | undefined>(slot)) {
      const out = e.value(input);
      if (out !== undefined) return out;
    }
    return undefined;
  }

  /** Подписка на изменения слота (useSyncExternalStore). */
  subscribe(slot: string, fn: Listener): () => void {
    let set = this.listeners.get(slot);
    if (set == null) {
      set = new Set();
      this.listeners.set(slot, set);
    }
    set.add(fn);
    return () => { set.delete(fn); };
  }

  /** Выгрузка плагина: все его записи и слоты-декларации снимаются. */
  unloadPlugin(pluginId: string): void {
    const set = this.disposersByPlugin.get(pluginId);
    if (set != null) {
      for (const d of [...set]) d();
      this.disposersByPlugin.delete(pluginId);
    }
    for (const [name, decl] of [...this.decls]) {
      if (decl.declaredBy !== pluginId) continue;
      for (const entry of [...(this.contribs.get(name) ?? [])]) {
        this.disposerByEntry.get(entry)?.();
      }
      this.decls.delete(name);
      this.declsCache = null;
      this.invalidate(name);
    }
  }

  /** Счёт записей плагина — проверка «выгрузка без утечек». */
  pluginEntryCount(pluginId: string): number {
    let n = 0;
    for (const list of this.contribs.values()) {
      for (const e of list) if (e.pluginId === pluginId) n += 1;
    }
    return n;
  }

  private invalidate(slot: string): void {
    this.cache.delete(slot);
    for (const fn of this.listeners.get(slot) ?? []) fn();
  }

  private fail(message: string): void {
    this.issues.push({ message });
  }
}
