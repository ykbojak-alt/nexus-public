'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Button, GlassPanel, PanelHeader, StatusBadge } from '@nexus/ui';
import { PERSONAS } from '@nexus/mock-data';
import {
  type ChessState,
  type Color,
  type Move,
  type PieceType,
  SQ,
  FILE,
  RANK,
  alg,
  agreeDraw,
  allLegalMoves,
  applyMove,
  legalMoves,
  materialScore,
  newGame,
} from './engine';
import { aiMove, describeStatus, DIFFICULTY_LABEL, type Difficulty } from './ai';
import { gameMotion } from '@nexus/motion';
import { ChessPiece } from './pieces';
import styles from './chess.module.css';

// Фигуры — классические Staunton-силуэты (svg), цвет задаётся стилем.
const PIECE_NAME: Record<PieceType, string> = {
  p: 'пешка', n: 'конь', b: 'слон', r: 'ладья', q: 'ферзь', k: 'король',
};
// Род слова для согласования цвета в aria-label («белая пешка» / «чёрный конь»).
const PIECE_FEM: Record<PieceType, boolean> = {
  p: true, n: false, b: false, r: true, q: false, k: false,
};
const colorAdj = (c: Color, fem: boolean) =>
  c === 'w' ? (fem ? 'белая' : 'белый') : (fem ? 'чёрная' : 'чёрный');
const sqLabel = (state: ChessState, i: number) => {
  const p = state.board[i];
  return `${alg(i)}${p ? `, ${colorAdj(p.c, PIECE_FEM[p.t])} ${PIECE_NAME[p.t]}` : ''}`;
};

const ASSET_BASE =
  typeof document !== 'undefined' &&
    document.querySelector('script[src*="/_nexus/"], link[href*="/_nexus/"]')
    ? '/_nexus'
    : '';
const agentSrc = (personaId: string) => `${ASSET_BASE}/durak/agents/${personaId}.webp`;
const agentBgSrc = (personaId: string) => `${ASSET_BASE}/durak/agents/bg-${personaId}.webp`;

const AGENT_PERSONAS = PERSONAS.filter((p) => p.id !== 'nexus');

