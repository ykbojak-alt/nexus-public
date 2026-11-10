'use client';

/**
 * W49: Command Palette (Ctrl+Shift+P) — fuzzy-поиск команд, как в herdr.
 *
 * Команды: focus-терминал, spawn программы, kill, rename, share.
 * Открытие: Ctrl+Shift+P (глобально). Фильтр — подстрока по словам.
 */

import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import type { NewfBridge, TermSummary } from './newf-live';
import styles from './newf-agents-panel.module.css';

export interface CommandPaletteProps {
  bridge: NewfBridge;
  terms: TermSummary[];
  onFocus?: (term: string) => void;
  onShare?: (term: string) => void;
  onRename?: (term: string, name: string) => void;
  onOpenFloating?: (address: string) => void;
  /** W774: дополнительные команды (hidden/hotkey) от layout/host. */
  extraCommands?: PaletteCommand[];
}

export interface PaletteCommand {
  id: string;
  label: string;
  action: () => void;
  /** W774: hidden-команды не показываются в списке, но исполняются
   *  при явном выборе (executeCommand) или по hotkey. */
  hidden?: boolean;
  /** W774: хоткей вида 'ctrl+shift+k' — работает при закрытой палитре. */
  hotkey?: string;
}

export interface CommandPaletteHandle {
  /** Явный запуск команды по id (включая hidden). false — id неизвестен. */
  executeCommand: (id: string) => boolean;
}

/** 'ctrl+shift+k' → совпадение с KeyboardEvent. ctrl/mod/cmd/meta =
 *  «primary modifier» — ctrlKey ИЛИ metaKey (как newf-keys: Mod = Ctrl/Cmd). */
export function comboMatches(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split('+').map((s) => s.trim()).filter(Boolean);
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1));
  const wantPrimary = mods.has('ctrl') || mods.has('mod') || mods.has('cmd') || mods.has('meta');
  const wantShift = mods.has('shift');
  const wantAlt = mods.has('alt');
  const actualKey = e.key.toLowerCase();
  const keyOk = actualKey === key || (key === 'esc' && e.key === 'Escape') || (key === 'escape' && e.key === 'Escape')
    || (key === 'enter' && e.key === 'Enter') || (key === 'space' && e.key === ' ');
  if (!keyOk) return false;
  if ((e.ctrlKey || e.metaKey) !== wantPrimary) return false;
  if (e.shiftKey !== wantShift) return false;
  if (e.altKey !== wantAlt) return false;
  return true;
}

export function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return true;
  const words = q.split(/\s+/);
  return words.every((w) => text.toLowerCase().includes(w));
}

export function buildCommands({ bridge, terms, onFocus, onShare, onRename, onOpenFloating }: CommandPaletteProps): PaletteCommand[] {
  const cmds: PaletteCommand[] = [];

  for (const t of terms) {
    cmds.push({ id: `focus-${t.name}`, label: `Focus ${t.name}`, action: () => onFocus?.(t.name) });
    cmds.push({ id: `kill-${t.name}`, label: `Kill ${t.name}`, action: () => void bridge.kill?.(t.name) });
    cmds.push({ id: `rename-${t.name}`, label: `Rename ${t.name}`, action: () => {
      const name = window.prompt('Alias?', t.name);
      if (!name) return;
      // W774: реальное переименование — POST /terminal/{n}/rename (как ctx-menu);
      // локальный onRename обновляет отображаемое имя после успеха.
      if (bridge.renameTerminal) {
        void bridge.renameTerminal(t.name, name)
          .then(() => onRename?.(t.name, name))
          .catch((e) => window.alert(`rename failed: ${e instanceof Error ? e.message : e}`));
      } else {
        onRename?.(t.name, name);
      }
    } });
    // W774: Share — реальный поток через onShare (grid открывает ShareDialog
    // с bridge.shareCreate); fallback на локальный выбор, если диалога нет.
    cmds.push({ id: `share-${t.name}`, label: `Share ${t.name}`, action: () => onShare?.(t.name) });
  }

  if (bridge.runProgram) {
    cmds.push({ id: 'spawn', label: 'Spawn terminal (programs…)', action: () => {
      const name = window.prompt('Program id (claude/gobl/…)?');
      if (name) void bridge.runProgram?.(name).then((r) => onOpenFloating?.(r.address));
    } });
  }

  return cmds;
}

export function CommandPalette({ bridge, terms, onFocus, onShare, onRename, onOpenFloating, extraCommands, ref }: CommandPaletteProps & { ref?: Ref<CommandPaletteHandle> }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const lastFocusRef = useRef<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const commands = useMemo(
    () => [...buildCommands({ bridge, terms, onFocus, onShare, onRename, onOpenFloating }), ...(extraCommands ?? [])],
    [bridge, terms, onFocus, onShare, onRename, onOpenFloating, extraCommands],
  );
  const commandsRef = useRef(commands);
  commandsRef.current = commands;

  // W774: явный запуск по id — включая hidden-команды (вне списка).
  const executeCommand = useMemo(() => {
    return (id: string): boolean => {
      const cmd = commandsRef.current.find((c) => c.id === id);
      if (!cmd) return false;
      cmd.action();
      return true;
    };
  }, []);

  useImperativeHandle(ref, () => ({ executeCommand }), [executeCommand]);

  // W774: hotkey-команды исполняются при закрытой палитре.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open) return;
      for (const c of commandsRef.current) {
        if (c.hotkey && comboMatches(e, c.hotkey)) {
          e.preventDefault();
          c.action();
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // W63+W774: focus-restore — возвращаем фокус на элемент, бывший до палитры,
  // ТОЛЬКО если action не увёл фокус на реальный элемент (терминал и т.п.).
  const close = () => {
    const active = document.activeElement;
    const focusLost = !active || active === document.body || (rootRef.current?.contains(active) ?? false);
    setOpen(false);
    const prev = lastFocusRef.current;
    if (focusLost && prev && document.contains(prev)) prev.focus();
    lastFocusRef.current = null;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        if (!open) {
          lastFocusRef.current = document.activeElement as HTMLElement | null;
          setOpen(true);
        } else {
          close();
        }
        setQuery('');
        setSel(0);
      }
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // W774: hidden-команды не попадают в список — только явный вызов/hotkey.
  const filtered = useMemo(() => commands.filter((c) => !c.hidden && fuzzyMatch(query, c.label)), [commands, query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, Math.max(filtered.length - 1, 0))); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
      if (e.key === 'Enter') {
        e.preventDefault();
        // W63: guard — команда только если индекс в пределах отрендеренных результатов.
        const cmd = filtered[sel];
        if (!cmd) return;
        cmd.action();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filtered, sel]);

  if (!open) return null;

  return (
    <div ref={rootRef} className={styles.palette} data-testid="command-palette" role="dialog" aria-label="Command palette">
      <div className={styles.paletteInputRow}>
        <span className={styles.palettePrompt}>❯</span>
        <input
          autoFocus
          className={styles.paletteInput}
          data-testid="palette-input"
          placeholder="Команда…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSel(0); }}
        />
      </div>
      <ul className={styles.paletteList}>
        {filtered.slice(0, 12).map((c, i) => (
          <li key={c.id}>
            <button
              type="button"
              className={`${styles.paletteItem} ${i === sel ? styles.filterActive : ''}`}
              data-testid={`palette-cmd-${c.id}`}
              onClick={() => { c.action(); close(); }}
            >{c.label}</button>
          </li>
        ))}
        {filtered.length === 0 && <li className={styles.empty}>нет команд</li>}
      </ul>
    </div>
  );
}

export default CommandPalette;
