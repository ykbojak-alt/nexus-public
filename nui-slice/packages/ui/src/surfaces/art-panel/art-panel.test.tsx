import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { describe, expect, it } from 'vitest';
import { ArtPanel } from './art-panel';

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'art-panel.module.css'), 'utf8');

describe('ArtPanel no-art theme contrast', () => {
  it('uses semantic primary text on the plain panel and retains full content', async () => {
    const longCopy =
      'Развёрнутая причина состояния должна оставаться читаемой на панели без изображения в обеих основных темах и сохраняться целиком.';
    const { container } = render(
      <ArtPanel>
        <p>{longCopy}</p>
      </ArtPanel>,
    );
    const panel = screen.getByTestId('art-panel');
    expect(panel).not.toHaveAttribute('data-has-art');
    expect(panel).toHaveTextContent(longCopy);
    expect(CSS).toMatch(/\.root:not\(\[data-has-art\]\)\s*\{\s*color:\s*var\(--nexus-text-primary/);
    expect(await axe(container)).toHaveNoViolations();
  });
});
