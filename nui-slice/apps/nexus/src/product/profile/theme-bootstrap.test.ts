// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { THEME_BOOTSTRAP_SCRIPT } from './theme-bootstrap';

const runBootstrap = () => new Function(THEME_BOOTSTRAP_SCRIPT)();

describe('pre-paint theme bootstrap', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-density');
    document.documentElement.style.colorScheme = '';
    localStorage.clear();
  });

  it('applies a saved dark theme and density synchronously', () => {
    localStorage.setItem('nexus.profile.v1', JSON.stringify({
      themeId: 'aurum-dark',
      density: 'dense',
    }));

    runBootstrap();

    expect(document.documentElement.dataset.theme).toBe('aurum-dark');
    expect(document.documentElement.dataset.density).toBe('dense');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('applies the saved light theme before paint instead of the dark default', () => {
    localStorage.setItem('nexus.profile.v1', JSON.stringify({ themeId: 'alice' }));

    runBootstrap();

    expect(document.documentElement.dataset.theme).toBe('alice');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('keeps the first visit dark when the system prefers dark and no profile exists', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: true, media: '(prefers-color-scheme: dark)' }),
    });

    runBootstrap();

    expect(document.documentElement.dataset.theme).toBe('nexus');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('falls back to the canonical dark theme for malformed or unknown profiles', () => {
    localStorage.setItem('nexus.profile.v1', JSON.stringify({ themeId: 'unknown-theme', density: 'wide' }));

    runBootstrap();

    expect(document.documentElement.dataset.theme).toBe('nexus');
    expect(document.documentElement.dataset.density).toBe('standard');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });
});
