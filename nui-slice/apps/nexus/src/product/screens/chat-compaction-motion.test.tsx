// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatCompactSuccess } from '../data-source';
import { ChatCompactionMotion } from './chat-compaction-motion';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const compact: ChatCompactSuccess = {
  compacted: true,
  compactId: 'compact-1',
  threadId: 'run-1',
  summary: 'Разобрали задачу и сохранили важные решения.',
  coversMessageIds: ['run-1:user', 'run-1:assistant', 'run-2:user', 'run-2:assistant', 'run-3:answer'],
  keptMessageIds: [],
  createdAt: '2026-10-19T12:00:00Z',
};

const messages = compact.coversMessageIds.map((id) => ({
  id,
  content: <p>{`Сообщение ${id}`}</p>,
}));

describe('ChatCompactionMotion lifecycle', () => {
  it('collapses and keyboard-expands covered rows with the same state control', async () => {
    render(<ChatCompactionMotion compact={compact} coveredMessages={messages} />);
    const user = userEvent.setup();
    const toggle = screen.getByRole('button', { name: /Свернуть 5 сообщений/ });

    await user.click(toggle);
    expect(screen.getByTestId('chat-compaction-motion').getAttribute('data-state')).toBe('collapsed');
    expect(screen.getByRole('button', { name: /Сжатая история · покрыто/ }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('Разобрали задачу и сохранили важные решения.')).toBeTruthy();
    expect(screen.getByTestId('chat-compaction-motion').querySelector('ol')?.parentElement?.getAttribute('aria-hidden')).toBe('true');

    await user.keyboard('{Enter}');
    expect(screen.getByTestId('chat-compaction-motion').getAttribute('data-state')).toBe('expanded');
    expect(screen.getByRole('button', { name: /Свернуть 5 сообщений/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Сообщение run-3:answer')).toBeTruthy();
  });

  it('uses the static final state in the explicit reduced-motion mode', () => {
    render(
      <ChatCompactionMotion
        compact={compact}
        coveredMessages={messages}
        defaultCollapsed
        reducedMotion
      />,
    );
    const root = screen.getByTestId('chat-compaction-motion');
    expect(root.getAttribute('data-reduced-motion')).toBe('true');
    expect(root.getAttribute('data-state')).toBe('collapsed');
    expect(root.style.getPropertyValue('--compaction-out-duration')).toBe('0ms');
    expect(root.style.getPropertyValue('--compaction-badge-duration')).toBe('0ms');
    const css = readFileSync(resolve(process.cwd(), 'apps/nexus/src/product/screens/chat-compaction-motion.module.css'), 'utf8');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('transition: none;');
  });

  it('supports host-controlled state changes without replacing covered content', () => {
    const onCollapsedChange = vi.fn();
    const { rerender } = render(
      <ChatCompactionMotion
        compact={compact}
        coveredMessages={messages}
        collapsed={false}
        onCollapsedChange={onCollapsedChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Свернуть 5 сообщений/ }));
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    rerender(
      <ChatCompactionMotion
        compact={compact}
        coveredMessages={messages}
        collapsed
        onCollapsedChange={onCollapsedChange}
      />,
    );
    expect(screen.getByTestId('chat-compaction-motion').getAttribute('data-state')).toBe('collapsed');
    expect(screen.getByText('Разобрали задачу и сохранили важные решения.')).toBeTruthy();
  });

  it('keeps the context busy pulse on the compactionMotion contextPulse contract', () => {
    const css = readFileSync(resolve(process.cwd(), 'apps/nexus/src/product/screens/context-usage-indicator.module.css'), 'utf8');
    expect(css).toContain('contextUsagePulse');
    expect(css).toContain('var(--compaction-pulse-duration, var(--nexus-motion-seek, 1400ms))');
    expect(css).toContain('var(--compaction-pulse-easing, cubic-bezier(var(--nexus-easing-dissolve');
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toMatch(/\.fill\[data-tone='busy'\]\s*\{\s*animation:\s*none;/);
  });

  it('applies a capped 40ms opacity/transform stagger while batch-expanding', async () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({
      id: `run-${i}:answer`,
      content: <p>{`Сообщение ${i}`}</p>,
    }));
    const wideCompact: ChatCompactSuccess = {
      ...compact,
      coversMessageIds: seven.map((m) => m.id),
    };
    const user = userEvent.setup();
    render(<ChatCompactionMotion compact={wideCompact} coveredMessages={seven} />);

    const rows = () =>
      [...screen.getByTestId('chat-compaction-motion').querySelectorAll<HTMLElement>('ol > li')]
        .map((li) => li.style.getPropertyValue('--compaction-row-delay'));

    expect(rows()).toEqual(['0ms', '40ms', '80ms', '120ms', '160ms', '200ms', '200ms']);

    await user.click(screen.getByRole('button', { name: /Свернуть 7 сообщений/ }));
    expect(screen.getByTestId('chat-compaction-motion').getAttribute('data-state')).toBe('collapsed');
    expect(rows()).toEqual(['0ms', '0ms', '0ms', '0ms', '0ms', '0ms', '0ms']);

    await user.click(screen.getByRole('button', { name: /Сжатая история/ }));
    expect(screen.getByTestId('chat-compaction-motion').getAttribute('data-state')).toBe('expanded');
    expect(rows()).toEqual(['0ms', '40ms', '80ms', '120ms', '160ms', '200ms', '200ms']);

    const css = readFileSync(resolve(process.cwd(), 'apps/nexus/src/product/screens/chat-compaction-motion.module.css'), 'utf8');
    expect(css).toMatch(/transition-delay:\s*0ms,\s*var\(--compaction-row-delay, 0ms\),\s*var\(--compaction-row-delay, 0ms\)/);
  });

  it('exposes token-driven durations and easings on the root element', () => {
    render(<ChatCompactionMotion compact={compact} coveredMessages={messages} />);
    const style = screen.getByTestId('chat-compaction-motion').style;
    expect(style.getPropertyValue('--compaction-out-duration')).toBe('240ms');
    expect(style.getPropertyValue('--compaction-out-easing')).toBe('cubic-bezier(0.4, 0, 1, 1)');
    expect(style.getPropertyValue('--compaction-in-duration')).toBe('240ms');
    expect(style.getPropertyValue('--compaction-in-easing')).toBe('cubic-bezier(0, 0, 0.2, 1)');
    expect(style.getPropertyValue('--compaction-badge-duration')).toBe('140ms');
    expect(style.getPropertyValue('--compaction-badge-easing')).toBe('cubic-bezier(0.3, 0.9, 0.3, 1.15)');

    const css = readFileSync(resolve(process.cwd(), 'apps/nexus/src/product/screens/chat-compaction-motion.module.css'), 'utf8');
    expect(css).toContain('compactionBadgePop');
    expect(css).toContain('var(--compaction-out-duration, var(--nexus-duration-normal, 240ms))');
    expect(css).toMatch(/transition-delay:\s*0ms,\s*var\(--compaction-row-delay, 0ms\),\s*var\(--compaction-row-delay, 0ms\)/);
  });

  it('Escape inside the expanded list collapses and returns focus to the toggle', () => {
    render(<ChatCompactionMotion compact={compact} coveredMessages={messages} />);
    const toggle = screen.getByRole('button', { name: /Свернуть 5 сообщений/ });

    const list = screen.getByText('Сообщение run-3:answer').closest('ol')!;
    fireEvent.keyDown(list, { key: 'Escape' });
    expect(screen.getByTestId('chat-compaction-motion').getAttribute('data-state')).toBe('collapsed');
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders a non-interactive aria-busy state while the host compacts again', () => {
    render(<ChatCompactionMotion compact={compact} coveredMessages={messages} busy collapsed />);
    const root = screen.getByTestId('chat-compaction-motion');
    expect(root.getAttribute('aria-busy')).toBe('true');
    expect((screen.getByRole('button', { name: /Сжатая история/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Сжимаю историю…')).toBeTruthy();
  });

  it('reveals verbatim covers_message_ids behind the sources button', async () => {
    const user = userEvent.setup();
    render(<ChatCompactionMotion compact={compact} coveredMessages={messages} collapsed />);
    const button = screen.getByRole('button', { name: 'Показать исходные · 5' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('run-3:answer')).toBeNull();

    await user.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const link = screen.getByRole('link', { name: 'run-3:answer' });
    expect(link.getAttribute('href')).toBe('/run?id=run-3');

    await user.click(screen.getByRole('button', { name: 'Скрыть исходные' }));
    expect(screen.queryByRole('link', { name: 'run-3:answer' })).toBeNull();
  });

  it('does not schedule RAF work while idle, toggling, or after unmount', () => {
    const raf = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const { unmount } = render(<ChatCompactionMotion compact={compact} coveredMessages={messages} />);
    expect(raf).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Свернуть 5 сообщений/ }));
    expect(raf).not.toHaveBeenCalled();
    unmount();
    expect(raf).not.toHaveBeenCalled();
  });
});
