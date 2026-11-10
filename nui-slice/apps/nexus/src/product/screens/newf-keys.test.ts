// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import {
  DEFAULT_KEYS,
  getKeyBinding,
  isEscape,
  isPanelCycle,
  readUserKeys,
  writeUserKeys,
} from './newf-keys';

afterEach(() => { cleanup(); window.localStorage.clear(); });

describe('newf-keys (W66)', () => {
  it('дефолты: palette Ctrl+P, cycle Ctrl+Tab, close Esc', () => {
    expect(getKeyBinding('palette')).toBe('ctrl+p');
    expect(getKeyBinding('focusNextPanel')).toBe('ctrl+tab');
    expect(getKeyBinding('close')).toBe('escape');
    expect(getKeyBinding('interrupt', 'terminal')).toBe('ctrl+c');
    expect(DEFAULT_KEYS.global.paletteFallback).toBe('ctrl+shift+p');
  });

  it('user-конфиг из localStorage перекрывает дефолты; битый → дефолт', () => {
    expect(getKeyBinding('palette')).toBe('ctrl+p');
    writeUserKeys({ global: { palette: 'ctrl+f9' }, terminal: {} });
    expect(getKeyBinding('palette')).toBe('ctrl+f9');
    expect(getKeyBinding('focusNextPanel')).toBe('ctrl+tab'); // не тронут

    // не-JSON → дефолты целиком
    window.localStorage.setItem('newf.keys.v1', '{oops');
    expect(readUserKeys()).toEqual(DEFAULT_KEYS);
    // не-объект → дефолты
    window.localStorage.setItem('newf.keys.v1', '"str"');
    expect(readUserKeys()).toEqual(DEFAULT_KEYS);
    // объект с битым полем → поле пустое (не дефолт, слит мусор)
    window.localStorage.setItem('newf.keys.v1', '{"global": "bad"}');
    expect(readUserKeys()).toEqual({ global: {}, terminal: {} });
  });

  it('isEscape / isPanelCycle', () => {
    expect(isEscape({ key: 'Escape' } as KeyboardEvent)).toBe(true);
    expect(isEscape({ key: 'a' } as KeyboardEvent)).toBe(false);
    expect(isPanelCycle({ key: 'Tab', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent)).toBe('next');
    expect(isPanelCycle({ key: 'Tab', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true } as KeyboardEvent)).toBe('prev');
    expect(isPanelCycle({ key: 'Tab', ctrlKey: false, metaKey: true, altKey: false, shiftKey: false } as KeyboardEvent)).toBe('next');
    expect(isPanelCycle({ key: 'Tab', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent)).toBeNull();
  });
});
