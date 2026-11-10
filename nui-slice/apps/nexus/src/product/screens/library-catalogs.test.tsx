// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { useMemo } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/library',
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('../../integrations/ai2/desktop-bridge/adapter', () => ({
  getDesktopBridge: () => Promise.resolve(null),
  hasDesktopBridge: () => false,
}));

const listRuns = vi.fn();
const listAgents = vi.fn();
const listPresets = vi.fn();
const mcpList = vi.fn();
const mcpCall = vi.fn();
const rulesList = vi.fn();
const promptsList = vi.fn();
const promptsCreate = vi.fn();
const promptsUpdate = vi.fn();
const promptsRemove = vi.fn();
let mcpSeam: unknown;
let rulesSeam: unknown;
let promptsSeam: unknown;

const LIB_DS = () => ({
  listRuns, listAgents, listPresets,
  mcpServers: mcpSeam,
  sdkRules: rulesSeam,
  prompts: promptsSeam,
});
vi.mock('../data-source', () => ({
  getDataSourceKind: () => 'live',
  getDataSource: () => LIB_DS(),
  // #418 (wave #418-2): mount-gated hook; stable via useMemo so
  // useAsyncValue([ds]) deps don't refetch-loop in the test.
  useDataSource: () => useMemo(LIB_DS, []),
}));

import { FileViewerScreen } from './file-viewer';

afterEach(() => {
  cleanup();
  mcpSeam = undefined;
  rulesSeam = undefined;
  promptsSeam = undefined;
  for (const fn of [listRuns, listAgents, listPresets, mcpList, mcpCall,
    rulesList, promptsList, promptsCreate, promptsUpdate, promptsRemove]) {
    fn.mockReset();
  }
  listAgents.mockResolvedValue([]);
  listPresets.mockResolvedValue([]);
  listRuns.mockResolvedValue([]);
});

// ФИКСТУРЫ по контрактам draft: mcp-servers-contract.md,
// sdk-rules-contract.md, prompts-contract.md — поля verbatim.
const MCP_SERVER = {
  name: 'fs', transport: 'stdio', command: 'mcp-fs',
  args: ['--root', '/x'],
  tools: [{ name: 'read_file' }, { name: 'write_file' }],
  envKeys: ['MCP_TOKEN'],
  status: 'configured', error: null,
};
const RULE = {
  path: 'AGENTS.md', name: 'AGENTS.md', sizeBytes: 1234,
  mtimeMs: 1_792_160_000_000, source: 'agents-md',
};
const PROMPT_FILE = { name: 'analyst.md', path: 'analyst.md', id: null, source: 'file', updatedAt: null };
const PROMPT_SAVED = { name: 'разбор логов', path: null, id: 'p-3', source: 'saved', updatedAt: 1_792_160_000_000 };

