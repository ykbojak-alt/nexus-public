// @vitest-environment jsdom
/** Compaction wave W3 — индикатор заполнения контекста до порога
 *  компактизации: реальные токены хоста предпочтительны, сообщения —
 *  измеренный локальный fallback, unavailable — без выдуманного %. */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CHAT_COMPACTION_THRESHOLD_MESSAGES } from './agent-chat-feed';
import { ContextUsageIndicator, contextUsageState } from './context-usage-indicator';

afterEach(cleanup);

const THRESHOLD = CHAT_COMPACTION_THRESHOLD_MESSAGES;

describe('contextUsageState', () => {
  it('норма при доле ниже 75% порога', () => {
    expect(contextUsageState(0, THRESHOLD)).toBe('normal');
    expect(contextUsageState(8, THRESHOLD)).toBe('normal');
    expect(contextUsageState(23, THRESHOLD)).toBe('normal');
  });

  it('«близко» от 75% порога и выше', () => {
    expect(contextUsageState(24, THRESHOLD)).toBe('near');
    expect(contextUsageState(THRESHOLD, THRESHOLD)).toBe('near');
    expect(contextUsageState(THRESHOLD + 3, THRESHOLD)).toBe('near');
  });

  it('компактизация идёт — в приоритете над near', () => {
    expect(contextUsageState(30, THRESHOLD, true)).toBe('compacting');
  });

  it('unavailable без измеримой величины или при битом/необъявленном пороге', () => {
    expect(contextUsageState(null, THRESHOLD)).toBe('unavailable');
    expect(contextUsageState(Number.NaN, THRESHOLD)).toBe('unavailable');
    expect(contextUsageState(5, Number.NaN)).toBe('unavailable');
    expect(contextUsageState(5, 0)).toBe('unavailable');
    expect(contextUsageState(5, -1)).toBe('unavailable');
    expect(contextUsageState(5, null)).toBe('unavailable');
  });
});

describe('ContextUsageIndicator', () => {
  it('норма: реальная доля сообщений, золотая шкала без тона', () => {
    render(<ContextUsageIndicator used={8} total={THRESHOLD} />);
    const root = screen.getByTestId('context-usage-indicator');
    expect(root.dataset.state).toBe('normal');
    expect(screen.getByText(`Контекст диалога · 8 из ${THRESHOLD} сообщений`)).toBeTruthy();
    expect(screen.getByText('25%')).toBeTruthy();
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe('8');
    expect(meter.getAttribute('aria-valuemax')).toBe(String(THRESHOLD));
    expect(root.querySelector('[data-tone]')).toBeNull();
  });

  it('близко к порогу: warn-тон и подпись о близости', () => {
    render(<ContextUsageIndicator used={28} total={THRESHOLD} />);
    const root = screen.getByTestId('context-usage-indicator');
    expect(root.dataset.state).toBe('near');
    expect(screen.getByText(/близок к порогу/)).toBeTruthy();
    expect(screen.getByText('88%')).toBeTruthy();
    expect(root.querySelector('[data-tone="warn"]')).toBeTruthy();
  });

  it('компактизация идёт: «Сжимаю историю…» без выдуманного прогресса', () => {
    render(<ContextUsageIndicator used={30} total={THRESHOLD} compacting />);
    const root = screen.getByTestId('context-usage-indicator');
    expect(root.dataset.state).toBe('compacting');
    expect(screen.getByText('Сжимаю историю…')).toBeTruthy();
    expect(root.querySelector('[data-tone="busy"]')).toBeTruthy();
  });

  it('host-triggered compaction state is visible even when context fill is unknown', () => {
    render(<ContextUsageIndicator used={null} total={THRESHOLD} compacting />);
    const root = screen.getByTestId('context-usage-indicator');
    expect(root.dataset.state).toBe('compacting');
    expect(screen.getByText('Сжимаю историю…')).toBeTruthy();
    expect(screen.queryByRole('meter')).toBeNull();
    expect(root.textContent).not.toContain('%');
  });

  it('unavailable: нет метрики — нет процента и нет 0%', () => {
    render(<ContextUsageIndicator used={null} total={THRESHOLD} />);
    const root = screen.getByTestId('context-usage-indicator');
    expect(root.dataset.state).toBe('unavailable');
    expect(screen.getByText('Контекст диалога недоступен')).toBeTruthy();
    expect(screen.queryByRole('meter')).toBeNull();
    expect(root.textContent).not.toContain('%');
  });

  it('0 сообщений — честный ноль, а не unavailable', () => {
    render(<ContextUsageIndicator used={0} total={THRESHOLD} />);
    const root = screen.getByTestId('context-usage-indicator');
    expect(root.dataset.state).toBe('normal');
    expect(screen.getByText('0%')).toBeTruthy();
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('0');
  });

  it('шкала ограничена 100% при переполнении порога', () => {
    render(<ContextUsageIndicator used={THRESHOLD + 8} total={THRESHOLD} />);
    expect(screen.getByText('100%')).toBeTruthy();
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe(String(THRESHOLD));
    expect(meter.getAttribute('aria-valuetext')).toBe(`${THRESHOLD + 8} из ${THRESHOLD} сообщений`);
  });

  it('реальные токены хоста: заполнение от threshold_tokens, метод в title', () => {
    render(
      <ContextUsageIndicator
        used={63000}
        total={84000}
        unit="tokens"
        usageMethod="run_usage"
      />,
    );
    const root = screen.getByTestId('context-usage-indicator');
    expect(root.dataset.state).toBe('near');
    expect(screen.getByText('Контекст близок к порогу · 63000 из 84000 токенов')).toBeTruthy();
    expect(screen.getByText('75%')).toBeTruthy();
    expect(root.getAttribute('title')).toContain('run_usage');
    expect(screen.getByRole('meter').getAttribute('aria-valuetext')).toBe('63000 из 84000 токенов');
  });

  it('токены измерены, но порог не объявлен хостом — честно без полосы и %', () => {
    render(<ContextUsageIndicator used={12000} total={null} unit="tokens" />);
    const root = screen.getByTestId('context-usage-indicator');
    expect(root.dataset.state).toBe('unavailable');
    expect(screen.getByText('Контекст диалога · 12000 токенов')).toBeTruthy();
    expect(screen.getByText(/порог компактизации не объявлен/i)).toBeTruthy();
    expect(screen.queryByRole('meter')).toBeNull();
    expect(root.textContent).not.toContain('%');
  });

  it('порог композитора совпадает с порогом compact-блока (тот же источник)', () => {
    expect(THRESHOLD).toBe(32);
    render(<ContextUsageIndicator used={THRESHOLD} total={THRESHOLD} />);
    expect(screen.getByText('100%')).toBeTruthy();
  });
});
