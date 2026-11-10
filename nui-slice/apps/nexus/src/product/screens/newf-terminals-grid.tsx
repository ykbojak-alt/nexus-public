'use client';

/**
 * W35: TerminalsSummary — лёгкий грид карточек терминалов.
 *
 * Поллинг GET /api/core/terminals/summary (лёгкий: count/name/space/state/
 * last_line/last_activity_ts) каждые 2с ПО УМОЛЧАНИЮ. Тяжёлый экран
 * (useLiveTerminalScreen → /screens/<term>) монтируется ТОЛЬКО для
 * выбранной (клик) или активной (state=working) карточки.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { readMagnetLayout, writeMagnetLayout } from './newf-magnetize';
import { useLiveTerminalScreen, DEFAULT_SCREEN_POLL_MS } from './newf-render-hook';
import { NewfCtxMenu } from './newf-ctx-menu';
import { NewfGpuScreenLazy } from './newf-gpu-screen-lazy';
import { CommandPalette } from './newf-command-palette';
import { ShareDialog } from './newf-share-ui';
import { detectAgent } from './newf-agent-badge';
import type { InputLogEntry, LiveEvent, NewfBridge, TermSummary } from './newf-live';
import styles from './newf-agents-panel.module.css';

export const SUMMARY_POLL_MS = 2000;
export const TOAST_TTL_DEFAULT_MS = 4000;

export interface TerminalsGridProps {
  bridge: NewfBridge;
  /** Интервал сводки, мс (default 2000). */
  pollMs?: number;
  /** Интервал экрана выбранной карточки, мс (default 200). */
  screenPollMs?: number;
  /** Авто-разворот рабочих терминалов (default true). */
  autoExpandWorking?: boolean;
  /** Время жизни toast, мс (default 4000). */
  toastTtlMs?: number;
}

type LoadState = 'loading' | 'ok' | 'offline';