describe('Library — MCP/правила/сценарии (XIV W3)', () => {
  it('seam отсутствует → честный unavailable по всем трём панелям', async () => {
    render(<FileViewerScreen />);
    await screen.findByTestId('runs-library');
    expect(screen.getByTestId('mcp-servers').getAttribute('data-state')).toBe('unavailable');
    expect(screen.getByTestId('sdk-rules').getAttribute('data-state')).toBe('unavailable');
    expect(screen.getByTestId('prompts-library').getAttribute('data-state')).toBe('unavailable');
  });

  it('MCP: сервер verbatim (transport/command/tools/envKeys), без env-значений', async () => {
    mcpSeam = { list: mcpList, call: mcpCall };
    rulesSeam = { list: rulesList };
    promptsSeam = { list: promptsList, create: promptsCreate, update: promptsUpdate, remove: promptsRemove };
    mcpList.mockResolvedValue({ configured: true, servers: [MCP_SERVER], error: null });
    rulesList.mockResolvedValue({ root: 'D:\\nexus', rules: [] });
    promptsList.mockResolvedValue([]);
    render(<FileViewerScreen />);
    const row = await screen.findByTestId('mcp-fs');
    expect(row.textContent).toContain('fs');
    expect(row.textContent).toContain('stdio');
    expect(row.textContent).toContain('mcp-fs --root /x');
    expect(row.textContent).toContain('инструментов: 2');
    expect(row.textContent).toContain('MCP_TOKEN');
    expect(row.textContent).not.toContain('=sk-');
    expect(row.textContent).toContain('настроен');
  });

  it('MCP: пустой каталог → честное «нет данных» (configured:false)', async () => {
    mcpSeam = { list: mcpList, call: mcpCall };
    rulesSeam = { list: rulesList };
    promptsSeam = { list: promptsList, create: promptsCreate, update: promptsUpdate, remove: promptsRemove };
    mcpList.mockResolvedValue({ configured: false, servers: [], error: null });
    rulesList.mockResolvedValue({ root: 'D:\\nexus', rules: [] });
    promptsList.mockResolvedValue([]);
    render(<FileViewerScreen />);
    const p = screen.getByTestId('mcp-servers');
    await waitFor(() => expect(p.getAttribute('data-state')).toBe('empty'));
    expect(p.textContent).toContain('AI2_MCP_CONFIG');
  });

  it('MCP call: первый POST → заявка awaiting_confirmation verbatim', async () => {
    mcpSeam = { list: mcpList, call: mcpCall };
    rulesSeam = { list: rulesList };
    promptsSeam = { list: promptsList, create: promptsCreate, update: promptsUpdate, remove: promptsRemove };
    mcpList.mockResolvedValue({ configured: true, servers: [MCP_SERVER], error: null });
    rulesList.mockResolvedValue({ root: 'D:\\nexus', rules: [] });
    promptsList.mockResolvedValue([]);
    mcpCall.mockResolvedValue({ status: 'awaiting_confirmation', requestId: 'req-55' });
    const user = userEvent.setup();
    render(<FileViewerScreen />);
    const row = await screen.findByTestId('mcp-fs');
    await user.click(within(row).getByRole('button', { name: 'Вызвать' }));
    await user.click(screen.getByRole('button', { name: 'Отправить заявку' }));
    await waitFor(() => expect(mcpCall).toHaveBeenCalledWith('fs', { tool: 'read_file', arguments: undefined }));
    const form = screen.getByTestId('mcp-call-form');
    const st = await within(form).findByRole('status');
    expect(st.textContent).toContain('req-55');
    expect(st.textContent).toContain('fs_requests');
  });

  it('правила: метаданные verbatim + каталог; содержимого нет', async () => {
    mcpSeam = { list: mcpList, call: mcpCall };
    rulesSeam = { list: rulesList };
    promptsSeam = { list: promptsList, create: promptsCreate, update: promptsUpdate, remove: promptsRemove };
    mcpList.mockResolvedValue({ configured: false, servers: [], error: null });
    rulesList.mockResolvedValue({ root: 'D:\\nexus', rules: [RULE] });
    promptsList.mockResolvedValue([]);
    render(<FileViewerScreen />);
    const p = screen.getByTestId('sdk-rules');
    await waitFor(() => expect(p.getAttribute('data-state')).toBe('ready'));
    expect(p.textContent).toContain('AGENTS.md');
    expect(p.textContent).toContain('agents-md');
    expect(p.textContent).toContain('1234 Б');
    expect(p.textContent).toContain('D:\\nexus');
  });

  it('промпты: file + saved verbatim; saved → Удалить вызывает remove', async () => {
    mcpSeam = { list: mcpList, call: mcpCall };
    rulesSeam = { list: rulesList };
    promptsSeam = { list: promptsList, create: promptsCreate, update: promptsUpdate, remove: promptsRemove };
    mcpList.mockResolvedValue({ configured: false, servers: [], error: null });
    rulesList.mockResolvedValue({ root: 'D:\\nexus', rules: [] });
    promptsList.mockResolvedValue([PROMPT_FILE, PROMPT_SAVED]);
    promptsRemove.mockResolvedValue({ id: 'p-3', deleted: true });
    const user = userEvent.setup();
    render(<FileViewerScreen />);
    const p = screen.getByTestId('prompts-library');
    await waitFor(() => expect(p.getAttribute('data-state')).toBe('ready'));
    expect(p.textContent).toContain('analyst.md');
    expect(p.textContent).toContain('разбор логов');
    expect(p.textContent).toContain('сценарий');
    await user.click(within(p).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(promptsRemove).toHaveBeenCalledWith('p-3'));
  });

  it('создать сценарий → create verbatim; 422 секрета → verbatim-ошибка', async () => {
    mcpSeam = { list: mcpList, call: mcpCall };
    rulesSeam = { list: rulesList };
    promptsSeam = { list: promptsList, create: promptsCreate, update: promptsUpdate, remove: promptsRemove };
    mcpList.mockResolvedValue({ configured: false, servers: [], error: null });
    rulesList.mockResolvedValue({ root: 'D:\\nexus', rules: [] });
    promptsList.mockResolvedValue([PROMPT_FILE]);
    promptsCreate
      .mockResolvedValueOnce({ id: 'p-9', title: 'дневной отчёт', body: 'собери', createdAt: 1, updatedAt: 1 })
      .mockRejectedValueOnce(new Error('422: текст похож на секрет (key/token/password) — не сохраняем'));
    const user = userEvent.setup();
    render(<FileViewerScreen />);
    const form = await screen.findByTestId('prompt-create-form');
    await user.type(within(form).getByLabelText('Название сценария'), 'дневной отчёт');
    await user.type(within(form).getByLabelText('Текст сценария'), 'собери');
    await user.click(within(form).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(promptsCreate).toHaveBeenCalledWith({ title: 'дневной отчёт', body: 'собери' }));
    // повтор с секретоподобным текстом → verbatim-ошибка хоста
    await user.type(within(form).getByLabelText('Название сценария'), 'x');
    await user.type(within(form).getByLabelText('Текст сценария'), 'API_KEY=sk-…');
    await user.click(within(form).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(form.textContent).toContain('не сохраняем'));
  });
});
