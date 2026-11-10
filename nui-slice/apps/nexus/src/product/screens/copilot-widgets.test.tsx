// @vitest-environment jsdom
/**
 * Wave XI W3 — тесты компонентов Copilot-механик по спеке W2
 * (copilot-patterns-spec.md) и контрактам W1 (copilot.ts/bus.ts):
 * ModeSwitch (профиль + startRun.mode), SessionList, DelegationChip,
 * HandoffBar, ToolCallCard с вложенностью.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BusDelegation, BusSession } from '../../integrations/ai2/contracts/bus';
import type { AgentHandoff } from '@nexus/mock-data';
import { DelegationChip, HandoffBar, ModeSwitch, SessionList } from './copilot-widgets';
import { ToolCallCard, type TrajectoryCall } from '@nexus/ui';

const session = (over: Partial<BusSession> = {}): BusSession => ({
  id: 's-w0', window: 'W0', title: 'ДИСПЕТЧЕР', kind: 'desktop',
  status: 'idle', lastActivityAt: Math.floor(Date.now() / 1000) - 60,
  ...over,
});

const delegation = (over: Partial<BusDelegation> = {}): BusDelegation => ({
  id: 'd-1', to: 'W1', taskPath: 'inbox/w1-task.md',
  state: 'queued', answerPath: null, createdAt: 1700000000,
  ...over,
});

afterEach(() => cleanup());

describe('ModeSwitch (волна XI)', () => {
  it('три сегмента по спеке: Агент/Спросить/План, активный — aria-checked', () => {
    render(<ModeSwitch value="agent" onChange={() => { }} />);
    const group = screen.getByRole('radiogroup', { name: 'Режим композитора' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(['Агент', 'Спросить', 'План']);
    expect(screen.getByRole('radio', { name: 'Агент' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'План' })).toHaveAttribute('aria-checked', 'false');
  });

  it('клик и стрелки переключают режим', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ModeSwitch value="agent" onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: 'План' }));
    expect(onChange).toHaveBeenCalledWith('plan');
    onChange.mockClear();
    // Стрелочная навигация (спека A11y): ArrowRight agent→ask
    const group = screen.getByRole('radiogroup');
    group.focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('ask');
  });
});

describe('SessionList (волна XI)', () => {
  it('пустой список → «Нет данных о сессиях», не пустые строки', () => {
    render(<SessionList sessions={[]} />);
    const el = screen.getByTestId('session-list');
    expect(el).toHaveAttribute('data-state', 'empty');
    expect(el).toHaveTextContent('Нет данных о сессиях');
  });

  it('строки: окно+title, kind-метка, статус по таблице спеки', () => {
    render(<SessionList sessions={[
      session(),
      session({ id: 's-w3', window: 'W3', title: 'PRODUCT UI', status: 'busy' }),
      session({ id: 's-w5', window: 'W5', title: 'QA', status: 'locked', lastActivityAt: null }),
    ]} />);
    expect(screen.getByText(/W0 · ДИСПЕТЧЕР/)).toBeTruthy();
    expect(screen.getByText('Свободна')).toBeTruthy();
    expect(screen.getByText('Занята')).toBeTruthy();
    // locked → paused-подпись «Занята другим», не ошибка
    expect(screen.getByText('Занята другим')).toBeTruthy();
    expect(screen.getAllByText('desktop')).toHaveLength(3);
  });

  it('кнопка «Отправить окну» вызывает onSend; у locked-окна — disabled', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<SessionList
      sessions={[session(), session({ id: 's2', window: 'W5', status: 'locked' })]}
      onSend={onSend}
    />);
    const btns = screen.getAllByRole('button', { name: 'Отправить окну' });
    expect(btns[1]).toBeDisabled();
    await user.click(btns[0]);
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ window: 'W0' }));
  });

  it('DelegationChip рядом с кнопкой: состояние по таблице спеки', () => {
    render(<SessionList
      sessions={[session()]}
      onSend={() => { }}
      delegations={{ W0: delegation({ state: 'answered' }) }}
    />);
    expect(screen.getByTestId('delegation-chip')).toHaveTextContent('Ответ получен');
  });
});

describe('DelegationChip (волна XI)', () => {
  it.each([
    ['queued', 'В очереди'], ['sent', 'Отправлено'], ['answered', 'Ответ получен'],
    ['locked', 'Окно занято'], ['failed', 'Не доставлено'],
  ] as const)('state %s → «%s»', (state, label) => {
    render(<DelegationChip delegation={delegation({ state })} />);
    expect(screen.getByTestId('delegation-chip')).toHaveTextContent(label);
  });

  it('failed → текстовое действие «Повторить» (не авто-ретрай)', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<DelegationChip delegation={delegation({ state: 'failed' })} onRetry={onRetry} />);
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ id: 'd-1' }));
  });
});

describe('HandoffBar (волна XI)', () => {
  const handoffs: AgentHandoff[] = [
    { label: 'Реализовать план', agent: 'codex', prompt: 'реализуй', send: true },
    { label: 'В композитор', agent: 'mech', prompt: 'черновик', send: false },
  ];

  it('handoffs отсутствует/пуст → бара нет (отсутствие — не состояние)', () => {
    const { container } = render(<HandoffBar handoffs={undefined} onPick={() => { }} />);
    expect(container.firstChild).toBeNull();
    const { container: c2 } = render(<HandoffBar handoffs={[]} onPick={() => { }} />);
    expect(c2.firstChild).toBeNull();
  });

  it('кнопки по {label}, role=group «Действия по ответу», клик → handoff', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<HandoffBar handoffs={handoffs} onPick={onPick} />);
    const group = screen.getByRole('group', { name: 'Действия по ответу' });
    expect(within(group).getAllByRole('button')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Реализовать план' }));
    expect(onPick).toHaveBeenCalledWith(handoffs[0]);
  });
});

describe('ToolCallCard (волна XI)', () => {
  const parent: TrajectoryCall = {
    callId: 'c1', name: 'spawn', input: { agent: 'mech' },
    startedAt: 1700000000, status: 'done', durationMs: 1200,
  };
  const child: TrajectoryCall = {
    callId: 'c2', parentCallId: 'c1', name: 'read_file',
    input: { path: 'a.md' }, output: 'ok', startedAt: 1700000001, status: 'done',
  };

  it('вложенность по parentCallId: дочерний вызов внутри карточки родителя', async () => {
    const user = userEvent.setup();
    render(<ToolCallCard call={parent} calls={[child]} />);
    const card = screen.getByTestId('tool-call-card');
    expect(card).toHaveTextContent('spawn');
    // Карточка закрыта по умолчанию (Copilot-модель); дочерние вызовы
    // монтируются при раскрытии.
    await user.click(within(card).getByTestId('trajectory-call'));
    const nested = card.querySelector('[data-depth="1"]');
    expect(nested).toBeTruthy();
    expect(nested).toHaveTextContent('read_file');
  });

  it('сирота (parentCallId без родителя) — верхний уровень + пометка', () => {
    render(<ToolCallCard call={child} />);
    expect(screen.getByTestId('tool-call-card')).toHaveTextContent('родительский вызов c1 вне этого трейса');
  });
});

describe('composerMode → профиль (волна XI)', () => {
  // Интеграционный кейс ModeSwitch→startRun — в home.test.tsx (там харнесс ds);
  // здесь — хранение: updateProfile → localStorage → loadProfile.
  it('composerMode сохраняется в nexus.profile.v1', async () => {
    const { updateProfile, loadProfile, resetProfileStore } = await import('../profile/profile-store');
    localStorage.clear();
    resetProfileStore();
    updateProfile({ composerMode: 'plan' });
    expect(loadProfile()?.composerMode).toBe('plan');
    const raw = JSON.parse(localStorage.getItem('nexus.profile.v1') ?? '{}');
    expect(raw.composerMode).toBe('plan');
    resetProfileStore();
  });
});
