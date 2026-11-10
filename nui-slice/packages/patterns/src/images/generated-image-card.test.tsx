import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { GeneratedImageCard, type GeneratedImage } from './generated-image-card';

afterEach(cleanup);

const IMG: GeneratedImage = {
  imageB64: 'aGVsbG8=',
  mime: 'image/png',
  bytes: 2048,
  model: 'vendor/img-x',
  costUsd: null,
  prompt: 'obsidian shield, glass panel',
  enrichedPrompt: 'obsidian shield, glass panel, bronze frame, soft light',
  enriched: true,
};

describe('GeneratedImageCard — honest INT-23 states', () => {
  it('renders image with prompt alt and "cost unknown" when provider gave no price', () => {
    render(<GeneratedImageCard image={IMG} />);
    const img = screen.getByTestId('generated-image') as HTMLImageElement;
    expect(img.src).toBe('data:image/png;base64,aGVsbG8=');
    expect(img.alt).toBe('obsidian shield, glass panel');
    expect(screen.getByTestId('generated-image-cost').textContent).toBe('неизвестна');
    expect(screen.getByTestId('generated-image-model').textContent).toBe('vendor/img-x');
  });

  it('shows real cost only when provider reported it — unknown is never zero', () => {
    render(<GeneratedImageCard image={{ ...IMG, costUsd: 0.07 }} />);
    expect(screen.getByTestId('generated-image-cost').textContent).toBe('$0.0700');
  });

  it('shows enriched prompt verbatim only when enrichment actually ran', () => {
    const { unmount } = render(<GeneratedImageCard image={IMG} />);
    expect(screen.getByTestId('generated-image-enriched').textContent).toContain('bronze frame');
    unmount();
    render(<GeneratedImageCard image={{ ...IMG, enriched: false, enrichedPrompt: null }} />);
    expect(screen.queryByTestId('generated-image-enriched')).toBeNull();
  });

  it('unavailable renders host reason verbatim, no img, no hidden call', () => {
    render(<GeneratedImageCard image={null} state="unavailable" unavailableReason="ключи провайдера не настроены — INT-23" />);
    expect(screen.getByTestId('generated-image-reason').textContent).toContain('ключи провайдера не настроены');
    expect(screen.queryByTestId('generated-image')).toBeNull();
    expect(screen.getByText('НЕДОСТУПНО')).toBeInTheDocument();
  });

  it('stale keeps last-known image with the stale badge', () => {
    render(<GeneratedImageCard image={IMG} state="stale" freshness="stale" />);
    expect(screen.getByTestId('generated-image')).toBeInTheDocument();
    expect(screen.getByText('УСТАРЕЛО')).toBeInTheDocument();
    expect(screen.getByTestId('generated-image-card')).toHaveAttribute('data-freshness', 'stale');
  });
});
