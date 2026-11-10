import { describe, expect, it } from 'vitest';
import {
  KEYBOARD_SHORTCUTS,
  findKeyboardShortcutConflicts,
  matchKeyboardShortcut,
  shortcutHint,
  type KeyboardShortcut,
} from './keyboard-shortcuts';

function key(
  value: string,
  modifiers: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>> = {},
): KeyboardEvent {
  return { key: value, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...modifiers } as KeyboardEvent;
}

describe('keyboard shortcut registry', () => {
  it('has no duplicate chords', () => {
    expect(findKeyboardShortcutConflicts()).toEqual([]);
  });

  it('keeps every registered action discoverable with a non-empty exact hint', () => {
    const expected = [
      ['palette.alt0', 'Alt+0'],
      ['palette.modk', 'Ctrl/Cmd+K'],
      ['shortcuts.help', '?'],
      ['dock.toggle', 'Ctrl/Cmd+B'],
      ['dock.toggle.alt', 'Alt+B'],
      ['modal.dismiss', 'Esc'],
      ['composer.submit', 'Enter'],
      ['composer.newline', 'Ctrl/Cmd+Enter'],
      ...Array.from({ length: 9 }, (_, i) => [`rail.section.${i + 1}`, `Alt+${i + 1}`]),
    ];
    expect(KEYBOARD_SHORTCUTS.map(({ id, hint }) => [id, hint])).toEqual(expected);
    expect(KEYBOARD_SHORTCUTS.every(({ description, hint }) => description.length > 0 && hint.length > 0)).toBe(true);
  });

  it('reports duplicate chords when two actions claim the same binding', () => {
    const collision: KeyboardShortcut[] = [
      { id: 'palette.modk', key: 'k', modifiers: ['Mod'], hint: 'Ctrl/Cmd+K', description: 'Поиск' },
      { id: 'dock.toggle', key: 'K', modifiers: ['Mod'], hint: 'Ctrl/Cmd+K', description: 'Док' },
    ];
    expect(findKeyboardShortcutConflicts(collision)).toEqual([
      { chord: 'Mod+k', ids: ['palette.modk', 'dock.toggle'] },
    ]);
  });

  it('matches Mod on Ctrl and Meta, and keeps Alt bindings distinct', () => {
    expect(matchKeyboardShortcut(key('k', { ctrlKey: true }))?.id).toBe('palette.modk');
    expect(matchKeyboardShortcut(key('k', { metaKey: true }))?.id).toBe('palette.modk');
    expect(matchKeyboardShortcut(key('0', { altKey: true }))?.id).toBe('palette.alt0');
    expect(matchKeyboardShortcut(key('b', { altKey: true }))?.id).toBe('dock.toggle.alt');
    expect(matchKeyboardShortcut(key('b', { ctrlKey: true }))?.id).toBe('dock.toggle');
    expect(matchKeyboardShortcut(key('b', { altKey: true, ctrlKey: true }))).toBeNull();
  });

  it('keeps Ctrl/Cmd+Enter line insertion compatible with Shift+Enter', () => {
    expect(matchKeyboardShortcut(key('Enter'))?.id).toBe('composer.submit');
    expect(matchKeyboardShortcut(key('Enter', { ctrlKey: true }))?.id).toBe('composer.newline');
    expect(matchKeyboardShortcut(key('Enter', { metaKey: true, shiftKey: true }))?.id).toBe('composer.newline');
  });

  it('matches rail navigation and modal Escape; exposes Russian-use hints', () => {
    expect(matchKeyboardShortcut(key('3', { altKey: true }))?.id).toBe('rail.section.3');
    expect(matchKeyboardShortcut(key('Escape'))?.id).toBe('modal.dismiss');
    expect(shortcutHint('palette.alt0')).toBe('Alt+0');
    expect(shortcutHint('palette.modk')).toBe('Ctrl/Cmd+K');
    expect(shortcutHint('modal.dismiss')).toBe('Esc');
  });
});