export function ChessScreen() {
  const [opponentId, setOpponentId] = useState<string>('alice');
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [seed, setSeed] = useState<number>(() => Math.floor(Math.random() * 1_000_000));
  // Пользователь ввёл seed вручную — реплей перекрывает автоматику.
  const seedTouched = useRef(false);
  const [state, setState] = useState<ChessState | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  // Roving tabindex на доске: один tab-стоп на всю сетку, стрелки двигают фокус.
  const [focusSq, setFocusSq] = useState(52); // e2 — стартовая клетка белой пешки
  // Пешка дошла до края — ждём выбора фигуры, не ферзь по умолчанию.
  const [pendingPromo, setPendingPromo] = useState<Move[] | null>(null);
  // Подсказка движка — клетки from/to предложенного хода.
  const [hint, setHint] = useState<{ from: number; to: number } | null>(null);
  const [flipped, setFlipped] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const animMoveRef = useRef<Move | null>(null);
  const tickRef = useRef(0);
  // Стек позиций перед ходами игрока — откат снимает и ответ AI.
  const historyRef = useRef<ChessState[]>([]);

  const userColor: Color = 'w';
  const aiColor: Color = 'b';
  const userTurn = state !== null && state.turn === userColor && state.status === 'play';

  // Реплей по ссылке: /chess?seed=N&difficulty=hard&opponent=X&start=1
  // → seed + сложность + оппонент из URL; start=1 сразу начинает партию.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const n = Number(params.get('seed'));
    const hasSeed = n > 0;
    if (hasSeed) {
      seedTouched.current = true;
      setSeed(n);
    }
    const diff = params.get('difficulty');
    if (diff != null && diff in DIFFICULTY_LABEL) {
      setDifficulty(diff as Difficulty);
    }
    const opp = params.get('opponent');
    if (opp != null && AGENT_PERSONAS.some((p) => p.id === opp)) {
      setOpponentId(opp);
    }
    if (params.get('start') === '1') {
      const s = hasSeed ? n : Math.floor(Math.random() * 1_000_000);
      setSeed(s);
      setState(newGame(s));
      setSelected(null);
      setPendingPromo(null);
      setHint(null);
      tickRef.current = 0;
      historyRef.current = [];
    }
  }, []);

  // Persist для хаба /games: seed последней партии и её итог.
  useEffect(() => {
    if (!state) return;
    window.localStorage.setItem('nexus.chess.lastSeed', String(state.seed));
    if (state.status !== 'play') {
      window.localStorage.setItem(
        'nexus.chess.lastResult',
        state.winner === userColor ? 'w' : state.winner ? 'l' : 'd',
      );
    }
  }, [state, userColor]);

  // Ход AI — один тик на ход.
  useEffect(() => {
    if (!state || state.status !== 'play' || state.turn !== aiColor) return;
    const t = setTimeout(() => {
      setState((prev) => {
        if (!prev || prev.turn !== aiColor || prev.status !== 'play') return prev;
        tickRef.current += 1;
        const m = aiMove(prev, aiColor, opponentId, tickRef.current, difficulty);
        if (!m) return prev;
        const next = applyMove(prev, m);
        animMoveRef.current = next.lastMove;
        return next;
      });
    }, 620);
    return () => clearTimeout(t);
  }, [state, opponentId, difficulty]);

  // Анимация хода: фигура перелетает по дуге с исходной клетки на целевую;
  // конь — высоким прыжком, рокировка двигает и ладью, проход — «поп» новой фигуры.
  useLayoutEffect(() => {
    const m = animMoveRef.current;
    const root = boardRef.current;
    animMoveRef.current = null;
    if (!m || !root) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const anims: Animation[] = [];
    const fly = (fromSq: number, toSq: number, hop: boolean) => {
      const to = root.querySelector<HTMLElement>(`[data-sq="${toSq}"]`);
      const from = root.querySelector<HTMLElement>(`[data-sq="${fromSq}"]`);
      const piece = to?.querySelector<HTMLElement>(`.${styles.piece}`);
      if (!to || !from || !piece || typeof piece.animate !== 'function') return;
      const a = from.getBoundingClientRect();
      const b = piece.getBoundingClientRect();
      const dx = a.left + (a.width - b.width) / 2 - b.left;
      const dy = a.top + (a.height - b.height) / 2 - b.top;
      const lift = b.height * (hop ? 0.55 : 0.32);
      anims.push(
        piece.animate(
          [
            { transform: `translate(${dx}px, ${dy}px)`, offset: 0 },
            {
              transform: `translate(${dx * 0.5}px, ${dy * 0.5 - lift}px) scale(1.12) rotate(${dx >= 0 ? -4 : 4}deg)`,
              offset: 0.55,
            },
            { transform: 'none', offset: 1 },
          ],
          // Ритм — gameMotion-фабрика (W4): взятие=capture, ход=move; дуга=arc.
          gameMotion(hop ? 'capture' : 'move', 'arc'),
        ),
      );
    };

    const moved = state?.board[m.to];
    fly(m.from, m.to, moved?.t === 'n');
    // Рокировка — ладья едет следом за королём.
    if (m.castle) {
      const home = RANK(m.to);
      fly(
        m.castle === 'k' ? SQ(7, home) : SQ(0, home),
        m.castle === 'k' ? SQ(5, home) : SQ(3, home),
        false,
      );
    }
    // Проход — новая фигура «вырастает» на клетке.
    if (m.promo) {
      const piece = root
        .querySelector<HTMLElement>(`[data-sq="${m.to}"]`)
        ?.querySelector<HTMLElement>(`.${styles.piece}`);
      if (!piece || typeof piece.animate !== 'function') return;
      anims.push(
        piece.animate(
          [
            { transform: 'scale(0.3)', opacity: 0.2 },
            { transform: 'scale(1.06)', opacity: 1, offset: 0.7 },
            { transform: 'none' },
          ],
          // Промо — gameMotion-фабрика (W4): motion.promote + pop-овершут.
          gameMotion('promote', 'pop'),
        ),
      );
    }
    // WAAPI-анимации отменяем при новом ходе/unmount — handle живёт не дольше эффекта.
    return () => {
      for (const a of anims) a.cancel();
    };
  }, [state]);

  // Escape — отмена выбора превращения, затем выделения клетки.
  useEffect(() => {
    if (!pendingPromo && selected === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (pendingPromo) setPendingPromo(null);
      else setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingPromo, selected]);

  // Диалог превращения забирает фокус на первую кнопку — иначе клавиатурный
  // фокус оставался бы на клетке под поповером.
  const promoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pendingPromo) promoRef.current?.querySelector('button')?.focus();
  }, [pendingPromo]);

  function commit(next: ChessState | null) {
    if (next && state && next.lastMove !== state.lastMove) {
      animMoveRef.current = next.lastMove;
    }
    setState(next);
  }

  function start() {
    // Сид свежий каждую партию — кроме случая, когда ввели свой для реплея.
    const s = seedTouched.current ? seed : Math.floor(Math.random() * 1_000_000);
    setSeed(s);
    setState(newGame(s));
    setSelected(null);
    setPendingPromo(null);
    setHint(null);
    tickRef.current = 0;
    historyRef.current = [];
  }

  function userMove(m: Move) {
    historyRef.current.push(state!);
    commit(applyMove(state!, m));
    setSelected(null);
    setPendingPromo(null);
    setHint(null);
    // Клавиатурный фокус следует за сходившей фигурой.
    setFocusSq(m.to);
    boardRef.current
      ?.querySelector<HTMLElement>(`[data-sq="${m.to}"]`)
      ?.focus();
  }

  function undo() {
    const prev = historyRef.current.pop();
    if (prev) {
      setState(prev);
      setSelected(null);
      setPendingPromo(null);
      setHint(null);
    }
  }

  function offerDraw() {
    if (!state || !userTurn) return;
    // AI принимает ничью, только если не выигрывает явно (< ~1.5 пешки).
    if (materialScore(state.board, aiColor) < 150) {
      commit(agreeDraw(state));
    } else {
      setState({
        ...state,
        log: [...state.log, `${names.b} отклонил предложение ничьей`],
      });
    }
  }

  function requestHint() {
    if (!state || !userTurn) return;
    const m = aiMove(state, userColor, 'codex', tickRef.current + 977, 'normal');
    if (m) setHint({ from: m.from, to: m.to });
  }

  function onSquare(i: number) {
    if (!state || !userTurn || pendingPromo) return;
    const p = state.board[i];
    // Выбор своей фигуры.
    if (selected === null) {
      if (p && p.c === userColor && legalMoves(state, i).length > 0) setSelected(i);
      return;
    }
    if (i === selected) {
      setSelected(null);
      return;
    }
    const targets = legalMoves(state, selected).filter((m) => m.to === i);
    if (targets.length > 0) {
      // Несколько вариантов на одну клетку = превращение — спрашиваем фигуру.
      if (targets.length > 1 && targets.every((m) => m.promo)) {
        setPendingPromo(targets);
        return;
      }
      userMove(targets[0]);
      return;
    }
    // Перевыбор на другую свою фигуру.
    if (p && p.c === userColor) {
      setSelected(legalMoves(state, i).length > 0 ? i : null);
      return;
    }
    setSelected(null);
  }

  // ARIA grid-клавиатура: стрелки/края ряда/края доски. Направления следуют
  // видимой ориентации — при перевёрнутой доске инвертируются.
  function onBoardKey(e: React.KeyboardEvent) {
    const cur = focusSq;
    const f = FILE(cur);
    const r = RANK(cur);
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowLeft': next = f === (flipped ? 7 : 0) ? null : cur + (flipped ? 1 : -1); break;
      case 'ArrowRight': next = f === (flipped ? 0 : 7) ? null : cur + (flipped ? -1 : 1); break;
      case 'ArrowUp': next = r === (flipped ? 7 : 0) ? null : cur + (flipped ? 8 : -8); break;
      case 'ArrowDown': next = r === (flipped ? 0 : 7) ? null : cur + (flipped ? -8 : 8); break;
      case 'Home': next = cur + (flipped ? 7 - f : -f); break;
      case 'End': next = cur + (flipped ? -f : 7 - f); break;
      case 'PageUp': next = flipped ? f : 56 + f; break;
      case 'PageDown': next = flipped ? 56 + f : f; break;
      default: return;
    }
    if (next === null || next === cur) return;
    e.preventDefault();
    setFocusSq(next);
    boardRef.current?.querySelector<HTMLElement>(`[data-sq="${next}"]`)?.focus();
  }

  if (!state) {
    return (
      <div className={styles.page} data-screen="chess" data-state="empty" aria-labelledby="chess-title">
        <PanelHeader
          level="screen"
          divider={false}
          titleId="chess-title"
          title="Шахматы"
          subtitle="Полные правила: рокировка, взятие на проходе, повторение, 50 ходов. Откат и подсказка движка. Локально."
          actions={<StatusBadge status="info" label="ЛОКАЛЬНО" />}
        />
        <GlassPanel className={styles.setup}>
          <PanelHeader level="panel" divider={false} headingLevel={2} title="Соперник" />
          <div className={styles.opponentPick}>
            {AGENT_PERSONAS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={styles.personaChip}
                data-on={opponentId === p.id || undefined}
                aria-pressed={opponentId === p.id}
                onClick={() => setOpponentId(p.id)}
              >
                <img loading="lazy" decoding="async" src={agentSrc(p.id)} alt="" className={styles.personaAvatar} />
                <span className={styles.personaName}>{p.name}</span>
              </button>
            ))}
          </div>
          <div className={styles.diffPick}>
            <span className={styles.diffLabel}>Сложность</span>
            {(Object.keys(DIFFICULTY_LABEL) as Difficulty[]).map((d) => (
              <button
                key={d}
                type="button"
                className={styles.diffChip}
                data-on={difficulty === d || undefined}
                aria-pressed={difficulty === d}
                onClick={() => setDifficulty(d)}
              >
                {DIFFICULTY_LABEL[d]}
              </button>
            ))}
          </div>
          <div className={styles.setupRow}>
            <label className={styles.label}>
              Seed <i>(авто)</i>
              <input
                className={styles.input}
                type="number"
                title="По умолчанию — случайный каждую партию; введите свой для реплея"
                value={seed}
                onChange={(e) => {
                  seedTouched.current = true;
                  setSeed(Number(e.target.value) || 0);
                }}
              />
            </label>
            <span className={styles.hint}>Вы играете белыми. Ход — клик по фигуре и клетке.</span>
            <Button variant="primary" onClick={start}>
              Начать партию
            </Button>
          </div>
        </GlassPanel>
      </div>
    );
  }

  const persona = PERSONAS.find((p) => p.id === opponentId);
  const names: Record<Color, string> = { w: 'Вы', b: persona?.name ?? 'AI' };
  const userMoves = selected !== null ? legalMoves(state, selected) : [];
  const targets = new Set(userMoves.map((m) => m.to));
  const captures = new Set(
    userMoves.filter((m) => state.board[m.to] || m.ep).map((m) => m.to),
  );
  // Свои фигуры, которым есть куда ходить, — точечная подсветка доступности.
  const canMove = new Set<number>();
  if (userTurn) {
    for (let i = 0; i < 64; i++) {
      const p = state.board[i];
      if (p && p.c === userColor && legalMoves(state, i).length > 0) canMove.add(i);
    }
  }
  const kingSq = state.board.findIndex((p) => p !== null && p.t === 'k' && p.c === state.check);
  const finished = state.status !== 'play';
  // Чистый материальный баланс с точки зрения игрока (без позиционной оценки).
  const material = materialScore(state.board, userColor);
  // Порядок клеток — прямой или зеркальный при перевёрнутой доске.
  const order = flipped
    ? Array.from({ length: 64 }, (_, i) => 63 - i)
    : Array.from({ length: 64 }, (_, i) => i);

  return (
    <div className={styles.page} data-screen="chess" data-state={finished ? 'finished' : 'ready'} aria-labelledby="chess-title">
      <PanelHeader
        level="screen"
        divider={false}
        titleId="chess-title"
        title="Шахматы"
        subtitle={(
          <>
            <span aria-live="polite">{describeStatus(state, names)}</span>
            {` · ${DIFFICULTY_LABEL[difficulty]} · seed ${state.seed}`}
          </>
        )}
        actions={(
          <div className={styles.headerMeta}>
            <StatusBadge status="info" label="ЛОКАЛЬНО" />
            <Button variant="ghost" onClick={() => setState(null)}>
              Новая игра
            </Button>
          </div>
        )}
      />

      <div className={styles.board}>
        <div className={styles.mainCol}>
          <GlassPanel
            className={styles.opponent}
            data-turn={state.turn === aiColor || undefined}
            style={{ '--agentBg': `url(${agentBgSrc(opponentId)})` } as CSSProperties}
          >
            <span className={styles.avatarWrap}>
              <img loading="lazy" decoding="async" src={agentSrc(opponentId)} alt="" className={styles.avatar} />
            </span>
            <span className={styles.opponentName}>{persona?.name}</span>
            <span className={styles.opponentRole}>
              {finished ? 'партия завершена' : state.turn === aiColor ? 'думает' : 'чёрные'}
            </span>
            <span className={styles.capturedTray}>
              {state.captured.b.map((t, i) => (
                <span key={i} className={styles.capturedPiece} title={PIECE_NAME[t]}>
                  <ChessPiece t={t} c="w" className={styles.capturedSvg} />
                </span>
              ))}
            </span>
          </GlassPanel>

          <GlassPanel className={styles.boardArea}>
            <div className={styles.boardFrame}>
              <div
                className={styles.chessBoard}
                ref={boardRef}
                role="grid"
                aria-label="Шахматная доска. Стрелки — навигация, Enter — выбор и ход"
                onKeyDown={onBoardKey}
              >
                {order.map((i) => {
                  const p = state.board[i];
                  return (
                    <button
                      key={i}
                      type="button"
                      role="gridcell"
                      className={styles.square}
                      data-sq={i}
                      aria-label={sqLabel(state, i)}
                      aria-selected={selected === i || undefined}
                      tabIndex={focusSq === i ? 0 : -1}
                      onFocus={() => setFocusSq(i)}
                      data-light={(FILE(i) + RANK(i)) % 2 === 0 || undefined}
                      data-selected={selected === i || undefined}
                      data-target={targets.has(i) || undefined}
                      data-capture={captures.has(i) || undefined}
                      data-last={
                        state.lastMove && (state.lastMove.from === i || state.lastMove.to === i)
                          ? true
                          : undefined
                      }
                      data-check={kingSq === i || undefined}
                      data-cap={
                        state.lastMove?.cap && state.lastMove.to === i ? true : undefined
                      }
                      data-canmove={canMove.has(i) || undefined}
                      data-hint={hint && (hint.from === i || hint.to === i) ? true : undefined}
                      onClick={() => onSquare(i)}
                    >
                      <span className={styles.coord}>
                        {FILE(i) === (flipped ? 7 : 0) && <i>{8 - RANK(i)}</i>}
                        {RANK(i) === (flipped ? 0 : 7) && <b>{'abcdefgh'[FILE(i)]}</b>}
                      </span>
                      {p && (
                        <span className={styles.piece} data-c={p.c} title={PIECE_NAME[p.t]}>
                          <ChessPiece t={p.t} c={p.c} className={styles.pieceSvg} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            {pendingPromo && (
              <div className={styles.promoPop} role="dialog" aria-label="Выбор фигуры превращения" ref={promoRef}>
                <span className={styles.promoTitle}>Превратить в</span>
                <div className={styles.promoBtns}>
                  {pendingPromo.map((m) => (
                    <button
                      key={m.promo}
                      type="button"
                      className={styles.promoBtn}
                      aria-label={PIECE_NAME[m.promo!]}
                      title={PIECE_NAME[m.promo!]}
                      onClick={() => userMove(m)}
                    >
                      <ChessPiece
                        t={m.promo!}
                        c={userColor}
                        className={styles.promoGlyph}
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </GlassPanel>

          <GlassPanel className={styles.userBar} data-turn={userTurn || undefined}>
            <span className={styles.you}>
              Вы · белые{state.check === 'w' && state.status === 'play' ? ' · шах!' : ''}
            </span>
            <span className={styles.capturedTray}>
              {state.captured.w.map((t, i) => (
                <span key={i} className={styles.capturedPiece} title={PIECE_NAME[t]}>
                  <ChessPiece t={t} c="b" className={styles.capturedSvg} />
                </span>
              ))}
              {material !== 0 && (
                <span className={styles.matChip} title="Материальный баланс (пешки)">
                  {material > 0 ? '+' : ''}
                  {material / 100}
                </span>
              )}
            </span>
            <div className={styles.actions}>
              {!finished && (
                <>
                  <Button
                    variant="ghost"
                    onClick={undo}
                    disabled={historyRef.current.length === 0}
                    title="Вернуть последний свой ход и ответ AI"
                  >
                    Откат
                  </Button>
                  <Button variant="ghost" onClick={requestHint} disabled={!userTurn}>
                    Подсказка
                  </Button>
                  <Button variant="ghost" onClick={offerDraw} disabled={!userTurn}>
                    Ничья
                  </Button>
                  <Button variant="ghost" onClick={() => setFlipped((f) => !f)}>
                    Перевернуть
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setState({ ...state, status: 'checkmate', winner: aiColor, check: null })
                    }
                  >
                    Сдаться
                  </Button>
                </>
              )}
              {finished && (
                <Button variant="primary" onClick={() => setState(null)}>
                  Новая игра
                </Button>
              )}
            </div>
          </GlassPanel>
        </div>

        <aside className={styles.log}>
          <h2 className={styles.logTitle}>Ходы</h2>
          <ol className={styles.logList} tabIndex={0} aria-label="Журнал ходов партии — нотация по колонкам, прокрутка стрелками">
            {state.log.map((entry, i) => (
              <li key={i}>{entry}</li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}
