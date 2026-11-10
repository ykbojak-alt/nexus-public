// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ModelPickerControl, toModelPickerOptions } from './model-picker-control';
import type { ModelInfo } from '@nexus/mock-data';

const HOST_MODELS: ModelInfo[] = [
  { id: 'default', label: 'по умолчанию (из env)', free: null, isDefault: true },
  { id: 'anthropic/claude-sonnet-5', label: 'claude-sonnet-5', free: false, isDefault: false },
  { id: 'cohere/command-r', label: 'command-r', free: false, isDefault: false },
];

describe('toModelPickerOptions', () => {
  it('модели хоста переносятся как есть', () => {
    const opts = toModelPickerOptions(HOST_MODELS);
    expect(opts).toHaveLength(3);
    expect(opts[0]).toMatchObject({ id: 'default', isDefault: true, free: null });
    expect(opts[1]).toMatchObject({ id: 'anthropic/claude-sonnet-5', free: false });
  });

  it('модели OpenCode получают префикс «oc:» и провайдера', () => {
    const opts = toModelPickerOptions(HOST_MODELS, [{ id: 'openai/gpt-4o-mini', name: 'gpt-4o-mini', provider: 'openai' }]);
    expect(opts).toHaveLength(4);
    expect(opts[3]).toMatchObject({ id: 'oc:openai/gpt-4o-mini', provider: 'openai', free: null });
  });

  it('null-список моделей не роняет маппинг', () => {
    expect(toModelPickerOptions(null)).toEqual([]);
  });
});

describe('ModelPickerControl', () => {
  it('кнопка показывает текущую модель; null = серверный дефолт', () => {
    const { rerender } = render(
      <ModelPickerControl models={HOST_MODELS} selectedId="cohere/command-r" onSelect={() => {}} />,
    );
    expect(screen.getByTestId('model-picker-trigger').textContent).toBe('cohere/command-r');
    rerender(<ModelPickerControl models={HOST_MODELS} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByTestId('model-picker-trigger').textContent).toBe('default (сервер)');
  });

  it('клик открывает пикер с группировкой по провайдеру', () => {
    render(<ModelPickerControl models={HOST_MODELS} selectedId={null} onSelect={() => {}} />);
    fireEvent.click(screen.getByTestId('model-picker-trigger'));
    expect(screen.getByTestId('model-picker')).toBeTruthy();
    expect(screen.getAllByText('anthropic').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('cohere').length).toBeGreaterThanOrEqual(1);
  });

  it('выбор модели возвращает её id', () => {
    const onSelect = vi.fn();
    render(<ModelPickerControl models={HOST_MODELS} selectedId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('model-picker-trigger'));
    fireEvent.mouseDown(screen.getByText('claude-sonnet-5'));
    expect(onSelect).toHaveBeenCalledWith('anthropic/claude-sonnet-5');
  });

  it('«сбросить на серверный дефолт» возвращает null', () => {
    const onSelect = vi.fn();
    render(<ModelPickerControl models={HOST_MODELS} selectedId="cohere/command-r" onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('model-picker-trigger'));
    fireEvent.click(screen.getByText('Сбросить на серверный дефолт'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
