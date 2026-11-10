import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import styles from './agent-panel.module.css';

/**
 * wave-XXV W3 — плавающая панель ассистента (DCT bar).
 *
 * Одна сущность, три честных режима:
 *  - `collapsed` — узкая капсула (имя + статус), клик разворачивает;
 *  - `expanded`  — рабочая панель с композером; `queryMode` открывает чат;
 *  - `closed`    — панель скрыта (mount сохраняется, состояние не теряется).
 *
 * Панель можно тащить за `dragHandle` и менять размер за `resizeHandle`;
 * позиция/размер клампятся в вьюпорт. Всё состояние (режим, чат, позиция,
 * размер) опционально персистится в localStorage — restore только в effect,
 * чтобы SSR-разметка совпадала с первым клиентским рендером (#418-класс).
 *
 * Honest-state: панель не изобретает ответы. Нет `onSendQuery` — отправка
 * недоступна и это сказано текстом; нет сообщений — честный empty.
 */

export type AgentPanelMode = 'collapsed' | 'expanded' | 'closed';
export type AgentPanelRole = 'user' | 'assistant' | 'system';

export interface AgentPanelMessage {
  id: string;
  role: AgentPanelRole;
  text: string;
}

export interface AgentPanelPosition {
  x: number;
  y: number;
}

export interface AgentPanelSize {
  width: number;
  height: number;
}

export interface AgentPanelHandle {
  /** Открыть панель в expanded. */
  expand: () => void;
  /** Свернуть в капсулу. */
  collapse: () => void;
  /** Переключить капсула ⇄ панель. */
  toggleCollapse: () => void;
  /** Закрыть (скрыть) панель. */
  close: () => void;
  /** Открыть панель (alias expand). */
  open: () => void;
}

export interface AgentPanelProps {
  /** Контролируемый режим; без него — внутреннее состояние. */
  mode?: AgentPanelMode;
  defaultMode?: AgentPanelMode;
  onModeChange?: (mode: AgentPanelMode) => void;
  /** Контролируемый режим чата. */
  queryMode?: boolean;
  defaultQueryMode?: boolean;
  onQueryModeChange?: (open: boolean) => void;
  messages?: AgentPanelMessage[];
  /** Отправка сообщения. Без колбэка панель честно говорит, что runtime не подключён. */
  onSendQuery?: (text: string) => void;
  assistantName?: string;
  /** Честная строка статуса (не выдумывается панелью). */
  status?: string;
  initialPosition?: AgentPanelPosition;
  /** Ключ персиста; `null` отключает. По умолчанию `nexus.agent-panel.v1`. */
  storageKey?: string | null;
  className?: string;
  style?: CSSProperties;
  /** Дополнительный контент над композером (слоты виджетов). */
  children?: ReactNode;
}

const CLAMP_PAD = 8;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;
const DEFAULT_WIDTH = 380;
const DEFAULT_HEIGHT = 300;
const CHAT_WIDTH = 520;
const CHAT_HEIGHT = 560;
const KEY_STEP = 16;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

const isStorageKey = (key: string | null | undefined): key is string =>
  typeof key === 'string' && key.length > 0;

