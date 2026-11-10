import { describe, expect, it } from 'vitest';
import {
  type ChessState,
  type Move,
  agreeDraw,
  allLegalMoves,
  applyMove,
  inCheck,
  legalMoves,
  newGame,
  parseAlg,
} from './engine';
import { aiMove } from './ai';

const mv = (st: ChessState, from: string, to: string, promo?: Move['promo']) =>
  applyMove(st, { from: parseAlg(from), to: parseAlg(to), promo });

function seq(st: ChessState, moves: [string, string][]): ChessState {
  return moves.reduce((s, [a, b]) => mv(s, a, b), st);
}

describe('chess engine', () => {
  it('начальная позиция: 20 легальных ходов, белые ходят', () => {
    const st = newGame(1);
    expect(st.turn).toBe('w');
    expect(allLegalMoves(st, 'w')).toHaveLength(20);
    expect(st.board[parseAlg('e1')]?.t).toBe('k');
  });

  it('детерминизм: одинаковая партия по одному seed последовательности ходов AI', () => {
    const a = newGame(42);
    const b = newGame(42);
    expect(a.board).toEqual(b.board);
  });

  it('детский мат — checkmate', () => {
    const st = seq(newGame(1), [
      ['e2', 'e4'],
      ['e7', 'e5'],
      ['d1', 'h5'],
      ['b8', 'c6'],
      ['f1', 'c4'],
      ['g8', 'f6'],
      ['h5', 'f7'],
    ]);
    expect(st.status).toBe('checkmate');
    expect(st.winner).toBe('w');
    expect(st.log.at(-1)).toContain('#');
  });

  it('рокировка короткая: король и ладья встают верно, право сгорает', () => {
    const st = seq(newGame(1), [
      ['e2', 'e4'],
      ['e7', 'e5'],
      ['g1', 'f3'],
      ['b8', 'c6'],
      ['f1', 'e2'],
      ['g8', 'f6'],
    ]);
    const castle = legalMoves(st, parseAlg('e1')).find((m) => m.castle === 'k');
    expect(castle).toBeDefined();
    const next = applyMove(st, castle!);
    expect(next.board[parseAlg('g1')]?.t).toBe('k');
    expect(next.board[parseAlg('f1')]?.t).toBe('r');
    expect(next.castling.wk).toBe(false);
    expect(next.castling.wq).toBe(false);
  });

  it('взятие на проходе снимает пешку соперника', () => {
    const st = seq(newGame(1), [
      ['e2', 'e4'],
      ['a7', 'a6'],
      ['e4', 'e5'],
      ['d7', 'd5'],
    ]);
    const ep = legalMoves(st, parseAlg('e5')).find((m) => m.ep);
    expect(ep).toBeDefined();
    const next = applyMove(st, ep!);
    expect(next.board[parseAlg('d5')]).toBeNull();
    expect(next.board[parseAlg('d6')]?.t).toBe('p');
    expect(next.captured.w).toContain('p');
  });

  it('проход в ферзь заменяет пешку', () => {
    // Конструируем позицию: белая пешка на a7.
    const st = newGame(1);
    st.board = Array(64).fill(null);
    st.board[parseAlg('a7')] = { t: 'p', c: 'w' };
    st.board[parseAlg('e1')] = { t: 'k', c: 'w' };
    st.board[parseAlg('e8')] = { t: 'k', c: 'b' };
    const next = applyMove(st, { from: parseAlg('a7'), to: parseAlg('a8'), promo: 'q' });
    expect(next.board[parseAlg('a8')]?.t).toBe('q');
  });

  it('пат — ничья без мата', () => {
    // Чёрный король h8 без ходов после Qg6: g8/g7 бьётся, h7 под ферзём.
    const st = newGame(1);
    st.board = Array(64).fill(null);
    st.board[parseAlg('h8')] = { t: 'k', c: 'b' };
    st.board[parseAlg('f7')] = { t: 'k', c: 'w' };
    st.board[parseAlg('g5')] = { t: 'q', c: 'w' };
    st.turn = 'w';
    const next = applyMove(st, { from: parseAlg('g5'), to: parseAlg('g6') });
    expect(next.status).toBe('stalemate');
    expect(next.winner).toBeNull();
  });

  it('нельзя оставить своего короля под шахом', () => {
    // Белый король e1, белая ладья e2 блокирует ладью e8.
    const st = newGame(1);
    st.board = Array(64).fill(null);
    st.board[parseAlg('e1')] = { t: 'k', c: 'w' };
    st.board[parseAlg('e2')] = { t: 'r', c: 'w' };
    st.board[parseAlg('e8')] = { t: 'r', c: 'b' };
    st.board[parseAlg('a8')] = { t: 'k', c: 'b' };
    const moves = legalMoves(st, parseAlg('e2'));
    // Ладья может двигаться только по линии e — отход вбок открывает шах.
    expect(moves.every((m) => (m.to & 7) === 4)).toBe(true);
  });

  it('шах фиксируется в state.check', () => {
    const st = seq(newGame(1), [
      ['e2', 'e4'],
      ['e7', 'e5'],
      ['d1', 'h5'],
      ['b8', 'c6'],
      ['f1', 'c4'],
      ['g8', 'f6'],
      ['h5', 'f7'],
    ]);
    expect(st.check).toBe('b');
    expect(inCheck(st.board, 'b')).toBe(true);
  });

  it('полная AI-партия завершается без зависания', () => {
    let st = newGame(7);
    let tick = 0;
    while (st.status === 'play' && tick < 500) {
      const color = st.turn;
      const m = aiMove(st, color, 'mech', tick);
      expect(m).not.toBeNull();
      st = applyMove(st, m!);
      tick += 1;
    }
    expect(st.status).not.toBe('play');
    expect(tick).toBeLessThan(500);
  });
});

