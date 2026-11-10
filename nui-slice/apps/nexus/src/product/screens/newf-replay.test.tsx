// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { parseCast, ReplayPlayer } from './newf-replay';

afterEach(cleanup);

const CAST = [
  '[0.0, 0.1, "o", "hello "]',
  '[0.1, 0.2, "o", "world\\r\\n"]',
  '[0.3, 0.1, "o", "prompt> "]',
].join('\n');

describe('parseCast (W16)', () => {
  it('парсит .cast → frames (только type=o)', () => {
    const frames = parseCast(CAST);
    expect(frames).toHaveLength(3);
    expect(frames[0]).toMatchObject({ data: 'hello ' });
    expect(frames[1].delay).toBe(0.2);
  });
});

describe('ReplayPlayer (W16)', () => {
  it('рендеририт управление и seek-вывод', () => {
    render(<ReplayPlayer castText={CAST} />);
    expect(screen.getByTestId('replay-player')).toBeInTheDocument();
    expect(screen.getByTestId('replay-play')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('replay-seek'), { target: { value: '2' } });
    expect(screen.getByTestId('replay-output')).toHaveTextContent('hello world');
  });

  it('play увеличивает позицию; speed 2x доступен', async () => {
    vi.useFakeTimers();
    render(<ReplayPlayer castText={CAST} />);
    fireEvent.click(screen.getByTestId('replay-play'));
    fireEvent.click(screen.getByTestId('replay-speed-2'));
    await vi.advanceTimersByTimeAsync(500);
    expect(Number(screen.getByTestId('replay-position').textContent?.split('/')[0] ?? 0)).toBeGreaterThan(0);
    vi.useRealTimers();
  });
});
