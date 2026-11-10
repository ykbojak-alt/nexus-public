// GAMES → Unreal scene bridge (prep): сериализация игрового состояния в
// версионный snapshot — тот же контрактный стиль, что у runtime-сцены
// (docs/product/unreal-games-scene-integration.md,
//  integrations/unreal/NexusRuntimeScene/games-scene-snapshot.schema.json).
//
// Честная граница данных: snapshot несёт ровно то, что видит игрок за
// столом — руки агентов только счётчиками, колода числом, скрытые карты
// на провод не уходят. source всегда 'local' — UE-сцена обязана держать
// LOCAL-метку и никогда не рисовать «онлайн/сервер».

import type { DurakState, Card, Suit } from '../durak/engine';
import type { ChessState, GameStatus } from '../chess/engine';

export interface WireCard {
  suit: Suit;
  rank: number;
}

export interface DurakOpponent {
  seat: number;
  personaId: string;
  name: string;
  /** Размер веера — как на столе. Сами карты не отправляются. */
  count: number;
  out: boolean;
}

export interface DurakScenePayload {
  phase: DurakState['phase'];
  /** Колода — только числом; стопку рисует сцена. */
  deck: number;
  /** Подкозырная карта лежит лицом — передаётся полностью. */
  trumpCard: WireCard;
  table: { attack: WireCard; defense: WireCard | null }[];
  /** Отбой — верхние карты видны игроку, передаём последние N лицом. */
  discard: { count: number; top: WireCard[] };
  you: { seat: number; hand: WireCard[] };
  opponents: DurakOpponent[];
  attackerSeat: number;
  defenderSeat: number;
  loser: number | null;
  draw: boolean;
}

export type WirePiece = `${'w' | 'b'}${'p' | 'n' | 'b' | 'r' | 'q' | 'k'}`;

export interface ChessScenePayload {
  status: GameStatus;
  turn: 'w' | 'b';
  /** 64 клетки, a8→h1 (rank*8+file, как в engine) — 'wp','bk',… или null. */
  board: (WirePiece | null)[];
  lastMove: { from: number; to: number } | null;
  check: 'w' | 'b' | null;
  captured: { w: string[]; b: string[] };
  fullmove: number;
}

export interface GameSceneEnvelope {
  protocolVersion: 1;
  game: 'durak' | 'chess';
  source: 'local';
  seed: number;
  timestampMs?: number;
  payload: DurakScenePayload | ChessScenePayload;
}

const wireCard = (c: Card): WireCard => ({ suit: c.suit, rank: c.rank });

/** Отбой показывает последние N карт — как стол на экране. */
const DISCARD_VISIBLE = 6;

export function durakSceneSnapshot(
  state: DurakState,
  userSeat = 0,
  timestampMs?: number,
): GameSceneEnvelope {
  return {
    protocolVersion: 1,
    game: 'durak',
    source: 'local',
    seed: state.seed,
    timestampMs,
    payload: {
      phase: state.phase,
      deck: state.deck.length,
      trumpCard: wireCard(state.trumpCard),
      table: state.table.map((p) => ({
        attack: wireCard(p.attack),
        defense: p.defense ? wireCard(p.defense) : null,
      })),
      discard: {
        count: state.discard.length,
        top: state.discard.slice(-DISCARD_VISIBLE).map(wireCard),
      },
      you: {
        seat: userSeat,
        hand: state.players[userSeat]?.hand.map(wireCard) ?? [],
      },
      opponents: state.players
        .map((p, seat) => ({ p, seat }))
        .filter(({ seat }) => seat !== userSeat)
        .map(({ p, seat }) => ({
          seat,
          personaId: p.personaId,
          name: p.name,
          count: p.hand.length,
          out: p.out,
        })),
      attackerSeat: state.attacker,
      defenderSeat: state.defender,
      loser: state.loser,
      draw: state.draw,
    },
  };
}

export function chessSceneSnapshot(state: ChessState, timestampMs?: number): GameSceneEnvelope {
  return {
    protocolVersion: 1,
    game: 'chess',
    source: 'local',
    seed: state.seed,
    timestampMs,
    payload: {
      status: state.status,
      turn: state.turn,
      board: state.board.map((p): WirePiece | null => (p ? `${p.c}${p.t}` : null)),
      lastMove: state.lastMove ? { from: state.lastMove.from, to: state.lastMove.to } : null,
      check: state.check,
      captured: { w: [...state.captured.w], b: [...state.captured.b] },
      fullmove: state.fullmove,
    },
  };
}
