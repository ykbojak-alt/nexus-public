import { describe, expect, it } from 'vitest';
import { newGame as newDurak } from '../durak/engine';
import { newGame as newChess } from '../chess/engine';
import { chessSceneSnapshot, durakSceneSnapshot } from './scene-snapshot';
import type { ChessScenePayload, DurakScenePayload } from './scene-snapshot';

const SEATS = [
  { id: 'u', name: 'Вы', personaId: 'nexus', isUser: true },
  { id: 'a', name: 'AGENT-A', personaId: 'alice' },
  { id: 'm', name: 'M.E.C.H.', personaId: 'mech' },
];

describe('scene-snapshot — GAMES → UE bridge (prep)', () => {
  it('durak envelope: версия, source=local, seed честный', () => {
    const st = newDurak(SEATS, 42);
    const env = durakSceneSnapshot(st, 0, 1700000000000);
    expect(env.protocolVersion).toBe(1);
    expect(env.game).toBe('durak');
    expect(env.source).toBe('local');
    expect(env.seed).toBe(42);
    expect(env.timestampMs).toBe(1700000000000);
  });

  it('durak payload: скрытая информация не уходит на провод', () => {
    const st = newDurak(SEATS, 7);
    const env = durakSceneSnapshot(st);
    const p = env.payload as DurakScenePayload;
    // колода — числом, карты не сериализуются
    expect(p.deck).toBe(st.deck.length);
    expect(p.deck).toBeGreaterThan(0);
    // руки оппонентов — только счётчики
    expect(p.opponents).toHaveLength(2);
    for (const o of p.opponents) {
      expect(o.count).toBe(st.players[o.seat].hand.length);
      expect(o).not.toHaveProperty('hand');
    }
    // своя рука и открытые элементы — полностью
    expect(p.you.hand).toHaveLength(st.players[0].hand.length);
    expect(p.trumpCard).toEqual({ suit: st.trumpCard.suit, rank: st.trumpCard.rank });
    expect(p.table).toEqual([]);
    expect(p.discard.count).toBe(0);
    expect(p.attackerSeat).toBe(st.attacker);
    expect(p.defenderSeat).toBe(st.defender);
  });

  it('chess payload: стартовая позиция → 64 клетки wire-формата', () => {
    const st = newChess(11);
    const env = chessSceneSnapshot(st);
    const p = env.payload as ChessScenePayload;
    expect(env.game).toBe('chess');
    expect(env.source).toBe('local');
    expect(p.status).toBe('play');
    expect(p.board).toHaveLength(64);
    // индексация a8→h1: 0=a8 чёрная ладья, 4=e8 чёрный король,
    // 48=a2 белая пешка, 60=e1 белый король
    expect(p.board[0]).toBe('br');
    expect(p.board[4]).toBe('bk');
    expect(p.board[48]).toBe('wp');
    expect(p.board[60]).toBe('wk');
    expect(p.board.filter((c) => c !== null)).toHaveLength(32);
    expect(p.lastMove).toBeNull();
    expect(p.captured.w).toHaveLength(0);
    expect(p.fullmove).toBe(1);
  });
});
