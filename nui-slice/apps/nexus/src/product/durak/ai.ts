// Эвристические AI-противники для переводного дурака.
// Не LLM — локальная стратегия с персональным уклоном (агрессия/экономия козырей).

import {
  type Card,
  type DurakState,
  attack,
  defend,
  isDefenderNeighbor,
  legalAttackCards,
  legalDefenseCards,
  legalTransferCards,
  passThrowIn,
  rankLabel,
  take,
  transfer,
  uncovered,
} from './engine';

interface Style {
  aggression: number; // 0..1 — склонность подкидывать и переводить
  trumpThrift: number; // 0..1 — экономия козырей (выше = бережливее)
}

const STYLES: Record<string, Style> = {
  alice: { aggression: 0.55, trumpThrift: 0.7 },
  mech: { aggression: 0.35, trumpThrift: 0.9 },
  forge: { aggression: 0.85, trumpThrift: 0.4 },
  codex: { aggression: 0.5, trumpThrift: 0.8 },
  arch: { aggression: 0.3, trumpThrift: 0.85 },
};

function style(state: DurakState, idx: number): Style {
  return STYLES[state.players[idx].personaId] ?? { aggression: 0.5, trumpThrift: 0.6 };
}

// Детерминированный «рандом» на основе сида и номера хода — реплеи стабильны.
function pick<T>(items: T[], state: DurakState, salt: number): T {
  const h = (state.seed * 31 + state.log.length * 7 + salt * 13) >>> 0;
  return items[h % items.length];
}

function cheapestNonTrump(cards: Card[], trump: string): Card[] {
  const plain = cards.filter((c) => c.suit !== trump).sort((a, b) => a.rank - b.rank);
  return plain.length ? plain : cards.slice().sort((a, b) => a.rank - b.rank);
}

function canCoverAll(state: DurakState, idx: number): boolean {
  // Грубая проверка: для каждой открытой атаки есть хоть одна карта (без учёта конфликтов по одной карте — допустимо для эвристики).
  return uncovered(state).every((pos) => legalDefenseCards(state, idx, pos).length > 0);
}

/** Один ход AI-игрока idx. Возвращает новое состояние или null, если ходов нет. */
export function aiMove(state: DurakState, idx: number): DurakState | null {
  if (state.phase === 'finished' || state.players[idx].out) return null;
  const st = style(state, idx);
  const me = state.players[idx];

  if (state.phase === 'attack' && idx === state.attacker) {
    const legal = legalAttackCards(state, idx);
    if (!legal.length) return null;
    const ordered = cheapestNonTrump(legal, state.trump);
    // Первая атака обязательна; дальше — по настроению и количеству карт защитника.
    if (!state.firstAttack) {
      const defCards = state.defenderCapacity;
      const cheap = ordered.filter((c) => c.suit !== state.trump);
      if (defCards <= state.table.length || (!cheap.length && st.trumpThrift > 0.5)) {
        return null; // сигнал «хватит» — обработчик завершит фазу
      }
    }
    const chosen =
      state.firstAttack || pick([true, false], state, 1)
        ? ordered[0]
        : pick(ordered, state, 2);
    return attack(state, idx, chosen);
  }

  if (state.phase === 'defend' && idx === state.defender) {
    // Перевод: есть карта того же ранга и характер позволяет.
    const tCards = legalTransferCards(state, idx);
    const openCount = uncovered(state).length;
    if (
      tCards.length &&
      !canCoverAll(state, idx) &&
      pick([true, false, true], state, 3) // псевдослучайность по сиду
    ) {
      const t = cheapestNonTrump(tCards, state.trump)[0];
      return transfer(state, idx, t);
    }
    // Перевод ради выгоды: крыть пришлось бы козырем, а перевод дешёвый.
    if (tCards.length && st.aggression > 0.4 && !canCoverAll(state, idx)) {
      const t = cheapestNonTrump(tCards, state.trump)[0];
      if (t.suit !== state.trump) return transfer(state, idx, t);
    }

    // Покрываем самую дешёвую побитую пару по очереди — первую открытую.
    const open = uncovered(state);
    if (!open.length) return null;
    const pos = open[0];
    const options = legalDefenseCards(state, idx, pos).sort((a, b) => {
      const cost = (c: Card) => c.rank + (c.suit === state.trump ? 100 : 0);
      return cost(a) - cost(b);
    });
    if (!options.length) {
      // Может ли покрыть остальные после гипотетического взятия — решает просто брать.
      return take(state, idx);
    }
    const chosen = options[0];
    // Если единственная защита — козырь старший и карт много — бережливый берёт.
    if (
      chosen.suit === state.trump &&
      chosen.rank >= 12 &&
      st.trumpThrift > 0.75 &&
      openCount >= 2 &&
      !canCoverAll(state, idx)
    ) {
      return take(state, idx);
    }
    return defend(state, idx, pos, chosen);
  }

  if (state.phase === 'throwin' && idx !== state.defender) {
    const legal = legalAttackCards(state, idx);
    const cheap = cheapestNonTrump(legal, state.trump).filter((c) => c.suit !== state.trump);
    // Подкидывает при наличии дешёвой карты с вероятностью ~aggression (персонажный уклон).
    const dice = [true, true, true, false].filter((_, i) => i < 1 + Math.round(st.aggression * 2));
    if (cheap.length && pick(dice, state, 7)) {
      return attack(state, idx, cheap[0]);
    }
    return passThrowIn(state, idx);
  }

  return null;
}

/**
 * Взятие защитника в фазе подкидки: по правилам брать можно в любой
 * момент кона, но actorIndex в throwin отдаёт ход бросающим — без этой
 * проверки AI-защитник был «заморожен» и вынужден набирать всё новые
 * карты, хотя выгоднее взять раньше и срезать потери.
 * Вызывается ПЕРЕД ходом очередного бросающего.
 */
export function aiDefenderTake(state: DurakState): DurakState | null {
  if (state.phase !== 'throwin') return null;
  const d = state.defender;
  const me = state.players[d];
  if (me.isUser || me.out || state.table.length === 0) return null;
  // Стол заполнен до лимита — подкидок больше не будет, ждём «бито».
  const cap = Math.min(state.firstBout ? 5 : 6, state.defenderCapacity);
  if (state.table.length >= cap) return null;
  // Если ни у кого не осталось легальных подкидок — тоже ждём «бито».
  const moreComing = state.players.some(
    (p, i) =>
      i !== d &&
      !p.out &&
      !state.passed.includes(i) &&
      isDefenderNeighbor(state, i) &&
      legalAttackCards(state, i).length > 0,
  );
  if (!moreComing) return null;
  // Подкидки ещё будут. Берём, если: рука почти пуста (нечем крыть
  // следующие) и стол уже весомый, либо бережливая персона страхуется
  // на полном почти столе — детерминированно от сида.
  const st = style(state, d);
  const depleted = me.hand.length <= 3 && state.table.length >= 3;
  const cautious =
    state.table.length >= 4 && st.trumpThrift > 0.5 && pick([true, false], state, 11);
  if (depleted || cautious) return take(state, d);
  return null;
}

/** Проиграть все доступные ходы AI до тех пор, пока очередь не дойдёт до пользователя или паузы. */
export function describePhase(state: DurakState): string {
  switch (state.phase) {
    case 'attack':
      return `атака: ${state.players[state.attacker].name}`;
    case 'defend':
      return `защита: ${state.players[state.defender].name}`;
    case 'throwin':
      return 'подкидывание';
    default:
      return state.draw ? 'ничья' : `${state.players[state.loser ?? 0]?.name} — дурак`;
  }
}

export { rankLabel };
