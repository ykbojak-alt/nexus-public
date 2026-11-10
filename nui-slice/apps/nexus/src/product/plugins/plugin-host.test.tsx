// @vitest-environment jsdom
/**
 * Волна XVI — хост плагинов: регистрация, патч профиля, выгрузка без
 * утечек, переключатели бандла/строк. Фикстуры помечены // FIXTURE.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SlotRuntime } from './slot-runtime';
import {
  PluginHost, SHELL_SLOTS, getPluginHost, resetPluginHost,
  useSlotEntry, type NeuPluginDef,
} from './plugin-host';
import './builtin';

vi.mock('../data-source', () => ({
  getDataSourceKind: () => 'mock',
  getDataSource: () => ({}),
  useDataSource: () => ({}),
}));

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  resetPluginHost();
});

function makeDef(id: string, activate?: (ctx: Parameters<NeuPluginDef['activate']>[0]) => void): NeuPluginDef {
  return {
    manifest: { id, version: '1.0.0', title: `Плагин ${id}`, description: 'тестовый', icon: null, builtin: true, permissions: [] },
    rows: [
      { rowId: 'w1', slot: 'home.widgets', key: 'w1', title: 'Виджет 1' },
      { rowId: 'w2', slot: 'home.widgets', key: 'w2', title: 'Виджет 2' },
    ],
    activate: activate ?? ((ctx) => {
      ctx.contribute('w1', () => <div>w1</div>);
      ctx.contribute('w2', () => <div>w2</div>);
    }),
  };
}

function makeHost(): PluginHost {
  const host = new PluginHost();
  host.declareShellSlots(SHELL_SLOTS);
  return host;
}

describe('PluginHost — регистрация и патч', () => {
  it('load: записи плагина появляются в слоте; unload — уходят без остатка', () => {
    const host = makeHost();
    host.register(makeDef('p.a'));
    host.load('p.a');
    expect(host.runtime.pluginEntryCount('p.a')).toBe(2);
    expect(host.plugin('p.a')?.status).toBe('active');
    host.unload('p.a');
    expect(host.runtime.pluginEntryCount('p.a')).toBe(0);
    expect(host.plugin('p.a')?.status).toBe('disabled');
  });

  it('повторный load активного бандла не дублирует вклады', () => {
    const host = makeHost();
    host.register(makeDef('p.a'));
    host.load('p.a');
    host.load('p.a');
    expect(host.runtime.entries('home.widgets')).toHaveLength(2);
    expect(host.runtime.pluginEntryCount('p.a')).toBe(2);
  });

  it('исключение в activate → статус failed + диагностика verbatim', () => {
    const host = makeHost();
    host.register(makeDef('p.bad', () => { throw new Error('бум в регистрации'); }));
    host.load('p.bad');
    const st = host.plugin('p.bad');
    expect(st?.status).toBe('failed');
    expect(st?.error).toBe('бум в регистрации');
    expect(host.runtime.pluginEntryCount('p.bad')).toBe(0);
  });

  it('setPluginEnabled(false) пишет патч и выгружает; включение читает патч обратно', () => {
    const host = makeHost();
    host.register(makeDef('p.a'));
    host.load('p.a');
    host.setPluginEnabled('p.a', false);
    expect(host.plugin('p.a')?.status).toBe('disabled');
    expect(JSON.parse(localStorage.getItem('nexus.plugins.patch.v1')!).disabled).toContain('p.a');
    // новый хост (перезапуск страницы) — патч держит выключение
    const host2 = makeHost();
    host2.register(makeDef('p.a'));
    host2.load('p.a');
    expect(host2.plugin('p.a')?.status).toBe('disabled');
    expect(host2.runtime.pluginEntryCount('p.a')).toBe(0);
  });

  it('setRowEnabled снимает одну строку; бандл остаётся активным', () => {
    const host = makeHost();
    host.register(makeDef('p.a'));
    host.load('p.a');
    host.setRowEnabled('p.a', 'w1', false);
    expect(host.plugin('p.a')?.status).toBe('active');
    expect(host.runtime.entry('home.widgets', 'w1')).toBeNull();
    expect(host.runtime.entry('home.widgets', 'w2')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('nexus.plugins.patch.v1')!).rows['p.a']).toEqual(['w1']);
  });

  it('contribute строки вне манифеста → issues, записи нет', () => {
    const host = makeHost();
    host.register(makeDef('p.a', (ctx) => ctx.contribute('zzz', 1)));
    host.load('p.a');
    expect(host.runtime.issues.some((i) => i.message.includes('без строки'))).toBe(true);
  });

  it('contribute в необъявленный слот → issues и запись отклонена', () => {
    const host = makeHost();
    const base = makeDef('p.b', (ctx) => ctx.contribute('w1', 1));
    host.register({
      ...base,
      rows: [{ rowId: 'w1', slot: 'no.such.slot', key: 'x', title: '?' }],
    });
    host.load('p.b');
    expect(host.runtime.issues.some((i) => i.message.includes('не объявлен'))).toBe(true);
  });
});

describe('getPluginHost — встроенные бандлы', () => {
  it('singleton загружает встроенные плагины и объявляет слоты оболочки', () => {
    const host = getPluginHost();
    expect(host.runtime.slotKind('home.widgets')).toBe('keyed');
    expect(host.runtime.slotKind('rightbar.tabs')).toBe('keyed');
    expect(host.runtime.slotKind('command.palette')).toBe('chain');
    const ids = host.plugins().map((p) => p.def.manifest.id);
    expect(ids).toContain('nexus.home-widgets');
    expect(ids).toContain('nexus.rightbar-tabs');
    // записи реально в слотах
    expect(host.runtime.entries('home.widgets')).toHaveLength(5);
    expect(host.runtime.entries('rightbar.tabs')).toHaveLength(2);
  });

  it('useSlotEntry реагирует на переключение строки без перезагрузки', () => {
    function Probe() {
      const e = useSlotEntry('home.widgets', 'workflow');
      return <div data-testid="probe">{e == null ? 'пусто' : 'есть'}</div>;
    }
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('есть');
    const host = getPluginHost();
    act(() => { host.setRowEnabled('nexus.home-widgets', 'workflow', false); });
    expect(screen.getByTestId('probe').textContent).toBe('пусто');
    act(() => { host.setRowEnabled('nexus.home-widgets', 'workflow', true); });
    expect(screen.getByTestId('probe').textContent).toBe('есть');
  });
});
