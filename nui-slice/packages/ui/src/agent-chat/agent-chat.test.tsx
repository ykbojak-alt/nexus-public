import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AgentComposer, DiffReviewCard, CheckpointMarker, UsageMeter,
  FileMention, AttachmentList, ToolConfirmationCard, StreamText, SessionRow,
  ToolCallCard, DelegationTree,
} from '../index';

/* FIXTURE — все данные ниже синтетические тестовые, не из рантайма. */
const FX = {
  modes: ['agent', 'ask', 'plan'] as const,
  models: [
    { value: 'nexus-large', label: 'Nexus Large' },
    { value: 'nexus-fast', label: 'Nexus Fast' },
  ],
  files: [
    { path: 'src/auth/login.ts', additions: 42, deletions: 7, state: 'pending' as const },
    { path: 'src/auth/session.ts', additions: 3, deletions: 18, state: 'accepted' as const },
    { path: 'README.md', additions: 10, deletions: 0, state: 'pending' as const },
  ],
  attachments: [
    { id: 'a1', name: 'screenshot.png', kind: 'image', meta: '120 КБ' },
    { id: 'a2', name: 'trace.log', kind: 'file', meta: '8 КБ' },
  ],
  calls: [
    { callId: 'call-root', name: 'run_agent', input: { task: 'проверить файлы' }, status: 'running' as const },
    { callId: 'call-child', parentCallId: 'call-root', name: 'read_file', durationMs: 240, status: 'done' as const },
    { callId: 'call-error', name: 'apply_patch', status: 'error' as const },
  ],
  delegations: [
    { id: 'run-root', parentCallId: null, label: 'Проверить изменения', agent: 'AGENT-A', state: 'running', durationMs: 840 },
    { id: 'run-child', parentCallId: 'run-root', label: 'Проверить типы', agent: 'M.E.C.H.', state: 'answered', durationMs: 1200, summary: 'Типы согласованы.' },
    { id: 'run-orphan', parentCallId: 'run-missing', label: 'Потерянная связь', agent: null, state: null, durationMs: null },
  ],
};

