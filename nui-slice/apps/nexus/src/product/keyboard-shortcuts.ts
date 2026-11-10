/** Product hotkeys with visible UI affordances. Arrow-key widget navigation
 * remains component-local; window/bar drag arrows are documented separately. */
export type ShortcutId =
  | 'palette.alt0'
  | 'palette.modk'
  | 'shortcuts.help'
  | 'dock.toggle'
  | 'dock.toggle.alt'
  | 'modal.dismiss'
  | 'composer.submit'
  | 'composer.newline'
  | `rail.section.${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;

export type ShortcutModifier = 'Mod' | 'Alt';

export interface KeyboardShortcut {
  id: ShortcutId;
  key: string;
  modifiers: readonly ShortcutModifier[];
  hint: string;
  description: string;
  allowShift?: boolean;
}

export interface KeyboardShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Canonical product bindings; Mod means Ctrl on Windows/Linux and Cmd on macOS. */
export const KEYBOARD_SHORTCUTS: readonly KeyboardShortcut[] = [
  { id: 'palette.alt0', key: '0', modifiers: ['Alt'], hint: 'Alt+0', description: 'Открыть командную палитру' },
  { id: 'palette.modk', key: 'k', modifiers: ['Mod'], hint: 'Ctrl/Cmd+K', description: 'Открыть командную палитру' },
  { id: 'shortcuts.help', key: '?', modifiers: [], hint: '?', description: 'Справка по шорткатам', allowShift: true },
  { id: 'dock.toggle', key: 'b', modifiers: ['Mod'], hint: 'Ctrl/Cmd+B', description: 'Показать или скрыть правую панель' },
  { id: 'dock.toggle.alt', key: 'b', modifiers: ['Alt'], hint: 'Alt+B', description: 'Показать или скрыть правую панель' },
  { id: 'modal.dismiss', key: 'Escape', modifiers: [], hint: 'Esc', description: 'Закрыть меню или отменить действие' },
  { id: 'composer.submit', key: 'Enter', modifiers: [], hint: 'Enter', description: 'Запустить прогон из композитора' },
  { id: 'composer.newline', key: 'Enter', modifiers: ['Mod'], hint: 'Ctrl/Cmd+Enter', description: 'Вставить новую строку в композитор', allowShift: true },
  ...Array.from({ length: 9 }, (_, index) => {
    const number = (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
    return {
      id: `rail.section.${number}` as const,
      key: String(number),
      modifiers: ['Alt'] as const,
      hint: `Alt+${number}`,
      description: `Перейти в раздел ${number}`,
    };
  }),
];

function chordOf(shortcut: KeyboardShortcut): string {
  return `${[...shortcut.modifiers].sort().join('+')}${shortcut.modifiers.length ? '+' : ''}${shortcut.key.toLowerCase()}`;
}

export function findKeyboardShortcutConflicts(
  shortcuts: readonly KeyboardShortcut[] = KEYBOARD_SHORTCUTS,
): Array<{ chord: string; ids: ShortcutId[] }> {
  const byChord = new Map<string, ShortcutId[]>();
  for (const shortcut of shortcuts) {
    const chord = chordOf(shortcut);
    byChord.set(chord, [...(byChord.get(chord) ?? []), shortcut.id]);
  }
  return [...byChord]
    .filter(([, ids]) => ids.length > 1)
    .map(([chord, ids]) => ({ chord, ids }));
}

export function matchKeyboardShortcut(event: KeyboardShortcutEvent): KeyboardShortcut | null {
  const hasMod = event.ctrlKey || event.metaKey;
  const actualModifiers = new Set<ShortcutModifier>([
    ...(hasMod ? ['Mod' as const] : []),
    ...(event.altKey ? ['Alt' as const] : []),
  ]);
  return KEYBOARD_SHORTCUTS.find((shortcut) =>
    shortcut.key.toLowerCase() === event.key.toLowerCase()
    && shortcut.modifiers.length === actualModifiers.size
    && shortcut.modifiers.every((modifier) => actualModifiers.has(modifier))
    && (shortcut.allowShift === true || !event.shiftKey),
  ) ?? null;
}

export function matchesShortcut(event: KeyboardShortcutEvent, id: ShortcutId): boolean {
  return matchKeyboardShortcut(event)?.id === id;
}

export function shortcutHint(id: ShortcutId): string {
  return KEYBOARD_SHORTCUTS.find((shortcut) => shortcut.id === id)?.hint ?? '';
}
