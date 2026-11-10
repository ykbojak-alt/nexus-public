import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryItems, memorySearch, memoryStructure } from '@nexus/mock-data';
import { MemoryTemplate } from './memory-template';
import { MemoryBrowser } from './memory-browser';
import { MemoryInspector } from './memory-inspector';

afterEach(cleanup);

describe('MemoryTemplate', () => {
  it('submits trimmed text via callback and clears the field', () => {
    const onSave = vi.fn();
    render(<MemoryTemplate project="nexus" onSave={onSave} />);
    const area = screen.getByLabelText('Текст записи');
    fireEvent.change(area, { target: { value: '  факт о мире  ' } });
    fireEvent.click(screen.getByText('Сохранить в память'));
    expect(onSave).toHaveBeenCalledWith('факт о мире');
    expect((area as HTMLTextAreaElement).value).toBe('');
  });

  it('never promises editing — create-only notice is rendered', () => {
    render(<MemoryTemplate project="nexus" />);
    expect(screen.getByText(/не редактируется/)).toBeTruthy();
  });

  it('empty project disables submission honestly', () => {
    render(<MemoryTemplate state="empty" />);
    expect(screen.queryByLabelText('Текст записи')).toBeNull();
    expect(screen.getByText(/Проект не выбран/)).toBeTruthy();
  });
});

describe('MemoryBrowser', () => {
  it('lists items with id and project', () => {
    render(<MemoryBrowser items={memoryItems} />);
    expect(screen.getByTestId('memory-browser').dataset.state).toBe('ready');
    expect(screen.getByText(/#900 · nexus/)).toBeTruthy();
  });

  it('search hits expose score from server response', () => {
    render(<MemoryBrowser items={memorySearch} query="память" onSearch={() => {}} />);
    expect(screen.getByText(/score 0\.87/)).toBeTruthy();
  });

  it('structure is labeled as a recent window, not totals', () => {
    render(<MemoryBrowser items={memoryItems} structure={memoryStructure} />);
    const line = screen.getByTestId('memory-structure');
    expect(line.textContent).toContain('nexus: 20 записей');
    expect(line.textContent).toContain('источники ui 14');
  });

  it('empty search result states the query', () => {
    render(<MemoryBrowser items={[]} query="xyz" state="empty" />);
    expect(screen.getByText(/«xyz»/)).toBeTruthy();
  });

  it('selection is a callback — no fetch inside the pattern', () => {
    const onSelect = vi.fn();
    render(<MemoryBrowser items={memoryItems} onSelect={onSelect} />);
    fireEvent.click(screen.getByText(/#900 · nexus/));
    expect(onSelect).toHaveBeenCalledWith(900);
  });
});

describe('MemoryInspector', () => {
  it('renders item facts and delegates delete via callback', () => {
    const onDelete = vi.fn();
    render(<MemoryInspector item={memoryItems[0]} onDelete={onDelete} formatTs={() => 'TS'} />);
    expect(screen.getByText(memoryItems[0].text)).toBeTruthy();
    expect(screen.getByText('#900')).toBeTruthy();
    fireEvent.click(screen.getByText('Удалить запись'));
    expect(onDelete).toHaveBeenCalledWith(900);
  });

  it('shows the honest no-edit notice instead of an edit affordance', () => {
    render(<MemoryInspector item={memoryItems[0]} />);
    expect(screen.getByText(/Редактирование не поддерживается API памяти/)).toBeTruthy();
    expect(screen.queryByText(/Редактировать/)).toBeNull();
  });

  it('empty selection is explicit', () => {
    render(<MemoryInspector item={null} />);
    expect(screen.getByText(/Выберите запись/)).toBeTruthy();
  });
});
