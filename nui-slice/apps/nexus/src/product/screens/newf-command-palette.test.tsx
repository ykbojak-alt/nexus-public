// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommandPalette, comboMatches, fuzzyMatch, type CommandPaletteHandle, type PaletteCommand } from './newf-command-palette';
import { detectAgent } from './newf-agent-badge';
import type { NewfBridge, TermSummary } from './newf-live';

afterEach(cleanup);

const TERMS: TermSummary[] = [
  { name: 't1', space: 'local', state: 'idle', lastLine: '❯ ls', lastActivityTs: 1 },
  { name: 't2', space: 'local', state: 'working', lastLine: 'devin>', lastActivityTs: 2 },
];

function bridge(): NewfBridge {
  return {
    spaces: async () => [],
    terminals: async () => [],
    agents: async () => [],
    screen: async () => '',
    send: async () => {},
    keys: async () => {},
    kill: vi.fn(async () => {}),
    runProgram: vi.fn(async () => ({ address: 'local/new' })),
  };
}

describe('fuzzyMatch (W49)', () => {
  it('подстрока по словам', () => {
    expect(fuzzyMatch('focus', 'Focus t1')).toBe(true);
    expect(fuzzyMatch('fo t1', 'Focus t1')).toBe(true);
    expect(fuzzyMatch('zzz', 'Focus t1')).toBe(false);
    expect(fuzzyMatch('', 'anything')).toBe(true);
  });
});

describe('CommandPalette (W49)', () => {
  it('открытие Ctrl+Shift+P, фильтр, Enter выполняет focus', async () => {
    const focus = vi.fn();
    render(<CommandPalette bridge={bridge()} terms={TERMS} onFocus={focus} />);
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'P', ctrlKey: true, shiftKey: true });
    await screen.findByTestId('command-palette');

    fireEvent.change(screen.getByTestId('palette-input'), { target: { value: 'focus t2' } });
    const item = await screen.findByTestId('palette-cmd-focus-t2');
    fireEvent.click(item);
    expect(focus).toHaveBeenCalledWith('t2');
    await waitFor(() => expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument());
  });

  it('kill — через bridge.kill', async () => {
    const b = bridge();
    render(<CommandPalette bridge={b} terms={TERMS} />);
    fireEvent.keyDown(window, { key: 'P', ctrlKey: true, shiftKey: true });
    fireEvent.change(screen.getByTestId('palette-input'), { target: { value: 'kill t1' } });
    fireEvent.click(await screen.findByTestId('palette-cmd-kill-t1'));
    await waitFor(() => expect(b.kill).toHaveBeenCalledWith('t1'));
  });
});

