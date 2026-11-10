import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ModelPicker,
  groupModelsByProvider,
  isOpenCodeModel,
  matchesModelQuery,
  modelProviderOf,
  OTHER_PROVIDER_LABEL,
  type ModelPickerOption,
} from './model-picker';

afterEach(cleanup);

const options: ModelPickerOption[] = [
  { id: 'default', label: 'по умолчанию (из env)', free: null, isDefault: true },
  { id: 'anthropic/claude-haiku-4.5', label: 'claude-haiku-4.5', free: false },
  { id: 'anthropic/claude-sonnet-5', label: 'claude-sonnet-5', free: false },
  { id: 'cohere/command-r', label: 'command-r', free: false },
  { id: 'gpt-4o', label: 'gpt-4o', free: false },
  { id: 'oc:openai/gpt-4o-mini', label: 'gpt-4o-mini (openai)', free: null },
];

describe('modelProviderOf', () => {
  it('берёт провайдера из префикса id (формат OpenCode)', () => {
    expect(modelProviderOf('anthropic/claude-haiku-4.5')).toBe('anthropic');
    expect(modelProviderOf('cohere/command-r')).toBe('cohere');
  });

  it('явный провайдер важнее разбора id', () => {
    expect(modelProviderOf('anthropic/claude-haiku-4.5', 'openrouter')).toBe('openrouter');
  });

  it('модель OpenCode разбирается по провайдеру после префикса oc:', () => {
    expect(modelProviderOf('oc:openai/gpt-4o-mini')).toBe('openai');
    expect(isOpenCodeModel('oc:openai/gpt-4o-mini')).toBe(true);
    expect(isOpenCodeModel('anthropic/claude-haiku-4.5')).toBe(false);
  });

  it('без префикса — честная группа «без провайдера»', () => {
    expect(modelProviderOf('gpt-4o')).toBe(OTHER_PROVIDER_LABEL);
  });
});

describe('matchesModelQuery', () => {
  it('пустой запрос совпадает со всем', () => {
    expect(matchesModelQuery(options[0], '')).toBe(true);
  });

  it('ищет по id, label и провайдеру', () => {
    expect(matchesModelQuery(options[1], 'haiku')).toBe(true);
    expect(matchesModelQuery(options[1], 'anthropic')).toBe(true);
    expect(matchesModelQuery(options[1], 'nope')).toBe(false);
  });

  it('несколько токенов — логическое И', () => {
    expect(matchesModelQuery(options[2], 'anthropic sonnet')).toBe(true);
    expect(matchesModelQuery(options[2], 'anthropic cohere')).toBe(false);
  });
});

describe('groupModelsByProvider', () => {
  it('группирует по провайдеру, «без провайдера» — в конец', () => {
    const groups = groupModelsByProvider(options);
    expect(groups.map((g) => g.provider)).toEqual([
      'anthropic',
      'cohere',
      'openai',
      OTHER_PROVIDER_LABEL,
    ]);
    expect(groups[0].options).toHaveLength(2);
  });
});

describe('ModelPicker', () => {
  it('группирует модели по провайдеру и показывает бейджи', () => {
    render(<ModelPicker open onOpenChange={() => {}} options={options} onSelect={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Модель' });
    expect(dialog).toBeTruthy();
    // Имя провайдера встречается дважды: чип-фильтр и заголовок группы.
    expect(screen.getAllByText('anthropic').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('cohere').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('opencode')).toBeTruthy();
    // 'default' — и id модели, и бейдж серверного дефолта.
    expect(screen.getAllByText('default').length).toBeGreaterThanOrEqual(1);
  });

  it('поиск фильтрует список', () => {
    render(<ModelPicker open onOpenChange={() => {}} options={options} onSelect={() => {}} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'haiku' } });
    expect(screen.getByText('claude-haiku-4.5')).toBeTruthy();
    expect(screen.queryByText('command-r')).toBeNull();
  });

  it('клик по модели вызывает onSelect с её id', () => {
    const onSelect = vi.fn();
    render(<ModelPicker open onOpenChange={() => {}} options={options} onSelect={onSelect} />);
    fireEvent.mouseDown(screen.getByText('command-r'));
    expect(onSelect).toHaveBeenCalledWith('cohere/command-r');
  });

  it('клавиатура: стрелки двигают активную строку, Enter выбирает', () => {
    const onSelect = vi.fn();
    render(<ModelPicker open onOpenChange={() => {}} options={options} onSelect={onSelect} />);
    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('Escape закрывает окно', () => {
    const onOpenChange = vi.fn();
    render(<ModelPicker open onOpenChange={onOpenChange} options={options} onSelect={() => {}} />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('чип провайдера оставляет только его модели', () => {
    render(<ModelPicker open onOpenChange={() => {}} options={options} onSelect={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'cohere' }));
    expect(screen.getByText('command-r')).toBeTruthy();
    expect(screen.queryByText('claude-haiku-4.5')).toBeNull();
  });

  it('пустое состояние честно сообщает, что моделей нет', () => {
    render(<ModelPicker open onOpenChange={() => {}} options={[]} onSelect={() => {}} />);
    expect(screen.getByText('Модели не найдены')).toBeTruthy();
  });
});
