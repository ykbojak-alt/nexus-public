/**
 * Shared DOM test harness (Window 5, Task 4 / storybook-harness-contract).
 * Loaded via vitest `setupFiles` for the `dom` project — jest-dom matchers,
 * RTL cleanup and jest-axe matchers are guaranteed for every *.test.tsx;
 * individual test files must NOT re-register them.
 *
 * Axe usage in tests: `const results = await axe(container);`
 * `expect(results).toHaveNoViolations()` — jsdom-level checks only;
 * browser-level checks (color contrast, layout, focus visibility) run in
 * Playwright via @axe-core/playwright and are out of scope here.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

afterEach(cleanup);

// Environment stubs — jsdom lacks these browser APIs; screens guard or
// degrade on them, so stubs must exist once here, not per test file
// (wave-4 W5-11: was duplicated in chess/durak screen.test.tsx).
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
        matches: false,
        media: q,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    })) as never;
}

// jsdom has no canvas 2d backend — components must exit gracefully on
// null ctx (durak matrix-rain does). Stubbed globally so every suite sees
// the same honest environment instead of a jsdom "not implemented" throw.
if (typeof HTMLCanvasElement !== 'undefined') {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null) as never;
}

// WAAPI stub: jsdom lacks Element.animate — screens feature-detect it and
// degrade. Stubbed globally so tests exercise the SAME animated path a
// browser takes (already-resolved finished promise, no side effects).
if (typeof Element !== 'undefined' && typeof Element.prototype.animate !== 'function') {
    Element.prototype.animate = vi.fn().mockImplementation(() => ({
        finished: Promise.resolve(),
        onfinish: null,
        cancel: vi.fn(),
        finish: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
    })) as never;
}

// ScrollIntoView stub: jsdom не даёт Element.prototype.scrollIntoView, а экраны
// зовут его безусловно после вставки bubble (home.tsx:219) — тесты падали на
// typeof-ошибке (W0, регресс 4f6140a7). Заглушка один раз здесь, а не в тесте.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = vi.fn() as never;
}

// localStorage/sessionStorage harness for jsdom — jsdom reports a present
// but non-functional localStorage (plain object whose getItem always returns
// undefined). Probe it: replace only when it misbehaves, and only then.
// Storage-like objects use an internal map so setItem/getItem round-trip
// (components persist state; tests read it back).
function functionalStorage(): boolean {
  try {
    const probeKey = '__nexus_storage_probe__';
    window.localStorage.setItem(probeKey, '1');
    const ok = window.localStorage.getItem(probeKey) === '1';
    window.localStorage.removeItem(probeKey);
    return ok;
  } catch {
    return false;
  }
}

function makeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear() { store.clear(); },
    getItem(key: string) { return store.has(key) ? store.get(key)! : null; },
    key(i: number) { return Array.from(store.keys())[i] ?? null; },
    removeItem(key: string) { store.delete(key); },
    setItem(key: string, value: string) { store.set(key, String(value)); },
  } as Storage;
}

if (typeof window !== 'undefined') {
    if (typeof window.localStorage === 'undefined' || !functionalStorage()) {
        Object.defineProperty(window, 'localStorage', {
            value: makeStorage(),
            writable: true,
        });
    }
    if (typeof window.sessionStorage === 'undefined' || !functionalStorage()) {
        Object.defineProperty(window, 'sessionStorage', {
            value: makeStorage(),
            writable: true,
        });
    }
}
