'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import type { RunEventView, RunStatus } from '@nexus/mock-data';
import type { ProductDataSource } from '../data-source';
import styles from './home.module.css';
import { useCollapsePhase } from '../use-collapse-phase';

/** Роли моделей и инструменты — в человеческие фразы. Технические имена
 *  (model_call / tool_call / JSON) в эхо не показываются вовсе. */
const ROLE_PHRASE: Record<string, string> = {
  planner: 'Продумываю, с чего начать',
  critic: 'Перепроверяю себя',
  executor: 'Делаю следующий шаг',
  router: 'Выбираю путь к ответу',
  summarizer: 'Собираю главное',
};

const TOOL_PHRASE: Record<string, string> = {
  memory_search: 'Заглядываю в память',
  memory: 'Заглядываю в память',
  file_read: 'Читаю нужные записи',
  read_file: 'Читаю нужные записи',
  file_write: 'Записываю результат',
  write_file: 'Записываю результат',
  shell: 'Проверяю на практике',
  bash: 'Проверяю на практике',
  web_search: 'Ищу в источниках',
  search: 'Ищу в источниках',
};

/** Событие рантайма → красивая фраза от первого лица. */
function phraseOf(ev: RunEventView): string {
  const body = (ev.body != null && typeof ev.body === 'object'
    ? ev.body as Record<string, unknown>
    : {}) as Record<string, unknown>;
  const tool = typeof body.tool === 'string' ? body.tool
    : typeof body.name === 'string' ? body.name : null;
  switch (ev.type) {
    case 'run_start':
      return 'Открываю прогон';
    case 'config':
      return 'Настраиваюсь на задачу';
    case 'plan':
      return 'Раскладываю задачу на шаги';
    case 'decision': {
      const verdict = String(body.verdict ?? '').toUpperCase();
      if (verdict === 'APPROVE') return 'Ответ проходит проверку';
      if (verdict === 'REVISE') return 'Уточняю формулировки';
      if (verdict === 'REJECT') return 'Возвращаюсь к началу';
      return 'Проверяю собственный ответ';
    }
    case 'tool_call':
      return (tool != null ? TOOL_PHRASE[tool] : null) ?? 'Берусь за инструмент';
    case 'model_call': {
      const role = (ev.role ?? '').toLowerCase();
      return ROLE_PHRASE[role] ?? 'Думаю над ответом';
    }
    case 'final':
    case 'result':
    case 'answer':
      return 'Собираю ответ';
    default:
      return 'Продолжаю работу';
  }
}

/** Прозаический фрагмент события (если он есть) — курсивной строкой под
 *  фразой. JSON и служебные поля сюда не попадают. */
function excerptOf(body: unknown, limit = 180): string | null {
  if (body == null || typeof body !== 'object') return null;
  const obj = body as Record<string, unknown>;
  for (const key of ['text', 'content', 'answer', 'summary', 'message']) {
    const value = obj[key];
    if (typeof value !== 'string') continue;
    const flat = value.replace(/\s+/g, ' ').trim();
    if (flat === '' || flat.startsWith('{') || flat.startsWith('[')) continue;
    return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
  }
  return null;
}

/** Строка эха: фраза + необязательная цитата; одинаковые подряд фразы
 *  схлопываются в одну с счётчиком. */
interface EchoLine {
  id: number;
  text: string;
  excerpt: string | null;
  count: number;
}

function linesOf(events: readonly RunEventView[]): EchoLine[] {
  const out: EchoLine[] = [];
  for (const ev of events) {
    const text = phraseOf(ev);
    const excerpt = excerptOf(ev.body);
    const last = out[out.length - 1];
    if (last != null && last.text === text) {
      out[out.length - 1] = { ...last, excerpt: excerpt ?? last.excerpt, count: last.count + 1 };
      continue;
    }
    out.push({ id: ev.seq, text, excerpt, count: 1 });
  }
  return out.slice(-60);
}

/** Три пульсирующие точки — «работаю дальше». Смысл дублирует текст,
 *  поэтому скрыты от скринридера. */
export function EchoDots() {
  return (
    <span className={styles.echoDots} aria-hidden="true">
      <i /><i /><i />
    </span>
  );
}

const STATUS_LABEL: Record<RunStatus, string> = {
  running: 'в работе',
  done: 'завершён',
  error: 'ошибка',
  cancelled: 'отменён',
  timeout: 'таймаут',
};

export interface RuntimeEchoState {
  live: { runId: string; status: RunStatus } | null;
  lines: EchoLine[];
  answer: { body: string; confidence: string | null } | null;
  /** Вопрос пользователя, запустивший прогон — рисуется напротив фраз эха. */
  question: string | null;
  feedRef: RefObject<HTMLOListElement | null>;
  /** Подписаться на поток нового прогона (старый отписывается). */
  start: (runId: string, status: RunStatus, question?: string) => void;
  close: () => void;
}

