// Переводной дурак — детерминированный движок.
// 36 карт (6..A), козырь — масть нижней карты колоды.
// Атака → защита/перевод → подкидывание → бито/взял.

export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';
export const SUITS: Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];
export const RANKS = [6, 7, 8, 9, 10, 11, 12, 13, 14];

export interface Card {
  suit: Suit;
  rank: number;
}

export interface DurakPlayer {
  id: string;
  name: string;
  personaId: string;
  isUser: boolean;
  hand: Card[];
  out: boolean;
}

export interface TablePair {
  attack: Card;
  defense: Card | null;
}

export type DurakPhase = 'attack' | 'defend' | 'throwin' | 'finished';

export interface DurakState {
  players: DurakPlayer[];
  deck: Card[];
  trump: Suit;
  trumpCard: Card;
  table: TablePair[];
  discard: Card[];
  attacker: number;
  defender: number;
  phase: DurakPhase;
  firstAttack: boolean;
  firstBout: boolean;
  /** Рука защитника на старте кона/перевода — лимит подкидок считается от неё, не от текущей. */
  defenderCapacity: number;
  passed: number[];
  throwCursor: number;
  log: string[];
  loser: number | null;
  draw: boolean;
  seed: number;
}

const MAX_TABLE_CARDS = 6;
const FIRST_BOUT_CAP = 5;
const HAND_LIMIT = 6;

export function rankLabel(rank: number): string {
  return rank <= 10 ? String(rank) : ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as const)[rank] ?? '?';
}

export function cardId(c: Card): string {
  return `${c.suit}-${c.rank}`;
}

export function beats(def: Card, atk: Card, trump: Suit): boolean {
  if (def.suit === atk.suit) return def.rank > atk.rank;
  return def.suit === trump && atk.suit !== trump;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function nextActive(players: DurakPlayer[], from: number): number {
  const n = players.length;
  for (let i = 1; i <= n; i++) {
    const j = (from + i) % n;
    if (!players[j].out) return j;
  }
  return from;
}

function prevActive(players: DurakPlayer[], from: number): number {
  const n = players.length;
  for (let i = 1; i <= n; i++) {
    const j = (from - i + n) % n;
    if (!players[j].out) return j;
  }
  return from;
}

/** «Крайние» защитника: ближайшие активные соседи слева и справа — только они подкидывают. */
export function isDefenderNeighbor(st: DurakState, idx: number): boolean {
  return (
    idx === nextActive(st.players, st.defender) || idx === prevActive(st.players, st.defender)
  );
}

function activeCount(players: DurakPlayer[]): number {
  return players.filter((p) => !p.out).length;
}

function clone(state: DurakState): DurakState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p, hand: [...p.hand] })),
    deck: [...state.deck],
    table: state.table.map((t) => ({ ...t })),
    discard: [...state.discard],
    passed: [...state.passed],
    log: [...state.log],
  };
}

function say(state: DurakState, msg: string) {
  state.log.push(msg);
}

export function newGame(
  seats: { id: string; name: string; personaId: string; isUser?: boolean }[],
  seed = 1,
): DurakState {
  if (seats.length < 2) throw new Error('Durak requires at least two players/seats.');

  const rng = mulberry32(seed);
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ suit, rank });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const trumpCard = deck[0]; // нижняя карта — под колоду
  const trump = trumpCard.suit;
  const players: DurakPlayer[] = seats.map((s) => ({
    id: s.id,
    name: s.name,
    personaId: s.personaId,
    isUser: s.isUser ?? false,
    hand: [],
    out: false,
  }));
  for (let r = 0; r < HAND_LIMIT; r++)
    for (const p of players) p.hand.push(deck.pop()!);

  // Первым атакует владелец младшего козыря, иначе первый игрок.
  let attacker = 0;
  let lowest = Infinity;
  players.forEach((p, i) => {
    for (const c of p.hand) {
      if (c.suit === trump && c.rank < lowest) {
        lowest = c.rank;
        attacker = i;
      }
    }
  });
  const defender = nextActive(players, attacker);
  const state: DurakState = {
    players,
    deck,
    trump,
    trumpCard,
    table: [],
    discard: [],
    attacker,
    defender,
    phase: 'attack',
    firstAttack: true,
    firstBout: true,
    defenderCapacity: players[defender].hand.length,
    passed: [],
    throwCursor: attacker,
    log: [`Раздача. Козырь: ${trump}. seed=${seed}`],
    loser: null,
    draw: false,
    seed,
  };
  say(state, `${players[attacker].name} атакует первым`);
  return state;
}

