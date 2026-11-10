// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GeneratedImage } from '@nexus/mock-data';
import type { ProductDataSource } from '../data-source';
import { MediaScreen } from './media';

vi.mock('next/navigation', () => ({
  usePathname: () => '/media',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('../../integrations/local-audio/local-audio-adapter', () => ({
  LocalAudioAdapter: class {
    state = { queue: [], trackState: {}, rejected: [], currentId: null, playing: false, currentTime: 0, duration: 0, volume: 1, muted: false };
    subscribe() { return () => { }; }
    index() { return -1; }
    dispose() { }
    clear() { }
    addFiles() { }
    togglePlay() { }
    prev() { }
    next() { }
    seek() { }
    setVolume() { }
    setMuted() { }
    select() { }
  },
}));

let dsStub: ProductDataSource;
vi.mock('../data-source', () => ({
  getDataSource: () => dsStub,
  useDataSource: () => dsStub,
  getDataSourceKind: () => 'mock',
}));

const image: GeneratedImage = {
  imageB64: 'QUJD',
  mime: 'image/png',
  bytes: 2048,
  model: 'provider/image-1',
  costUsd: null,
  prompt: 'пейзаж',
  enrichedPrompt: 'пейзаж, cinematic light',
  enriched: true,
};

const capsOk = () => Promise.resolve({
  features: { imageGen: { supported: true, reason: null, models: ['a/image-1', 'b/image-2'] } },
} as never);

describe('MediaScreen — image generation (INT-23)', () => {
  it('seam absent → unavailable, no form', async () => {
    dsStub = {} as ProductDataSource;
    render(<MediaScreen />);
    const panel = screen.getByTestId('media-imagegen');
    expect(panel.getAttribute('data-state')).toBe('unavailable');
    expect(panel.textContent).toContain('не предоставляет генерацию');
    expect(screen.queryByLabelText('Запрос генерации изображения')).toBeNull();
  });

  it('feature supported=false → unavailable with host reason verbatim', async () => {
    const generateImage = vi.fn();
    dsStub = {
      generateImage,
      getCapabilities: () => Promise.resolve({
        features: { imageGen: { supported: false, reason: 'image keys not configured', models: [] } },
      } as never),
    } as unknown as ProductDataSource;
    render(<MediaScreen />);
    const panel = screen.getByTestId('media-imagegen');
    await waitFor(() => expect(panel.getAttribute('data-state')).toBe('unavailable'));
    expect(panel.textContent).toContain('image keys not configured');
    expect(generateImage).not.toHaveBeenCalled();
  });

  it('supported → form renders models, generate returns image with honest meta', async () => {
    const generateImage = vi.fn().mockResolvedValue(image);
    dsStub = { generateImage, getCapabilities: capsOk } as unknown as ProductDataSource;
    render(<MediaScreen />);
    const panel = screen.getByTestId('media-imagegen');
    await waitFor(() => expect(panel.getAttribute('data-state')).toBe('ready'));

    fireEvent.change(screen.getByLabelText('Запрос генерации изображения'), { target: { value: 'пейзаж' } });
    fireEvent.change(screen.getByLabelText('Модель генерации'), { target: { value: 'b/image-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сгенерировать' }));

    await waitFor(() => expect(generateImage).toHaveBeenCalledWith({ prompt: 'пейзаж', model: 'b/image-2', enrich: true }));
    const img = await screen.findByAltText('пейзаж');
    expect(img.getAttribute('src')).toBe('data:image/png;base64,QUJD');
    // costUsd null → honest 'н/д', enriched prompt shown verbatim
    expect(panel.textContent).toContain('н/д');
    expect(panel.textContent).toContain('provider/image-1');
    expect(panel.textContent).toContain('пейзаж, cinematic light');
  });

  it('generate rejection surfaces the host message via role=alert', async () => {
    const { Ai2ApiError } = await import('../../integrations/ai2/api/errors');
    const generateImage = vi.fn().mockRejectedValue(new Ai2ApiError(503, { message: 'image generation is not configured' }));
    dsStub = { generateImage, getCapabilities: capsOk } as unknown as ProductDataSource;
    render(<MediaScreen />);
    await waitFor(() => expect(screen.getByTestId('media-imagegen').getAttribute('data-state')).toBe('ready'));
    fireEvent.change(screen.getByLabelText('Запрос генерации изображения'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сгенерировать' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('image generation is not configured');
  });
});