export const AgentPanel = forwardRef<AgentPanelHandle, AgentPanelProps>(function AgentPanel(
  {
    mode: modeProp,
    defaultMode = 'expanded',
    onModeChange,
    queryMode: queryModeProp,
    defaultQueryMode = false,
    onQueryModeChange,
    messages = [],
    onSendQuery,
    assistantName = 'AGENT-A',
    status = 'на связи',
    initialPosition,
    storageKey = 'nexus.agent-panel.v1',
    className,
    style,
    children,
  },
  ref,
) {
  const [modeState, setModeState] = useState<AgentPanelMode>(defaultMode);
  const [queryState, setQueryState] = useState(defaultQueryMode);
  const [position, setPosition] = useState<AgentPanelPosition | null>(initialPosition ?? null);
  const [size, setSize] = useState<AgentPanelSize | null>(null);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origin: AgentPanelPosition } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; originW: number; originH: number } | null>(null);
  const restoredRef = useRef(false);

  const mode = modeProp ?? modeState;
  const queryMode = queryModeProp ?? queryState;

  const setMode = useCallback(
    (next: AgentPanelMode) => {
      setModeState(next);
      onModeChange?.(next);
    },
    [onModeChange],
  );

  const setQuery = useCallback(
    (next: boolean) => {
      setQueryState(next);
      onQueryModeChange?.(next);
    },
    [onQueryModeChange],
  );

  useImperativeHandle(
    ref,
    () => ({
      expand: () => setMode('expanded'),
      collapse: () => setMode('collapsed'),
      toggleCollapse: () => setMode(mode === 'collapsed' ? 'expanded' : 'collapsed'),
      close: () => setMode('closed'),
      open: () => setMode('expanded'),
    }),
    [mode, setMode],
  );

  // Restore — только в effect (SSR-safe: первый рендер без localStorage).
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (!isStorageKey(storageKey)) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        mode?: AgentPanelMode;
        queryMode?: boolean;
        position?: AgentPanelPosition | null;
        size?: AgentPanelSize | null;
      };
      if (modeProp === undefined && saved.mode) setModeState(saved.mode);
      if (queryModeProp === undefined && typeof saved.queryMode === 'boolean') setQueryState(saved.queryMode);
      if (saved.position && Number.isFinite(saved.position.x) && Number.isFinite(saved.position.y)) {
        setPosition(saved.position);
      }
      if (saved.size && Number.isFinite(saved.size.width) && Number.isFinite(saved.size.height)) {
        setSize(saved.size);
      }
    } catch {
      /* повреждённый localStorage — честно стартуем с дефолтов */
    }
  }, [storageKey, modeProp, queryModeProp]);

  // Persist — после restore, чтобы не затереть сохранённое дефолтами.
  useEffect(() => {
    if (!restoredRef.current || !isStorageKey(storageKey)) return;
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ mode, queryMode, position, size }),
      );
    } catch {
      /* приватный режим/квота — не падаем */
    }
  }, [storageKey, mode, queryMode, position, size]);

  // При разворачивании фокус уходит в поле ввода (клавиатурный сценарий).
  const prevModeRef = useRef<AgentPanelMode>(mode);
  useEffect(() => {
    if (prevModeRef.current === 'collapsed' && mode === 'expanded') {
      inputRef.current?.focus();
    }
    prevModeRef.current = mode;
  }, [mode]);

  const expand = () => setMode('expanded');
  const collapse = () => setMode('collapsed');
  const close = () => setMode('closed');

  /** Текущая высота панели — значение сплиттера для ARIA. */
  const currentHeight = size?.height ?? (queryMode ? CHAT_HEIGHT : DEFAULT_HEIGHT);

  const viewportMax = (rect?: DOMRect | null) => ({
    width: Math.max(MIN_WIDTH, window.innerWidth - CLAMP_PAD * 2),
    height: Math.max(MIN_HEIGHT, window.innerHeight - CLAMP_PAD * 2),
    panelW: rect?.width || (queryMode ? CHAT_WIDTH : DEFAULT_WIDTH),
    panelH: rect?.height || (queryMode ? CHAT_HEIGHT : DEFAULT_HEIGHT),
  });

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== undefined && event.button !== 0) return;
    const px = Number.isFinite(event.clientX) ? event.clientX : 0;
    const py = Number.isFinite(event.clientY) ? event.clientY : 0;
    const rect = panelRef.current?.getBoundingClientRect();
    const origin = position ?? { x: rect?.left ?? CLAMP_PAD, y: rect?.top ?? CLAMP_PAD };
    dragRef.current = { startX: px, startY: py, origin };
    setDragging(true);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = dragRef.current;
    if (!gesture) return;
    const px = Number.isFinite(event.clientX) ? event.clientX : gesture.startX;
    const py = Number.isFinite(event.clientY) ? event.clientY : gesture.startY;
    const rect = panelRef.current?.getBoundingClientRect();
    const bounds = viewportMax(rect);
    const nextX = clamp(gesture.origin.x + (px - gesture.startX), CLAMP_PAD, bounds.width - bounds.panelW);
    const nextY = clamp(gesture.origin.y + (py - gesture.startY), CLAMP_PAD, bounds.height - bounds.panelH);
    setPosition({ x: nextX, y: nextY });
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  };

  const startResize = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== undefined && event.button !== 0) return;
    const px = Number.isFinite(event.clientX) ? event.clientX : 0;
    const py = Number.isFinite(event.clientY) ? event.clientY : 0;
    const rect = panelRef.current?.getBoundingClientRect();
    const originW = size?.width ?? (rect?.width || (queryMode ? CHAT_WIDTH : DEFAULT_WIDTH));
    const originH = size?.height ?? (rect?.height || (queryMode ? CHAT_HEIGHT : DEFAULT_HEIGHT));
    resizeRef.current = { startX: px, startY: py, originW, originH };
    setResizing(true);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const moveResize = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = resizeRef.current;
    if (!gesture) return;
    const px = Number.isFinite(event.clientX) ? event.clientX : gesture.startX;
    const py = Number.isFinite(event.clientY) ? event.clientY : gesture.startY;
    const rect = panelRef.current?.getBoundingClientRect();
    const bounds = viewportMax(rect);
    setSize({
      width: clamp(gesture.originW + (px - gesture.startX), MIN_WIDTH, bounds.width),
      height: clamp(gesture.originH + (py - gesture.startY), MIN_HEIGHT, bounds.height),
    });
  };

  const endResize = (event: ReactPointerEvent<HTMLElement>) => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    setResizing(false);
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  };

  const moveByKeyboard = (event: ReactKeyboardEvent<HTMLElement>, handle: 'drag' | 'resize') => {
    const delta = KEY_STEP;
    const rect = panelRef.current?.getBoundingClientRect();
    const bounds = viewportMax(rect);
    if (handle === 'drag') {
      const current = position ?? { x: rect?.left ?? CLAMP_PAD, y: rect?.top ?? CLAMP_PAD };
      let next = { ...current };
      if (event.key === 'ArrowLeft') next.x -= delta;
      else if (event.key === 'ArrowRight') next.x += delta;
      else if (event.key === 'ArrowUp') next.y -= delta;
      else if (event.key === 'ArrowDown') next.y += delta;
      else return;
      event.preventDefault();
      setPosition({
        x: clamp(next.x, CLAMP_PAD, bounds.width - bounds.panelW),
        y: clamp(next.y, CLAMP_PAD, bounds.height - bounds.panelH),
      });
      return;
    }
    const currentW = size?.width ?? rect?.width ?? (queryMode ? CHAT_WIDTH : DEFAULT_WIDTH);
    const currentH = size?.height ?? rect?.height ?? (queryMode ? CHAT_HEIGHT : DEFAULT_HEIGHT);
    let nextW = currentW;
    let nextH = currentH;
    if (event.key === 'ArrowLeft') nextW -= delta;
    else if (event.key === 'ArrowRight') nextW += delta;
    else if (event.key === 'ArrowUp') nextH -= delta;
    else if (event.key === 'ArrowDown') nextH += delta;
    else return;
    event.preventDefault();
    setSize({
      width: clamp(nextW, MIN_WIDTH, bounds.width),
      height: clamp(nextH, MIN_HEIGHT, bounds.height),
    });
  };

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    if (onSendQuery) {
      onSendQuery(text);
      setDraft('');
      setNotice(null);
      return;
    }
    setNotice('Отправка недоступна: runtime не подключён — сообщение не отправлено.');
  };

  const onRootKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    if (queryMode) {
      event.stopPropagation();
      setQuery(false);
      return;
    }
    if (mode === 'expanded') {
      event.stopPropagation();
      collapse();
    }
  };

  const panelStyle: CSSProperties = {
    ...(position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : null),
    ...(size ? { width: size.width, height: size.height } : null),
    ...style,
  };

  const rootClass = [
    styles.agentBar,
    styles[mode],
    queryMode ? styles.chatMode : '',
    dragging ? styles.dragging : '',
    resizing ? styles.resizing : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={panelRef}
      className={rootClass}
      data-testid="agent-panel"
      data-mode={mode}
      data-query={queryMode || undefined}
      data-dragging={dragging || undefined}
      data-resizing={resizing || undefined}
      hidden={mode === 'closed'}
      role="region"
      aria-label={`${assistantName} — панель ассистента`}
      aria-hidden={mode === 'closed' || undefined}
      style={panelStyle}
      onKeyDown={onRootKeyDown}
    >
      {mode === 'collapsed' ? (
        <div className={styles.capsule}>
          <span className={styles.avatar} aria-hidden="true" />
          <span className={styles.capsuleText}>
            <span className={styles.capsuleName}>{assistantName}</span>
            <span className={styles.capsuleStatus}>{status}</span>
          </span>
          <button
            type="button"
            className={styles.expandBtn}
            aria-label={`Развернуть панель ${assistantName}`}
            aria-expanded={false}
            onClick={expand}
          >
            ⌃
          </button>
          <div
            className={styles.dragHandle}
            role="button"
            tabIndex={0}
            aria-label="Переместить панель"
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={(event) => moveByKeyboard(event, 'drag')}
          >
            <span className={styles.grip} aria-hidden="true">⋮⋮</span>
          </div>
        </div>
      ) : (
        <>
          <header className={styles.header}>
            <div
              className={styles.dragHandle}
              role="button"
              tabIndex={0}
              aria-label="Переместить панель"
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={(event) => moveByKeyboard(event, 'drag')}
            >
              <span className={styles.grip} aria-hidden="true">⋮⋮</span>
              <span className={styles.title}>
                <span className={styles.titleName}>{assistantName}</span>
                <span className={styles.titleStatus}>{status}</span>
              </span>
            </div>
            <div className={styles.headerTools}>
              <button
                type="button"
                className={styles.queryBtn}
                aria-label={queryMode ? 'Свернуть чат' : 'Открыть чат'}
                aria-pressed={queryMode}
                onClick={() => setQuery(!queryMode)}
              >
                Чат
              </button>
              <button
                type="button"
                className={styles.minimizeBtn}
                aria-label="Свернуть панель"
                onClick={collapse}
              >
                –
              </button>
              <button
                type="button"
                className={styles.closeBtn}
                aria-label="Закрыть панель"
                onClick={close}
              >
                ×
              </button>
            </div>
          </header>

          <div className={styles.body}>
            {children}
            {queryMode ? (
              <div className={styles.chatBar}>
                <div
                  className={styles.messages}
                  data-testid="agent-panel-messages"
                  role="log"
                  aria-live="polite"
                  aria-label="Сообщения чата"
                >
                  {messages.length > 0 ? (
                    messages.map((message) => (
                      <p key={message.id} className={styles.message} data-role={message.role}>
                        <span className={styles.messageRole}>
                          {message.role === 'user' ? 'Вы' : message.role === 'assistant' ? assistantName : 'Система'}
                        </span>
                        {message.text}
                      </p>
                    ))
                  ) : (
                    <p className={styles.placeholder}>
                      Сообщений нет — ответы появятся, когда подключён runtime.
                    </p>
                  )}
                </div>
              </div>
            ) : null}

            <form
              className={styles.composer}
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <textarea
                ref={inputRef}
                className={styles.queryInput}
                placeholder="Спросите ALICE"
                value={draft}
                rows={1}
                aria-label={`Сообщение для ${assistantName}`}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
              <button
                type="submit"
                className={styles.sendBtn}
                aria-label="Отправить сообщение"
                disabled={draft.trim().length === 0}
              >
                →
              </button>
            </form>
            {notice ? (
              <p className={styles.notice} role="status">
                {notice}
              </p>
            ) : null}
          </div>

          <div
            className={styles.resizeHandle}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Изменить размер панели"
            aria-valuenow={currentHeight}
            aria-valuemin={MIN_HEIGHT}
            aria-valuemax={Math.max(1080, currentHeight)}
            tabIndex={0}
            onPointerDown={startResize}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onKeyDown={(event) => moveByKeyboard(event, 'resize')}
          />
        </>
      )}
    </div>
  );
});
