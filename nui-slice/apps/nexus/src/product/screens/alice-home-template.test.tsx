import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AliceHomeTemplate, type AliceHomeTemplateProps } from '@nexus/templates';

// Смоук интеграции публичного API шаблона: рейл ALICE home получает всё
// только через props (адаптер — apps/nexus/src/product/screens/
// alice-home-route-adapter.tsx), поэтому тест фиксирует именно проброс
// hero/composer/systemStatus/activity/today.
const baseProps: AliceHomeTemplateProps = {
  workspaceLabel: 'Рабочая область AGENT-A',
  railLabel: 'Состояние рантайма и сегодняшние прогоны',
  hero: {
    eyebrow: 'ПЕРСОНАЛЬНЫЙ ИНТЕЛЛЕКТ',
    title: 'AGENT-A',
    description: 'Ваш интеллектуальный рантайм.',
    statement: 'Думать глубже. Видеть дальше. Создавать новое.',
    signature: [
      { id: 'research', label: 'Исследовать' },
      { id: 'analyze', label: 'Анализировать' },
    ],
  },
  capabilities: [
    { id: 'research', label: 'Исследование', state: 'active' },
    { id: 'analyze', label: 'Анализ' },
    { id: 'plan', label: 'План' },
  ],
  composer: {
    agent: 'AGENT-A',
    mode: 'agent',
    modes: [
      { id: 'agent', label: 'Агент' },
      { id: 'ask', label: 'Спросить' },
      { id: 'plan', label: 'План' },
    ],
    onModeChange: () => undefined,
    value: '',
    onValueChange: () => undefined,
    onSubmit: () => undefined,
    state: 'idle',
    voice: { enabled: true, onToggle: () => undefined },
    attachment: { enabled: false, reason: 'Подключённый рантайм не принимает вложения' },
    tools: [{ id: 'memory', label: 'Память', onSelect: () => undefined }],
  },
  systemStatus: {
    state: 'ready',
    core: 'attention',
    statusLabel: 'Есть замечания',
    activeRuns: 0,
    latencyMs: 147,
    meters: [
      { id: 'cpu', label: 'CPU', value: 64 },
      { id: 'ram', label: 'Память', value: 51 },
      { id: 'disk', label: 'Диск', value: 78 },
    ],
  },
  activity: {
    state: 'ready',
    data: [18, 26, 22, 38, 32, 47],
    label: 'Локальная серия активности',
  },
  today: {
    state: 'ready',
    items: [{ id: 'sample-1', title: 'Анализ рыночных данных', timestamp: '14:30', status: 'success' }],
  },
};

describe('AliceHomeTemplate — ALICE home reference wiring', () => {
  it('renders hero, capability rail and composer from props', () => {
    render(<AliceHomeTemplate {...baseProps} />);

    expect(screen.getByRole('heading', { level: 1, name: 'AGENT-A' })).toBeInTheDocument();
    expect(screen.getByText('ПЕРСОНАЛЬНЫЙ ИНТЕЛЛЕКТ')).toBeInTheDocument();
    expect(screen.getByText('Думать глубже. Видеть дальше. Создавать новое.')).toBeInTheDocument();

    const capabilities = screen.getByRole('group', { name: 'Возможности' });
    const buttons = within(capabilities).getAllByRole('button');
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toHaveTextContent('Исследование');
    expect(buttons[0]).toHaveAttribute('data-state', 'active');
    expect(buttons[1]).toHaveAttribute('data-state', 'default');
  });

  it('forwards attachment, modes and agent to the composer', () => {
    render(<AliceHomeTemplate {...baseProps} />);

    const composer = screen.getByTestId('command-composer');
    expect(within(composer).getByText('Агент: AGENT-A')).toBeInTheDocument();

    // Paperclip существует только при переданном attachment seam; disabled
    // seam сохраняет причину хоста verbatim.
    expect(within(composer).getByRole('button', { name: 'Подключённый рантайм не принимает вложения' })).toBeDisabled();

    const modeGroup = within(composer).getByRole('group', { name: 'Режим' });
    expect(within(modeGroup).getByRole('button', { name: 'Агент' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(modeGroup).getByRole('button', { name: 'Спросить' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows ready system facts and meters verbatim', () => {
    render(<AliceHomeTemplate {...baseProps} />);

    const status = screen.getByTestId('system-status-panel');
    expect(status).toHaveAttribute('data-state', 'ready');
    expect(within(status).getByText('Есть замечания')).toBeInTheDocument();
    expect(within(status).getByText('Активных прогонов')).toBeInTheDocument();
    expect(within(status).getByText('147 мс')).toBeInTheDocument();
    expect(within(status).getByRole('meter', { name: 'CPU' })).toHaveAttribute('aria-valuenow', '64');
    expect(within(status).getByRole('meter', { name: 'Память' })).toHaveAttribute('aria-valuenow', '51');
    expect(within(status).getByRole('meter', { name: 'Диск' })).toHaveAttribute('aria-valuenow', '78');
  });

  it('keeps loading and error states honest instead of inventing values', () => {
    const { rerender } = render(
      <AliceHomeTemplate {...baseProps} systemStatus={{ ...baseProps.systemStatus, state: 'loading' }} />,
    );
    expect(screen.getByText('Получаю состояние…')).toBeInTheDocument();

    rerender(<AliceHomeTemplate {...baseProps} systemStatus={{ ...baseProps.systemStatus, state: 'error' }} />);
    expect(screen.getByText('Данные о состоянии недоступны.')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('draws three activity ridges from real hop trails', () => {
    render(
      <AliceHomeTemplate
        {...baseProps}
        activity={{
          state: 'ready',
          emptyBody: 'Наблюдений активности пока нет.',
          series: [
            { id: 'cpu', label: 'CPU', data: [18, 26, 22, 38] },
            { id: 'ram', label: 'Память', data: [42, 40, 45, 47] },
            { id: 'disk', label: 'Диск', data: [70, 71, 68, 74] },
          ],
        }}
      />,
    );

    const ridges = within(screen.getByTestId('activity-panel')).getByTestId('activity-ridges');
    expect(ridges).toHaveAttribute('data-series', 'cpu ram disk');
    expect(ridges.querySelectorAll('g[data-ridge]')).toHaveLength(3);
    expect(ridges).toHaveAccessibleName(
      'Поток активности: CPU 38 %, Память 47 %, Диск 74 % — последние наблюдения.',
    );
  });

  it('renders today rows and an honest empty activity state', () => {
    const { rerender } = render(<AliceHomeTemplate {...baseProps} />);
    const today = screen.getByTestId('today-timeline');
    expect(within(today).getByText('Анализ рыночных данных')).toBeInTheDocument();
    expect(within(today).getByText('14:30')).toBeInTheDocument();

    rerender(<AliceHomeTemplate {...baseProps} activity={{ state: 'empty', emptyBody: 'Наблюдений активности пока нет.' }} />);
    const activity = screen.getByTestId('activity-panel');
    expect(activity).toHaveAttribute('data-state', 'empty');
    expect(within(activity).getByText('Наблюдений активности пока нет.')).toBeInTheDocument();
  });
});
