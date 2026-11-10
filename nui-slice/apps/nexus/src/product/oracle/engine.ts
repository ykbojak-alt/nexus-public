// Движок Song of Light and Shadow — все расклады по Guide v5 §7–9.
// Детерминированная тяга по seed. Не предсказание: пространство рефлексии.

import { SOLS_CARDS, SOLS_SECTION_LABEL, type SolsCard, type SolsSection } from './cards';

export type SolsMode =
  | 'daily' // Карта дня — тот же сид у всех в эту дату
  | 'note' // Одна нота — 1 карта, «какая сила просит быть увиденной»
  | 'mirror' // Зеркало момента — 3
  | 'voices' // Три голоса — по карте из каждой стопки
  | 'flow' // Течение судьбы — 4
  | 'crossroad' // Перекрёсток — 5
  | 'path' // Путь через состояние — 5
  | 'choice' // Выбор без предсказания — 6
  | 'song' // Песнь цикла — 7
  | 'space'; // Одно пространство — 1 карта выбранной секции

export interface SolsSpread {
  label: string;
  /** Назначение расклада по руководству. */
  desc: string;
  positions: string[];
  /** Пул каждой позиции: 'all' — полная колода, иначе — одна секция. */
  pools: ('all' | SolsSection)[];
}

export const SPREADS: Record<Exclude<SolsMode, 'daily' | 'space'>, SolsSpread> = {
  note: {
    label: 'Одна нота',
    desc: 'Короткая настройка, дневник, завершение дня',
    positions: ['Сила, которая просит быть увиденной сейчас'],
    pools: ['all'],
  },
  mirror: {
    label: 'Зеркало момента',
    desc: 'Ситуация с большими эмоциями и малым количеством ясности',
    positions: [
      'На поверхности',
      'Действует глубже и не признано',
      'Возвращает свободу выбора',
    ],
    pools: ['all', 'all', 'all'],
  },
  voices: {
    label: 'Три голоса',
    desc: 'Полный цикл: материал — видение — воплощение',
    positions: [
      'SHADOW — механизм, который уже действует',
      'GNOSIS — что необходимо увидеть и понять',
      'LIGHT — что может быть воплощено',
    ],
    pools: ['shadow', 'gnosis', 'light'],
  },
  flow: {
    label: 'Течение судьбы',
    desc: 'Куда ведёт путь, по которому иду сейчас',
    positions: [
      'Исток — сила из прошлого',
      'Течение — что происходит сейчас',
      'Устье — вероятное развитие',
      'Поворот — действие, меняющее направление',
    ],
    pools: ['all', 'all', 'all', 'all'],
  },
  crossroad: {
    label: 'Перекрёсток',
    desc: 'Момент выбора: суть, видимое, скрытое, возможность, исход',
    positions: [
      'Суть — что происходит в действительности',
      'Видимое — как воспринимается сознанием',
      'Скрытое — что действует из Тени',
      'Выбор — какая возможность открыта',
      'Исход — наиболее вероятная линия',
    ],
    pools: ['all', 'all', 'all', 'all', 'all'],
  },
  path: {
    label: 'Путь через состояние',
    desc: 'Повторяющийся паттерн, который заметили, но не изменили',
    positions: [
      'Порог — где вхожу в механизм',
      'Двигатель — какую потребность обслуживает',
      'Цена — что теряю, продолжая автоматически',
      'Знание — чему опыт уже научил',
      'Воплощение — действие, меняющее траекторию',
    ],
    pools: ['all', 'all', 'all', 'all', 'all'],
  },
  choice: {
    label: 'Выбор без предсказания',
    desc: 'Решение между вариантами — участие в выборе, а не «суждено»',
    positions: [
      'Вариант A — что притягивает',
      'Вариант A — цена, которую не замечаю',
      'Вариант B — что притягивает',
      'Вариант B — цена, которую не замечаю',
      'Внутренний критерий важнее вариантов',
      'Первый обратимый шаг — опыт вместо фантазии',
    ],
    pools: ['all', 'all', 'all', 'all', 'all', 'all'],
  },
  song: {
    label: 'Песнь цикла',
    desc: 'Большой жизненный этап, глубокая самостоятельная сессия',
    positions: [
      'Источник — из чего родилось движение',
      'Искажение — где связь потеряна',
      'Путь — как паттерн воспроизводится',
      'Бездна — к какому пределу ведёт',
      'Видение — что очевидно сейчас',
      'Равновесие — что удержать вместе',
      'Восхождение — действие, завершающее цикл',
    ],
    pools: ['all', 'all', 'all', 'all', 'all', 'all', 'all'],
  },
};

export const SOLS_MODE_LABEL: Record<SolsMode, string> = {
  daily: 'Карта дня',
  space: 'Одно пространство',
  ...Object.fromEntries(Object.entries(SPREADS).map(([k, v]) => [k, v.label])),
} as Record<SolsMode, string>;

export interface SolsDraw {
  mode: SolsMode;
  cards: SolsCard[];
  positions: string[];
  seed: number;
  /** Для space — выбранная секция. */
  space?: SolsSection;
}

// mulberry32 — тот же PRNG, что и в шахматном движке; реплей по seed.
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

const bySection = (s: SolsSection) => SOLS_CARDS.filter((c) => c.section === s);

// Тяга без повторов — как с физической колодой.
function take<T>(rng: () => number, pool: T[], used: Set<T>): T {
  const free = pool.filter((x) => !used.has(x));
  const c = free[Math.floor(rng() * free.length)];
  used.add(c);
  return c;
}

export function draw(mode: SolsMode, seed: number, space: SolsSection = 'light'): SolsDraw {
  const rng = mulberry32(seed);

  if (mode === 'daily') {
    return { mode, cards: [SOLS_CARDS[Math.floor(rng() * SOLS_CARDS.length)]], positions: ['Карта дня'], seed };
  }
  if (mode === 'space') {
    return {
      mode,
      cards: [bySection(space)[Math.floor(rng() * bySection(space).length)]],
      positions: [`Пространство ${SOLS_SECTION_LABEL[space]}`],
      seed,
      space,
    };
  }

  const spread = SPREADS[mode];
  const used = new Set<SolsCard>();
  return {
    mode,
    cards: spread.pools.map((pool) =>
      take(rng, pool === 'all' ? SOLS_CARDS : bySection(pool), used),
    ),
    positions: spread.positions,
    seed,
  };
}

/** Seed карты дня — одинаковая у всех в эту дату: YYYYMMDD как целое. */
export function dailySeed(d = new Date()): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
