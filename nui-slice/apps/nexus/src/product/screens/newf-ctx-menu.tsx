'use client';

/**
 * W40: общий контекст-меню терминала (shared).
 *
 * Используется и в agents-panel, и в terminals-grid (summaryRow).
 * Пропсы: координаты, term, bridge, опциональные колбэки. Все действия —
 * rename/labels/clone/kill/share/snapshot/archive/restart/new-terminal и т.д.
 */

import { useState } from 'react';
import { fetchBridgeApi, type NewfBridge, type LiveTerminal } from './newf-live';

export interface CtxMenuProps {
  bridge: NewfBridge;
  x: number;
  y: number;
  term: string;
  /** Терминалы для гейтов (archive/restart: state). */
  terminals?: LiveTerminal[];
  /** Базовый URL core (для worktree/kill). */
  base?: string;
  /** Закрыть меню (обязательно). */
  onClose: () => void;
  /** Открыть floating-терминал (опционально). */
  onOpenFloating?: (address: string) => void;
  /** Открыть share-диалог (опционально). */
  onShare?: (term: string) => void;
  /** Сеттер алиаса (rename) — локальный для владельца (опционально). */
  onRename?: (term: string, name: string) => void;
  /** Вернуть label (для rename-подсказки). */
  labelFor?: (term: string) => string;
  /** Гейт программ (capability). */
  programsCapable?: boolean;
}