describe('AgentComposer', () => {
  it('mode is a radiogroup; switching calls back without submitting', async () => {
    const onMode = vi.fn(); const onSubmit = vi.fn();
    render(<AgentComposer value="тест" onChange={() => {}} onSubmit={onSubmit}
      inputLabel="Сообщение агенту" mode="agent" onModeChange={onMode} models={FX.models} model="nexus-large" />);
    const group = screen.getByRole('radiogroup', { name: 'Режим агента' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(within(group).getByRole('radio', { name: 'АГЕНТ' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(within(group).getByRole('radio', { name: 'ПЛАН' }));
    expect(onMode).toHaveBeenCalledWith('plan');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders model options verbatim; empty models show «нет данных», none hides picker', () => {
    const { rerender } = render(<AgentComposer value="" onChange={() => {}} onSubmit={() => {}}
      inputLabel="x" mode="ask" onModeChange={() => {}} models={FX.models} model="nexus-fast" />);
    const sel = screen.getByRole('combobox', { name: 'Модель' });
    expect(within(sel).getAllByRole('option').map((o) => o.textContent)).toEqual(['Nexus Large', 'Nexus Fast']);
    rerender(<AgentComposer value="" onChange={() => {}} onSubmit={() => {}}
      inputLabel="x" mode="ask" onModeChange={() => {}} models={[]} />);
    expect(screen.getByText('Модель: нет данных')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('Enter submits non-empty input; pending blocks it', async () => {
    const onSubmit = vi.fn();
    render(<AgentComposer value="сделай" onChange={() => {}} onSubmit={onSubmit}
      inputLabel="x" mode="agent" onModeChange={() => {}} />);
    await userEvent.type(screen.getByLabelText('x'), '{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const pending = render(<AgentComposer value="сделай" onChange={() => {}} onSubmit={onSubmit}
      inputLabel="y" mode="agent" onModeChange={() => {}} pending />);
    expect(within(pending.container).getByRole('button', { name: 'Отправить' })).toBeDisabled();
  });
});

describe('DiffReviewCard', () => {
  it('sums real +/− counters and lists every file', () => {
    render(<DiffReviewCard files={FX.files} />);
    expect(screen.getByText('Изменённые файлы')).toBeInTheDocument();
    expect(screen.getByText('+55')).toBeInTheDocument();
    expect(screen.getByText('−25')).toBeInTheDocument();
    expect(screen.getAllByTestId('file-diff-row')).toHaveLength(3);
  });

  it('empty list renders the honest empty label, no invented counts', () => {
    render(<DiffReviewCard files={[]} emptyLabel="Изменений нет" />);
    expect(screen.getByText('Изменений нет')).toBeInTheDocument();
    expect(screen.queryByText('+0')).not.toBeInTheDocument();
  });

  it('missing file counters stay «нет данных», never become zero', () => {
    render(<DiffReviewCard files={[{ path: 'src/unknown.ts', additions: null, deletions: 3 }]} />);
    expect(screen.getByText('Добавления: нет данных')).toBeInTheDocument();
    expect(screen.getAllByText('−3')).toHaveLength(2);
    expect(screen.queryByText('+0')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Изменённые файлы' })).toBeInTheDocument();
  });

  it('FileDiffRow labels actions and unknown counts in Russian', async () => {
    const onAccept = vi.fn();
    render(<DiffReviewCard files={[{ path: 'src/one.ts', onAccept }]} />);
    const row = screen.getByTestId('file-diff-row');
    expect(within(row).getByLabelText('Добавлено строк: нет данных; Удалено строк: нет данных')).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Принять' }));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['pending', 'Ожидает проверки', true],
    ['accepted', 'Принято', true],
    ['rejected', 'Отклонено', false],
    ['restored', 'Восстановлено', false],
  ] as const)('maps file state %s to its Russian status and available actions', (state, label, hasAction) => {
    render(<DiffReviewCard files={[{
      path: 'src/state.ts', additions: 1, deletions: 1, state,
      onAccept: () => {}, onReject: () => {}, onRestore: () => {},
    }]} />);
    const row = screen.getByTestId('file-diff-row');
    expect(row).toHaveAttribute('data-state', state);
    expect(within(row).getByText(label)).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Принять' }) != null ||
      within(row).queryByRole('button', { name: 'Восстановить' }) != null).toBe(hasAction);
  });
});

describe('CheckpointMarker', () => {
  it('ready state offers rewind with verbatim id', async () => {
    const onRewind = vi.fn();
    render(<CheckpointMarker checkpointId="ckp_041" onRewind={onRewind} />);
    expect(screen.getByText('ckp_041')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Откатить к чекпоинту ckp_041/ }));
    expect(onRewind).toHaveBeenCalledTimes(1);
  });

  it('restoring disables; unavailable/restored replace the button honestly', () => {
    const { rerender } = render(<CheckpointMarker checkpointId="c1" state="restoring" onRewind={() => {}} />);
    expect(screen.getByRole('button')).toBeDisabled();
    rerender(<CheckpointMarker checkpointId="c1" state="unavailable" onRewind={() => {}} />);
    expect(screen.getByText('откат недоступен')).toBeInTheDocument();
    rerender(<CheckpointMarker checkpointId="c1" state="restored" onRewind={() => {}} />);
    expect(screen.getByText('восстановлено')).toBeInTheDocument();
  });
});

describe('UsageMeter', () => {
  it('renders real numbers; meter reflects the context fraction', () => {
    render(<UsageMeter tokens={18450} costUsd={0.0312} contextUsed={96000} contextTotal={128000} />);
    expect(screen.getByText(/18\s?450/)).toBeInTheDocument();
    expect(screen.getByText('$0.0312')).toBeInTheDocument();
    const meter = screen.getByRole('meter', { name: 'Заполнение контекста' });
    expect(meter).toHaveAttribute('aria-valuenow', '75');
  });

  it('nulls render «нет данных» and no meter — never zero, never invented', () => {
    render(<UsageMeter tokens={null} costUsd={null} contextUsed={null} contextTotal={null} />);
    expect(screen.getAllByText('нет данных')).toHaveLength(3);
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('uses warning/error tones only at the supplied real context thresholds', () => {
    const { rerender } = render(<UsageMeter contextUsed={75} contextTotal={100} />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '75');
    expect(screen.getByRole('meter').querySelector('[data-tone]')).toHaveAttribute('data-tone', 'warn');
    rerender(<UsageMeter contextUsed={95} contextTotal={100} />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '95');
    expect(screen.getByRole('meter').querySelector('[data-tone]')).toHaveAttribute('data-tone', 'error');
    rerender(<UsageMeter contextUsed={10} contextTotal={100} />);
    expect(screen.getByRole('meter').querySelector('div')).not.toHaveAttribute('data-tone');
  });
});

describe('FileMention', () => {
  it('renders verbatim #path; clickable only with onOpen', async () => {
    const onOpen = vi.fn();
    render(<FileMention path="src/ai/router.ts" onOpen={onOpen} />);
    const btn = screen.getByRole('button', { name: 'Открыть файл src/ai/router.ts' });
    expect(btn).toHaveTextContent('#src/ai/router.ts');
    await userEvent.click(btn);
    expect(onOpen).toHaveBeenCalledTimes(1);
    render(<FileMention path="static.txt" />);
    expect(screen.getAllByTestId('file-mention')[1].tagName).toBe('SPAN');
  });
});

describe('AttachmentList', () => {
  it('lists names verbatim; remove calls back with the item id', async () => {
    const onRemove = vi.fn();
    render(<AttachmentList items={FX.attachments} onRemove={onRemove} />);
    expect(screen.getByText('screenshot.png')).toBeInTheDocument();
    expect(screen.getByText('trace.log')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Снять вложение trace.log' }));
    expect(onRemove).toHaveBeenCalledWith('a2');
  });

  it('empty list renders nothing (composer shows no dead row)', () => {
    const { container } = render(<AttachmentList items={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('ToolConfirmationCard', () => {
  it('awaiting actions are keyboard operable and call distinct handlers', async () => {
    const onAllow = vi.fn(); const onDeny = vi.fn();
    render(<ToolConfirmationCard toolName="runVscodeCommand" input={{ command: 'pnpm test' }}
      status="awaiting" onAllow={onAllow} onDeny={onDeny} />);
    const allow = screen.getByRole('button', { name: 'Разрешить' });
    allow.focus();
    await userEvent.keyboard('{Enter}');
    expect(onAllow).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Отклонить' }));
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it('maps deferred/allow/deny to Russian status announcements without actions', () => {
    const { rerender } = render(<ToolConfirmationCard toolName="applyPatch" status="deferred" />);
    expect(screen.getByRole('status')).toHaveTextContent('Отложено');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(<ToolConfirmationCard toolName="applyPatch" status="allow" />);
    expect(screen.getByRole('status')).toHaveTextContent('Разрешено');
    rerender(<ToolConfirmationCard toolName="applyPatch" status="deny" />);
    expect(screen.getByRole('status')).toHaveTextContent('Отклонено');
  });

  it('masks secrets, preserves timeout state and disables unwired actions', () => {
    render(<ToolConfirmationCard toolName="applyPatch"
      input={{ file: 'a.ts', api_key: 'sk-live-secret' }} status="allowed" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/sk-live-secret/)).not.toBeInTheDocument();
    const second = render(<ToolConfirmationCard toolName="readFile" status="timeout" />);
    expect(within(second.container).getByTestId('tool-confirmation-card')).toHaveAttribute('data-status', 'timeout');
    expect(within(second.container).getByRole('status')).toHaveTextContent('Время истекло');
    const pending = render(<ToolConfirmationCard toolName="readFile" status="awaiting" />);
    expect(within(pending.container).getByRole('button', { name: 'Разрешить' })).toBeDisabled();
    expect(within(pending.container).getByRole('button', { name: 'Отклонить' })).toBeDisabled();
  });
});

describe('ToolCallCard (agent run timeline)', () => {
  it('exposes running/ok/error and reveals parentCallId children with keyboard', async () => {
    render(<ToolCallCard call={FX.calls[0]} calls={FX.calls.slice(1)} />);
    const root = screen.getByRole('button', { name: /run_agent/ });
    expect(root).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('ВЫПОЛНЯЕТСЯ')).toBeInTheDocument();
    root.focus();
    await userEvent.keyboard('{Enter}');
    expect(root).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('read_file')).toBeInTheDocument();
    expect(screen.getByText('ГОТОВО')).toBeInTheDocument();
    const error = render(<ToolCallCard call={FX.calls[2]} />);
    expect(within(error.container).getByText('ОШИБКА')).toBeInTheDocument();
  });
});

describe('DelegationTree', () => {
  it('nests by parentCallId, announces details and opens with keyboard', async () => {
    render(<DelegationTree items={FX.delegations} />);
    const tree = screen.getByRole('list', { name: 'Дерево делегаций' });
    expect(within(tree).getByText('Выполняется')).toBeInTheDocument();
    expect(within(tree).getByText('Ответ получен')).toBeInTheDocument();
    expect(within(tree).getByText('Родитель вне списка: run-missing')).toBeInTheDocument();
    const summary = screen.getByText('Проверить изменения').closest('summary');
    expect(summary).not.toBeNull();
    expect(summary).toHaveAttribute('tabindex', '0');
    summary!.focus();
    expect(summary).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(summary!.closest('details')).toHaveAttribute('open');
    expect(screen.getByText('Проверить типы')).toBeInTheDocument();
  });

  it('empty list has an honest empty state', () => {
    render(<DelegationTree items={[]} />);
    expect(screen.getByText('Делегаций нет')).toHaveAttribute('data-state', 'empty');
    expect(screen.queryByRole('list', { name: 'Дерево делегаций' })).not.toBeInTheDocument();
  });

  it('renders known delegation outcomes with Russian labels and leaves unknown state verbatim', () => {
    render(<DelegationTree items={[
      { id: 'sent', state: 'sent' },
      { id: 'failed', state: 'failed' },
      { id: 'cancelled', state: 'cancelled' },
      { id: 'future', state: 'new-host-state' },
    ]} />);
    expect(screen.getByText('Запущена')).toBeInTheDocument();
    expect(screen.getByText('Ошибка')).toBeInTheDocument();
    expect(screen.getByText('Отменена')).toBeInTheDocument();
    expect(screen.getByText('new-host-state')).toBeInTheDocument();
  });
});

describe('StreamText (S4)', () => {
  it('renders accumulated text verbatim; caret only while streaming', () => {
    const { rerender } = render(<StreamText text="Читаю src/auth/login.ts…" streaming />);
    const el = screen.getByTestId('stream-text');
    expect(el).toHaveTextContent('Читаю src/auth/login.ts…');
    expect(el).toHaveAttribute('aria-busy', 'true');
    expect(el).toHaveAttribute('data-streaming', 'true');
    rerender(<StreamText text="Готово." streaming={false} />);
    expect(el).not.toHaveAttribute('aria-busy');
    expect(el).not.toHaveAttribute('data-streaming');
  });
});

describe('SessionRow (S3)', () => {
  it('renders verbatim facts and calls resume/fork from the keyboard', async () => {
    const onResume = vi.fn(); const onFork = vi.fn();
    render(<SessionRow title="Рефактор auth" model="Nexus Large" updatedAt="сегодня 14:02"
      messageCount={17} onResume={onResume} onFork={onFork} />);
    expect(screen.getByText('Рефактор auth')).toBeInTheDocument();
    expect(screen.getByText(/Nexus Large · сегодня 14:02 · сообщений: 17/)).toBeInTheDocument();
    const resume = screen.getByRole('button', { name: 'Продолжить сессию «Рефактор auth»' });
    resume.focus();
    await userEvent.keyboard('{Enter}');
    expect(onResume).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Форкнуть сессию «Рефактор auth»' }));
    expect(onFork).toHaveBeenCalledTimes(1);
  });

  it('null fields render честное «нет данных», buttons only when wired', () => {
    render(<SessionRow title="Пустая сессия" />);
    expect(screen.getByText(/Модель: нет данных · обновлено: нет данных/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps the full long title available and actions keyboard reachable', async () => {
    const title = 'Сверка_длинного_описания_сессии_и_непрерывного_идентификатора_run_0123456789';
    const onResume = vi.fn();
    render(<SessionRow title={title} onResume={onResume} />);
    expect(screen.getByText(title)).toBeInTheDocument();
    const resume = screen.getByRole('button', { name: `Продолжить сессию «${title}»` });
    resume.focus();
    expect(resume).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onResume).toHaveBeenCalledOnce();
  });
});
