// @vitest-environment jsdom
/**
 * Волна XVI — экран «Плагины»: встроенные из реестра хоста плагинов,
 * локальные из ds.neuPlugins (seam W1); без seam — честный unavailable.
 * Фикстуры помечены // FIXTURE — реальная форма ответа хоста.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NeuPluginInventory } from '../../integrations/ai2/contracts/neu-plugins';

const push = vi.fn();
let searchParams = new URLSearchParams('');
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/plugins',
  useSearchParams: () => searchParams,
}));

const neuList = vi.fn();
const neuSetEnabled = vi.fn();
const neuSetRow = vi.fn();
const sdkAudit = vi.fn();
let withSeam = true;
let withAudit = false;
// Stable sub-objects: hoisted so useAsyncValue deps ([neuPlugins]) see the
// same reference across renders; `withSeam`/`withAudit` toggles are read
// by `compute` at call time.
const _neuPlugins = { list: neuList, setEnabled: neuSetEnabled, setRowEnabled: neuSetRow };
vi.mock('../data-source', () => {
  const compute = () => ({
    ...(withSeam ? { neuPlugins: _neuPlugins } : {}),
    ...(withAudit ? { sdkAudit } : {}),
  });
  return {
    getDataSourceKind: () => 'mock',
    getDataSource: compute,
    useDataSource: compute,
  };
});

import { PluginsScreen } from './plugins-screen';
import { getPluginHost, resetPluginHost } from './plugin-host';

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  resetPluginHost();
  searchParams = new URLSearchParams('');
  neuList.mockReset();
  neuSetEnabled.mockReset();
  neuSetRow.mockReset();
  sdkAudit.mockReset();
  withSeam = true;
  withAudit = false;
});

describe('PluginsScreen — встроенные бандлы', () => {
  it('карточки встроенных из реестра: название, строки, переключатели', async () => {
    neuList.mockResolvedValue({ plugins: [], recovery: false, sources: [] });
    render(<PluginsScreen />);
    expect(screen.getByText('Блоки домашнего экрана')).toBeTruthy();
    expect(screen.getByText('Вкладки правой панели')).toBeTruthy();
    // FIXTURE: builtin карточка с переключателем (W2 PluginCard).
    const card = screen.getByText('Блоки домашнего экрана').closest('[data-testid="plugin-card"]')!;
    const sw = within(card as HTMLElement).getByRole('switch');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    await userEvent.click(sw);
    expect(getPluginHost().plugin('nexus.home-widgets')?.status).toBe('disabled');
    expect(screen.queryByText('Блоки домашнего экрана')).toBeTruthy(); // карточка остаётся
    // слот опустел — записей плагина нет
    expect(getPluginHost().runtime.entries('home.widgets')).toHaveLength(0);
  });

  it('переключатель строки снимает одну запись слота', async () => {
    neuList.mockResolvedValue({ plugins: [], recovery: false, sources: [] });
    render(<PluginsScreen />);
    await userEvent.click(screen.getByText(/Строки: 5/));
    const row = screen.getByText('Ход работы').closest('li')!;
    const sw = within(row as HTMLElement).getByRole('switch');
    await userEvent.click(sw);
    expect(getPluginHost().runtime.entry('home.widgets', 'workflow')).toBeNull();
    expect(getPluginHost().runtime.entry('home.widgets', 'orchestration')).not.toBeNull();
  });

  it('страница настроек ?plugin=id — манифест и строки verbatim', async () => {
    searchParams = new URLSearchParams('plugin=nexus.home-widgets');
    neuList.mockResolvedValue({ plugins: [], recovery: false, sources: [] });
    render(<PluginsScreen />);
    const detail = await screen.findByTestId('plugin-detail');
    expect(within(detail).getByText('nexus.home-widgets')).toBeTruthy();
    expect(within(detail).getByText('1.0.0')).toBeTruthy();
    expect(within(detail).getByText('чтение сессий')).toBeTruthy();
    expect(within(detail).getByText('home.widgets:orchestration')).toBeTruthy();
  });

  it('NQ-095: дети role=list — только listitem (карточки и состояния)', async () => {
    neuList.mockResolvedValue({ plugins: [], recovery: false, sources: [] });
    render(<PluginsScreen />);
    await screen.findByText('Блоки домашнего экрана');
    for (const list of screen.getAllByRole('list')) {
      for (const child of Array.from(list.children)) {
        expect(child.getAttribute('role')).toBe('listitem');
      }
    }
    // и карточки реально внутри listitem — axe aria-required-children чист
    const card = screen.getByText('Блоки домашнего экрана').closest('[data-testid="plugin-card"]')!;
    expect(card.closest('[role="listitem"]')).not.toBeNull();
  });

  it('источник builtin от W1 попадает в группу «Встроенные»', async () => {
    neuList.mockResolvedValue({
      recovery: false,
      sources: [{ source: 'builtin', path: 'D:/builtin' }],
      plugins: [{
        id: 'host.official', version: '1.0.0', title: 'Официальный модуль',
        description: null, icon: null, kind: 'builtin', status: 'active',
        enabled: true, overriddenBy: null, errors: null, permissions: null,
        contributes: null, rows: null, clientEntry: null, clientHash: null,
        hasHostEntry: false,
      }],
    });
    render(<PluginsScreen />);
    const group = screen.getAllByTestId('plugin-group')[0];
    expect(await within(group).findByText('Официальный модуль')).toBeTruthy();
  });
});

describe('PluginsScreen — локальные бандлы (seam W1)', () => {
  it('seam отсутствует → честный «нет данных», запросов нет', () => {
    withSeam = false;
    render(<PluginsScreen />);
    expect(screen.getByText(/источник не подключён к инвентарю плагинов хоста/)).toBeTruthy();
    expect(screen.getByTestId('plugin-inventory-state').getAttribute('data-state')).toBe('skipped');
    expect(neuList).not.toHaveBeenCalled();
  });

  it('состояние loading включено в listitem и явно помечено', () => {
    neuList.mockReturnValue(new Promise(() => {}));
    render(<PluginsScreen />);
    expect(screen.getByTestId('plugin-inventory-state').getAttribute('data-state')).toBe('loading');
    const list = screen.getAllByRole('list').find((item) => item.textContent?.includes('Читаю инвентарь'));
    expect(list?.firstElementChild?.getAttribute('role')).toBe('listitem');
  });

  it('404 от хоста → «Хост не ответил» + Повторить', async () => {
    neuList.mockRejectedValue(new Error('404 not_found'));
    render(<PluginsScreen />);
    await waitFor(() => expect(screen.getByText('Хост не ответил')).toBeTruthy());
    expect(screen.getByTestId('plugin-inventory-state').getAttribute('data-state')).toBe('failed');
    neuList.mockResolvedValue({ plugins: [], recovery: false, sources: [] });
    await userEvent.click(screen.getByText('Повторить'));
    await waitFor(() => expect(screen.getByText(/Локальных плагинов нет/)).toBeTruthy());
  });

  it('локальные строки: статус verbatim, переключатель пишет через seam', async () => {
    // FIXTURE: ответ /v1/neu/plugins живого хоста (форма контракта).
    const inv: NeuPluginInventory = {
      recovery: false,
      sources: [{ source: 'local', path: 'D:/plugins' }],
      plugins: [{
        id: 'local.weather', version: '0.2.0', title: 'Погода', description: 'Панель погоды',
        icon: null, kind: 'local', status: 'active', enabled: true, overriddenBy: null,
        errors: null, permissions: ['sessions.read'], contributes: { 'home.widgets': ['w'] },
        clientEntry: 'client.js', clientHash: 'sha256:abc', hasHostEntry: false,
        rows: [{ rowId: 'w', slot: 'home.widgets', title: null, enabled: true }],
      }],
    };
    neuList.mockResolvedValue(inv);
    neuSetEnabled.mockResolvedValue({ ...inv.plugins[0], enabled: false, status: 'disabled' });
    render(<PluginsScreen />);
    const card = (await screen.findByText('Погода')).closest('[data-testid="plugin-card"]')!;
    const sw = within(card as HTMLElement).getByRole('switch');
    await userEvent.click(sw);
    expect(neuSetEnabled).toHaveBeenCalledWith('local.weather', false);
  });

  it('recovery=true отображается как host state, не как пустой или недоступный список', async () => {
    neuList.mockResolvedValue({
      plugins: [{
        id: 'local.recovery-test', version: null, title: 'Отключённый хостом',
        description: null, icon: null, kind: 'local', status: 'disabled',
        enabled: false, overriddenBy: null, errors: null, permissions: null,
        contributes: null, rows: null, clientEntry: null, clientHash: null,
        hasHostEntry: false,
      }],
      recovery: true,
      sources: [],
    });
    render(<PluginsScreen />);
    const recovery = await screen.findByTestId('plugin-recovery-state');
    expect(recovery.getAttribute('data-state')).toBe('recovery');
    expect(recovery.textContent).toContain('Режим восстановления активен');
    expect(screen.getByTestId('plugin-inventory-state').getAttribute('data-state')).toBe('recovery');
  });

  it('skipped plugin status is visible to assistive technology in Russian', async () => {
    neuList.mockResolvedValue({
      plugins: [{
        id: 'local.skipped', version: null, title: 'Пропущенный модуль',
        description: null, icon: null, kind: 'local', status: 'skipped',
        enabled: false, overriddenBy: null, errors: null, permissions: null,
        contributes: null, rows: null, clientEntry: null, clientHash: null,
        hasHostEntry: false,
      }],
      recovery: false,
      sources: [],
    });
    render(<PluginsScreen />);
    const skipped = await screen.findByText('Хост пропустил загрузку этого плагина.');
    expect(skipped.getAttribute('data-state')).toBe('skipped');
    expect(skipped.getAttribute('role')).toBe('status');
  });

  it('переключатель строки локального бандла пишет в W1 seam', async () => {
    const plugin: NeuPluginInventory['plugins'][number] = {
      id: 'local.weather', version: '0.2.0', title: 'Погода', description: null,
      icon: null, kind: 'local', status: 'active', enabled: true, overriddenBy: null,
      errors: null, permissions: null, contributes: null, clientEntry: null,
      clientHash: null, hasHostEntry: false,
      rows: [{ rowId: 'w', slot: 'home.widgets', title: null, enabled: true }],
    };
    neuList.mockResolvedValue({ plugins: [plugin], recovery: false, sources: [] });
    neuSetRow.mockResolvedValue(plugin);
    render(<PluginsScreen />);
    const rowButton = await screen.findByRole('button', { name: /Строки: 1/ });
    await userEvent.click(rowButton);
    const row = screen.getByText('w').closest('li')!;
    await userEvent.click(within(row).getByRole('switch'));
    expect(neuSetRow).toHaveBeenCalledWith('local.weather', 'w', false);
  });

  it('settings keep sound and badge preferences; audit renders only real W1 entries', async () => {
    withAudit = true;
    sdkAudit.mockResolvedValue({
      entries: [{
        id: 'audit-1', ts: 1792345678, actor: 'local', runId: 'sdk-run-1',
        callId: 'install-1', tool: 'plugin_manager.install_bundle',
        decision: 'deny', reason: 'таймаут подтверждения',
        initiator: 'sdk-run-1', source: 'D:/incoming/plugin', sha256: 'sha256:abc',
      }],
      total: 1,
      limit: 100,
      offset: 0,
    });
    neuList.mockResolvedValue({ plugins: [], recovery: false, sources: [] });
    render(<PluginsScreen />);
    await waitFor(() => expect(screen.getByTestId('plugin-install-journal').getAttribute('data-state')).toBe('ready'));
    expect(screen.getByText(/Источник: D:\/incoming\/plugin/)).toBeTruthy();
    expect(screen.getByText(/Причина: таймаут подтверждения/)).toBeTruthy();

    const sound = screen.getByRole('switch', { name: 'Звук подтверждений установки' });
    await userEvent.click(sound);
    expect(sound.getAttribute('aria-checked')).toBe('true');
    expect(localStorage.getItem('nexus.plugin-install-notifications.v1')).toContain('"soundEnabled":true');
  });

  it('audit seam absent shows unavailable instead of an invented empty journal', () => {
    neuList.mockResolvedValue({ plugins: [], recovery: false, sources: [] });
    render(<PluginsScreen />);
    const journal = screen.getByTestId('plugin-install-journal');
    const state = within(journal).getByTestId('empty-state');
    expect(state.textContent).toContain('Журнал недоступен');
    expect(state.textContent).toContain('источник не подключил audit seam');
    expect(sdkAudit).not.toHaveBeenCalled();
  });
});
