// Локальный AI шахмат: 4 уровня сложности.
// easy   — одноходовая жадная оценка + персональный уклон + seed-шум (исходный).
// normal — negamax глубина 2, материал + позиционные таблицы (PST).
// hard   — negamax глубина 3 + alpha-beta, лучший ход без лотереи.
// master — negamax глубина 4 + alpha-beta + quiescence (досчёт взятий/
//          превращений/ответов на шах за горизонтом) — максимально сильный
//          локальный противник, без лотереи.
// Все уровни детерминированы по seed — реплей воспроизводится.
import {
  allLegalMoves,
  applyMove,
  materialScore,
  mulberry32,
  posKey,
  type Board,
  type ChessState,
  type Color,
  type Move,
  type PieceType,
  PIECE_VALUE,
} from './engine';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'master';

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'Лёгкий',
  normal: 'Средний',
  hard: 'Сложный',
  master: 'Мастер',
};

// Центр — лёгкий позиционный бонус, чтобы AI не был чистым материалистом.
const CENTER = new Set([27, 28, 35, 36, 19, 20, 43, 44]);

// ─── Позиционные таблицы (PST), индекс 0 = a8, белая перспектива ───
// Чёрная фигура читает таблицу зеркально по рангу: i ^ 56.
const PST: Record<PieceType, number[]> = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ],
};

// Полная оценка позиции для цвета me: материал + PST.
function evaluate(board: Board, me: Color): number {
  let s = 0;
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (!p) continue;
    const v = PIECE_VALUE[p.t] + PST[p.t][p.c === 'w' ? i : i ^ 56];
    s += p.c === me ? v : -v;
  }
  return s;
}

// Дешёвая сортировка ходов: взятия по MVV-LVA и проходы первыми —
// alpha-beta отсекает заметно больше веток.
function orderScore(st: ChessState, m: Move): number {
  let s = 0;
  const victim = m.ep ? 'p' : st.board[m.to]?.t;
  if (victim) s += PIECE_VALUE[victim] * 10 - PIECE_VALUE[st.board[m.from]!.t];
  if (m.promo) s += PIECE_VALUE[m.promo];
  return s;
}

// Quiescence-поиск: за горизонтом основного поиска досчитываем только
// «шумные» ходы (взятия, превращения) — иначе мастер мог бы отдать ферзя
// на последнем полуходе и записать позицию как выигрышную. Под шахом
// stand-pat незаконен — перебираем все защиты.
function quiesce(
  st: ChessState,
  alpha: number,
  beta: number,
  ply: number,
  qdepth: number,
): number {
  if (st.status === 'checkmate') return -1_000_000 + ply;
  if (st.status !== 'play') return 0;
  const stand = evaluate(st.board, st.turn);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  if (qdepth === 0) return alpha;
  const all = allLegalMoves(st, st.turn);
  const moves = st.check
    ? all.sort((a, b) => orderScore(st, b) - orderScore(st, a))
    : all
        .filter((m) => m.ep || m.promo || st.board[m.to])
        .sort((a, b) => orderScore(st, b) - orderScore(st, a));
  for (const m of moves) {
    const sc = -quiesce(applyMove(st, m), -beta, -alpha, ply + 1, qdepth - 1);
    if (sc >= beta) return beta;
    if (sc > alpha) alpha = sc;
  }
  return alpha;
}

const MATE = 1_000_000;

// Транспозиционная таблица (только master): одна позиция достижима
// перестановками ходов — кэш «глубина + исход + тип границы» отсекает
// повторный перебор. Ключ — тот же posKey, что у правила повторений.
interface TTEntry {
  depth: number;
  score: number;
  flag: 'exact' | 'lower' | 'upper';
}
type TT = Map<string, TTEntry>;

// Мат-оценки ply-зависимы — нормализуем на запись/чтение (стандарт TT).
function ttProbe(
  e: TTEntry,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
): { hit?: number; alpha: number; beta: number } {
  if (e.depth < depth) return { alpha, beta };
  const s =
    e.score > MATE - 1000 ? e.score - ply : e.score < -(MATE - 1000) ? e.score + ply : e.score;
  if (e.flag === 'exact') return { hit: s, alpha, beta };
  if (e.flag === 'lower') alpha = Math.max(alpha, s);
  else beta = Math.min(beta, s);
  return alpha >= beta ? { hit: s, alpha, beta } : { alpha, beta };
}