describe('W774: hidden commands', () => {
  const hiddenCmd: PaletteCommand = { id: 'hidden-do', label: 'Do hidden thing', action: vi.fn(), hidden: true };

  it('hidden не рендерится в списке, но исполняется через executeCommand', async () => {
    const ref = { current: null as CommandPaletteHandle | null };
    render(<CommandPalette ref={ref} bridge={bridge()} terms={TERMS} extraCommands={[hiddenCmd]} />);
    fireEvent.keyDown(window, { key: 'P', ctrlKey: true, shiftKey: true });
    await screen.findByTestId('command-palette');

    // hidden-команда отсутствует в DOM даже при пустом запросе
    expect(screen.queryByTestId('palette-cmd-hidden-do')).not.toBeInTheDocument();
    expect(screen.queryByText('Do hidden thing')).not.toBeInTheDocument();

    // явный выбор по id исполняет её
    expect(ref.current?.executeCommand('hidden-do')).toBe(true);
    expect(hiddenCmd.action).toHaveBeenCalledTimes(1);
    expect(ref.current?.executeCommand('no-such')).toBe(false);
  });

  it('hotkey hidden-команды срабатывает при закрытой палитре', () => {
    const action = vi.fn();
    render(<CommandPalette bridge={bridge()} terms={TERMS} extraCommands={[{ id: 'hk', label: 'Hotkeyed', action, hidden: true, hotkey: 'ctrl+shift+h' }]} />);
    fireEvent.keyDown(window, { key: 'h', ctrlKey: true, shiftKey: true });
    expect(action).toHaveBeenCalledTimes(1);
    // неполное совпадение модификаторов — не срабатывает
    fireEvent.keyDown(window, { key: 'h', ctrlKey: true, shiftKey: false });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('W778: hotkey срабатывает и по Meta (Cmd) — primary modifier', () => {
    const action = vi.fn();
    render(<CommandPalette bridge={bridge()} terms={TERMS} extraCommands={[{ id: 'hk', label: 'H', action, hotkey: 'ctrl+shift+h' }]} />);
    fireEvent.keyDown(window, { key: 'h', metaKey: true, shiftKey: true });
    expect(action).toHaveBeenCalledTimes(1);
    // meta без shift — не совпадает
    fireEvent.keyDown(window, { key: 'h', metaKey: true, shiftKey: false });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('comboMatches: ctrl+shift+h точное совпадение модификаторов', () => {
    const base = { key: 'h', altKey: false, metaKey: false } as const;
    expect(comboMatches({ ...base, ctrlKey: true, shiftKey: true } as KeyboardEvent, 'ctrl+shift+h')).toBe(true);
    expect(comboMatches({ ...base, ctrlKey: true, shiftKey: false } as KeyboardEvent, 'ctrl+shift+h')).toBe(false);
    expect(comboMatches({ ...base, ctrlKey: false, shiftKey: true } as KeyboardEvent, 'ctrl+shift+h')).toBe(false);
    expect(comboMatches({ key: 'Escape', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false } as KeyboardEvent, 'escape')).toBe(true);
  });
});

describe('W774: focus restore', () => {
  it('фокус возвращается на предыдущий элемент, если action не увёл фокус', async () => {
    const invoker = document.createElement('button');
    document.body.appendChild(invoker);
    invoker.focus();
    render(<CommandPalette bridge={bridge()} terms={TERMS} onFocus={vi.fn()} />);

    fireEvent.keyDown(window, { key: 'P', ctrlKey: true, shiftKey: true });
    await screen.findByTestId('command-palette');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(invoker);
    invoker.remove();
  });

  it('если action увёл фокус на терминал — фокус НЕ перехватывается обратно', async () => {
    const term = document.createElement('div');
    term.tabIndex = 0;
    document.body.appendChild(term);
    const invoker = document.createElement('button');
    document.body.appendChild(invoker);
    invoker.focus();

    const focus = vi.fn(() => term.focus());
    render(<CommandPalette bridge={bridge()} terms={TERMS} onFocus={focus} />);
    fireEvent.keyDown(window, { key: 'P', ctrlKey: true, shiftKey: true });
    await screen.findByTestId('command-palette');
    fireEvent.change(screen.getByTestId('palette-input'), { target: { value: 'focus t1' } });
    fireEvent.click(await screen.findByTestId('palette-cmd-focus-t1'));
    await waitFor(() => expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument());
    expect(focus).toHaveBeenCalledWith('t1');
    expect(document.activeElement).toBe(term);
    term.remove(); invoker.remove();
  });
});

describe('W774: rename/share реально работают', () => {
  it('rename вызывает bridge.renameTerminal и onRename после успеха', async () => {
    const b = { ...bridge(), renameTerminal: vi.fn(async () => ({ address: 'local/t1' })) };
    const onRename = vi.fn();
    vi.spyOn(window, 'prompt').mockReturnValue('new-name');
    render(<CommandPalette bridge={b} terms={TERMS} onRename={onRename} />);
    fireEvent.keyDown(window, { key: 'P', ctrlKey: true, shiftKey: true });
    fireEvent.change(screen.getByTestId('palette-input'), { target: { value: 'rename t1' } });
    fireEvent.click(await screen.findByTestId('palette-cmd-rename-t1'));
    await waitFor(() => expect(b.renameTerminal).toHaveBeenCalledWith('t1', 'new-name'));
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('t1', 'new-name'));
    vi.restoreAllMocks();
  });

  it('rename без bridge.renameTerminal — только локальный onRename', async () => {
    const onRename = vi.fn();
    vi.spyOn(window, 'prompt').mockReturnValue('alias');
    render(<CommandPalette bridge={bridge()} terms={TERMS} onRename={onRename} />);
    fireEvent.keyDown(window, { key: 'P', ctrlKey: true, shiftKey: true });
    fireEvent.change(screen.getByTestId('palette-input'), { target: { value: 'rename t1' } });
    fireEvent.click(await screen.findByTestId('palette-cmd-rename-t1'));
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('t1', 'alias'));
    vi.restoreAllMocks();
  });

  it('W778: renameTerminal reject → alert, onRename НЕ вызывается', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const b = { ...bridge(), renameTerminal: vi.fn(async () => { throw new Error('boom'); }) };
    const onRename = vi.fn();
    vi.spyOn(window, 'prompt').mockReturnValue('new-name');
    render(<CommandPalette bridge={b} terms={TERMS} onRename={onRename} />);
    fireEvent.keyDown(window, { key: 'P', ctrlKey: true, shiftKey: true });
    fireEvent.change(screen.getByTestId('palette-input'), { target: { value: 'rename t1' } });
    fireEvent.click(await screen.findByTestId('palette-cmd-rename-t1'));
    await waitFor(() => expect(b.renameTerminal).toHaveBeenCalledWith('t1', 'new-name'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('boom')));
    expect(onRename).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('share вызывает onShare (grid открывает ShareDialog с shareCreate)', async () => {
    const onShare = vi.fn();
    render(<CommandPalette bridge={bridge()} terms={TERMS} onShare={onShare} />);
    fireEvent.keyDown(window, { key: 'P', ctrlKey: true, shiftKey: true });
    fireEvent.change(screen.getByTestId('palette-input'), { target: { value: 'share t2' } });
    fireEvent.click(await screen.findByTestId('palette-cmd-share-t2'));
    expect(onShare).toHaveBeenCalledWith('t2');
  });
});

describe('detectAgent (W50/W63)', () => {
  it('devin по last_line-маркеру, codex по имени, pwsh по PS-промпту', () => {
    expect(detectAgent('t2', 'devin>')!.key).toBe('devin');
    expect(detectAgent('codex-1', '❯')!.key).toBe('codex');
    expect(detectAgent('t3', 'PS C:\\Users>')!.key).toBe('pwsh');
    expect(detectAgent('t1', '❯ ls')).not.toBeNull();
  });

  it('W63: пустой/generic промпт → null (не приписываем shell)', () => {
    expect(detectAgent('t1', '')).toBeNull();
    expect(detectAgent('t1', '   ')).toBeNull();
    expect(detectAgent('t1', 'non-prompt noise')).toBeNull();
    expect(detectAgent('t1', 'hello world')).toBeNull();
  });
});
