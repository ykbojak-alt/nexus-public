/**
 * Хост плагинов NEU (волна XVI). Реестр манифестов + активация через
 * контекст `ctx` (contribute/onDispose — аналог ctx.effect у cordis,
 * реализация своя). Слой пользовательского патча — localStorage
 * `nexus.plugins.patch.v1` (аналог cordis.patch.yml профиля DSH):
 * отключённые бандлы и строки переживают перезапуск страницы.
 *
 * Статусы: 'active' | 'disabled' | 'failed' | 'overridden' |
 * 'restart-required'. Для встроенных плагинов статус вычисляется
 * локально (activate бросил → failed); 'overridden'/'restart-required'
 * приходят от хоста для локальных бандлов — UI показывает verbatim.
 */
'use client';

import { useSyncExternalStore } from 'react';
import type { ComponentType } from 'react';
import { SlotRuntime, type Contribution, type SlotDecl, type SlotKind } from './slot-runtime';

export interface NeuPluginManifest {
  id: string;
  version: string;
  title: string;
  description: string;
  icon: string | null;
  builtin: boolean;
  /** Права по манифесту (п.2.6: по умолчанию — ничего). */
  permissions: readonly string[];
}

/** Строка contributes манифеста — адресуемая запись в слоте. */
export interface PluginRowDecl {
  rowId: string;
  slot: string;
  /** ключ для keyed-слотов */
  key?: string;
  /** подпись для экрана «Плагины» */
  title: string;
  order?: number;
}

export interface PluginCtx {
  /** Запись в слот; строка снятого патчем row не регистрируется. */
  contribute<T>(rowId: string, value: T): void;
  /** Диспозер уровня плагина — зовётся при выгрузке. */
  onDispose(fn: () => void): void;
  readonly pluginId: string;
}

export interface NeuPluginDef {
  manifest: NeuPluginManifest;
  rows: readonly PluginRowDecl[];
  activate(ctx: PluginCtx): void;
}

export type PluginStatus = 'active' | 'disabled' | 'failed' | 'overridden' | 'restart-required';

export interface PluginState {
  def: NeuPluginDef;
  status: PluginStatus;
  /** диагностика активации — сообщение исключения verbatim */
  error: string | null;
}

const PATCH_KEY = 'nexus.plugins.patch.v1';

interface Patch {
  disabled: string[];
  rows: Record<string, string[]>;
}

function readPatch(): Patch {
  try {
    const raw = globalThis.localStorage?.getItem(PATCH_KEY);
    if (raw == null) return { disabled: [], rows: {} };
    const p = JSON.parse(raw) as Partial<Patch>;
    return {
      disabled: Array.isArray(p.disabled) ? p.disabled.filter((x): x is string => typeof x === 'string') : [],
      rows: typeof p.rows === 'object' && p.rows != null ? p.rows as Record<string, string[]> : {},
    };
  } catch {
    return { disabled: [], rows: {} };
  }
}

function writePatch(patch: Patch): void {
  try {
    globalThis.localStorage?.setItem(PATCH_KEY, JSON.stringify(patch));
  } catch { /* приватный режим — патч живёт до конца сессии */ }
}

export class PluginHost {
  readonly runtime = new SlotRuntime();
  private defs = new Map<string, NeuPluginDef>();
  private states = new Map<string, PluginState>();
  private pluginDisposers = new Map<string, Set<() => void>>();
  private listeners = new Set<() => void>();
  private patch: Patch;

  constructor() {
    this.patch = typeof window === 'undefined' ? { disabled: [], rows: {} } : readPatch();
  }

  /** Слоты оболочки объявляются один раз до регистрации плагинов. */
  declareShellSlots(slots: readonly (readonly [string, SlotKind])[]): void {
    for (const [name, kind] of slots) this.runtime.declareSlot(name, kind, 'shell');
  }

  register(def: NeuPluginDef): void {
    if (this.defs.has(def.manifest.id)) {
      this.runtime.issues.push({ message: `плагин ${def.manifest.id}: повторная регистрация` });
      return;
    }
    this.defs.set(def.manifest.id, def);
    for (const row of def.rows) {
      if (this.runtime.slotKind(row.slot) == null) {
        // плагин объявляет свой слот или ошибку ловит contribute — тут
        // фиксируем заранее для диагностики.
        this.runtime.issues.push({ message: `плагин ${def.manifest.id}: слот «${row.slot}» не объявлен оболочкой` });
      }
    }
    this.states.set(def.manifest.id, { def, status: 'disabled', error: null });
  }

