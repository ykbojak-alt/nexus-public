// Детерминированный движок шахмат — полные правила, без зависимостей.
// Клетки: idx = rank*8 + file; rank 0 — верх доски (8-я горизонталь, чёрные), file 0 — 'a'.

export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export interface Piece {
  t: PieceType;
  c: Color;
}
export type Board = (Piece | null)[];

export interface Move {
  from: number;
  to: number;
  promo?: PieceType;
  ep?: boolean; // взятие на проходе
  castle?: 'k' | 'q';
  cap?: PieceType; // тип съеденной фигуры — заполняется движком
}

export type GameStatus =
  | 'play'
  | 'checkmate'
  | 'stalemate'
  | 'draw50'
  | 'material'
  | 'repetition' // троекратное повторение позиции — ничья
  | 'agreement'; // ничья по соглашению сторон

export interface ChessState {
  board: Board;
  turn: Color;
  castling: { wk: boolean; wq: boolean; bk: boolean; bq: boolean };
  ep: number | null; // клетка, куда можно взять на проходе
  halfmove: number; // счётчик 50 ходов
  fullmove: number;
  status: GameStatus;
  winner: Color | null;
  check: Color | null;
  lastMove: Move | null;
  captured: { w: PieceType[]; b: PieceType[] }; // что съели белые / чёрные
  log: string[];
  // posKey → сколько раз позиция встречалась (для троекратного повторения).
  seen: Record<string, number>;
  seed: number;
}

export const FILE = (i: number) => i & 7;
export const RANK = (i: number) => i >> 3;
export const SQ = (file: number, rank: number) => rank * 8 + file;
export const alg = (i: number) => 'abcdefgh'[FILE(i)] + (8 - RANK(i));
export const parseAlg = (s: string) => SQ('abcdefgh'.indexOf(s[0]), 8 - Number(s[1]));
export const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const START: Record<number, PieceType> = {
  0: 'r', 1: 'n', 2: 'b', 3: 'q', 4: 'k', 5: 'b', 6: 'n', 7: 'r',
  56: 'r', 57: 'n', 58: 'b', 59: 'q', 60: 'k', 61: 'b', 62: 'n', 63: 'r',
};

export function newGame(seed = 1): ChessState {
  const board: Board = Array(64).fill(null);
  for (let f = 0; f < 8; f++) {
    board[SQ(f, 0)] = { t: START[f], c: 'b' };
    board[SQ(f, 1)] = { t: 'p', c: 'b' };
    board[SQ(f, 6)] = { t: 'p', c: 'w' };
    board[SQ(f, 7)] = { t: START[56 + f], c: 'w' };
  }
  const st: ChessState = {
    board,
    turn: 'w',
    castling: { wk: true, wq: true, bk: true, bq: true },
    ep: null,
    halfmove: 0,
    fullmove: 1,
    status: 'play',
    winner: null,
    check: null,
    lastMove: null,
    captured: { w: [], b: [] },
    log: [],
    seen: {},
    seed,
  };
  st.seen[posKey(st)] = 1; // стартовая позиция — первое вхождение
  return st;
}

// Ключ позиции для правила повторений: фигуры + очередь + права рокировки + ep.
// Счётчики ходов (halfmove/fullmove) и лог в ключ не входят — по правилам FIDE.
export function posKey(st: ChessState): string {
  let s = '';
  for (let i = 0; i < 64; i++) {
    const p = st.board[i];
    s += p ? p.c + p.t : '.';
  }
  const c = st.castling;
  return `${s}|${st.turn}|${c.wk ? 1 : 0}${c.wq ? 1 : 0}${c.bk ? 1 : 0}${c.bq ? 1 : 0}|${st.ep ?? -1}`;
}

