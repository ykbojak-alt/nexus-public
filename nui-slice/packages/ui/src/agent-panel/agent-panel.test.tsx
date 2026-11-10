import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRef } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentPanel, type AgentPanelHandle } from './agent-panel';

const NAME = 'AGENT-A';

beforeEach(() => {
  window.localStorage.clear();
});

function panel() {
  return screen.getByTestId('agent-panel');
}

describe('AgentPanel — режимы', () => {
  it('по умолчанию — expanded: регион, имя, композер', () => {
    render(<AgentPanel storageKey={null} />);
    const region = screen.getByRole('region', { name: `${NAME} — панель ассистента` });
    expect(region.getAttribute('data-mode')).toBe('expanded');
    expect(screen.getByLabelText(`Сообщение для ${NAME}`)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Свернуть панель' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Закрыть панель' })).toBeTruthy();
  });

  it('minimize -> collapsed капсула, expand возвращает панель', async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    render(<AgentPanel storageKey={null} onModeChange={onModeChange} />);

    await user.click(screen.getByRole('button', { name: 'Свернуть панель' }));
    expect(panel().getAttribute('data-mode')).toBe('collapsed');
    expect(onModeChange).toHaveBeenLastCalledWith('collapsed');
    expect(screen.getByRole('button', { name: `Развернуть панель ${NAME}` })).toBeTruthy();
    expect(screen.queryByLabelText(`Сообщение для ${NAME}`)).toBeNull();

    await user.click(screen.getByRole('button', { name: `Развернуть панель ${NAME}` }));
    expect(panel().getAttribute('data-mode')).toBe('expanded');
    expect(onModeChange).toHaveBeenLastCalledWith('expanded');
    expect(screen.getByLabelText(`Сообщение для ${NAME}`)).toBeTruthy();
  });

  it('close -> hidden + data-mode=closed; контент недоступен', async () => {
    const user = userEvent.setup();
    render(<AgentPanel storageKey={null} />);
    await user.click(screen.getByRole('button', { name: 'Закрыть панель' }));
    expect(panel().getAttribute('data-mode')).toBe('closed');
    expect(panel().hasAttribute('hidden')).toBe(true);
    expect(panel().getAttribute('aria-hidden')).toBe('true');
  });

  it('imperative handle: toggleCollapse/expand/close', () => {
    const ref = createRef<AgentPanelHandle>();
    render(<AgentPanel storageKey={null} ref={ref} />);
    act(() => ref.current!.toggleCollapse());
    expect(panel().getAttribute('data-mode')).toBe('collapsed');
    act(() => ref.current!.expand());
    expect(panel().getAttribute('data-mode')).toBe('expanded');
    act(() => ref.current!.close());
    expect(panel().getAttribute('data-mode')).toBe('closed');
  });

  it('контролируемый mode: проп управляет состоянием, колбэк сообщает о намерении', async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    render(<AgentPanel storageKey={null} mode="expanded" onModeChange={onModeChange} />);
    await user.click(screen.getByRole('button', { name: 'Свернуть панель' }));
    expect(onModeChange).toHaveBeenLastCalledWith('collapsed');
    expect(panel().getAttribute('data-mode')).toBe('expanded'); // без смены пропа
  });
});

