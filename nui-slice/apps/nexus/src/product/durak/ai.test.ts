import { describe, expect, it } from 'vitest';
import { aiDefenderTake } from './ai';
import { newGame, type Card, type DurakState } from './engine';

const SEATS = [
  { id: 'u', name: 'U', personaId: 'nexus', isUser: true },
  { id: 'a', name: 'A', personaId: 'alice' },
  { id: 'm', name: 'M', personaId: 'mech' },
];

const pair = (i: number) => ({
  attack: { suit: 'clubs' as const, rank: 6 + i },
  defense: { suit: 'clubs' as const, rank: 10 + i },
});

function throwinState(over: {
  defender: number;
  tableLen: number;
  hands: Record<number, Card[]>;
  defenderCapacity?: number;
  firstBout?: boolean;
}): DurakState {
  const base = newGame(SEATS, 7);
  return {
    ...base,
    phase: 'throwin',
    defender: over.defender,
    attacker: 0,
    table: Array.from({ length: over.tableLen }, (_, i) => pair(i)),
    defenderCapacity: over.defenderCapacity ?? 6,
    firstBout: over.firstBout ?? false,
    passed: [],
    players: base.players.map((p, i) => ({
      ...p,
      hand: over.hands[i] ?? p.hand,
    })),
  };
}

describe('aiDefenderTake — взятие защитника в фазе подкидки', () => {
  it('берёт при истощённой руке и живых подкидчиках', () => {
    // Защитник (AI #1) с 2 картами, стол 3, у атакующего есть легальная
    // подкидка (6♥ по рангу на столе) — ждать = набрать ещё больше.
    const s = throwinState({
      defender: 1,
      tableLen: 3,
      hands: {
        0: [{ suit: 'hearts', rank: 6 }],
        1: [{ suit: 'diamonds', rank: 7 }, { suit: 'diamonds', rank: 8 }],
      },
    });
    const next = aiDefenderTake(s);
    expect(next).not.toBeNull();
    // взял → все карты стола в руке защитника, кон завершён
    expect(next!.players[1].hand.length).toBe(2 + 6);
    expect(next!.phase).toBe('attack');
  });

  it('не берёт, когда стол заполнен до лимита — ждёт «бито»', () => {
    const s = throwinState({
      defender: 1,
      tableLen: 3,
      defenderCapacity: 3,
      hands: {
        0: [{ suit: 'hearts', rank: 6 }],
        1: [{ suit: 'diamonds', rank: 7 }],
      },
    });
    expect(aiDefenderTake(s)).toBeNull();
  });

  it('не берёт, если подкидывать больше некому', () => {
    const s = throwinState({
      defender: 1,
      tableLen: 3,
      hands: {
        // Ранг 9 не совпадает со столом (6,7,8) — легальных подкидок нет.
        0: [{ suit: 'hearts', rank: 9 }],
        1: [{ suit: 'diamonds', rank: 7 }],
        2: [{ suit: 'hearts', rank: 9 }],
      },
    });
    expect(aiDefenderTake(s)).toBeNull();
  });

  it('не решает за пользователя-защитника', () => {
    const s = throwinState({
      defender: 0,
      tableLen: 3,
      hands: {
        0: [{ suit: 'diamonds', rank: 7 }],
        1: [{ suit: 'hearts', rank: 6 }],
        2: [{ suit: 'hearts', rank: 6 }],
      },
    });
    expect(aiDefenderTake(s)).toBeNull();
  });

  it('не берёт с полной рукой — есть ресурсы отбиваться дальше', () => {
    const s = throwinState({
      defender: 1,
      tableLen: 3,
      hands: {
        0: [{ suit: 'hearts', rank: 6 }],
        1: [
          { suit: 'diamonds', rank: 7 },
          { suit: 'diamonds', rank: 8 },
          { suit: 'diamonds', rank: 9 },
          { suit: 'diamonds', rank: 10 },
          { suit: 'diamonds', rank: 11 },
          { suit: 'diamonds', rank: 12 },
        ],
      },
    });
    expect(aiDefenderTake(s)).toBeNull();
  });
});
