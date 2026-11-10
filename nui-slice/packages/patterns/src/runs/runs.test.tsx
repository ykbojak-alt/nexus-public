import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { runDetails, runStates } from '@nexus/mock-data';
import type { RunDetail } from '@nexus/mock-data';
import { RunDetailPanel } from './run-detail';

const doneDetail: RunDetail = {
  run: runStates.done,
  result: runDetails['run-1039'].result,
  events: runDetails['run-1039'].events,
};

describe('RunDetailPanel', () => {
  it('renders stored facts verbatim — ids, status vocab, stopReason', () => {
    render(<RunDetailPanel detail={doneDetail} />);
    const el = screen.getByTestId('run-detail');
    expect(el.dataset.state).toBe('ready');
    expect(screen.getByText('run-1039')).toBeTruthy();
    expect(screen.getByText('ЗАВЕРШЁН')).toBeTruthy(); // server vocab, uppercased label
    expect(screen.getByText('arch')).toBeTruthy();
    expect(screen.getByText('done', { selector: 'dd' })).toBeTruthy(); // stopReason verbatim
    expect(screen.getByText('$0.214')).toBeTruthy();
  });

  it('shows duration only from stored timestamps — never computed', () => {
    render(<RunDetailPanel detail={doneDetail} />);
    // 187s → '3 мин': appears in both run facts and result block — both stored values
    expect(screen.getAllByText('3 мин').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the persisted event log seq-ordered with role + body', () => {
    render(<RunDetailPanel detail={doneDetail} />);
    expect(screen.getByText('#3')).toBeTruthy();
    expect(screen.getByText(/tool_result · executor/)).toBeTruthy();
    expect(screen.getByText(/"commits":7/)).toBeTruthy();
  });

  it('renders result only when the source stored one', () => {
    const live: RunDetail = { run: runStates.running, result: null, events: runDetails['run-1042'].events };
    render(<RunDetailPanel detail={live} />);
    expect(screen.queryByText(/Результат/)).toBeNull();
    expect(screen.queryByTestId('run-evidence')).toBeNull();
    expect(screen.getByText(/Журнал событий/)).toBeTruthy();
  });

  it('provenance (W3-06): sections declare their source read; evidence badge mirrors verified', () => {
    render(<RunDetailPanel detail={doneDetail} />);
    expect(document.querySelector('[data-origin="run-meta"]')).toBeTruthy();
    expect(document.querySelector('[data-origin="run-result"]')).toBeTruthy();
    expect(document.querySelector('[data-origin="run-events"]')).toBeTruthy();
    // run-1039 stores verified=true → evidence badge says so verbatim.
    expect(screen.getByTestId('run-evidence').textContent).toContain('ПРОВЕРЕН');
  });

  it('evidence badge: unverified and unknown results are honest, not green', () => {
    const unverified: RunDetail = {
      run: runStates.done,
      result: { ...runDetails['run-1039'].result!, verified: false },
      events: [],
    };
    const { unmount } = render(<RunDetailPanel detail={unverified} />);
    expect(screen.getByTestId('run-evidence').textContent).toContain('НЕ ПРОВЕРЕН');
    unmount();
    render(<RunDetailPanel detail={{ ...unverified, result: { ...unverified.result!, verified: null } }} />);
    expect(screen.getByTestId('run-evidence').textContent).toContain('Н/Д');
  });

  it('offers cancel only for a live run and only via callback', () => {
    const onCancel = vi.fn();
    const live: RunDetail = { run: runStates.running, result: null, events: [] };
    const { unmount } = render(<RunDetailPanel detail={doneDetail} onCancel={onCancel} />);
    expect(screen.queryByText('Отменить прогон')).toBeNull(); // done run → no cancel
    unmount();
    render(<RunDetailPanel detail={live} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Отменить прогон'));
    expect(onCancel).toHaveBeenCalledWith('run-1042');
  });

  it('delegates parent navigation to onOpenRun callback', () => {
    const onOpenRun = vi.fn();
    const child: RunDetail = { run: runStates.cancelled, result: null, events: [] };
    render(<RunDetailPanel detail={child} onOpenRun={onOpenRun} />);
    fireEvent.click(screen.getByText('run-1020'));
    expect(onOpenRun).toHaveBeenCalledWith('run-1020');
  });

  it('states: loading / error / not-found are honest and distinct', () => {
    const r1 = render(<RunDetailPanel detail={null} state="loading" />);
    expect(screen.getByTestId('run-detail').dataset.state).toBe('loading');
    r1.unmount();
    const r2 = render(<RunDetailPanel detail={null} state="error" />);
    expect(screen.getByText('Не удалось загрузить прогон.')).toBeTruthy();
    r2.unmount();
    render(<RunDetailPanel detail={null} />);
    const el = screen.getByTestId('run-detail');
    expect(el.dataset.state).toBe('empty');
    expect(screen.getByText(/не найден/)).toBeTruthy();
  });

  it('plan projection (wave-6 п.7): plan.step журнала → ordered шаги, verbatim, без выдуманного прогресса', () => {
    const live: RunDetail = { run: runStates.running, result: null, events: runDetails['run-1042'].events };
    render(<RunDetailPanel detail={live} />);
    const plan = screen.getByTestId('run-plan');
    expect(plan.dataset.origin).toBe('run-plan');
    const items = plan.querySelectorAll('li');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('шаг 1');
    expect(items[0].textContent).toContain('Загрузить список суб-агентов прогона');
    expect(items[1].textContent).toContain('Построить карту зависимостей');
    // Никаких status-бейджей — outcome по шагу журнал не хранит.
    expect(plan.querySelectorAll('[data-testid="status-badge"], [class*="badge"]')).toHaveLength(0);
  });

  it('plan projection: журнал без plan.step → честная строка, не пустота', () => {
    render(<RunDetailPanel detail={doneDetail} />);
    expect(screen.queryByTestId('run-plan')).toBeNull();
    expect(screen.getByText('Шаги плана в журнале прогона не записаны.')).toBeTruthy();
  });

  it('control events: checkpoint/replay/pause считаются из журнала, не придумываются', () => {
    const withCp: RunDetail = {
      run: runStates.done,
      result: null,
      events: [
        ...runDetails['run-1039'].events,
        { seq: 6, type: 'checkpoint', role: 'supervisor', ts: runDetails['run-1039'].events[0].ts + 200, body: { id: 'cp-1' } },
        { seq: 7, type: 'replay', role: 'supervisor', ts: runDetails['run-1039'].events[0].ts + 260, body: {} },
      ],
    };
    const { unmount } = render(<RunDetailPanel detail={withCp} />);
    expect(screen.getByTestId('run-control-events').textContent).toContain(': 2');
    unmount();
    const bare: RunDetail = { run: runStates.done, result: null, events: runDetails['run-1039'].events };
    render(<RunDetailPanel detail={bare} />);
    expect(screen.getByTestId('run-control-events').textContent).toContain('не записаны');
  });

  it('fires onBack when provided', () => {
    const onBack = vi.fn();
    render(<RunDetailPanel detail={doneDetail} onBack={onBack} />);
    fireEvent.click(screen.getByText('← Назад'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
