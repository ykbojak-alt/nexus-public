import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TypingIndicator } from './typing-indicator';

afterEach(cleanup);

describe('TypingIndicator (W4-1020)', () => {
  it('renders three cascading dots and a localized status label', () => {
    render(<TypingIndicator label="AGENT-A печатает…" />);
    const indicator = screen.getByRole('status', { name: 'AGENT-A печатает…' });
    expect(indicator).toHaveAttribute('data-typing-indicator', 'dots-cascade');
    expect(indicator.querySelectorAll('[aria-hidden="true"] > span')).toHaveLength(3);
  });

  it('declares tokenized cascade motion and a static reduced-motion path', () => {
    const css = readFileSync(join(__dirname, 'typing-indicator.module.css'), 'utf8');
    expect(css).toContain('animation: dotsCascade var(--nexus-motion-pulse, 1100ms)');
    expect(css).toContain('cubic-bezier(var(--nexus-easing-enter');
    expect(css.match(/animation-delay:/g)).toHaveLength(2);
    expect(css).toContain('var(--nexus-duration-fast, 140ms)');
    expect(css).toMatch(/@keyframes dotsCascade[\s\S]*24%[\s\S]*opacity:\s*1;[\s\S]*translateY\(-3px\)/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).toMatch(/\.dots\s*\{\s*display:\s*none;/);
    expect(css).toMatch(/\.dot\s*\{\s*animation:\s*none;/);
  });
});