/**
 * Живое эхо рантайма для hero-пузыря: запуск задачи не уводит на /runtime —
 * события и черновик ответа раскрываются на месте. Подписка на SSE живёт
 * здесь, поэтому экран-владелец только зовёт `start`/`close`.
 */
export function useRuntimeEcho(ds: ProductDataSource): RuntimeEchoState {
  const [live, setLive] = useState<{ runId: string; status: RunStatus } | null>(null);
  const [events, setEvents] = useState<RunEventView[]>([]);
  const [draft, setDraft] = useState('');
  const [question, setQuestion] = useState<string | null>(null);
  const unsub = useRef<(() => void) | null>(null);
  const feedRef = useRef<HTMLOListElement | null>(null);

  const close = useCallback(() => {
    unsub.current?.();
    unsub.current = null;
    setLive(null);
    setEvents([]);
    setDraft('');
    setQuestion(null);
  }, []);

  // Отписка при размонтировании — сам прогон на хосте продолжается.
  useEffect(() => () => { unsub.current?.(); }, []);

  const start = useCallback((runId: string, status: RunStatus, question?: string) => {
    unsub.current?.();
    unsub.current = null;
    setLive({ runId, status });
    setEvents([]);
    setDraft('');
    setQuestion(question != null && question.trim() !== '' ? question.trim() : null);
    if (typeof ds.streamRun !== 'function') return;
    unsub.current = ds.streamRun(runId, {
      onEvent: (ev) => setEvents((prev) => (
        prev.some((p) => p.seq === ev.seq) ? prev : [...prev, ev].sort((a, b) => a.seq - b.seq)
      )),
      onDelta: (text) => setDraft((prev) => prev + text),
      onEnd: (next) => setLive((cur) => (cur != null && cur.runId === runId ? { ...cur, status: next } : cur)),
    }) ?? null;
  }, [ds]);

  // Лента держится у последнего события, как в runtime-фиде.
  useEffect(() => {
    const feed = feedRef.current;
    if (feed != null) feed.scrollTop = feed.scrollHeight;
  }, [events, draft]);

  const lines = useMemo(() => linesOf(events), [events]);
  // «ОТВЕТ: …» становится заголовком блока, «УВЕРЕННОСТЬ: N» — пилюлей;
  // остальной текст ответа остаётся как есть.
  const answer = useMemo(() => {
    const raw = draft.trim();
    if (raw === '') return null;
    let body = raw;
    let confidence: string | null = null;
    const conf = raw.match(/УВЕРЕННОСТЬ\s*[:：]\s*([0-9]{1,3}(?:[.,][0-9]+)?)/i);
    if (conf != null) {
      confidence = conf[1];
      body = body.replace(conf[0], '');
    }
    body = body.replace(/^\s*ОТВЕТ\s*[:：]\s*/i, '').trim();
    return { body: body === '' ? raw : body, confidence };
  }, [draft]);

  return { live, lines, answer, question, feedRef, start, close };
}

/**
 * Панель эха: на всю ширину hero-пузыря. Заголовок + статус, лента фраз с
 * анимацией «печати», блок ответа и явная ссылка на /runtime.
 */