function tableRanks(table: TablePair[]): Set<number> {
  const s = new Set<number>();
  for (const t of table) {
    s.add(t.attack.rank);
    if (t.defense) s.add(t.defense.rank);
  }
  return s;
}

/** Карты, которыми idx может добавить на стол (атака или подкидка). */
export function legalAttackCards(state: DurakState, idx: number): Card[] {
  const st = state;
  if (st.phase !== 'attack' && st.phase !== 'throwin') return [];
  let isAttackerTurn = idx === st.attacker;
  if (st.phase === 'throwin') {
    isAttackerTurn = false;
    for (let offset = 0; offset < st.players.length; offset++) {
      const current = (st.throwCursor + offset) % st.players.length;
      if (
        current !== st.defender &&
        !st.players[current].out &&
        !st.passed.includes(current) &&
        isDefenderNeighbor(st, current)
      ) {
        isAttackerTurn = idx === current;
        break;
      }
    }
  }
  if (!isAttackerTurn || st.players[idx].out) return [];
  const cap = st.firstBout ? FIRST_BOUT_CAP : MAX_TABLE_CARDS;
  if (st.table.length >= Math.min(cap, st.defenderCapacity)) return [];
  if (st.table.length === 0) return st.players[idx].hand;
  const ranks = tableRanks(st.table);
  return st.players[idx].hand.filter((c) => ranks.has(c.rank));
}

/** Карты idx, которые бьют данную атакующую карту. */
export function legalDefenseCards(state: DurakState, idx: number, attackPos: number): Card[] {
  if (state.phase !== 'defend' || idx !== state.defender) return [];
  const pair = state.table[attackPos];
  if (!pair || pair.defense) return [];
  return state.players[idx].hand.filter((c) => beats(c, pair.attack, state.trump));
}

/** Карты idx для перевода (только до первой покрытой карты). */
export function legalTransferCards(state: DurakState, idx: number): Card[] {
  const st = state;
  if (st.phase !== 'defend' || idx !== st.defender || st.table.length === 0) return [];
  if (st.table.some((t) => t.defense)) return [];
  const ranks = tableRanks(st.table);
  const nextDef = nextActive(st.players, idx);
  // Следующий должен суметь покрыть текущий стол + переводную
  if (st.players[nextDef].hand.length < st.table.length + 1) return [];
  return st.players[idx].hand.filter((c) => ranks.has(c.rank));
}

export function uncovered(state: DurakState): number[] {
  return state.table.map((t, i) => (t.defense ? -1 : i)).filter((i) => i >= 0);
}

function removeCard(p: DurakPlayer, card: Card): boolean {
  const i = p.hand.findIndex((c) => c.suit === card.suit && c.rank === card.rank);
  if (i < 0) return false;
  p.hand.splice(i, 1);
  return true;
}

export function attack(state: DurakState, idx: number, card: Card): DurakState {
  const legal = legalAttackCards(state, idx).some((c) => c.suit === card.suit && c.rank === card.rank);
  if (!legal) return state;
  const st = clone(state);
  removeCard(st.players[idx], card);
  st.table.push({ attack: card, defense: null });
  st.firstAttack = false;
  // Новая открытая атака — защитник должен покрыть её сразу (и после подкидки).
  st.phase = 'defend';
  // Подкидывание идёт по кругу: следующий за бросившим получает очередь.
  if (state.phase === 'throwin') st.throwCursor = (idx + 1) % st.players.length;
  say(st, `${st.players[idx].name}: атака ${rankLabel(card.rank)}${card.suit === st.trump ? ' (козырь)' : ''}`);
  return st;
}

export function defend(state: DurakState, idx: number, attackPos: number, card: Card): DurakState {
  const legal = legalDefenseCards(state, idx, attackPos).some(
    (c) => c.suit === card.suit && c.rank === card.rank,
  );
  if (!legal) return state;
  const st = clone(state);
  removeCard(st.players[idx], card);
  st.table[attackPos].defense = card;
  say(st, `${st.players[idx].name}: покрыл ${rankLabel(st.table[attackPos].attack.rank)} → ${rankLabel(card.rank)}`);
  if (uncovered(st).length === 0) {
    st.phase = 'throwin';
    // Приоритет подкидывания — у основного атакующего: после каждого
    // покрытия очередь сбрасывается на него, остальные идут по кругу после.
    st.throwCursor = st.attacker;
  }
  return st;
}