export function TerminalsGrid({
  bridge,
  pollMs = SUMMARY_POLL_MS,
  screenPollMs = DEFAULT_SCREEN_POLL_MS,
  autoExpandWorking = true,
  toastTtlMs = TOAST_TTL_DEFAULT_MS,
}: TerminalsGridProps) {
  const [terms, setTerms] = useState<TermSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [load, setLoad] = useState<LoadState>('loading');
  const [menu, setMenu] = useState<{ x: number; y: number; term: string } | null>(null);
  // W774: Share из палитры — реальный ShareDialog (bridge.shareCreate).
  const [shareTerm, setShareTerm] = useState<string | null>(null);
  // W47: multi-select (ctrl/cmd+click) на карточках.
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  // W53: collapse-all/expand-all + счётчик working.
  const [expandedSet, setExpandedSet] = useState<Set<string> | null>(null);
  const [toasts, setToasts] = useState<{ id: number; text: string; born: number }[]>([]);
  const cancelled = useRef(false);

  // W63: TTL по умолчанию — автоскрытие toast через toastTtlMs (born-время).
  useEffect(() => {
    const t = setInterval(() => {
      setToasts((prev) => {
        const now = Date.now();
        const next = prev.filter((x) => now - x.born < toastTtlMs);
        return next.length === prev.length ? prev : next;
      });
    }, 500);
    return () => clearInterval(t);
  }, [toastTtlMs]);

  const isActive = useCallback((t: TermSummary) => t.state === 'working', []);

  const expanded = useCallback((t: TermSummary): boolean => {
    if (expandedSet !== null) return expandedSet.has(t.name);
    return selected === t.name || (autoExpandWorking && isActive(t));
  }, [expandedSet, selected, autoExpandWorking, isActive]);

  const expandedAll = () => setExpandedSet(new Set(terms.map((t) => t.name)));
  const collapsedAll = () => setExpandedSet(new Set());

  const workingCount = terms.filter((t) => t.state === 'working').length;

  // W52: toast-нотификации на events-stream (exited/working transitions).
  useEffect(() => {
    if (!bridge.streamEvents) return;
    let alive = true;
    let toastId = 0;
    const off = bridge.streamEvents((e: LiveEvent) => {
      if (!alive) return;
      if (e.type === 'exited') {
        const who = e.address != null ? String(e.address) : 'терминал';
        setToasts((prev) => [...prev.slice(-4), { id: ++toastId, text: `${who} завершился`, born: Date.now() }]);
      } else if (e.type === 'status' && e.state === 'working') {
        const who = e.address != null ? String(e.address) : 'терминал';
        setToasts((prev) => [...prev.slice(-4), { id: ++toastId, text: `${who} работает`, born: Date.now() }]);
      }
    });
    return () => { alive = false; off(); };
  }, [bridge]);

  const toggleMulti = (name: string) => {
    setMultiSelected((prev) => {
      const n = new Set(prev);
      if (n.has(name)) n.delete(name); else n.add(name);
      return n;
    });
  };

  const batchKill = () => {
    if (multiSelected.size === 0) return;
    const terms = [...multiSelected];
    void Promise.all(terms.map((t) => bridge.kill?.(t) ?? Promise.resolve()))
      .then(() => setMultiSelected(new Set()))
      .catch(() => setMultiSelected(new Set()));
  };

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  useEffect(() => {
    cancelled.current = false;
    return () => { cancelled.current = true; };
  }, []);

  useEffect(() => {
    if (!bridge.terminalsSummary) { setLoad('offline'); return; }
    let inflight = false;
    const tick = async () => {
      if (inflight) return;
      inflight = true;
      try {
        const res = await bridge.terminalsSummary!();
        if (cancelled.current) return;
        setTerms(res.terminals);
        setLoad('ok');
      } catch {
        if (!cancelled.current) setLoad('offline');
      } finally {
        inflight = false;
      }
    };
    void tick();
    const id = setInterval(() => void tick(), pollMs);
    return () => clearInterval(id);
  }, [bridge, pollMs]);

  if (!bridge.terminalsSummary) {
    return (
      <section className={styles.group} role="region" aria-label="Terminals" data-testid="terms-grid">
        <h3 className={styles.groupTitle}>TERMINALS</h3>
        <p className={styles.empty}>terminalsSummary отсутствует</p>
      </section>
    );
  }

  return (
    <section className={styles.group} role="region" aria-label="Terminals" data-testid="terms-grid">
      <h3 className={styles.groupTitle}>
        TERMINALS
        <span className={styles.groupCount} data-testid="terms-count">{terms.length}</span>
        <span className={styles.workingCount} data-testid="working-count" title="working">{workingCount} ⚡</span>
        <span className={`${styles.conn} ${load === 'ok' ? styles.connOk : load === 'offline' ? styles.connBad : styles.connDim}`} role="status">
          {load === 'ok' ? 'summary live' : load === 'offline' ? 'offline' : 'loading…'}
        </span>
        <span className={styles.gridControls}>
          <button type="button" className={styles.filterChip} data-testid="grid-expand-all" onClick={expandedAll}>expand all</button>
          <button type="button" className={styles.filterChip} data-testid="grid-collapse-all" onClick={collapsedAll}>collapse all</button>
        </span>
      </h3>
      {toasts.length > 0 && (
        <div className={styles.toastTray} data-testid="toast-tray" role="status">
          {toasts.map((t) => (
            <span key={t.id} className={styles.toastItem} data-testid={`toast-${t.id}`}>
              {t.text}
              <button type="button" className={styles.filterChip} aria-label="Закрыть уведомление" data-testid={`toast-close-${t.id}`} onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}>×</button>
            </span>
          ))}
        </div>
      )}
      {load === 'offline' ? (
        <p className={styles.offline} role="alert">summary unavailable{terms.length > 0 ? ' · showing last snapshot' : ''}</p>
      ) : null}
      {menu && (
        <NewfCtxMenu
          bridge={bridge}
          x={menu.x}
          y={menu.y}
          term={menu.term}
          base=""
          onClose={() => setMenu(null)}
          onRename={(_t, name) => setTerms((prev) => prev.map((x) => x.name === menu.term ? { ...x, name } : x))}
          labelFor={(t) => terms.find((x) => x.name === t)?.name ?? t}
          programsCapable
        />
      )}
      <CommandPalette
        bridge={bridge}
        terms={terms}
        onFocus={(name) => setSelected(name)}
        // W774: Share открывает реальный диалог (shareCreate → /api/core/share);
        // без shareCreate — прежний fallback на выбор карточки.
        onShare={(name) => { if (bridge.shareCreate) setShareTerm(name); else setSelected(name); }}
        onRename={(name, title) => setTerms((prev) => prev.map((x) => x.name === name ? { ...x, name: title } : x))}
      />
      {shareTerm && bridge.shareCreate && (
        <ShareDialog bridge={bridge} term={shareTerm} onClose={() => setShareTerm(null)} />
      )}
      {multiSelected.size > 0 && (
        <div className={styles.batchBar} data-testid="grid-batch-bar">
          <span data-testid="grid-batch-count">{multiSelected.size} selected</span>
          <button type="button" className={styles.filterChip} data-testid="grid-batch-kill" onClick={batchKill}>kill</button>
          <button type="button" className={styles.filterChip} onClick={() => setMultiSelected(new Set())}>×</button>
        </div>
      )}
      {terms.length === 0 ? (
        <p className={styles.empty}>no terminals</p>
      ) : (
        <ul className={styles.list}>
          {terms.map((t, i) => (
            <li
              key={t.name}
              className={styles.badge}
              data-testid={`term-card-${i}`}
              data-state={t.state}
              onContextMenu={(e) => {
                // нативное меню в input/textarea (paste/cut) — наше меню не показываем
                if ((e.target as HTMLElement).closest('input,textarea,[contenteditable="true"]')) return;
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, term: t.name });
              }}
            >
              <button
                type="button"
                className={`${styles.summaryRow} ${expanded(t) ? styles.filterActive : ''} ${multiSelected.has(t.name) ? styles.multiSelected : ''}`}
                data-testid={`term-card-toggle-${i}`}
                aria-expanded={expanded(t)}
                aria-label={`Терминал ${t.name}`}
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleMulti(t.name);
                    return;
                  }
                  setSelected(expanded(t) ? null : t.name);
                }}
              >
                <span className={styles.badgeName}>{t.name} <span className={styles.summarySpace}>{t.space}</span></span>
                <span className={styles.badgeMeta}>
                  {t.state} · {t.lastActivityTs !== undefined ? new Date(t.lastActivityTs * 1000).toTimeString().slice(0, 8) : '—'}
                </span>
                <span className={styles.summaryLine} data-testid={`term-line-${i}`} title={t.lastLine}>
                  {t.lastLine || '—'}
                </span>
              </button>
              <div className={styles.summaryActions}>
                {bridge.inputLog && (
                  <InputLogPopover bridge={bridge} term={t.name} />
                )}
              </div>
              {expanded(t) && (
                <TermFrame
                  term={t}
                  bridge={bridge}
                  screenPollMs={screenPollMs}
                  onCollapse={() => setSelected(null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ScreenSlot({ bridge, term, pollMs, onStreamState }: { bridge: NewfBridge; term: string; pollMs: number; onStreamState?: (streamOk: boolean) => void }) {
  // W41: SSE-поток /terminal/{n}/stream (event screen {seq, screen}) с
  // fallback-поллингом. W57: при streamOk поллинг ставится на паузу
  // (keepalive раз в 5s), чтобы не дублировать запросы.
  const [liveScreen, setLiveScreen] = useState<string | null>(null);
  const [streamOk, setStreamOk] = useState(false);
  const pollHook = useLiveTerminalScreen(bridge, term, {
    cols: 120, rows: 12,
    pollMs: streamOk ? 5000 : pollMs, // W57: keepalive при SSE
  });
  const screen = liveScreen ?? pollHook.screen;

  useEffect(() => {
    if (!bridge.screenStream) { setStreamOk(false); return; }
    let alive = true;
    const off = bridge.screenStream(
      term,
      (s) => { if (alive) { setLiveScreen(s); setStreamOk(true); onStreamState?.(true); } },
      () => { if (alive) { setStreamOk(false); onStreamState?.(false); } },
    );
    return () => { alive = false; off(); };
  }, [bridge, term, onStreamState]);

  // W81: GPU-рендер primary (xterm+WebGL canvas), <pre> — fallback при
  // недоступности WebGL (NewfGpuScreen сам решает и рендерит pre).
  const prefix = streamOk
    ? ''
    : pollHook.offline && liveScreen === null
      ? `[offline] ${pollHook.error ?? ''}`
      : '';
  return (
    <NewfGpuScreenLazy
      screen={`${prefix}${screen || '…'}`}
      testId={`term-screenbody-${term}`}
    />
  );
}

/** W41: видимая строка ввода внизу expanded-карточки. Enter → sendLine; raw → sendRaw. */
function InputLine({ bridge, term }: { bridge: NewfBridge; term: string }) {
  const [text, setText] = useState('');
  const [raw, setRaw] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!text) return;
    const payload = text;
    const action = raw ? bridge.sendRaw : bridge.sendLine;
    if (!action) {
      setError(raw ? 'raw input unsupported by bridge' : 'line input unsupported by bridge');
      return;
    }
    setText('');
    setError(null);
    void action.call(bridge, term, payload).catch((e: unknown) => setError(e instanceof Error ? e.message : 'send failed'));
  };

  return (
    <div className={styles.inputLine}>
      <button
        type="button"
        className={`${styles.filterChip} ${raw ? styles.filterActive : ''}`}
        data-testid={`inputline-raw-${term}`}
        aria-pressed={raw}
        title={raw ? 'raw: посимвольно, без Enter (стрелки/Ctrl+C)' : 'строка: Enter отправляет целиком'}
        onClick={() => setRaw((v) => !v)}
      >{raw ? 'raw' : 'line'}</button>
      <input
        type="text"
        className={styles.inputLineField}
        data-testid={`inputline-${term}`}
        placeholder={raw ? 'raw ввод…' : 'команда…'}
        aria-label={`Ввод для ${term}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
      />
      {error && <span className={styles.inputLineError} role="alert" data-testid={`inputline-error-${term}`}>{error}</span>}
    </div>
  );
}

/** W39: кнопка «⌨» + мини-дроер последних N вводов. */
function InputLogPopover({ bridge, term }: { bridge: NewfBridge; term: string }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<InputLogEntry[]>([]);
  const [load, setLoad] = useState<'idle' | 'loading' | 'ok' | 'offline'>('idle');
  const [error, setError] = useState<string | null>(null);

  const openLog = () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    setLoad('loading');
    bridge.inputLog!(term, 50)
      .then((res) => { setEntries(res.entries); setLoad('ok'); setError(null); })
      .catch((e: unknown) => { setLoad('offline'); setError(e instanceof Error ? e.message : 'input-log failed'); });
  };

  return (
    <span className={styles.inputLogWrap}>
      <button
        type="button"
        className={styles.filterChip}
        data-testid={`inputlog-toggle-${term}`}
        title="Последние вводы (input-log)"
        aria-expanded={open}
        onClick={openLog}
      >⌨</button>
      {open && (
        <div className={styles.inputLogPopover} data-testid={`inputlog-popover-${term}`} role="region" aria-label={`Input log ${term}`}>
          {load === 'offline' ? (
            <p className={styles.offline} role="alert">{error ?? 'input-log unavailable'}</p>
          ) : load === 'loading' ? (
            <p className={styles.empty}>loading…</p>
          ) : entries.length === 0 ? (
            <p className={styles.empty}>no inputs</p>
          ) : (
            <ul className={styles.inputLogList}>
              {entries.map((e, i) => (
                <li key={`${e.ts}-${i}`} className={styles.inputLogItem} data-testid={`inputlog-entry-${term}-${i}`}>
                  <span className={styles.inputLogTime}>{e.ts !== undefined ? new Date(e.ts * 1000).toTimeString().slice(0, 8) : '—'}</span>
                  <span className={styles.inputLogText}>{e.text || '⏎'}</span>
                  <span className={styles.inputLogEnter}>{e.enter ? '↵' : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </span>
  );
}

/** W43: herdr-паритет — expanded-карточка как рамочное окно. */
function TermFrame({
  term, bridge, screenPollMs, onCollapse,
}: {
  term: TermSummary;
  bridge: NewfBridge;
  screenPollMs: number;
  onCollapse: () => void;
}) {
  const [max, setMax] = useState(false);
  const [streamOk, setStreamOk] = useState(false);
  const agent = detectAgent(term.name, term.lastLine);

  // W42b: titlebar drag -> float, snap-home <24px, persist rect (same layout store)
  const panelId = `term-${term.name}`;
  const [floating, setFloating] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pinned, setPinned] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const homeRef = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const dragStart = useRef<{ mx: number; my: number; x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const saved = readMagnetLayout()[panelId];
    if (saved) setPinned(saved.pinned === true);
    if (saved?.detached) setFloating({ x: saved.x, y: saved.y, w: saved.w, h: saved.h });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId]);

  useLayoutEffect(() => {
    if (floating) return;
    const r = rootRef.current?.getBoundingClientRect();
    if (r) homeRef.current = { x: r.left, y: r.top, w: r.width, h: r.height };
  }, [floating]);

  // W5r: home-geometry устаревает при resize окна — пересчитываем
  useEffect(() => {
    const onResize = () => {
      if (floating) return;
      const r = rootRef.current?.getBoundingClientRect();
      if (r) homeRef.current = { x: r.left, y: r.top, w: r.width, h: r.height };
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [floating]);

  const persist = (rect: { x: number; y: number; w: number; h: number } | null) => {
    const map = readMagnetLayout();
    if (rect) map[panelId] = { ...rect, detached: true, pinned };
    else delete map[panelId];
    writeMagnetLayout(map);
  };

  const togglePin = () => {
    setPinned((v) => {
      const next = !v;
      // pin/отpin не должен терять floating-geometry
      const map = readMagnetLayout();
      const saved = map[panelId];
      if (saved) map[panelId] = { ...saved, pinned: next };
      writeMagnetLayout(map);
      return next;
    });
  };

  const beginDrag = (e: ReactMouseEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const start = floating ?? homeRef.current;
    dragStart.current = { mx: e.clientX, my: e.clientY, x: start.x, y: start.y };
    setFloating({ ...start });
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => {
      const s = dragStart.current;
      if (!s) return;
      setFloating((f) => (f ? { ...f, x: s.x + e.clientX - s.mx, y: s.y + e.clientY - s.my } : f));
    };
    const up = () => {
      const home = homeRef.current;
      setFloating((f) => {
        const snap = f && Math.hypot(f.x - home.x, f.y - home.y) < 24;
        const next = snap ? null : f;
        persist(next);
        return next;
      });
      dragStart.current = null;
      setDragging(false);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    // W5r: потеря фокуса окна mid-drag = drop (иначе dragging зависает)
    window.addEventListener('blur', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('blur', up);
      window.removeEventListener('pointercancel', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  return (
    <div
      ref={rootRef}
      className={`${styles.termFrame} ${term.state === 'working' ? styles.termFrameActive : ''} ${max ? styles.termFrameMax : ''} ${pinned ? styles.termFramePinned : ''}`}
      data-floating={floating ? 'true' : 'false'}
      data-pinned={pinned ? 'true' : undefined}
      data-panel="term"
      tabIndex={-1}
      style={floating
        ? { position: 'fixed', left: floating.x, top: floating.y, width: floating.w, zIndex: pinned ? 50000 : 400, margin: 0 }
        : (pinned ? { zIndex: 50000 } : undefined)}
      data-testid={`term-frame-${term.name}`}
      data-state={term.state}
    >
      {/* titlebar: иконка + имя + space слева; контролы справа */}
      <header className={styles.termTitlebar} onMouseDown={beginDrag} onDoubleClick={() => { setFloating(null); persist(null); }}>
        {agent && (
          <span className={styles.termAgent} data-testid={`term-agent-${term.name}`} title={agent.name}>
            {agent.icon} {agent.name}
          </span>
        )}
        <span className={styles.termIcon} aria-hidden="true">▣</span>
        <span className={styles.termTitleText} data-testid={`term-frame-title-${term.name}`}>
          {term.name}
          <span className={styles.summarySpace}>{term.space}</span>
        </span>
        <span className={styles.termControls}>
          <button type="button" data-testid={`term-frame-expand-${term.name}`} title="Свернуть/развернуть" onClick={onCollapse}>▾</button>
          <button type="button" data-testid={`term-frame-pin-${term.name}`} title={pinned ? 'Открепить (не всегда поверх)' : 'Закрепить (всегда поверх)'} aria-pressed={pinned} aria-label="Закрепить (всегда поверх)" onClick={togglePin}>📌</button>
          <button type="button" data-testid={`term-frame-min-${term.name}`} title="Свернуть в карточку (min)" onClick={onCollapse}>–</button>
          <button type="button" data-testid={`term-frame-max-${term.name}`} title="На весь canvas (max)" aria-pressed={max} onClick={() => setMax((v) => !v)}>▢</button>
          <button type="button" data-testid={`term-frame-close-${term.name}`} title="Закрыть окно (close)" onClick={onCollapse}>×</button>
        </span>
      </header>

      <div className={styles.termBody}>
        <ScreenSlot bridge={bridge} term={term.name} pollMs={screenPollMs} onStreamState={setStreamOk} />
      </div>

      {/* status-bar: state-badge, machine-chip, last-activity, stream/live, контекст */}
      <footer className={styles.termStatus}>
        {/* W76: статус-глифы по спеке mods/pane — spinner / Needs you / dot / ничего.
            error маппим на «Needs you» (требует внимания), archived — как idle. */}
        <span className={styles.termState} data-testid={`term-frame-state-${term.name}`} data-state={term.state}>
          {term.state === 'working' && <span className={styles.termSpinner} role="img" aria-label="working" title="working" />}
          {(term.state === 'blocked' || term.state === 'error') && <span className={styles.termNeedsYou}>Needs you</span>}
          {term.state === 'done' && <span className={styles.termDoneDot} role="img" aria-label="done" title="done" />}
        </span>
        <span className={`${styles.termMeta} ${styles.termMachineChip}`} data-testid={`term-frame-machine-${term.name}`}>
          {term.space}
        </span>
        <span className={styles.termMeta}>
          {term.lastActivityTs !== undefined ? new Date(term.lastActivityTs * 1000).toTimeString().slice(0, 8) : '—'}
        </span>
        <span
          className={`${styles.termMeta} ${streamOk ? styles.termLive : ''}`}
          data-testid={`term-frame-live-${term.name}`}
          title={streamOk ? 'SSE stream' : 'poll 200ms'}
        >
          {streamOk ? '● live' : '○ poll'}
        </span>
        <span className={`${styles.termMeta} ${styles.termContext}`} title={term.lastLine}>
          {term.lastLine || '—'}
        </span>
      </footer>

      {bridge.sendLine && <InputLine bridge={bridge} term={term.name} />}
    </div>
  );
}

export default TerminalsGrid;