export function RuntimeEcho({ echo, onSpeak, speaking }: {
  echo: RuntimeEchoState;
  onSpeak?: () => void;
  speaking?: boolean;
}) {
  const { live, lines, answer, question, feedRef, close } = echo;
  const panelRef = useRef<HTMLDivElement>(null);
  const dragSessionRef = useRef<number | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const collapsePhase = useCollapsePhase(collapsed);
  if (live == null) return null;
  const movePanel = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    // Один активный pointer: повторный pointerdown во время drag игнорируется.
    if (dragSessionRef.current != null) return;
    const panel = panelRef.current;
    const shell = panel?.closest<HTMLElement>('[data-app-shell]');
    const overlay = shell?.querySelector<HTMLElement>('[data-floating-overlay]');
    if (panel == null || shell == null || overlay == null) return;
    e.preventDefault();
    e.stopPropagation();
    const activePointer = e.pointerId ?? 0; // jsdom MouseEvent → 0
    dragSessionRef.current = activePointer;
    const samePointer = (ev: { pointerId?: number }) =>
      ev.pointerId == null || ev.pointerId === activePointer;
    const grip = e.currentTarget;
    grip.setPointerCapture?.(activePointer);
    const rect = panel.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    const origin = { x: rect.left, y: rect.top };
    const pointer = { x: e.clientX, y: e.clientY };
    const originalCss = panel.style.cssText;
    const originalOverlayOverflow = overlay.style.overflow;
    const overflows: Array<[HTMLElement, string]> = [];
    let parent = panel.parentElement;
    while (parent != null && parent !== shell) {
      overflows.push([parent, parent.style.overflow]);
      parent.style.overflow = 'visible';
      parent = parent.parentElement;
    }
    overlay.style.overflow = 'visible';
    let moved = false;
    let raf = 0;
    let next = origin;
    const width = Math.min(rect.width, Math.max(220, shellRect.width - 24));
    const clamp = () => {
      next.x = Math.max(shellRect.left, Math.min(shellRect.right - width, next.x));
      next.y = Math.max(shellRect.top, Math.min(shellRect.bottom - rect.height, next.y));
    };
    const paint = () => {
      raf = 0;
      panel.style.left = `${next.x}px`;
      panel.style.top = `${next.y}px`;
    };
    const cleanup = () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
      dragSessionRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onBlur);
      grip.removeEventListener('lostpointercapture', onLostCapture);
      document.body.removeAttribute('data-message-drag');
      panel.removeAttribute('data-drag-lift');
      overlay.style.overflow = originalOverlayOverflow;
      for (const [el, overflow] of overflows) el.style.overflow = overflow;
      if (panel.isConnected) panel.style.cssText = originalCss;
    };
    const onMove = (ev: PointerEvent) => {
      if (!samePointer(ev)) return;
      next = { x: origin.x + ev.clientX - pointer.x, y: origin.y + ev.clientY - pointer.y };
      clamp();
      if (!moved && Math.hypot(ev.clientX - pointer.x, ev.clientY - pointer.y) < 4) return;
      if (!moved) {
        moved = true;
        panel.style.position = 'fixed';
        panel.style.left = `${origin.x}px`;
        panel.style.top = `${origin.y}px`;
        panel.style.width = `${width}px`;
        // Над соседними floating (база z 120) на время удержания; cleanup вернёт.
        panel.style.zIndex = '130';
        // dragLift: scale+shadow affordance на время удержания.
        panel.setAttribute('data-drag-lift', '');
      }
      if (raf === 0) raf = requestAnimationFrame(paint);
    };
    // Честный drop: pointerup / pointercancel / lostpointercapture / blur —
    // коммит последней точки (W4-1018: фиксируем позицию, не телепортируем).
    const finish = (ev: { clientX: number; clientY: number } | null) => {
      if (dragSessionRef.current == null) return;
      if (moved) {
        if (ev != null) next = { x: origin.x + ev.clientX - pointer.x, y: origin.y + ev.clientY - pointer.y };
        clamp();
        if (raf !== 0) cancelAnimationFrame(raf);
        raf = 0;
        paint();
      }
      cleanup();
      if (moved) {
        // Re-drag плавающей панели: инлайним точку сброса до коммита.
        if (position != null && panel.isConnected) {
          panel.style.left = `${next.x}px`;
          panel.style.top = `${next.y}px`;
        }
        setPosition({
          x: Math.round(next.x - shellRect.left),
          y: Math.round(next.y - shellRect.top),
          width: Math.round(width),
          height: Math.round(rect.height),
        });
      }
    };
    const onUp = (ev: PointerEvent) => { if (samePointer(ev)) finish(ev); };
    const onCancel = (ev: PointerEvent) => { if (samePointer(ev)) finish(ev); };
    const onLostCapture = () => finish(null);
    const onBlur = () => finish(null);
    document.body.setAttribute('data-message-drag', '');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onBlur);
    grip.addEventListener('lostpointercapture', onLostCapture);
  };
  const moveByKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16],
    };
    const step = delta[e.key];
    const shell = panelRef.current?.closest<HTMLElement>('[data-app-shell]');
    const panel = panelRef.current;
    if (step == null || panel == null || shell == null) return;
    e.preventDefault();
    const shellRect = shell.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    const current = position ?? {
      x: rect.left - shellRect.left, y: rect.top - shellRect.top,
      width: rect.width, height: rect.height,
    };
    setPosition({
      ...current,
      x: Math.max(0, Math.min(shellRect.width - current.width, current.x + step[0])),
      y: Math.max(0, Math.min(shellRect.height - current.height, current.y + step[1])),
    });
  };
  const overlay = typeof document === 'undefined'
    ? null
    : document.querySelector<HTMLElement>('[data-floating-overlay]');
  const style = position == null
    ? undefined
    : { left: position.x, top: position.y, width: position.width } satisfies CSSProperties;
  const panel = (
    <div
      ref={panelRef}
      className={styles.echo}
      data-testid="home-runtime-echo"
      data-floating={position != null || undefined}
      data-collapsed={collapsed || undefined}
      data-state={live.status}
      aria-live="polite"
      style={style}
    >
      <div className={styles.echoHead}>
        <button
          type="button"
          className={styles.echoDragGrip}
          aria-label="Перетащить диалог; стрелки перемещают на 16 px"
          title="Зажмите и перетащите; стрелки перемещают на 16 px"
          onPointerDown={movePanel}
          onKeyDown={moveByKey}
        >
          <span aria-hidden="true">⠿</span>
        </button>
        {position != null && (
          <button
            type="button"
            className={styles.echoReturn}
            aria-label="Вернуть диалог в AGENT-A"
            title="Вернуть в AGENT-A"
            onClick={() => setPosition(null)}
          >
            ↩
          </button>
        )}
        <span className={styles.echoStatus} data-status={live.status}>
          {STATUS_LABEL[live.status] ?? live.status}
        </span>
        {live.status === 'running' && <EchoDots />}
        <button
          type="button"
          className={styles.echoCollapse}
          aria-label={collapsed ? 'Развернуть диалог' : 'Свернуть диалог в полосу'}
          title={collapsed ? 'Развернуть' : 'Свернуть в полосу'}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? '▢' : '–'}
        </button>
        <button
          type="button"
          className={styles.echoHeadClose}
          aria-label="Закрыть эхо-панель"
          title="Закрыть панель"
          onClick={close}
        >
          ×
        </button>
      </div>
      {(!collapsed || collapsePhase === 'collapsing') && (
        <div
          className={styles.collapseItem}
          inert={collapsePhase === 'collapsing'}
          aria-hidden={collapsePhase === 'collapsing' || undefined}
          data-collapse-anim={
            collapsePhase === 'collapsing' ? 'shrink' : collapsePhase === 'expanding' ? 'grow' : undefined
          }
        >
          <div className={styles.collapseInner}>
            <div className={styles.echoBody}>
              {question != null && (
                <aside className={styles.echoQuestion} data-testid="echo-question" data-side="right">
                  <span className={styles.echoQuestionLabel}>Вы спросили</span>
                  <p className={styles.echoQuestionText}>{question}</p>
                </aside>
              )}
              <ol className={styles.echoFeed} ref={feedRef} data-side="left">
                {lines.length === 0 && (
                  <li className={styles.echoRow} data-tone="idle">
                    <span className={styles.echoMark} aria-hidden="true" />
                    <span className={styles.echoText}>Собираюсь с мыслями<EchoDots /></span>
                  </li>
                )}
                {lines.map((line) => (
                  <li key={line.id} className={styles.echoRow} data-tone="event">
                    <span className={styles.echoMark} aria-hidden="true" />
                    <span className={styles.echoText}>
                      {line.text}
                      {line.count > 1 && <span className={styles.echoCount}>×{line.count}</span>}
                    </span>
                    {line.excerpt != null && <span className={styles.echoExcerpt}>{line.excerpt}</span>}
                  </li>
                ))}
                {live.status === 'running' && lines.length > 0 && (
                  <li className={styles.echoRow} data-tone="active">
                    <span className={styles.echoMark} aria-hidden="true" />
                    <span className={styles.echoText}>Продолжаю<EchoDots /></span>
                  </li>
                )}
              </ol>
            </div>
            {answer != null && (
              <div className={styles.echoAnswer} data-testid="echo-answer">
                <p className={styles.echoAnswerLabel}>
                  {live.status === 'running' ? 'Формулирую ответ' : 'Ответ'}
                </p>
                <p className={styles.echoAnswerText}>
                  {answer.body}
                  {live.status === 'running' && <EchoDots />}
                </p>
                {answer.confidence != null && (
                  <span className={styles.echoConfidence}>уверенность {answer.confidence}</span>
                )}
              </div>
            )}
            <div className={styles.echoActions}>
              {onSpeak != null && (
                <button type="button" className={styles.echoVoice} onClick={onSpeak}
                  disabled={live.status === 'running'}>
                  {speaking ? '⏸ Стоп' : '▶ Озвучить'}
                </button>
              )}
              <Link className={styles.echoOpen} href={`/runtime?run=${encodeURIComponent(live.runId)}`}
                title={`прогон ${live.runId}`}>
                Открыть прогон ↗
              </Link>
              <button type="button" className={styles.echoClose} onClick={close}>Закрыть</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (position != null && overlay != null) {
    return (
      <>
        <div className={styles.echoPlaceholder} aria-hidden="true" style={{ height: position.height }} />
        {createPortal(panel, overlay, live.runId)}
      </>
    );
  }
  return (
    panel
  );
}