const KNIGHT_D = [
  [1, 2], [2, 1], [2, -1], [1, -2],
  [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const KING_D = [
  [1, 0], [1, 1], [0, 1], [-1, 1],
  [-1, 0], [-1, -1], [0, -1], [1, -1],
];
const RAY_B = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const RAY_R = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const inside = (f: number, r: number) => f >= 0 && f < 8 && r >= 0 && r < 8;

// Атакует ли цвет `by` клетку `sq` (псевдоходы, без проверки своего короля).
export function isAttacked(board: Board, sq: number, by: Color): boolean {
  const f = FILE(sq);
  const r = RANK(sq);
  // Пешки: белая атакует вверх — её источник на ранг ниже клетки.
  const pd = by === 'w' ? 1 : -1;
  for (const df of [-1, 1]) {
    const ff = f + df;
    const rr = r + pd;
    if (inside(ff, rr)) {
      const p = board[SQ(ff, rr)];
      if (p && p.c === by && p.t === 'p') return true;
    }
  }
  for (const [df, dr] of KNIGHT_D) {
    const ff = f + df;
    const rr = r + dr;
    if (inside(ff, rr)) {
      const p = board[SQ(ff, rr)];
      if (p && p.c === by && p.t === 'n') return true;
    }
  }
  for (const [df, dr] of KING_D) {
    const ff = f + df;
    const rr = r + dr;
    if (inside(ff, rr)) {
      const p = board[SQ(ff, rr)];
      if (p && p.c === by && p.t === 'k') return true;
    }
  }
  for (const [rays, types] of [
    [RAY_B, ['b', 'q']] as const,
    [RAY_R, ['r', 'q']] as const,
  ]) {
    for (const [df, dr] of rays) {
      let ff = f + df;
      let rr = r + dr;
      while (inside(ff, rr)) {
        const p = board[SQ(ff, rr)];
        if (p) {
          if (p.c === by && (types as readonly PieceType[]).includes(p.t)) return true;
          break;
        }
        ff += df;
        rr += dr;
      }
    }
  }
  return false;
}

export function kingSquare(board: Board, c: Color): number {
  return board.findIndex((p) => p !== null && p.t === 'k' && p.c === c);
}

export function inCheck(board: Board, c: Color): boolean {
  const k = kingSquare(board, c);
  return k >= 0 && isAttacked(board, k, other(c));
}

function pseudoMoves(st: ChessState, i: number): Move[] {
  const p = st.board[i];
  if (!p) return [];
  const out: Move[] = [];
  const f = FILE(i);
  const r = RANK(i);
  const push = (to: number, extra?: Partial<Move>) => {
    const target = st.board[to];
    if (target && target.c === p.c) return;
    out.push({ from: i, to, ...extra });
  };

  if (p.t === 'p') {
    const dir = p.c === 'w' ? -1 : 1;
    const startR = p.c === 'w' ? 6 : 1;
    const promoR = p.c === 'w' ? 0 : 7;
    const addPawn = (to: number, extra?: Partial<Move>) => {
      if (RANK(to) === promoR) {
        for (const promo of ['q', 'r', 'b', 'n'] as const) {
          out.push({ from: i, to, promo, ...extra });
        }
      } else {
        out.push({ from: i, to, ...extra });
      }
    };
    if (inside(f, r + dir) && !st.board[SQ(f, r + dir)]) {
      addPawn(SQ(f, r + dir));
      if (r === startR && !st.board[SQ(f, r + 2 * dir)]) {
        addPawn(SQ(f, r + 2 * dir));
      }
    }
    for (const df of [-1, 1]) {
      const ff = f + df;
      const rr = r + dir;
      if (!inside(ff, rr)) continue;
      const to = SQ(ff, rr);
      const target = st.board[to];
      if (target && target.c !== p.c) addPawn(to);
      if (to === st.ep) addPawn(to, { ep: true });
    }
    return out;
  }

  if (p.t === 'n' || p.t === 'k') {
    for (const [df, dr] of p.t === 'n' ? KNIGHT_D : KING_D) {
      const ff = f + df;
      const rr = r + dr;
      if (inside(ff, rr)) push(SQ(ff, rr));
    }
    if (p.t === 'k') {
      const home = p.c === 'w' ? 7 : 0;
      const enemy = other(p.c);
      const rights =
        p.c === 'w'
          ? { k: st.castling.wk, q: st.castling.wq }
          : { k: st.castling.bk, q: st.castling.bq };
      if (i === SQ(4, home) && !inCheck(st.board, p.c)) {
        // Короткая: f,g свободны и не биты, ладья на h.
        if (
          rights.k &&
          st.board[SQ(7, home)]?.t === 'r' &&
          st.board[SQ(7, home)]?.c === p.c &&
          !st.board[SQ(5, home)] &&
          !st.board[SQ(6, home)] &&
          !isAttacked(st.board, SQ(5, home), enemy) &&
          !isAttacked(st.board, SQ(6, home), enemy)
        ) {
          out.push({ from: i, to: SQ(6, home), castle: 'k' });
        }
        // Длинная: b,c,d свободны; e,d,c не биты, ладья на a.
        if (
          rights.q &&
          st.board[SQ(0, home)]?.t === 'r' &&
          st.board[SQ(0, home)]?.c === p.c &&
          !st.board[SQ(1, home)] &&
          !st.board[SQ(2, home)] &&
          !st.board[SQ(3, home)] &&
          !isAttacked(st.board, SQ(3, home), enemy) &&
          !isAttacked(st.board, SQ(2, home), enemy)
        ) {
          out.push({ from: i, to: SQ(2, home), castle: 'q' });
        }
      }
    }
    return out;
  }

  const rays =
    p.t === 'b' ? RAY_B : p.t === 'r' ? RAY_R : [...RAY_B, ...RAY_R];
  for (const [df, dr] of rays) {
    let ff = f + df;
    let rr = r + dr;
    while (inside(ff, rr)) {
      const to = SQ(ff, rr);
      const target = st.board[to];
      if (target) {
        if (target.c !== p.c) out.push({ from: i, to });
        break;
      }
      out.push({ from: i, to });
      ff += df;
      rr += dr;
    }
  }
  return out;
}

function applyRaw(board: Board, m: Move): Board {
  const next = board.slice();
  const p = next[m.from]!;
  next[m.from] = null;
  if (m.ep) {
    // взятая пешка стоит на одном ранге с `from`, на файле `to`
    next[SQ(FILE(m.to), RANK(m.from))] = null;
  }
  if (m.castle) {
    const home = RANK(m.from);
    if (m.castle === 'k') {
      next[SQ(5, home)] = next[SQ(7, home)];
      next[SQ(7, home)] = null;
    } else {
      next[SQ(3, home)] = next[SQ(0, home)];
      next[SQ(0, home)] = null;
    }
  }
  next[m.to] = m.promo ? { t: m.promo, c: p.c } : p;
  return next;
}

export function legalMoves(st: ChessState, i: number): Move[] {
  const p = st.board[i];
  if (!p || p.c !== st.turn || st.status !== 'play') return [];
  return pseudoMoves(st, i).filter((m) => !inCheck(applyRaw(st.board, m), p.c));
}

export function allLegalMoves(st: ChessState, c: Color): Move[] {
  if (st.status !== 'play') return [];
  const tmp = { ...st, turn: c };
  const out: Move[] = [];
  for (let i = 0; i < 64; i++) {
    const p = st.board[i];
    if (p && p.c === c) out.push(...legalMoves(tmp, i));
  }
  return out;
}

const SAN_PIECE: Record<PieceType, string> = {
  p: '', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K',
};

function insufficientMaterial(board: Board): boolean {
  const rest = board.filter((p): p is Piece => p !== null);
  if (rest.length <= 2) return true;
  if (rest.length === 3 && rest.some((p) => p.t === 'b' || p.t === 'n')) return true;
  // K+B vs K+B на одноцветных полях
  if (
    rest.length === 4 &&
    rest.filter((p) => p.t === 'b').length === 2 &&
    rest.every((p) => p.t === 'b' || p.t === 'k')
  ) {
    const idxs = board
      .map((p, i) => (p && p.t === 'b' ? i : -1))
      .filter((i) => i >= 0);
    const color = (i: number) => (FILE(i) + RANK(i)) % 2;
    if (idxs.length === 2 && color(idxs[0]) === color(idxs[1])) return true;
  }
  return false;
}

export function applyMove(st: ChessState, m: Move): ChessState {
  if (st.status !== 'play') return st;
  const p = st.board[m.from];
  if (!p || p.c !== st.turn) return st;
  const legal = legalMoves(st, m.from).some(
    (x) => x.to === m.to && (x.promo ?? 'q') === (m.promo ?? 'q'),
  );
  if (!legal) return st;

  const capturedPiece = m.ep
    ? st.board[SQ(FILE(m.to), RANK(m.from))]
    : st.board[m.to];
  const board = applyRaw(st.board, m);
  const next: ChessState = {
    ...st,
    board,
    castling: { ...st.castling },
    ep: null,
    halfmove: p.t === 'p' || capturedPiece ? 0 : st.halfmove + 1,
    fullmove: st.fullmove + (st.turn === 'b' ? 1 : 0),
    turn: other(st.turn),
    lastMove: { ...m, cap: capturedPiece?.t },
    captured: { w: [...st.captured.w], b: [...st.captured.b] },
    log: [...st.log],
  };

  // Права на рокировку: король/ладья пошли или ладью съели.
  if (p.t === 'k') {
    if (p.c === 'w') next.castling.wk = next.castling.wq = false;
    else next.castling.bk = next.castling.bq = false;
  }
  const rookSq = (i: number, key: keyof typeof next.castling) => {
    if (m.from === i || m.to === i) next.castling[key] = false;
  };
  rookSq(63, 'wk');
  rookSq(56, 'wq');
  rookSq(7, 'bk');
  rookSq(0, 'bq');

  // Взятие на проходе — цель на следующий ход.
  if (p.t === 'p' && Math.abs(RANK(m.to) - RANK(m.from)) === 2) {
    next.ep = SQ(FILE(m.from), (RANK(m.from) + RANK(m.to)) / 2);
  }
  if (capturedPiece) next.captured[p.c].push(capturedPiece.t);

  const enemy = next.turn;
  const enemyInCheck = inCheck(board, enemy);
  const hasMoves = allLegalMoves(next, enemy).length > 0;
  next.check = enemyInCheck ? enemy : null;
  if (!hasMoves) {
    next.status = enemyInCheck ? 'checkmate' : 'stalemate';
    next.winner = enemyInCheck ? p.c : null;
  } else if (next.halfmove >= 100) {
    next.status = 'draw50';
  } else if (insufficientMaterial(board)) {
    next.status = 'material';
  } else {
    // Троекратное повторение позиции — ничья (FIDE).
    next.seen = { ...st.seen };
    const key = posKey(next);
    const count = (next.seen[key] = (next.seen[key] ?? 0) + 1);
    if (count >= 3) next.status = 'repetition';
  }

  // SAN-лайт нотация.
  const san =
    m.castle === 'k'
      ? 'O-O'
      : m.castle === 'q'
        ? 'O-O-O'
        : `${SAN_PIECE[p.t]}${p.t === 'p' && capturedPiece ? 'abcdefgh'[FILE(m.from)] : ''}${
            capturedPiece ? 'x' : ''
          }${alg(m.to)}${m.promo ? `=${SAN_PIECE[m.promo]}` : ''}`;
  next.log.push(
    `${st.fullmove}${p.c === 'w' ? '.' : '…'} ${san}${
      next.status === 'checkmate' ? '#' : enemyInCheck ? '+' : ''
    }`,
  );
  return next;
}

// Ничья по соглашению — одна сторона приняла предложение другой.
export function agreeDraw(st: ChessState): ChessState {
  if (st.status !== 'play') return st;
  return {
    ...st,
    status: 'agreement',
    check: null,
    log: [...st.log, '½–½ ничья по соглашению'],
  };
}

export const PIECE_VALUE: Record<PieceType, number> = {
  p: 100, n: 320, b: 330, r: 500, q: 900, k: 0,
};

export function materialScore(board: Board, c: Color): number {
  let s = 0;
  for (const p of board) {
    if (!p) continue;
    s += p.c === c ? PIECE_VALUE[p.t] : -PIECE_VALUE[p.t];
  }
  return s;
}
