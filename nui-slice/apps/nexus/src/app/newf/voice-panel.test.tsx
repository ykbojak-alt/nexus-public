import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VoicePanel } from './voice-panel';
import { VoiceUiContext } from '../../product/screens/voice-ui';

// jsdom не реализует Audio — ставим заглушку до использования компонента.
describe('VoicePanel (#374 voice-loop UI, #372 полировка)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'Audio', {
      value: vi.fn(() => ({
        play: vi.fn(() => Promise.resolve()),
        pause: vi.fn(),
        onended: null,
        onerror: null,
      })),
      writable: true,
      configurable: true,
    });
  });

  const openState = { open: true, setOpen: () => {}, active: true };
  const closedState = { open: false, setOpen: () => {}, active: true };

  it('без bridgeBase → панель не рендерится (ждать live-мост)', () => {
    const { container } = render(<VoicePanel />);
    expect(container.firstChild).toBeNull();
  });

  it('закрытая (не активная) панель не рендерится — рендерит тоггл экран', () => {
    render(
      <VoiceUiContext.Provider value={closedState}>
        <VoicePanel bridgeBase="http://127.0.0.1:8471" />
      </VoiceUiContext.Provider>,
    );
    expect(screen.queryByRole('dialog', { name: /Голосовая панель/i })).toBeNull();
  });

  it('открытая панель видна со всеми контролами', () => {
    render(
      <VoiceUiContext.Provider value={openState}>
        <VoicePanel bridgeBase="http://127.0.0.1:8471" />
      </VoiceUiContext.Provider>,
    );
    expect(screen.getByRole('dialog', { name: /Голосовая панель/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /Озвучить/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /Микрофон/i })).not.toBeNull();
  });

  it('TTS-запрос уходит на мост /voice/v1/audio/speech (qwen-base/olga)', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => ({ ok: true, status: 200, blob: async () => new Blob(['fake-wav'], { type: 'audio/wav' }) }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(
      <VoiceUiContext.Provider value={openState}>
        <VoicePanel bridgeBase="http://127.0.0.1:8471" />
      </VoiceUiContext.Provider>,
    );

    const textarea = screen.getByRole('textbox', { name: /Текст для озвучки/i });
    await user.type(textarea, 'привет');

    await user.click(screen.getByRole('button', { name: /Озвучить/i }));
    const ttsCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/voice/v1/audio/speech'));
    expect(ttsCall).toBeDefined();
    expect(String(ttsCall![0])).toBe('http://127.0.0.1:8471/voice/v1/audio/speech');
    const body = JSON.parse(ttsCall![1]!.body as string);
    expect(body.model).toBe('qwen-base');
    expect(body.voice).toBe('olga');
    expect(body.input).toBe('привет');

    vi.unstubAllGlobals();
  });

  it('STT offline отображается честно при 502', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 502,
      text: async () => 'backend unreachable',
      blob: async () => new Blob([]),
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <VoiceUiContext.Provider value={openState}>
        <VoicePanel bridgeBase="http://127.0.0.1:8471" />
      </VoiceUiContext.Provider>,
    );
    expect(await screen.findByText(/STT offline/i)).not.toBeNull();

    vi.unstubAllGlobals();
  });
});
