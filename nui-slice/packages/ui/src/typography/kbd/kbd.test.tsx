import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Kbd } from './kbd';

afterEach(cleanup);

describe('Kbd (W2-144)', () => {
  it('renders the key hint as a kbd element', () => {
    render(<Kbd>Ctrl+B</Kbd>);
    const el = screen.getByText('Ctrl+B');
    expect(el.tagName.toLowerCase()).toBe('kbd');
    expect(el).toHaveAttribute('data-kbd', 'sm');
  });

  it('supports md size', () => {
    render(<Kbd size="md">Esc</Kbd>);
    expect(screen.getByText('Esc')).toHaveAttribute('data-kbd', 'md');
  });

  it('declares tokenized chrome (no color literals)', () => {
    const css = readFileSync(join(__dirname, 'kbd.module.css'), 'utf8');
    expect(css).toContain('font: var(--nexus-type-code-font-weight');
    expect(css).toContain('var(--nexus-border-subtle');
    expect(css).toContain('var(--nexus-surface-panel');
    expect(css).toContain('var(--nexus-radius-sm');
  });
});