describe('AgentPanel — чат', () => {
  it('queryBtn открывает чат: placeholder + честный empty', async () => {
    const user = userEvent.setup();
    render(<AgentPanel storageKey={null} />);
    await user.click(screen.getByRole('button', { name: 'Открыть чат' }));
    expect(panel().getAttribute('data-query')).toBe('true');
    expect(screen.getByRole('button', { name: 'Свернуть чат' })).toBeTruthy();
    expect(screen.getByTestId('agent-panel-messages').textContent).toContain(
      'Сообщений нет — ответы появятся, когда подключён runtime.',
    );
  });

  it('messages рендерятся с ролями', async () => {
    const user = userEvent.setup();
    render(
      <AgentPanel
        storageKey={null}
        messages={[
          { id: 'm1', role: 'user', text: 'Привет' },
          { id: 'm2', role: 'assistant', text: 'Слушаю' },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Открыть чат' }));
    const log = screen.getByTestId('agent-panel-messages');
    expect(log.querySelector('[data-role="user"]')?.textContent).toContain('Привет');
    expect(log.querySelector('[data-role="assistant"]')?.textContent).toContain('Слушаю');
  });

  it('отправка: Enter зовёт onSendQuery и очищает поле', async () => {
    const user = userEvent.setup();
    const onSendQuery = vi.fn();
    render(<AgentPanel storageKey={null} onSendQuery={onSendQuery} />);
    const input = screen.getByLabelText(`Сообщение для ${NAME}`);
    await user.type(input, 'Что по прогону?{Enter}');
    expect(onSendQuery).toHaveBeenCalledWith('Что по прогону?');
    expect((input as HTMLTextAreaElement).value).toBe('');
  });

  it('без onSendQuery — честная ошибка, текст не теряется', async () => {
    const user = userEvent.setup();
    render(<AgentPanel storageKey={null} />);
    const input = screen.getByLabelText(`Сообщение для ${NAME}`);
    await user.type(input, 'ping{Enter}');
    expect(screen.getByRole('status').textContent).toContain('runtime не подключён');
    expect((input as HTMLTextAreaElement).value).toBe('ping');
  });

  it('Esc: из чата закрывает чат, повторный — сворачивает панель', async () => {
    const user = userEvent.setup();
    render(<AgentPanel storageKey={null} />);
    await user.click(screen.getByRole('button', { name: 'Открыть чат' }));
    await user.keyboard('{Escape}');
    expect(panel().getAttribute('data-query')).toBeNull();
    expect(panel().getAttribute('data-mode')).toBe('expanded');
    await user.keyboard('{Escape}');
    expect(panel().getAttribute('data-mode')).toBe('collapsed');
  });
});

describe('AgentPanel — drag & resize', () => {
  it('перетаскивание мышью задаёт позицию и data-dragging', () => {
    render(<AgentPanel storageKey={null} />);
    const handle = screen.getByRole('button', { name: 'Переместить панель' });
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    expect(panel().getAttribute('data-dragging')).toBe('true');
    fireEvent.pointerMove(handle, { clientX: 150, clientY: 130, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 150, clientY: 130, pointerId: 1 });
    expect(panel().getAttribute('data-dragging')).toBeNull();
    const left = parseFloat(panel().style.left);
    const top = parseFloat(panel().style.top);
    expect(left).toBeGreaterThanOrEqual(8);
    expect(top).toBeGreaterThanOrEqual(8);
  });

  it('стрелки на dragHandle двигают панель (клавиатурная доступность)', () => {
    render(<AgentPanel storageKey={null} />);
    const handle = screen.getByRole('button', { name: 'Переместить панель' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(parseFloat(panel().style.left)).toBeGreaterThanOrEqual(8);
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(parseFloat(panel().style.top)).toBeGreaterThanOrEqual(8);
  });

  it('resize меняет размер в пределах минимума, data-resizing', () => {
    render(<AgentPanel storageKey={null} />);
    const handle = screen.getByRole('separator', { name: 'Изменить размер панели' });
    fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10, pointerId: 2 });
    expect(panel().getAttribute('data-resizing')).toBe('true');
    fireEvent.pointerMove(handle, { clientX: 260, clientY: 260, pointerId: 2 });
    fireEvent.pointerUp(handle, { clientX: 260, clientY: 260, pointerId: 2 });
    expect(panel().getAttribute('data-resizing')).toBeNull();
    expect(parseFloat(panel().style.width)).toBeGreaterThanOrEqual(320);
    expect(parseFloat(panel().style.height)).toBeGreaterThanOrEqual(240);
  });

  it('стрелки на resizeHandle меняют размер (клавиатурная доступность)', () => {
    render(<AgentPanel storageKey={null} />);
    const handle = screen.getByRole('separator', { name: 'Изменить размер панели' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(parseFloat(panel().style.width)).toBeGreaterThanOrEqual(320);
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(parseFloat(panel().style.height)).toBeGreaterThanOrEqual(240);
  });
});

describe('AgentPanel — персист', () => {
  it('сохраняет и восстанавливает режим/позицию', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<AgentPanel storageKey="nexus.agent-panel.test" />);
    await user.click(screen.getByRole('button', { name: 'Свернуть панель' }));
    expect(JSON.parse(window.localStorage.getItem('nexus.agent-panel.test')!).mode).toBe('collapsed');
    unmount();

    render(<AgentPanel storageKey="nexus.agent-panel.test" />);
    // restore — в effect: RTL render + act внутри
    expect(panel().getAttribute('data-mode')).toBe('collapsed');
  });

  it('storageKey=null отключает запись', async () => {
    const user = userEvent.setup();
    render(<AgentPanel storageKey={null} />);
    await user.click(screen.getByRole('button', { name: 'Свернуть панель' }));
    expect(window.localStorage.length).toBe(0);
  });
});
