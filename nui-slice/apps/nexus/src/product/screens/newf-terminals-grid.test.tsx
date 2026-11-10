// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TerminalsGrid } from './newf-terminals-grid';
import type { NewfBridge, TermSummary } from './newf-live';

afterEach(cleanup);

const SUMMARY: TermSummary[] = [
  { name: 't1', space: 'local', state: 'working', lastLine: 'Planning…', lastActivityTs: 1000 },
  { name: 't2', space: 'local', state: 'idle', lastLine: '', lastActivityTs: 2000 },
];

function bridge(): NewfBridge {
  return {
    spaces: async () => [],
    terminals: async () => [],
    agents: async () => [],
    screen: async () => '',
    send: async () => {},
    keys: async () => {},
    terminalsSummary: vi.fn(async () => ({ count: SUMMARY.length, terminals: SUMMARY })),
    shareCreate: vi.fn(async () => ({
      token: 'tok', term: 't2', scopes: ['screen'], expiresAt: 1, viewUrl: '/view/tok/screen',
    })),
    cloneTerminal: vi.fn(async () => ({ address: 'local/t2-clone' })),
  };
}

describe('TerminalsGrid (W35)', () => {
  it('summary-поллинг: карточки (name/space/state/line) без screen (idle)', async () => {
    const b = bridge();
    const screenSpy = vi.fn(async () => 'screen-body');
    b.screen = screenSpy;
    b.terminalsSummary = async () => ({
      count: 1,
      terminals: [
        { name: 't2', space: 'local', state: 'idle', lastLine: '', lastActivityTs: 2000 },
      ],
    });
    render(<TerminalsGrid bridge={b} pollMs={50} />);

    await screen.findByTestId('term-card-0');
    expect(screen.getByTestId('terms-count')).toHaveTextContent('1');
    expect(screen.getByTestId('term-card-0')).toHaveTextContent('t2');
    expect(screen.getByTestId('term-card-0')).toHaveTextContent('local');
    expect(screen.getByTestId('term-card-0')).toHaveTextContent('idle');
    expect(screen.getByTestId('term-line-0')).toHaveTextContent('—');
    expect(screen.getByTestId('term-card-toggle-0')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('term-screen-0')).not.toBeInTheDocument(); // тяжёлый screen НЕ грузится
    expect(screenSpy).not.toHaveBeenCalled();
  });

  it('рабочий терминал (autoExpandWorking) раскрыт: screen грузится', async () => {
    const b = bridge();
    b.screen = vi.fn(async () => 'screen-body');
    render(<TerminalsGrid bridge={b} pollMs={50} />);

    await screen.findByTestId('term-card-0'); // t1 working
    expect(screen.getByTestId('term-card-toggle-0')).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByTestId('term-screenbody-t1')).toHaveTextContent('screen-body');
  });

  it('клик по неактивной карточке раскрывает screen; повторный клик сворачивает', async () => {
    const b = bridge();
    b.screen = vi.fn(async () => 't2-screen');
    render(<TerminalsGrid bridge={b} pollMs={50} />);

    await screen.findByTestId('term-card-1'); // t2 idle — свёрнут
    expect(screen.getByTestId('term-card-toggle-1')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('term-screen-1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('term-card-toggle-1'));
    expect(await screen.findByTestId('term-screenbody-t2')).toHaveTextContent('t2-screen');

    fireEvent.click(screen.getByTestId('term-card-toggle-1'));
    await waitFor(() => expect(screen.queryByTestId('term-screen-1')).not.toBeInTheDocument());
  });

  it('нет terminalsSummary → честный маркер', async () => {
    const b = bridge();
    delete b.terminalsSummary;
    render(<TerminalsGrid bridge={b} pollMs={50} />);
    expect(screen.getByTestId('terms-grid')).toBeInTheDocument();
    expect(screen.getByText('terminalsSummary отсутствует')).toBeInTheDocument();
  });

  it('W39: ⌨ открывает мини-дроер с последними вводами (ts/text/enter)', async () => {
    const b = bridge();
    b.inputLog = vi.fn(async (_term, limit) => ({
      term: 't2',
      entries: [
        { ts: 1000, text: 'ls', enter: true },
        { ts: 1001, text: '', enter: true },
      ],
      count: 2,
    }));
    render(<TerminalsGrid bridge={b} pollMs={50} />);

    await screen.findByTestId('term-card-1');
    fireEvent.click(screen.getByTestId('inputlog-toggle-t2'));
    expect(b.inputLog).toHaveBeenCalledWith('t2', 50);
    await screen.findByTestId('inputlog-popover-t2');
    expect(screen.getByTestId('inputlog-entry-t2-0')).toHaveTextContent('ls');
    expect(screen.getByTestId('inputlog-entry-t2-0')).toHaveTextContent('↵');
    expect(screen.getByTestId('inputlog-entry-t2-1')).toBeInTheDocument();
  });

  it('W39: ошибка input-log → честная плашка в дроере', async () => {
    const b = bridge();
    b.inputLog = vi.fn().mockRejectedValue(new Error('bridge 404: terminal not found'));
    render(<TerminalsGrid bridge={b} pollMs={50} />);

    await screen.findByTestId('term-card-1');
    fireEvent.click(screen.getByTestId('inputlog-toggle-t2'));
    await waitFor(() => expect(screen.getByText(/404/)).toBeInTheDocument());
  });

  it('W40: правый клик на summaryRow открывает ctx-menu; действия (clone/kill) работают', async () => {
    const b = bridge();
    render(<TerminalsGrid bridge={b} pollMs={50} />);

    const row = await screen.findByTestId('term-card-1');
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    expect(await screen.findByTestId('ctx-menu')).toBeInTheDocument();
    expect(screen.getByTestId('ctx-clone')).toBeInTheDocument();
    expect(screen.getByTestId('ctx-close')).toBeInTheDocument();
    expect(screen.getByTestId('ctx-share')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('ctx-clone'));
    await waitFor(() => expect(b.cloneTerminal).toHaveBeenCalledWith('t2'));
    await waitFor(() => expect(screen.queryByTestId('ctx-menu')).not.toBeInTheDocument());
  });

  it('W41: Enter в input-поле → sendLine(term, text); raw-тоггл → sendRaw', async () => {
    const b = bridge();
    b.sendLine = vi.fn(async () => {});
    b.sendRaw = vi.fn(async () => {});
    render(<TerminalsGrid bridge={b} pollMs={50} />);

    // раскрыть t2 (idle)
    await screen.findByTestId('term-card-1');
    fireEvent.click(screen.getByTestId('term-card-toggle-1'));

    const input = await screen.findByTestId('inputline-t2');
    fireEvent.change(input, { target: { value: 'ls -la' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(b.sendLine).toHaveBeenCalledWith('t2', 'ls -la'));
    expect((input as HTMLInputElement).value).toBe('');

    fireEvent.click(screen.getByTestId('inputline-raw-t2'));
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(b.sendRaw).toHaveBeenCalledWith('t2', 'x'));
  });

  it('W41: ошибка отправки → плашка в input-line', async () => {
    const b = bridge();
    b.sendLine = vi.fn().mockRejectedValue(new Error('bridge 403: denied'));
    render(<TerminalsGrid bridge={b} pollMs={50} />);

    await screen.findByTestId('term-card-1');
    fireEvent.click(screen.getByTestId('term-card-toggle-1'));
    const input = await screen.findByTestId('inputline-t2');
    fireEvent.change(input, { target: { value: 'boom' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('inputline-error-t2')).toHaveTextContent(/403/));
  });

  it('W43: expanded-карточка = рамочное окно (titlebar/status/контролы)', async () => {
    const b = bridge();
    render(<TerminalsGrid bridge={b} pollMs={50} />);

    await screen.findByTestId('term-card-1');
    fireEvent.click(screen.getByTestId('term-card-toggle-1'));

    await screen.findByTestId('term-frame-t2');
    expect(screen.getByTestId('term-frame-title-t2')).toHaveTextContent('t2');
    // W76: idle → по спеке статус-глиф отсутствует (пустой .termState)
    const stateEl = screen.getByTestId('term-frame-state-t2');
    expect(stateEl).toHaveAttribute('data-state', 'idle');
    expect(stateEl).toBeEmptyDOMElement();
    expect(screen.getByTestId('term-frame-close-t2')).toBeInTheDocument();
    expect(screen.getByTestId('term-frame-max-t2')).toBeInTheDocument();

    // close → схлопывает окно
    fireEvent.click(screen.getByTestId('term-frame-close-t2'));
    await waitFor(() => expect(screen.queryByTestId('term-frame-t2')).not.toBeInTheDocument());
  });

  it('W76: статус-глифы по спеке — spinner / Needs you / dot / idle-пусто', async () => {
    const b = bridge();
    b.terminalsSummary = async () => ({
      count: 4,
      terminals: [
        { name: 'tw', space: 'local', state: 'working', lastLine: '', lastActivityTs: 1 },
        { name: 'tb', space: 'local', state: 'blocked', lastLine: '', lastActivityTs: 1 },
        { name: 'td', space: 'local', state: 'done', lastLine: '', lastActivityTs: 1 },
        { name: 'ti', space: 'local', state: 'idle', lastLine: '', lastActivityTs: 1 },
      ],
    });
    render(<TerminalsGrid bridge={b} pollMs={50} />);

    await screen.findByTestId('grid-expand-all');
    fireEvent.click(screen.getByTestId('grid-expand-all'));
    await screen.findByTestId('term-frame-tb');

    expect(screen.getByTestId('term-frame-state-tw')).toHaveAttribute('data-state', 'working');
    expect(screen.getByLabelText('working')).toBeInTheDocument();       // spinner 12px
    expect(screen.getByText('Needs you')).toBeInTheDocument();          // blocked pill
    expect(screen.getByLabelText('done')).toBeInTheDocument();          // dot 7px
    expect(screen.getByTestId('term-frame-state-ti')).toBeEmptyDOMElement(); // idle → ничего
  });

  it('W778: сквозной palette → ShareDialog → shareCreate → ссылка', async () => {
    const b = bridge();
    render(<TerminalsGrid bridge={b} pollMs={50} />);

    await screen.findByTestId('term-card-0');
    fireEvent.keyDown(window, { key: 'P', ctrlKey: true, shiftKey: true });
    fireEvent.change(await screen.findByTestId('palette-input'), { target: { value: 'share t2' } });
    fireEvent.click(await screen.findByTestId('palette-cmd-share-t2'));

    // Share из палитры открывает реальный диалог, не просто выбор карточки
    const dialog = await screen.findByTestId('share-dialog');
    expect(dialog).toHaveTextContent('t2');
    fireEvent.click(screen.getByTestId('share-create'));

    await waitFor(() => expect(b.shareCreate).toHaveBeenCalledWith(
      't2', expect.objectContaining({ scopes: ['screen'] }),
    ));
    await screen.findByTestId('share-url'); // созданная ссылка показана
  });

  it('W47: ctrl+click → multi-select; batch-бар → kill по выбранным', async () => {
    const b = bridge();
    b.kill = vi.fn(async () => {});
    render(<TerminalsGrid bridge={b} pollMs={50} />);

    const c0 = await screen.findByTestId('term-card-toggle-0');
    const c1 = screen.getByTestId('term-card-toggle-1');
    fireEvent.click(c0, { ctrlKey: true });
    fireEvent.click(c1, { ctrlKey: true });

    const bar = await screen.findByTestId('grid-batch-bar');
    expect(screen.getByTestId('grid-batch-count')).toHaveTextContent('2 selected');
    fireEvent.click(screen.getByTestId('grid-batch-kill'));
    await waitFor(() => expect(b.kill).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('grid-batch-bar')).not.toBeInTheDocument());
  });

  it('W50/W51: TermFrame — agent-badge + machine-chip + live/poll индикатор', async () => {
    const b = bridge();
    b.terminalsSummary = async () => ({
      count: 1,
      terminals: [{ name: 't2', space: 'remote-host', state: 'working', lastLine: 'devin>', lastActivityTs: 2 }],
    });
    render(<TerminalsGrid bridge={b} pollMs={50} />);

    await screen.findByTestId('term-frame-t2'); // autoExpandWorking
    expect(screen.getByTestId('term-agent-t2')).toHaveTextContent('Devin');
    expect(screen.getByTestId('term-frame-machine-t2')).toHaveTextContent('remote-host');
    expect(screen.getByTestId('term-frame-live-t2')).toBeInTheDocument();
  });

  it('W53: expand-all/collapse-all + счётчик working', async () => {
    const b = bridge();
    b.terminalsSummary = async () => ({
      count: 2,
      terminals: [
        { name: 't1', space: 'local', state: 'idle', lastLine: '', lastActivityTs: 1 },
        { name: 't2', space: 'local', state: 'working', lastLine: '', lastActivityTs: 2 },
      ],
    });
    render(<TerminalsGrid bridge={b} pollMs={50} />);

    await screen.findByTestId('term-card-0');
    expect(screen.getByTestId('working-count')).toHaveTextContent('1');
    // t2 раскрыт авт., t1 — нет
    expect(screen.queryByTestId('term-frame-t1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('grid-expand-all'));
    await screen.findByTestId('term-frame-t1');
    fireEvent.click(screen.getByTestId('grid-collapse-all'));
    await waitFor(() => expect(screen.queryByTestId('term-frame-t1')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByTestId('term-frame-t2')).not.toBeInTheDocument());
  });

  it('W67: pin на TermFrame — всегda поверх (data-pinned) и aria-pressed', async () => {
    const b = bridge();
    b.terminalsSummary = async () => ({
      count: 1,
      terminals: [{ name: 't9', space: 'local', state: 'working', lastLine: '', lastActivityTs: 1 }],
    });
    render(<TerminalsGrid bridge={b} pollMs={50} />);

    const frame = await screen.findByTestId('term-frame-t9');
    expect(frame).not.toHaveAttribute('data-pinned');
    fireEvent.click(screen.getByTestId('term-frame-pin-t9'));
    expect(frame).toHaveAttribute('data-pinned', 'true');
    expect(screen.getByTestId('term-frame-pin-t9')).toHaveAttribute('aria-pressed', 'true');
  });
});
