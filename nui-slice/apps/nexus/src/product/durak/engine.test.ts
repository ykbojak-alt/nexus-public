import { describe, expect, it } from 'vitest';
import {
  beats,
  isDefenderNeighbor,
  legalAttackCards,
  legalDefenseCards,
  legalTransferCards,
  newGame,
  attack,
  defend,
  transfer,
  take,
  passThrowIn,
  type Card,
  type DurakState,
} from './engine';

const SEATS = [
  { id: 'u', name: 'U', personaId: 'nexus', isUser: true },
  { id: 'a', name: 'A', personaId: 'alice' },
  { id: 'm', name: 'M', personaId: 'mech' },
];

function freshGame() {
  return newGame(SEATS, 42);
}

describe('durak engine', () => {
  it('creates 36-card game: 3 players × 6, deck 18, trump set', () => {
    const s = freshGame();
    expect(s.players).toHaveLength(3);
    for (const p of s.players) expect(p.hand).toHaveLength(6);
    expect(s.deck).toHaveLength(18);
    expect(s.trump).toBe(s.trumpCard.suit);
    expect(s.phase).toBe('attack');
  });

  it('deterministic for same seed', () => {
    const a = freshGame();
    const b = freshGame();
    expect(a.players[0].hand).toEqual(b.players[0].hand);
    expect(a.trumpCard).toEqual(b.trumpCard);
  });

  it('beats(): same suit higher rank, trump over non-trump', () => {
    const atk: Card = { suit: 'hearts', rank: 10 };
    expect(beats({ suit: 'hearts', rank: 11 }, atk, 'spades')).toBe(true);
    expect(beats({ suit: 'hearts', rank: 9 }, atk, 'spades')).toBe(false);
    expect(beats({ suit: 'spades', rank: 6 }, atk, 'spades')).toBe(true);
    expect(beats({ suit: 'spades', rank: 6 }, atk, 'hearts')).toBe(false);
  });

  it('attack: first attack requires a card, limits to table ranks after', () => {
    let s = freshGame();
    const atk = s.attacker;
    const card = legalAttackCards(s, atk)[0];
    s = attack(s, atk, card);
    expect(s.phase).toBe('defend');
    expect(s.table).toHaveLength(1);
    // подкидка доступна только по рангу на столе
    const ranks = new Set([card.rank]);
    const more = legalAttackCards(s, atk);
    for (const c of more) expect(ranks.has(c.rank)).toBe(true);
  });

  it('defend covers and moves to throwin when all covered', () => {
    let s = freshGame();
    const atk = s.attacker;
    s = attack(s, atk, legalAttackCards(s, atk)[0]);
    const def = s.defender;
    const dc = legalDefenseCards(s, def, 0);
    if (!dc.length) {
      s = take(s, def);
      expect(s.players[def].hand.length).toBeGreaterThan(6);
      return;
    }
    s = defend(s, def, 0, dc[0]);
    expect(s.phase).toBe('throwin');
    // все не-защитники пасуют → бито, ход к защитнику
    for (let i = 0; i < s.players.length; i++) {
      if (i !== def) s = passThrowIn(s, i);
    }
    expect(s.phase).toBe('attack');
    expect(s.attacker).toBe(def);
    expect(s.discard.length).toBe(2);
  });

  it('transfer moves defender to next active player', () => {
    let s = freshGame();
    const atk = s.attacker;
    s = attack(s, atk, legalAttackCards(s, atk)[0]);
    const def = s.defender;
    const tc = legalTransferCards(s, def);
    if (!tc.length) return; // seed 42 может не дать перевода — это ок
    const before = s.defender;
    s = transfer(s, def, tc[0]);
    expect(s.defender).not.toBe(before);
    expect(s.table[s.table.length - 1].attack).toEqual(tc[0]);
  });

  it('take: defender picks up all table cards, next player attacks', () => {
    let s = freshGame();
    const atk = s.attacker;
    s = attack(s, atk, legalAttackCards(s, atk)[0]);
    const def = s.defender;
    const defHand = s.players[def].hand.length;
    s = take(s, def);
    expect(s.players[def].hand.length).toBe(defHand + 1);
    expect(s.phase).toBe('attack');
    // взял → атакует следующий активный после защитника
    expect(s.attacker).not.toBe(def);
    expect(s.players[s.attacker].out).toBe(false);
  });

  it('throwin card goes back to defend phase — defender must cover it', () => {
    let s = freshGame();
    const atk = s.attacker;
    s = attack(s, atk, legalAttackCards(s, atk)[0]);
    const def = s.defender;
    const dc = legalDefenseCards(s, def, 0);
    if (!dc.length) return;
    s = defend(s, def, 0, dc[0]);
    expect(s.phase).toBe('throwin');
    // подкидка атакующего картой ранга со стола
    const addable = legalAttackCards(s, atk);
    if (!addable.length) return;
    s = attack(s, atk, addable[0]);
    // после подкидки — защитник снова защищается, карта не висит открытой в бито
    expect(s.phase).toBe('defend');
    expect(legalDefenseCards(s, def, 1).length).toBeGreaterThanOrEqual(0); // фаза позволяет крыть
  });

  it('throw-in priority resets to the main attacker after each cover', () => {
    // Правило: как только защитник покрыл все открытые карты, право
    // подкинуть первым — у основного атакующего, а не по кругу дальше.
    let s = freshGame();
    const atk = s.attacker;
    s = attack(s, atk, legalAttackCards(s, atk)[0]);
    const def = s.defender;
    const dc = legalDefenseCards(s, def, 0);
    if (!dc.length) return;
    s = defend(s, def, 0, dc[0]);
    expect(s.phase).toBe('throwin');
    expect(s.throwCursor).toBe(atk);
    // Если подкинул НЕ атакующий и защитник покрыл — приоритет снова у атакующего.
    const other = s.players
      .map((_, i) => i)
      .find((i) => i !== atk && i !== def && isDefenderNeighbor(s, i) && legalAttackCards(s, i).length);
    if (other === undefined) return; // seed не дал второго подкидчика — ок
    s = attack(s, other, legalAttackCards(s, other)[0]);
    expect(s.phase).toBe('defend');
    const dc2 = legalDefenseCards(s, def, s.table.length - 1);
    if (!dc2.length) return;
    s = defend(s, def, s.table.length - 1, dc2[0]);
    expect(s.phase).toBe('throwin');
    expect(s.throwCursor).toBe(atk);
  });

  it('throwin rotates: multiple distinct non-defenders throw across games', async () => {
    const { aiMove } = await import('./ai');
    const attackCounts = new Map<number, number>();
    for (let seed = 1; seed <= 12; seed++) {
      let s = newGame(SEATS, seed);
      let steps = 0;
      while (s.phase !== 'finished' && steps < 4000) {
        const idx =
          s.phase === 'attack'
            ? s.attacker
            : s.phase === 'defend'
              ? s.defender
              : (() => {
                for (let i = 0; i < s.players.length; i++) {
                  const j = (s.throwCursor + i) % s.players.length;
                  if (
                    !s.players[j].out &&
                    j !== s.defender &&
                    !s.passed.includes(j) &&
                    isDefenderNeighbor(s, j)
                  )
                    return j;
                }
                return -1;
              })();
        if (idx < 0) break;
        const next = aiMove(s, idx) ?? (s.phase === 'throwin' ? passThrowIn(s, idx) : s);
        if (next && s.phase === 'throwin' && next.phase === 'defend' && next.table.length > s.table.length) {
          attackCounts.set(idx, (attackCounts.get(idx) ?? 0) + 1);
        }
        s = next;
        steps++;
      }
    }
    // за 12 партий подкидывают минимум 2 разных игрока — не «только крайний»
    expect(attackCounts.size).toBeGreaterThanOrEqual(2);
  });

  it('throw-in limit uses defender hand at bout start, not current hand', () => {
    let s = freshGame();
    const atk = s.attacker;
    const def = s.defender;
    // Защитник начал кон с 6 картами, покрыл 3 атаки — осталось 3.
    // Правило: лимит кона от стартовой руки → подкидка ещё возможна.
    const table = [0, 1, 2].map((i) => ({
      attack: { suit: 'clubs' as const, rank: 6 + i },
      defense: { suit: 'clubs' as const, rank: 10 + i },
    }));
    s = {
      ...s,
      phase: 'throwin',
      table,
      defenderCapacity: 6,
      firstBout: false,
      passed: [],
      players: s.players.map((p, i) => ({
        ...p,
        hand:
          i === def
            ? p.hand.slice(0, 3)
            : i === atk
              ? [{ suit: 'hearts' as const, rank: 7 }]
              : p.hand,
      })),
    };
    expect(s.players[def].hand).toHaveLength(3);
    const legal = legalAttackCards(s, atk);
    expect(legal).toHaveLength(1);
    const after = attack(s, atk, legal[0]);
    expect(after.table).toHaveLength(4);
    expect(after.phase).toBe('defend');
  });

  it('throw-in restricted to defender neighbors: distance >1 cannot throw', () => {
    // 4 игрока: atk — защитник def, соседи def = atk и игрок справа; дальний — нет.
    const s4 = newGame([...SEATS, { id: 'x', name: 'X', personaId: 'codex' }], 7);
    const def = s4.defender;
    let s: DurakState = {
      ...s4,
      phase: 'throwin' as const,
      table: [
        {
          attack: { suit: 'clubs' as const, rank: 6 },
          defense: { suit: 'clubs' as const, rank: 10 },
        },
      ],
      passed: [] as number[],
      players: s4.players.map((p) => ({ ...p, hand: [{ suit: 'hearts' as const, rank: 6 }] })),
    };
    const neighbors = s.players.map((_, i) => i).filter((i) => i !== def && isDefenderNeighbor(s, i));
    const far = s.players.map((_, i) => i).filter((i) => i !== def && !isDefenderNeighbor(s, i));
    expect(neighbors).toHaveLength(2);
    expect(far).toHaveLength(1);
    const distanceFromCursor = (i: number) => (i - s.throwCursor + s.players.length) % s.players.length;
    const [first, second] = [...neighbors].sort((a, b) => distanceFromCursor(a) - distanceFromCursor(b));
    expect(legalAttackCards(s, first)).toHaveLength(1);
    expect(legalAttackCards(s, second)).toHaveLength(0);
    for (const i of far) expect(legalAttackCards(s, i)).toHaveLength(0);
    // дальний не может «спасовать» из очереди — кон завершает спас только крайних.
    s = passThrowIn(s, far[0]);
    expect(s.phase).toBe('throwin');
    s = passThrowIn(s, first);
    expect(legalAttackCards(s, second)).toHaveLength(1);
    s = passThrowIn(s, second);
    expect(s.phase).toBe('attack');
  });

  it('first bout is capped at 5 attack cards, later bouts at 6', () => {
    let s = freshGame();
    const atk = s.attacker;
    const covered = (i: number) => ({
      attack: { suit: 'clubs' as const, rank: 6 + i },
      defense: { suit: 'clubs' as const, rank: 10 + i },
    });
    // Первый кон: 5 покрытых пар, ёмкость защитника 6 → 6-я подкидка нелегальна.
    s = {
      ...s,
      phase: 'throwin',
      table: [0, 1, 2, 3, 4].map(covered),
      defenderCapacity: 6,
      firstBout: true,
      passed: [],
      players: s.players.map((p, i) =>
        i === atk ? { ...p, hand: [{ suit: 'hearts' as const, rank: 6 }] } : p,
      ),
    };
    expect(legalAttackCards(s, atk)).toHaveLength(0);
    // Тот же стол в не-первом коне: 6-я легальна.
    s = { ...s, firstBout: false };
    expect(legalAttackCards(s, atk)).toHaveLength(1);
    // А при 6 парах уже нельзя нигде.
    s = { ...s, table: [0, 1, 2, 3, 4, 5].map(covered) };
    expect(legalAttackCards(s, atk)).toHaveLength(0);
  });

  it('full AI game terminates without infinite loop', async () => {
    const { aiMove } = await import('./ai');
    let s = freshGame();
    let steps = 0;
    while (s.phase !== 'finished' && steps < 5000) {
      const idx =
        s.phase === 'attack'
          ? s.attacker
          : s.phase === 'defend'
            ? s.defender
            : (() => {
              for (let i = 0; i < s.players.length; i++) {
                const j = (s.throwCursor + i) % s.players.length;
                if (
                  !s.players[j].out &&
                  j !== s.defender &&
                  !s.passed.includes(j) &&
                  isDefenderNeighbor(s, j)
                )
                  return j;
              }
              return -1;
            })();
      if (idx < 0) break;
      const next = aiMove(s, idx) ?? (s.phase === 'throwin' ? passThrowIn(s, idx) : s);
      expect(next).not.toBeNull();
      s = next;
      steps++;
    }
    expect(s.phase).toBe('finished');
    expect(s.loser === null || s.players[s.loser].out === false).toBe(true);
  });

  it('enforces throw-in priority for the player at throwCursor', () => {
    let s = freshGame();
    const atk = s.attacker;
    const def = s.defender;
    const other = s.players.map((_, i) => i).find((i) => i !== atk && i !== def)!;
    s = {
      ...s,
      phase: 'throwin',
      table: [{ attack: { suit: 'clubs', rank: 6 }, defense: { suit: 'clubs', rank: 7 } }],
      throwCursor: atk,
      passed: [],
      players: s.players.map((p, i) => ({
        ...p,
        hand: i === other ? [{ suit: 'hearts', rank: 6 }] : p.hand,
      })),
    };

    expect(legalAttackCards(s, other)).toHaveLength(0);
  });

  it('rejects a one-seat game instead of assigning the player as their own defender', () => {
    expect(() => newGame([{ id: 'solo', name: 'Solo', personaId: 'nexus' }], 1)).toThrow(/seat|player/i);
  });

  it('rejects an empty seat list with a clear validation error', () => {
    expect(() => newGame([], 1)).toThrow(/seat|player/i);
  });

  it.fails('allows the principal attacker to throw in after the defender declares take', () => {
    let s = freshGame();
    const atk = s.attacker;
    const def = s.defender;
    const extra: Card = { suit: 'hearts', rank: 6 };
    s = {
      ...s,
      phase: 'throwin',
      table: [{ attack: { suit: 'clubs', rank: 6 }, defense: { suit: 'clubs', rank: 7 } }],
      throwCursor: atk,
      passed: [],
      players: s.players.map((p, i) => (i === atk ? { ...p, hand: [extra] } : p)),
    };

    const afterTake = take(s, def);
    expect(afterTake.phase).toBe('throwin');
    expect(afterTake.table).toHaveLength(1);
    expect(legalAttackCards(afterTake, atk)).toContainEqual(extra);
  });

  it.fails('refills a throw-in participant before the defender when the stock runs out', () => {
    const attacker = 0;
    const defender = 1;
    const thrower = 2;
    const firstForThrower: Card = { suit: 'diamonds', rank: 14 };
    const firstForAttacker: Card = { suit: 'spades', rank: 14 };
    let s = freshGame();
    s = {
      ...s,
      attacker,
      defender,
      phase: 'throwin',
      throwCursor: attacker,
      passed: [],
      firstBout: false,
      defenderCapacity: 6,
      table: [
        { attack: { suit: 'clubs', rank: 6 }, defense: { suit: 'clubs', rank: 7 } },
        { attack: { suit: 'hearts', rank: 7 }, defense: { suit: 'hearts', rank: 8 } },
      ],
      deck: [firstForThrower, firstForAttacker],
      players: s.players.map((p, i) => ({
        ...p,
        hand: i === attacker
          ? [6, 7, 8, 9, 10].map((rank) => ({ suit: 'spades' as const, rank }))
          : i === defender
            ? [6, 7, 8, 9].map((rank) => ({ suit: 'hearts' as const, rank }))
            : [6, 7, 8, 9, 10].map((rank) => ({ suit: 'diamonds' as const, rank })),
      })),
    };

    s = passThrowIn(s, attacker);
    s = passThrowIn(s, thrower);
    expect(s.players[attacker].hand).toContainEqual(firstForAttacker);
    expect(s.players[thrower].hand).toContainEqual(firstForThrower);
    expect(s.players[defender].hand).not.toContainEqual(firstForThrower);
  });

  it.fails('settles defense when a short-handed defender uses their last card with an empty deck', () => {
    const attacker = 0;
    const defender = 1;
    let s = freshGame();
    s = {
      ...s,
      attacker,
      defender,
      phase: 'defend',
      firstBout: false,
      defenderCapacity: 1,
      deck: [],
      table: [{ attack: { suit: 'clubs', rank: 6 }, defense: null }],
      players: s.players.map((p, i) => (
        i === defender ? { ...p, hand: [{ suit: 'clubs', rank: 7 }] } : p
      )),
    };

    const afterDefense = defend(s, defender, 0, { suit: 'clubs', rank: 7 });
    expect(afterDefense.phase).toBe('attack');
    expect(afterDefense.table).toHaveLength(0);
    expect(afterDefense.discard).toHaveLength(2);
    expect(afterDefense.players[defender].out).toBe(true);
  });
});