  /** Загрузка: activate под патчем; исключение → failed с verbatim. */
  load(id: string): void {
    const def = this.defs.get(id);
    if (def == null) return;
    if (this.states.get(id)?.status === 'active') return;
    if (this.isPluginDisabled(id)) {
      this.states.set(id, { def, status: 'disabled', error: null });
      this.emit();
      return;
    }
    const disposers = new Set<() => void>();
    this.pluginDisposers.set(id, disposers);
    const disabledRows = new Set(this.patch.rows[id] ?? []);
    const rowById = new Map(def.rows.map((r) => [r.rowId, r]));
    const ctx: PluginCtx = {
      pluginId: id,
      contribute: (rowId, value) => {
        const row = rowById.get(rowId);
        if (row == null) {
          this.runtime.issues.push({ message: `плагин ${id}: contribute без строки «${rowId}» в манифесте` });
          return;
        }
        if (disabledRows.has(rowId)) return;
        const dispose = this.runtime.contribute(row.slot, {
          pluginId: id,
          rowId,
          key: row.key,
          order: row.order,
          value,
        });
        disposers.add(dispose);
      },
      onDispose: (fn) => { disposers.add(fn); },
    };
    try {
      def.activate(ctx);
      this.states.set(id, { def, status: 'active', error: null });
    } catch (err) {
      for (const d of [...disposers]) d();
      disposers.clear();
      this.pluginDisposers.delete(id);
      this.runtime.unloadPlugin(id);
      this.states.set(id, {
        def,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
    this.emit();
  }

  unload(id: string): void {
    const disposers = this.pluginDisposers.get(id);
    if (disposers != null) {
      for (const d of [...disposers]) d();
      disposers.clear();
      this.pluginDisposers.delete(id);
    }
    this.runtime.unloadPlugin(id);
    const def = this.defs.get(id);
    if (def != null) {
      this.states.set(id, { def, status: 'disabled', error: null });
    }
    this.emit();
  }

  isPluginDisabled(id: string): boolean {
    return this.patch.disabled.includes(id);
  }

  isRowDisabled(id: string, rowId: string): boolean {
    return (this.patch.rows[id] ?? []).includes(rowId);
  }

  setPluginEnabled(id: string, enabled: boolean): void {
    const disabled = new Set(this.patch.disabled);
    if (enabled) disabled.delete(id); else disabled.add(id);
    this.patch = { ...this.patch, disabled: [...disabled] };
    writePatch(this.patch);
    if (enabled) this.load(id); else this.unload(id);
  }

  /** Переключение строки = переактивация плагина (строки — записи). */
  setRowEnabled(id: string, rowId: string, enabled: boolean): void {
    const rows = { ...this.patch.rows };
    const cur = new Set(rows[id] ?? []);
    if (enabled) cur.delete(rowId); else cur.add(rowId);
    rows[id] = [...cur];
    this.patch = { ...this.patch, rows };
    writePatch(this.patch);
    if (this.states.get(id)?.status === 'active') {
      this.unload(id);
      this.load(id);
    } else {
      this.emit();
    }
  }

  private pluginsCache: PluginState[] | null = null;

  /** Кэшированный снимок — стабилен до emit (useSyncExternalStore). */
  plugins(): PluginState[] {
    if (this.pluginsCache == null) this.pluginsCache = [...this.states.values()];
    return this.pluginsCache;
  }

  plugin(id: string): PluginState | null {
    return this.states.get(id) ?? null;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit(): void {
    this.pluginsCache = null;
    for (const fn of this.listeners) fn();
  }
}

/** Слоты оболочки по спеке п.2.2 — объявляет оболочка до плагинов. */
export const SHELL_SLOTS: readonly (readonly [string, SlotKind])[] = [
  ['shell.rail', 'list'],
  ['shell.leading', 'single'],
  ['shell.overlay', 'list'],
  ['home.widgets', 'keyed'],
  ['rightbar.tabs', 'keyed'],
  ['conversation.composer.dock', 'list'],
  ['conversation.header.corner', 'list'],
  ['settings.sections', 'list'],
  ['plugins.item', 'keyed'],
  ['plugins.bundle.config', 'keyed'],
  ['plugins.row.config', 'keyed'],
  ['command.palette', 'chain'],
];

export interface RightbarTabDef {
  title: string;
  /** компонент вкладки — без пропсов, seam'ы внутри */
  component: ComponentType;
}

export interface HomeWidgetDef {
  /** компонент блока; пропсы подставляет экран */
  component: ComponentType<Record<string, unknown>>;
}

let hostSingleton: PluginHost | null = null;
let builtinLoader: (() => readonly NeuPluginDef[]) | null = null;

/** Регистратор встроенных — назначается модулем builtin (импорт снизу
 *  дерева), чтобы ядро не тянуло экранные компоненты в свой чанк. */
export function setBuiltinPlugins(loader: () => readonly NeuPluginDef[]): void {
  builtinLoader = loader;
}

export function getPluginHost(): PluginHost {
  if (hostSingleton == null) {
    hostSingleton = new PluginHost();
    hostSingleton.declareShellSlots(SHELL_SLOTS);
    for (const def of builtinLoader?.() ?? []) {
      hostSingleton.register(def);
      hostSingleton.load(def.manifest.id);
    }
  }
  return hostSingleton;
}

/** Тестовый сброс: новый хост, пустой runtime. */
export function resetPluginHost(): void {
  hostSingleton = null;
}

/** Подписка на записи слота — стабильный снимок из кэша runtime. */
export function useSlot<T = unknown>(slot: string): Contribution<T>[] {
  const host = getPluginHost();
  return useSyncExternalStore(
    (fn) => host.runtime.subscribe(slot, fn),
    () => host.runtime.entries<T>(slot),
    () => host.runtime.entries<T>(slot),
  );
}

/** Одна запись keyed/single слота. */
export function useSlotEntry<T = unknown>(slot: string, key?: string): Contribution<T> | null {
  const host = getPluginHost();
  return useSyncExternalStore(
    (fn) => host.runtime.subscribe(slot, fn),
    () => host.runtime.entry<T>(slot, key),
    () => host.runtime.entry<T>(slot, key),
  );
}

/** Состояния плагинов (для экрана «Плагины» и диагностики). */
export function usePluginStates(): PluginState[] {
  const host = getPluginHost();
  return useSyncExternalStore(
    (fn) => host.subscribe(fn),
    () => host.plugins(),
    () => host.plugins(),
  );
}

export function useSlotDecls(): SlotDecl[] {
  const host = getPluginHost();
  return useSyncExternalStore(
    (fn) => host.subscribe(fn),
    () => host.runtime.declaredSlots(),
    () => host.runtime.declaredSlots(),
  );
}