export function NewfCtxMenu({
  bridge, x, y, term, terminals = [], base = '', onClose,
  onOpenFloating, onShare, onRename, labelFor, programsCapable = true,
}: CtxMenuProps) {
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [programs, setPrograms] = useState<Awaited<ReturnType<NonNullable<NewfBridge['programs']>>> | null>(null);
  const [programsOpen, setProgramsOpen] = useState(false);

  const termState = terminals.find((t) => t.address === term)?.state ?? 'idle';
  const apiBase = base;
  const close = onClose;

  return (
    <div
      data-testid="ctx-menu"
      style={{ position: 'fixed', left: x, top: y, background: '#0d1117', border: '1px solid #334155', padding: 4, zIndex: 9999, color: '#e2e8f0', fontFamily: 'monospace', fontSize: 12 }}
    >
      <button data-testid="ctx-rename" onClick={() => {
        const name = window.prompt('Alias?', labelFor?.(term) ?? '');
        if (!name) { close(); return; }
        if (bridge.renameTerminal) {
          // W55: персистентное переименование (POST /terminal/{n}/rename).
          void bridge.renameTerminal(term, name).then(() => close()).catch((e) => { alert(`rename failed: ${e instanceof Error ? e.message : e}`); close(); });
        } else {
          // только эфемерный alias — результат не переживает рестарт
          alert('rename: alias only (persistent rename недоступен)');
          onRename?.(term, name);
          close();
        }
      }}>Rename</button>
      {bridge.terminalLabels && (
        <button data-testid="ctx-labels" onClick={() => {
          // W55: labels — читаем текущие, предлагаем отредактировать key=value
          void bridge.terminalLabels!(term).then((current) => {
            const raw = window.prompt('labels (key=value, через запятую):', Object.entries(current).map(([k, v]) => `${k}=${v}`).join(', ') ?? '');
            if (raw === null) { close(); return; }
            const next: Record<string, string> = {};
            for (const part of raw.split(',')) {
              const eq = part.indexOf('=');
              if (eq > 0) next[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
              else if (part.trim()) next[part.trim()] = '';
            }
            void bridge.terminalLabels!(term, next).then(() => close()).catch(() => close());
          }).catch(() => close());
        }}>Labels</button>
      )}
      <button data-testid="ctx-new-worktree" onClick={() => {
        const name = window.prompt('Worktree name?');
        if (!name) { close(); return; }
        void fetch(`${apiBase}/api/core/worktree`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repo: 'D:/<repo>', name }),
        }).then((r) => r.json()).then((data: { terminal?: { address?: string } }) => {
          const addr = data.terminal?.address;
          if (addr) onOpenFloating?.(addr);
          close();
        }).catch(() => close());
      }}>New worktree</button>
      <button data-testid="ctx-open-worktree" onClick={() => {
        void fetchBridgeApi(`${apiBase}/api/core/worktrees?repo=D:/<repo>`)
          .then((r) => r.json())
          .then((data: { worktrees?: { name: string; terminal?: string }[] }) => {
            const names = (data.worktrees ?? []).map((w) => w.name).join(', ');
            const pick = window.prompt(`Open worktree (${names})?`);
            if (!pick) { close(); return; }
            const found = (data.worktrees ?? []).find((w) => w.name === pick);
            if (found?.terminal) { void bridge.run?.({ name: found.name, command: ['cmd.exe'] }); }
            close();
          })
          .catch(() => close());
      }}>Open worktree</button>
      <button data-testid="ctx-close-worktree" onClick={() => {
        const name = window.prompt('Close worktree name?');
        if (!name) { close(); return; }
        const url = `${apiBase}/api/core/worktree?name=${encodeURIComponent(name)}&force=true`;
        void fetch(url, { method: 'DELETE' }).then(() => close()).catch(() => close());
      }}>Close worktree</button>

      {bridge.spawnChild && programsCapable && (
        <>
          <button data-testid="ctx-spawn-child" onClick={(e) => {
            e.stopPropagation();
            if (spawnOpen) { setSpawnOpen(false); return; }
            setSpawnOpen(true);
            if (programs === null) {
              bridge.programs?.().then((list) => setPrograms(list)).catch(() => setPrograms([]));
            }
          }}>Spawn child ▾</button>
          {spawnOpen && (
            <div data-testid="ctx-spawn-programs" style={{ marginLeft: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {(programs ?? []).filter((p) => p.available).map((p) => (
                <button
                  key={p.id}
                  data-testid={`ctx-spawn-program-${p.id}`}
                  onClick={() => {
                    setSpawnOpen(false);
                    void bridge.spawnChild?.(term, { command: Array.isArray(p.cmd) ? p.cmd : [p.cmd] })
                      .then((r) => { onOpenFloating?.(r.address); close(); })
                      .catch(() => close());
                  }}
                >{p.title}</button>
              ))}
              <button
                data-testid="ctx-spawn-custom"
                onClick={() => {
                  setSpawnOpen(false);
                  const command = window.prompt('Spawn child: command?');
                  if (!command) { close(); return; }
                  void bridge.spawnChild?.(term, { command: command.split(/\s+/).filter(Boolean) })
                    .then((r) => { onOpenFloating?.(r.address); close(); })
                    .catch(() => close());
                }}
              >custom</button>
            </div>
          )}
        </>
      )}

      {bridge.snapshot && (
        <button data-testid="ctx-snapshot" onClick={() => {
          void bridge.snapshot?.(term).then(() => close()).catch(() => close());
        }}>Snapshot</button>
      )}
      {bridge.shareCreate && (
        <button data-testid="ctx-share" onClick={() => { onShare?.(term); close(); }}>Share</button>
      )}
      {bridge.archive && termState !== 'archived' && (
        <button data-testid="ctx-archive" onClick={() => {
          void bridge.archive?.(term).then(() => close()).catch(() => close());
        }}>Archive</button>
      )}
      {bridge.restoreSnapshot && (
        <button data-testid="ctx-restore-snapshot" onClick={() => {
          const file = window.prompt('Restore snapshot file (snapshots/…)?');
          if (!file) { close(); return; }
          void bridge.restoreSnapshot?.(term, file).then(() => close()).catch(() => close());
        }}>Restore snapshot</button>
      )}
      {bridge.cloneTerminal && (
        <button data-testid="ctx-clone" onClick={() => {
          void bridge.cloneTerminal?.(term)
            .then((r) => { onOpenFloating?.(r.address); close(); })
            .catch(() => close());
        }}>Clone</button>
      )}
      {bridge.restart && programsCapable && (termState === 'done' || termState === 'error') && (
        <button data-testid="ctx-restart" onClick={() => {
          void bridge.restart?.(term).then(() => close()).catch(() => close());
        }}>Restart</button>
      )}

      <button data-testid="ctx-new-term" disabled={!programsCapable} title={programsCapable ? '' : 'programs: capability отключена'} onClick={(e) => {
        e.stopPropagation();
        if (programsOpen) { setProgramsOpen(false); return; }
        setProgramsOpen(true);
        if (programs === null) {
          bridge.programs?.().then((list) => setPrograms(list)).catch(() => setPrograms([]));
        }
      }}>New terminal ▾</button>
      {programsOpen && (
        <div data-testid="ctx-programs" style={{ marginLeft: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {programs === null ? (
            <span style={{ opacity: 0.6 }}>loading…</span>
          ) : programs.length === 0 ? (
            <span style={{ opacity: 0.6 }}>programs offline — custom only</span>
          ) : (
            programs.map((p) => (
              <button
                key={p.id}
                data-testid={`ctx-program-${p.id}`}
                disabled={!p.available}
                title={p.available ? (p.resolved ?? p.cmd?.toString() ?? '') : 'недоступна (resolved: null)'}
                style={{ opacity: p.available ? 1 : 0.45 }}
                onClick={() => {
                  setProgramsOpen(false);
                  void bridge.runProgram?.(p.id).then((r) => { onOpenFloating?.(r.address); close(); }).catch(() => close());
                }}
              >{p.title}</button>
            ))
          )}
          <button
            data-testid="ctx-custom-command"
            onClick={() => {
              setProgramsOpen(false);
              const command = window.prompt('Custom command (аргументы разделяйте пробелом)?');
              if (!command) { close(); return; }
              void bridge.run?.({ name: 'term', command: command.split(/\s+/).filter(Boolean) })
                .then((r) => { onOpenFloating?.(r.address); close(); })
                .catch(() => close());
            }}
          >custom command</button>
        </div>
      )}

      <button data-testid="ctx-open-float" onClick={() => { onOpenFloating?.(term); close(); }}>Open floating</button>
      <button data-testid="ctx-close" onClick={() => {
        void fetch(`${apiBase}/api/core/kill`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ term }),
        }).catch(() => {});
        close();
      }}>Close / kill</button>
    </div>
  );
}

export default NewfCtxMenu;