export function transfer(state: DurakState, idx: number, card: Card): DurakState {
  const legal = legalTransferCards(state, idx).some((c) => c.suit === card.suit && c.rank === card.rank);
  if (!legal) return state;
  const st = clone(state);
  removeCard(st.players[idx], card);
  st.table.push({ attack: card, defense: null });
  const oldDef = st.defender;
  st.defender = nextActive(st.players, idx);
  // Лимит подкидок — от руки нового защитника на момент перевода.
  st.defenderCapacity = st.players[st.defender].hand.length;
  st.passed = st.passed.filter((i) => i !== st.defender && i !== oldDef);
  say(st, `${st.players[idx].name}: перевёл на ${st.players[st.defender].name} (${rankLabel(card.rank)})`);
  return st;
}

/** Атакующие закончили подкидывать / защитник взял — завершение кона. */
export function passThrowIn(state: DurakState, idx: number): DurakState {
  if (state.phase !== 'throwin' || idx === state.defender || state.players[idx].out) return state;
  if (state.passed.includes(idx)) return state;
  const st = clone(state);
  st.passed.push(idx);
  // Кон завершается, когда спасовали все «крайние» — дальние игроки не участвуют в подкидке.
  const remaining = st.players.filter(
    (p, i) => !p.out && i !== st.defender && isDefenderNeighbor(st, i) && !st.passed.includes(i),
  );
  if (remaining.length === 0) return resolveBout(st, false);
  return st;
}

export function take(state: DurakState, idx: number): DurakState {
  if ((state.phase !== 'defend' && state.phase !== 'throwin') || idx !== state.defender) return state;
  if (state.table.length === 0) return state;
  const st = clone(state);
  say(st, `${st.players[idx].name}: берёт ${st.table.length} карт`);
  return resolveBout(st, true);
}

function resolveBout(state: DurakState, took: boolean): DurakState {
  const st = state;
  const tableCards = st.table.flatMap((t) => (t.defense ? [t.attack, t.defense] : [t.attack]));
  if (took) {
    st.players[st.defender].hand.push(...tableCards);
  } else {
    st.discard.push(...tableCards);
    say(st, 'Бито');
  }
  const prevAttacker = st.attacker;
  st.table = [];
  st.passed = [];

  // Добор по часовой от атакующего до 6, пока есть колода.
  for (let i = 0; i < st.players.length; i++) {
    const j = (prevAttacker + i) % st.players.length;
    const p = st.players[j];
    while (p.hand.length < HAND_LIMIT && st.deck.length > 0) p.hand.push(st.deck.pop()!);
  }

  // Выход в ноль при пустой колоде.
  for (const p of st.players) {
    if (!p.out && p.hand.length === 0 && st.deck.length === 0) {
      p.out = true;
      say(st, `${p.name} выходит из игры`);
    }
  }

  const alive = activeCount(st.players);
  if (alive === 0) {
    st.phase = 'finished';
    st.draw = true;
    say(st, 'Ничья — все вышли одновременно');
    return st;
  }
  if (alive === 1) {
    st.phase = 'finished';
    st.loser = st.players.findIndex((p) => !p.out);
    say(st, `${st.players[st.loser].name} — дурак`);
    return st;
  }

  // Очерёдность: взял → атакует следующий после защитника; бито → защитник атакует.
  st.attacker = took ? nextActive(st.players, st.defender) : st.defender;
  if (st.players[st.attacker].out) st.attacker = nextActive(st.players, st.attacker);
  st.defender = nextActive(st.players, st.attacker);
  st.defenderCapacity = st.players[st.defender].hand.length;
  st.firstBout = false;
  st.throwCursor = st.attacker; // подкидывание нового кона начинает атакующий
  st.phase = 'attack';
  st.firstAttack = true;
  say(st, `Ход: ${st.players[st.attacker].name} → ${st.players[st.defender].name}`);
  return st;
}

/** Сортировка руки: козыри в конец, внутри по рангу. */
export function sortHand(hand: Card[], trump: Suit): Card[] {
  return [...hand].sort((a, b) => {
    const ta = a.suit === trump ? 1 : 0;
    const tb = b.suit === trump ? 1 : 0;
    if (ta !== tb) return ta - tb;
    return a.rank - b.rank;
  });
}