// Negamax с alpha-beta. Оценка от стороны, которая ходит в данном узле.
// qdepth > 0 — на горизонте вместо статической оценки идёт quiescence.
function negamax(
  st: ChessState,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  qdepth = 0,
  tt?: TT,
): number {
  if (st.status === 'checkmate') return -MATE + ply; // ходящему мат
  if (st.status !== 'play') return 0; // пат/ничьи
  if (depth === 0) {
    return qdepth
      ? quiesce(st, alpha, beta, ply, qdepth)
      : evaluate(st.board, st.turn);
  }
  const alpha0 = alpha;
  let key = '';
  if (tt) {
    key = posKey(st);
    const e = tt.get(key);
    if (e) {
      const r = ttProbe(e, depth, alpha, beta, ply);
      if (r.hit !== undefined) return r.hit;
      alpha = r.alpha;
      beta = r.beta;
    }
  }
  const moves = allLegalMoves(st, st.turn).sort(
    (a, b) => orderScore(st, b) - orderScore(st, a),
  );
  let best = -Infinity;
  for (const m of moves) {
    const sc = -negamax(applyMove(st, m), depth - 1, -beta, -alpha, ply + 1, qdepth, tt);
    if (sc > best) best = sc;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  if (tt) {
    let score = best;
    if (score > MATE - 1000) score += ply;
    else if (score < -(MATE - 1000)) score -= ply;
    tt.set(key, {
      depth,
      score,
      flag: best <= alpha0 ? 'upper' : best >= beta ? 'lower' : 'exact',
    });
  }
  return best;
}

// Персональный уклон поверх поиска — характер агента сохраняется на всех уровнях.
function personaBonus(st: ChessState, m: Move, aggression: number): number {
  let s = 0;
  const cap = m.ep ? 'p' : st.board[m.to]?.t;
  if (cap) s += PIECE_VALUE[cap] * 0.06 * aggression;
  if (CENTER.has(m.to)) s += 4;
  if (m.promo === 'q') s += 20;
  return s;
}

function evalAfter(st: ChessState, m: Move, me: Color, aggression: number): number {
  const next = applyMove(st, m);
  let s = materialScore(next.board, me);
  // Атака: бонус за взятия и шах.
  const cap = m.ep ? 'p' : st.board[m.to]?.t;
  if (cap) s += PIECE_VALUE[cap] * 0.12 * aggression;
  if (next.check) s += 35 * aggression;
  if (next.status === 'checkmate') s += 1_000_000;
  if (CENTER.has(m.to)) s += 8;
  if (m.promo === 'q') s += 40;
  return s;
}

export function aiMove(
  st: ChessState,
  color: Color,
  personaId: string,
  tick: number,
  difficulty: Difficulty = 'easy',
): Move | null {
  const moves = allLegalMoves(st, color);
  if (moves.length === 0) return null;
  const aggression = personaId === 'forge' ? 1.6 : personaId === 'mech' ? 1.0 : 1.2;
  const rng = mulberry32(st.seed * 7919 + tick * 131 + color.charCodeAt(0));

  if (difficulty === 'easy') {
    const scored = moves.map((m) => ({ m, s: evalAfter(st, m, color, aggression) }));
    scored.sort((a, b) => b.s - a.s);
    // Персональная непредсказуемость: выбор из топ-K, детерминированно по seed.
    const topK = personaId === 'forge' ? 3 : 2;
    return scored[Math.floor(rng() * Math.min(topK, scored.length))].m;
  }

  const ordered = [...moves].sort((a, b) => orderScore(st, b) - orderScore(st, a));

  if (difficulty === 'master') {
    // Итеративное углубление 3→4 + общая TT: ранний проход прогревает кэш
    // и ставит сильные ходы первыми — alpha-beta на глубине 4 отсекает
    // резко больше, чем при «холодном» переборе.
    const tt = new Map<string, TTEntry>();
    const warm = ordered
      .map((m) => ({ m, s: -negamax(applyMove(st, m), 2, -Infinity, Infinity, 1, 0, tt) }))
      .sort((a, b) => b.s - a.s);
    const scored = warm
      .map((x) => ({
        m: x.m,
        s: -negamax(applyMove(st, x.m), 3, -Infinity, Infinity, 1, 4, tt)
          + personaBonus(st, x.m, aggression),
      }))
      .sort((a, b) => b.s - a.s);
    return scored[0].m;
  }

  const depth = difficulty === 'normal' ? 2 : 3;
  const scored = ordered.map((m) => ({
    m,
    s: -negamax(applyMove(st, m), depth - 1, -Infinity, Infinity, 1)
      + personaBonus(st, m, aggression),
  }));
  scored.sort((a, b) => b.s - a.s);

  if (difficulty === 'normal') {
    // Средний: выбор из почти лучших (≤40cp, максимум 3) — живой, но осмысленный.
    const best = scored[0].s;
    const near = scored.filter((x) => x.s >= best - 40).slice(0, 3);
    return near[Math.floor(rng() * near.length)].m;
  }
  return scored[0].m;
}

export function describeStatus(st: ChessState, names: Record<Color, string>): string {
  switch (st.status) {
    case 'checkmate':
      return `Мат — ${names[st.winner ?? 'w']} побеждает`;
    case 'stalemate':
      return 'Пат — ничья';
    case 'draw50':
      return 'Ничья — правило 50 ходов';
    case 'material':
      return 'Ничья — недостаточно материала';
    case 'repetition':
      return 'Ничья — троекратное повторение';
    case 'agreement':
      return 'Ничья по соглашению';
    default:
      return st.check ? `Шах — ход ${names[st.turn]}` : `Ход — ${names[st.turn]}`;
  }
}
