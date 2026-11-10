/* wave-XVII W3: DOM-тест стеклянных слоёв — теперь пакетный
 * GlassSurface из @nexus/ui (замена временной обёртки #53).
 * Проверяем маркировку поверхности (variant-класс + data-persona),
 * через которую CSS накладывает backdrop-filter; сам блюр в jsdom не
 * вычисляется — слои верифицируются по классам-носителям и атрибутам.
 * Контракт токенов/контраста живёт в @nexus/ui (glass-bars.test.tsx). */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GlassSurface } from '@nexus/ui';

describe('GlassSurface (пакет @nexus/ui) — стеклянный слой', () => {
  it('variant rail/topbar/card/statusbar + persona tone маркируются', () => {
    render(
      <>
        <GlassSurface variant="rail" tone="alice">rail</GlassSurface>
        <GlassSurface variant="topbar">topbar</GlassSurface>
        <GlassSurface variant="card" tone="nexus">card</GlassSurface>
        <GlassSurface variant="statusbar" tone="forge">status</GlassSurface>
      </>,
    );
    const layers = ['rail', 'topbar', 'card', 'status'].map((t) => screen.getByText(t));
    expect(layers).toHaveLength(4);
    for (const l of layers) expect(l.className).toMatch(/root/);
    expect(layers[0].className).toMatch(/rail/);
    expect(layers[1].className).toMatch(/topbar/);
    expect(layers[2].className).toMatch(/card/);
    expect(layers[3].className).toMatch(/statusbar/);
    expect(layers[0].getAttribute('data-persona')).toBe('alice');
    expect(layers[1].getAttribute('data-persona')).toBeNull();
    expect(layers[2].getAttribute('data-persona')).toBe('nexus');
    expect(layers[3].getAttribute('data-persona')).toBe('forge');
  });

  it('data-* и className потребителя пробрасываются (data-state/testid)', () => {
    render(<GlassSurface variant="card" tone="alice" className="railPanel" data-state="ready" data-testid="home-voice">x</GlassSurface>);
    const el = screen.getByTestId('home-voice');
    expect(el.getAttribute('data-state')).toBe('ready');
    expect(el.className).toContain('railPanel');
  });
});
