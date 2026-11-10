'use client';

/**
 * W66: keys.json-эквивалент (herdr keys.json {global,terminal}) —
 * пользовательские биндинги + дефолты. Чтение: localStorage newf.keys.v1
 * (формат {global: {<name>: combo}, terminal: {...}}), валидация,
 * fallback на дефолты. getKeyBinding(name) — каноничный доступ.
 */

export const NEWF_KEYS_STORAGE = 'newf.keys.v1';

export interface KeyBindingMap {
  [name: string]: string;
}

export interface NewfKeysConfig {
  global: KeyBindingMap;
  terminal: KeyBindingMap;
}

/** Дефолтные биндинги (канон herdr: palette Ctrl+P, cycle Ctrl+Tab, close Esc). */
export const DEFAULT_KEYS: NewfKeysConfig = {
  global: {
    palette: 'ctrl+p',
    paletteFallback: 'ctrl+shift+p',
    focusNextPanel: 'ctrl+tab',
    focusPrevPanel: 'ctrl+shift+tab',
    close: 'escape',
    layoutNext: 'ctrl+shift+l',
    help: '?',
  },
  terminal: {
    interrupt: 'ctrl+c',
    eof: 'ctrl+d',
    kill: 'ctrl+\\',
    lineEnter: 'enter',
    backspace: 'backspace',
    tab: 'tab',
    up: 'up',
    down: 'down',
    left: 'left',
    right: 'right',
    home: 'home',
    end: 'end',
    pageUp: 'pgup',
    pageDown: 'pagedown',
  },
};

function isMap(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function sanitizeMap(src: unknown): KeyBindingMap {
  const out: KeyBindingMap = {};
  if (isMap(src)) {
    for (const [k, v] of Object.entries(src)) {
      if (typeof v === 'string' && v.trim()) out[k] = v.trim().toLowerCase();
    }
  }
  return out;
}

export function readUserKeys(): NewfKeysConfig {
  try {
    const raw = window.localStorage.getItem(NEWF_KEYS_STORAGE);
    if (!raw) return DEFAULT_KEYS;
    const parsed = JSON.parse(raw) as unknown;
    if (!isMap(parsed)) return DEFAULT_KEYS;
    return {
      global: sanitizeMap(parsed.global),
      terminal: sanitizeMap(parsed.terminal),
    };
  } catch { return DEFAULT_KEYS; }
}

export function writeUserKeys(keys: NewfKeysConfig): void {
  try { window.localStorage.setItem(NEWF_KEYS_STORAGE, JSON.stringify(keys)); } catch { /* noop */ }
}

/** Каноничный доступ: getKeyBinding('palette') → 'ctrl+p' (из user или default). */
export function getKeyBinding(name: string, scope: 'global' | 'terminal' = 'global'): string {
  const user = readUserKeys();
  return (scope === 'terminal' ? user.terminal[name] : user.global[name]) ?? DEFAULT_KEYS[scope][name] ?? '';
}

export function isEscape(e: KeyboardEvent): boolean {
  return e.key === 'Escape';
}

/** Ctrl+Tab / Ctrl+Shift+Tab (cycle по панелям). Возвращает true если обработано. */
export function isPanelCycle(e: KeyboardEvent): 'next' | 'prev' | null {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'tab') {
    return e.shiftKey ? 'prev' : 'next';
  }
  return null;
}

export default DEFAULT_KEYS;