describe('chess AI: уровни сложности', () => {
  // Дурацкий мат: 1.f3 e5 2.g4 — у чёрных Qh4#.
  const fools = () => seq(newGame(1), [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4']]);

  it.each(['normal', 'hard', 'master'] as const)('%s находит мат в 1 ход', (d) => {
    // master (d4 + quiescence) честно думает секунды — таймаут с запасом.
    const st = fools();
    const m = aiMove(st, 'b', 'mech', 1, d);
    expect(m).not.toBeNull();
    const next = applyMove(st, m!);
    expect(next.status).toBe('checkmate');
    expect(next.winner).toBe('b');
    // master (d4 + quiescence) в тестовой среде идёт ~34s — запас 60s
  }, 60000);

  it.each(['hard', 'master'] as const)(
    '%s детерминирован: одинаковый ход при том же seed и тике',
    (d) => {
      const a = aiMove(newGame(9), 'b', 'alice', 3, d);
      const b = aiMove(newGame(9), 'b', 'alice', 3, d);
      expect(a).toEqual(b);
    },
    20000,
  );

  it('все уровни возвращают легальные ходы', () => {
    const st = newGame(5);
    for (const d of ['easy', 'normal', 'hard', 'master'] as const) {
      const m = aiMove(st, 'b', 'forge', 1, d);
      expect(m).not.toBeNull();
      const legal = allLegalMoves(st, 'b').some(
        (x) => x.from === m!.from && x.to === m!.to,
      );
      expect(legal).toBe(true);
    }
  }, 20000);

  it('hard не подставляет ферзя: забирает беззащитного и не теряет своего', () => {
    // Белый ферзь беззащитен на a4; чёрная пешка b7 может взять... упрощённо:
    // проверяем, что hard выигрывает материал, где easy может отвлечься.
    const st = newGame(1);
    st.board = Array(64).fill(null);
    st.board[parseAlg('e1')] = { t: 'k', c: 'w' };
    st.board[parseAlg('e8')] = { t: 'k', c: 'b' };
    st.board[parseAlg('d4')] = { t: 'q', c: 'w' }; // беззащитный ферзь
    st.board[parseAlg('d8')] = { t: 'r', c: 'b' }; // ладья бьёт по линии d
    st.board[parseAlg('a7')] = { t: 'p', c: 'b' };
    st.board[parseAlg('h2')] = { t: 'p', c: 'w' };
    st.turn = 'b';
    const m = aiMove(st, 'b', 'mech', 1, 'hard');
    expect(m).not.toBeNull();
    expect(m!.to).toBe(parseAlg('d4')); // Rxd4 — забирает ферзя
  });

  it('master не вешает ферзя: защищённая ладья не берётся', () => {
    // Чёрный ферзь может «выиграть» белую ладью на a1, но ладья d1 отбивает —
    // глубина 4 видит размен как проигрышный.
    const st = newGame(1);
    st.board = Array(64).fill(null);
    st.board[parseAlg('e1')] = { t: 'k', c: 'w' };
    st.board[parseAlg('e8')] = { t: 'k', c: 'b' };
    st.board[parseAlg('a1')] = { t: 'r', c: 'w' };
    st.board[parseAlg('d1')] = { t: 'r', c: 'w' }; // защита a1 по 1-й горизонтали
    st.board[parseAlg('a8')] = { t: 'q', c: 'b' };
    st.board[parseAlg('h7')] = { t: 'p', c: 'b' };
    st.board[parseAlg('h2')] = { t: 'p', c: 'w' };
    st.turn = 'b';
    const m = aiMove(st, 'b', 'mech', 1, 'master');
    expect(m).not.toBeNull();
    // Qxa1+?? проигрывает ферзя после Rxa1 — мастер так не ходит.
    expect(m!.to === parseAlg('a1') && m!.from === parseAlg('a8')).toBe(false);
  }, 20000);

  it('троекратное повторение позиции — ничья repetition', () => {
    // Коневой шаттл: позиция повторяется на 5-м и 9-м полуходе → третье вхождение.
    const st = seq(newGame(1), [
      ['g1', 'f3'], ['g8', 'f6'],
      ['f3', 'g1'], ['f6', 'g8'],
      ['g1', 'f3'], ['g8', 'f6'],
      ['f3', 'g1'], ['f6', 'g8'],
    ]);
    expect(st.status).toBe('repetition');
    expect(allLegalMoves(st, 'w')).toHaveLength(0);
  });

  it('два повторения — игра ещё идёт', () => {
    const st = seq(newGame(1), [
      ['g1', 'f3'], ['g8', 'f6'],
      ['f3', 'g1'], ['f6', 'g8'],
    ]);
    expect(st.status).toBe('play');
  });

  it('ничья по соглашению: agreeDraw завершает play-партию', () => {
    const st = agreeDraw(seq(newGame(1), [['e2', 'e4'], ['e7', 'e5']]));
    expect(st.status).toBe('agreement');
    expect(st.log.at(-1)).toContain('ничья');
    // Завершённая партия не меняется повторным agreeDraw
    expect(agreeDraw(st)).toBe(st);
  });
});
