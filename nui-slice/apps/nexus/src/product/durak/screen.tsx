'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type SyntheticEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Button, GlassPanel, PanelHeader, StatusBadge } from '@nexus/ui';
import { PERSONAS } from '@nexus/mock-data';
import { gameMotion, type GameMotionEasing, type GameMotionVerb } from '@nexus/motion';
import { runWhileDocumentVisible } from '../visible-interval';
import {
  type Card,
  type DurakState,
  attack,
  cardId,
  defend,
  isDefenderNeighbor,
  legalAttackCards,
  legalDefenseCards,
  legalTransferCards,
  newGame,
  passThrowIn,
  rankLabel,
  sortHand,
  take,
  transfer,
  uncovered,
} from './engine';
import { aiDefenderTake, aiMove, describePhase } from './ai';
import styles from './durak.module.css';

const SUIT_GLYPH: Record<Card['suit'], string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
};

const SUIT_LABEL: Record<Card['suit'], string> = {
  spades: 'пики',
  hearts: 'черви',
  diamonds: 'бубны',
  clubs: 'трефы',
};

// Статика: dev-сервер отдаёт /durak/…, AI-2 хост монтирует бандл под /_nexus.
const ASSET_BASE =
  typeof document !== 'undefined' &&
    document.querySelector('script[src*="/_nexus/"], link[href*="/_nexus/"]')
    ? '/_nexus'
    : '';

// Стили колоды: v1 — painterly tarot, v2 — cinematic CGI,
// v3/v4 — дополнительные стили (полные колоды 36 faces + 4 backs),
// v5 — NOIR (33 из 36 лиц, PNG в /durak/cards/; 8s/js/ad и рубашки
// честно откатываются на v1 до прихода файлов).
type DeckStyle = 'v1' | 'v2' | 'v3' | 'v4' | 'v5';
// Доступные стили: только те, чьи колоды лежат в public/durak целиком.
const DECK_STYLES: DeckStyle[] = ['v1', 'v2', 'v3', 'v4', 'v5'];
const STYLE_LABEL: Record<DeckStyle, string> = {
  v1: 'Таро · painterly',
  v2: 'CGI · cinematic',
  v3: 'Стиль 3',
  v4: 'Стиль 4',
  v5: 'NOIR · тушь',
};
const STYLE_SHORT: Record<DeckStyle, string> = {
  v1: 'Таро',
  v2: 'CGI',
  v3: 'Стиль 3',
  v4: 'Стиль 4',
  v5: 'NOIR',
};
// Циклический переход по доступным стилям (пикер — по спеке ACE).
const nextDeckStyle = (s: DeckStyle): DeckStyle =>
  DECK_STYLES[(DECK_STYLES.indexOf(s) + 1) % DECK_STYLES.length] ?? 'v1';
// Канонические имена noir-карт: 6s.png… (s/h/d/c, j/q/k/a для 11-14).
const NOIR_SUIT_KEY: Record<Card['suit'], string> = {
  spades: 's',
  hearts: 'h',
  diamonds: 'd',
  clubs: 'c',
};
const NOIR_RANK_KEY: Record<number, string> = { 11: 'j', 12: 'q', 13: 'k', 14: 'a' };
const noirCardKey = (c: Card) =>
  `${NOIR_RANK_KEY[c.rank] ?? c.rank}${NOIR_SUIT_KEY[c.suit]}`;
const faceSrc = (c: Card, style: DeckStyle) =>
  style === 'v5'
    ? `${ASSET_BASE}/durak/cards/${noirCardKey(c)}.png`
    : `${ASSET_BASE}/durak/${style}/faces/${c.suit}-${c.rank}.webp`;
// Рубашка колоды — по масти выпавшего козыря (у каждой колоды своя).
const backSrc = (suit: Card['suit'], style: DeckStyle) => `${ASSET_BASE}/durak/${style}/back-${suit}.webp`;
// Промах по файлу (неполный стиль) → тихий откат на painterly v1.
const artFallback =
  (style: DeckStyle, v1src: string) => (e: SyntheticEvent<HTMLImageElement>) => {
    const t = e.currentTarget;
    if (style !== 'v1' && !t.dataset.fbk) {
      t.dataset.fbk = '1';
      t.src = v1src;
    }
  };
const agentSrc = (personaId: string) => `${ASSET_BASE}/durak/agents/${personaId}.webp`;
// Фон панели агента — кроп из референса «Золотая команда» (фигура + тематическое поле).
const agentBgSrc = (personaId: string) => `${ASSET_BASE}/durak/agents/bg-${personaId}.webp`;

// Детерминированный джиттер стопки отбоя — «неровная стопка» как на живом столе.
const JITTER = [
  { x: 0, y: 0, r: -3 },
  { x: -8, y: 5, r: 7 },
  { x: 7, y: -4, r: -10 },
  { x: -10, y: -5, r: 5 },
  { x: 9, y: 6, r: -13 },
  { x: 4, y: -7, r: 12 },
];

const AGENT_PERSONAS = PERSONAS.filter((p) => p.id !== 'nexus');
const SUITS: Card['suit'][] = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS = [6, 7, 8, 9, 10, 11, 12, 13, 14];

function buildAssetManifest(style: DeckStyle): string[] {
  const urls: string[] = [];
  if (style === 'v5') {
    for (const s of SUITS) {
      for (const r of RANKS) {
        urls.push(`${ASSET_BASE}/durak/cards/${r >= 11 ? NOIR_RANK_KEY[r] : r}${NOIR_SUIT_KEY[s]}.png`);
      }
    }
  } else {
    for (const s of SUITS) {
      for (const r of RANKS) {
        urls.push(`${ASSET_BASE}/durak/${style}/faces/${s}-${r}.webp`);
      }
    }
  }
  for (const s of SUITS) urls.push(`${ASSET_BASE}/durak/${style}/back-${s}.webp`);
  for (const id of AGENT_PERSONAS.map((p) => p.id)) {
    urls.push(`${ASSET_BASE}/durak/agents/${id}.webp`);
    urls.push(`${ASSET_BASE}/durak/agents/bg-${id}.webp`);
  }
  return urls;
}

function actorIndex(state: DurakState): number | null {
  if (state.phase === 'attack') return state.attacker;
  if (state.phase === 'defend') return state.defender;
  if (state.phase === 'throwin') {
    for (let i = 0; i < state.players.length; i++) {
      const j = (state.throwCursor + i) % state.players.length;
      const p = state.players[j];
      if (!p.out && j !== state.defender && !state.passed.includes(j) && isDefenderNeighbor(state, j))
        return j;
    }
    return null;
  }
  return null;
}

function CardFace({
  card,
  trump,
  deckStyle,
  selected,
  small,
  usable,
  track,
  onClick,
  ariaDisabled,
  tabIndex,
  handIdx,
}: {
  card: Card;
  trump: Card['suit'];
  deckStyle: DeckStyle;
  selected?: boolean;
  small?: boolean;
  usable?: boolean;
  // track=false — не участвует в FLIP (напр. козырь под колодой лежит
  // повёрнутым, его rect не соответствует карте в руке — перелёт дёргается).
  track?: boolean;
  onClick?: () => void;
  // ariaDisabled — карта неиграбельна, но остаётся в roving-цепочке
  // (клавиатурный обзор руки как в chess grid).
  ariaDisabled?: boolean;
  tabIndex?: number;
  handIdx?: number;
}) {
  const isTrump = card.suit === trump;
  const cls = [
    styles.card,
    isTrump ? styles.trumpCard : '',
    selected ? styles.selected : '',
    usable ? styles.usable : '',
    small ? styles.small : '',
    onClick ? styles.clickable : '',
  ]
    .filter(Boolean)
    .join(' ');
  const img = (
    <img loading="eager" decoding="async"
      src={faceSrc(card, deckStyle)}
      onError={artFallback(deckStyle, faceSrc(card, 'v1'))}
      alt={`${rankLabel(card.rank)} ${SUIT_LABEL[card.suit]}`}
      className={styles.cardImg}
      draggable={false}
    />
  );
  const id = track === false ? undefined : cardId(card);
  return onClick || handIdx !== undefined ? (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      aria-label={`${rankLabel(card.rank)} ${SUIT_LABEL[card.suit]}`}
      aria-disabled={ariaDisabled || undefined}
      tabIndex={tabIndex}
      data-cardid={id}
      data-handidx={handIdx}
    >
      {img}
    </button>
  ) : (
    <span className={cls} data-cardid={id}>{img}</span>
  );
}

export function DurakScreen() {
  const [opponents, setOpponents] = useState<string[]>(['alice', 'mech', 'forge']);
  const [seed, setSeed] = useState<number>(() => Math.floor(Math.random() * 1_000_000));
  // Пользователь ввёл seed вручную — реплей перекрывает автоматику.
  const seedTouched = useRef(false);
  const [state, setState] = useState<DurakState | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const matrixRef = useRef<HTMLCanvasElement>(null);
  const logRef = useRef<HTMLOListElement>(null);
  // Позиции — через offsetLeft/offsetTop, а не getBoundingClientRect:
  // rect включает hover-подъём и бегущие анимации → FLIP видел фантомный
  // сдвиг и возвращал карту — рука «дрожала». offset* дают layout-позицию.
  const rectsRef = useRef(new Map<string, { x: number; y: number; zone: string }>());
  const prevStateRef = useRef<DurakState | null>(null);
  // Полёты AI-карт: cardId → индекс места-источника. Заполняется при ходе AI,
  // анимируется в layout-эффекте от реальной позиции веера агента.
  const flightsRef = useRef(new Map<string, number>());
  // Снимок состояния прошлого коммита — нужен FLIP-эффекту, чтобы отличать
  // «агент взял карты со стола» от «агент добрал из колоды» при появлении
  // новых рубашек в веере: источник полёта разный.
  const prevSnap = useRef<{ table: number; discard: number; defender: number } | null>(null);
  // Живые WAAPI-анимации по элементу карты. Отменяем ТОЛЬКО анимацию того же
  // элемента при повторном старте — иначе каждый рендер (choice, ghosts, лог)
  // обрывал бы все полёты на полпути, и карты «дёргались».
  const animsRef = useRef(new Map<HTMLElement, Animation>());
  // Карта подразумевает и бой, и перевод — ждём выбора игрока.
  const [choice, setChoice] = useState<{ card: Card; pos: number } | null>(null);
  const [ghosts, setGhosts] = useState<{
    pairs: DurakState['table'];
    dir: 'discard' | 'opponent';
    seat: number;
    // Разлёт каждой пары — детерминирован с момента события: раньше
    // Math.random() в рендере менял --jx/--jy при каждом перерендере
    // и траектория призрака «мигала» посреди полёта.
    jit: { d: number; t: number; jx: number; jy: number; gr: number }[];
  } | null>(null);
  // Попап результата партии — показывается автоматически, закрываем вручную.
  const [resultDismissed, setResultDismissed] = useState(false);
  // Сессионный счёт партий: победы / поражения / ничьи (persist — хаб /games).
  const [score, setScore] = useState<{ w: number; l: number; d: number }>(() => {
    try {
      const s = JSON.parse(
        typeof window !== 'undefined' ? window.localStorage.getItem('nexus.durak.score') ?? 'null' : 'null',
      );
      return s && typeof s.w === 'number' ? s : { w: 0, l: 0, d: 0 };
    } catch {
      return { w: 0, l: 0, d: 0 };
    }
  });
  // Темп анимаций карт: множитель 0.5–2 (локальная настройка, persist).
  const [animSpeed, setAnimSpeed] = useState<number>(() => {
    const v = typeof window !== 'undefined' ? Number(window.localStorage.getItem('nexus.durak.animSpeed')) : 0;
    return v >= 0.5 && v <= 2 ? v : 1;
  });
  useEffect(() => {
    window.localStorage.setItem('nexus.durak.animSpeed', String(animSpeed));
  }, [animSpeed]);

  // Стиль колоды: v1 painterly / v2 CGI / v3-v4 дополнительные (persist,
  // фолбэк на v1 для отсутствующих карт — см. artFallback).
  const [deckStyle, setDeckStyle] = useState<DeckStyle>(() => {
    const v = typeof window !== 'undefined' ? window.localStorage.getItem('nexus.durak.deckStyle') : null;
    return DECK_STYLES.find((s) => s === v) ?? 'v1';
  });
  useEffect(() => {
    window.localStorage.setItem('nexus.durak.deckStyle', deckStyle);
  }, [deckStyle]);

  // Preload the active deck once and track readiness, so gameplay renders do not
  // wait on late network requests. A selected style is warmed only once; switching
  // starts background preload without replacing the deck currently shown.
  const preloadedDeckStylesRef = useRef<Set<DeckStyle>>(new Set());
  const [deckAssetsReady, setDeckAssetsReady] = useState(false);
  const idlePreloadStartedRef = useRef(false);
  useEffect(() => {
    if (preloadedDeckStylesRef.current.has(deckStyle)) {
      setDeckAssetsReady(true);
      return undefined;
    }
    let cancelled = false;
    setDeckAssetsReady(false);
    const urls = buildAssetManifest(deckStyle);
    Promise.all(urls.map((url) => new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = url;
    }))).then(() => {
      if (!cancelled) {
        preloadedDeckStylesRef.current.add(deckStyle);
        setDeckAssetsReady(true);
      }
    });
    return () => { cancelled = true; };
  }, [deckStyle]);

  useEffect(() => {
    if (idlePreloadStartedRef.current) return undefined;
    idlePreloadStartedRef.current = true;
    let cancelled = false;
    const schedule = (work: () => void) => {
      if (typeof window === 'undefined') return;
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(() => work(), { timeout: 2000 });
      } else {
        window.setTimeout(work, 1500);
      }
    };
    schedule(() => {
      for (let index = 0; index < DECK_STYLES.length; index += 1) {
        const style = DECK_STYLES[index];
        if (!style || preloadedDeckStylesRef.current.has(style)) continue;
        void Promise.all(buildAssetManifest(style).map((url) => new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = url;
        }))).then(() => {
          if (!cancelled) preloadedDeckStylesRef.current.add(style);
        });
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Фокус между чипами пикера стилей — roving tabindex (стрелки/End/Home).
  const [focusedStyleIdx, setFocusedStyleIdx] = useState(0);

  const onStylePickKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    if (!fwd && !back && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0
      : e.key === 'End' ? DECK_STYLES.length - 1
        : fwd ? (focusedStyleIdx + 1) % DECK_STYLES.length
          : (focusedStyleIdx - 1 + DECK_STYLES.length) % DECK_STYLES.length;
    setFocusedStyleIdx(next);
  };

  // Launch-параметры: /durak?opponents=a,b&deckStyle=v5&seed=N&start=1
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // ?opponents=slug,slug — валидные персоны (без nexus), без дублей, до 4.
    const opp = params.get('opponents');
    let oppList: string[] | null = null;
    if (opp != null) {
      const valid = AGENT_PERSONAS.map((p) => p.id);
      const picked = [...new Set(opp.split(',').map((s) => s.trim()).filter(Boolean))]
        .filter((id) => valid.includes(id)).slice(0, 4);
      if (picked.length > 0) oppList = picked;
    }
    // ?deckStyle=v1..v5 — только существующие стили колоды (все в DECK_STYLES).
    const ds = params.get('deckStyle');
    if (ds != null && DECK_STYLES.includes(ds as DeckStyle)) setDeckStyle(ds as DeckStyle);
    // ?seed=N — реплей как ручной.
    const n = Number(params.get('seed'));
    const seedFromUrl = n > 0;
    if (seedFromUrl) {
      seedTouched.current = true;
      setSeed(n);
    }
    if (oppList != null) setOpponents(oppList);
    // ?start=1 — автозапуск партии с применёнными параметрами.
    if (params.get('start') === '1') {
      const seats = [
        { id: 'user', name: 'Вы', personaId: 'nexus', isUser: true },
        ...(oppList ?? opponents).map((pid) => {
          const p = PERSONAS.find((x) => x.id === pid)!;
          return { id: pid, name: p.name, personaId: pid };
        }),
      ];
      const s = seedFromUrl ? n : Math.floor(Math.random() * 1_000_000);
      setSeed(s);
      setState(newGame(seats, s));
    }
  }, []);

  // Persist для хаба /games: счёт сессии и seed последней партии.
  useEffect(() => {
    window.localStorage.setItem('nexus.durak.score', JSON.stringify(score));
  }, [score]);
  useEffect(() => {
    if (state) window.localStorage.setItem('nexus.durak.lastSeed', String(state.seed));
  }, [state]);

  const userIdx = 0;
  const actor = state ? actorIndex(state) : null;
  const userActs = state !== null && actor === userIdx;

  // FLIP: карта, сменившая позицию между рендерами, долетает из старой точки.
  useLayoutEffect(() => {
    const root = pageRef.current;
    if (!root) return;
    const reduced =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      typeof HTMLElement.prototype.animate !== 'function';
    const posOf = (el: HTMLElement) => {
      let x = 0;
      let y = 0;
      let n: HTMLElement | null = el;
      while (n) {
        x += n.offsetLeft;
        y += n.offsetTop;
        n = n.offsetParent as HTMLElement | null;
      }
      return { x, y };
    };
    const seen = new Set<string>();
    // Пере-запуск анимации на том же элементе отменяет предыдущую —
    // иначе трансформы наслаиваются. Остальные полёты доживают до конца.
    const fly = (el: HTMLElement, kf: Keyframe[] | PropertyIndexedKeyframes, opts: KeyframeAnimationOptions) => {
      animsRef.current.get(el)?.cancel();
      const a = el.animate(kf, opts);
      animsRef.current.set(el, a);
      const drop = () => {
        if (animsRef.current.get(el) === a) animsRef.current.delete(el);
      };
      a.finished.then(drop, drop); // cancel → finished отклоняется, оба пути чистим
    };
    const deckEl = root.querySelector<HTMLElement>('[data-deck]');
    // Точка раздачи — верхняя карта реальной стопки, а не центр зоны колоды.
    const deckTopEl =
      root.querySelector<HTMLElement>('[data-decktop]') ?? deckEl;
    // Снимок прошлого коммита: взятие агентом отличаем от добора —
    // стол опустел, а отбой не вырос → карты летели со стола, не из колоды.
    const snap = prevSnap.current;
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    // Темп из регулятора: длительности и задержки делятся на множитель.
    const k = 1 / animSpeed;
    // Ритм — gameMotion-фабрика (W4) над motion-токенами W2; jitter ±N caller-side.
    const mt = (verb: GameMotionVerb, ease: GameMotionEasing, jitter: number) => {
      const s = gameMotion(verb, ease, { tempo: k });
      return { duration: s.durationMs + rnd(-jitter, jitter) * k, easing: s.easing };
    };
    let dealStagger = 0;
    root.querySelectorAll<HTMLElement>('[data-cardid]').forEach((el) => {
      const id = el.dataset.cardid ?? '';
      const p = posOf(el);
      // Зона карты: рука/стол/колода. Движение внутри стола (рецентровка
      // пар при добавлении новых) не анимируем — иначе весь кон «ездает».
      const zone = el.closest<HTMLElement>('[data-zone]')?.dataset.zone ?? '';
      const old = rectsRef.current.get(id);
      if (!reduced) {
        if (old) {
          const moved = Math.abs(old.x - p.x) > 2 || Math.abs(old.y - p.y) > 2;
          // Перелёт между зонами или сдвиг в руке (смыкание веера) — да.
          // Скольжение по столу: средняя точка сносится вбок и с поворотом —
          // траектория живая, не прямая линия.
          if (moved && (old.zone !== zone || zone === 'hand')) {
            const dx = old.x - p.x;
            const dy = old.y - p.y;
            fly(
              el,
              [
                { transform: `translate(${dx}px, ${dy}px)` },
                {
                  transform: `translate(${dx * 0.5 + rnd(-48, 48)}px, ${dy * 0.5 + rnd(-36, 36)}px) rotate(${rnd(-7, 7)}deg)`,
                  offset: 0.55,
                },
                { transform: 'none' },
              ],
              mt('deal', 'glide', 100),
            );
          }
        } else if (deckEl && zone !== 'table') {
          // Новая карта вне стола. Источник: верх колоды при раздаче/доборе;
          // если агент только что забрал кон со стола — рубашка в его веере
          // вылетает со стола, а не из колоды.
          const seat = Number(el.closest<HTMLElement>('[data-seat]')?.dataset.seat ?? -1);
          const took =
            zone === 'opponent' &&
            snap !== null &&
            snap.table > 0 &&
            (state?.table.length ?? -1) === 0 &&
            (state?.discard.length ?? -1) === snap.discard &&
            seat === snap.defender;
          const srcEl = took
            ? (root.querySelector<HTMLElement>('[data-zone="table"]') ?? deckTopEl ?? deckEl)
            : (deckTopEl ?? deckEl);
          const r = el.getBoundingClientRect();
          const d = srcEl.getBoundingClientRect();
          const dx = d.left + d.width / 2 - (r.left + r.width / 2);
          const dy = d.top + d.height / 2 - (r.top + r.height / 2);
          const sc = r.height > 0 ? Math.min(d.height, r.height) / r.height : 1;
          fly(
            el,
            [
              {
                transform: `translate(${dx}px, ${dy}px) scale(${sc}) rotate(${rnd(-14, 14)}deg)`,
                opacity: 0,
              },
              {
                transform: `translate(${dx * rnd(0.3, 0.5)}px, ${dy * rnd(0.35, 0.55)}px) scale(${(sc + 1) / 2}) rotate(${rnd(-8, 8)}deg)`,
                opacity: 1,
                offset: 0.6,
              },
              { transform: 'none', opacity: 1 },
            ],
            {
              ...mt('attack', 'drift', 100),
              delay: (dealStagger += rnd(70, 190) * k),
            },
          );
        }
      }
      seen.add(id);
      rectsRef.current.set(id, { ...p, zone });
    });
    for (const id of [...rectsRef.current.keys()]) {
      if (!seen.has(id)) rectsRef.current.delete(id);
    }
    // Полёт AI-карты на стол — из центра веера её места, не «из воздуха».
    if (!reduced && flightsRef.current.size > 0) {
      for (const [id, seat] of flightsRef.current) {
        const el = root.querySelector<HTMLElement>(`[data-cardid="${id}"]`);
        const seatEl = root.querySelector<HTMLElement>(`[data-seat="${seat}"]`);
        // Вылет из реальной рубашки веера агента, а не из центра его панели.
        const backEl =
          seatEl?.querySelector<HTMLElement>(`.${styles.cardBackImg}`) ?? seatEl;
        if (el && backEl) {
          const r = el.getBoundingClientRect();
          const s = backEl.getBoundingClientRect();
          const dx = s.left + s.width / 2 - (r.left + r.width / 2);
          const dy = s.top + s.height / 2 - (r.top + r.height / 2);
          const sc = s.height > 0 && r.height > 0 ? s.height / r.height : 0.55;
          fly(
            el,
            [
              {
                transform: `translate(${dx}px, ${dy}px) scale(${sc}) rotate(${rnd(-12, 12)}deg)`,
                opacity: 0.3,
              },
              {
                transform: `translate(${dx * 0.5 + rnd(-40, 40)}px, ${dy * 0.5 + rnd(-30, 30)}px) scale(${(sc + 1) / 2}) rotate(${rnd(-6, 6)}deg)`,
                opacity: 1,
                offset: 0.55,
              },
              { transform: 'none', opacity: 1 },
            ],
            mt('deal', 'drift', 80),
          );
        }
      }
    }
    flightsRef.current.clear();
    // Снимок для следующего коммита — различение добор/взятие (см. выше).
    prevSnap.current = state
      ? {
        table: state.table.length,
        discard: state.discard.length,
        defender: state.defender,
      }
      : null;
  });

  // Unmount: гасим все полёты разом (покидаем экран — точности не нужно).
  useEffect(
    () => () => {
      for (const a of animsRef.current.values()) a.cancel();
      animsRef.current.clear();
    },
    [],
  );

  // Любое изменение состояния отменяет отложенный выбор «бой/перевод».
  useEffect(() => setChoice(null), [state]);

  // Escape закрывает диалоги выбора действия и результата партии.
  useEffect(() => {
    if (!choice && !(state?.phase === 'finished' && !resultDismissed)) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (choice) setChoice(null);
      else setResultDismissed(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choice, state?.phase, resultDismissed]);

  // Фон поля — «матричный» дождь из глифов карт и рангов.
  useEffect(() => {
    const canvas = matrixRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const GLYPHS = '♠♥♦♣AKQJTАБВГДЕКЛМНПР9876543210'.split('');
    const SUIT_TINT: Record<string, string> = {
      '♠': 'rgba(169, 143, 245, ',
      '♥': 'rgba(232, 131, 122, ',
      '♦': 'rgba(232, 194, 92, ',
      '♣': 'rgba(127, 176, 234, ',
    };
    const FS = 15;
    let w = 0;
    let h = 0;
    let cols = 0;
    let drops: number[] = [];
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / FS);
      drops = Array.from({ length: cols }, () => Math.floor(Math.random() * (h / FS)));
      ctx.fillStyle = '#0A0D11';
      ctx.fillRect(0, 0, w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const draw = () => {
      ctx.fillStyle = 'rgba(10, 13, 17, 0.14)'; // затухающий шлейф
      ctx.fillRect(0, 0, w, h);
      ctx.font = `${FS}px ui-monospace, monospace`;
      for (let i = 0; i < cols; i++) {
        const g = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        ctx.fillStyle =
          Math.random() < 0.04
            ? 'rgba(246, 240, 228, 0.9)'
            : (SUIT_TINT[g] ? `${SUIT_TINT[g]}0.5)` : 'rgba(201, 164, 92, 0.42)');
        ctx.fillText(g, i * FS, drops[i] * FS);
        drops[i] = drops[i] * FS > h && Math.random() > 0.972 ? 0 : drops[i] + 1;
      }
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      draw();
      return () => ro.disconnect();
    }
    const stopRain = runWhileDocumentVisible(draw, 78);
    return () => {
      stopRain();
      ro.disconnect();
    };
  }, [state !== null]);

  // Кон разрешён: карты улетели — показываем их вылет (в отбой или к оппоненту).
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (!prev || !state || state.table.length > 0 || prev.table.length === 0) return;
    const bito = state.discard.length > prev.discard.length;
    const userTook = !bito && prev.defender === userIdx;
    if (userTook) return; // карты долетают в руку через FLIP
    setGhosts({
      pairs: prev.table,
      dir: bito ? 'discard' : 'opponent',
      seat: prev.defender,
      jit: prev.table.map(() => ({
        d: 40 + Math.random() * 90,
        t: 560 + Math.random() * 220,
        jx: Math.round(Math.random() * 120 - 60),
        jy: Math.round(Math.random() * 56 - 28),
        gr: Math.round(Math.random() * 34 - 17),
      })),
    });
    const t = window.setTimeout(() => setGhosts(null), 1500 / animSpeed);
    return () => window.clearTimeout(t);
  }, [state, animSpeed]);

  // Призраки кона летят в РЕАЛЬНУЮ цель: отбой — в центр стопки отбоя,
  // взятие — в веер защищавшегося. Вектор считается по живым rect'ам
  // после монтажа слоя (парные --jx/--jy добавляют разброс поверх).
  useEffect(() => {
    if (!ghosts) return;
    const raf = requestAnimationFrame(() => {
      const root = pageRef.current;
      const layer = root?.querySelector<HTMLElement>('[data-ghosts]');
      const pair = layer?.querySelector<HTMLElement>(`.${styles.ghostPair}`);
      const target =
        ghosts.dir === 'discard'
          ? root?.querySelector<HTMLElement>('[data-discard]')
          : root?.querySelector<HTMLElement>(`[data-seat="${ghosts.seat}"]`);
      if (!layer || !pair || !target) return;
      const p = pair.getBoundingClientRect();
      const t = target.getBoundingClientRect();
      layer.style.setProperty('--tx', `${Math.round(t.left + t.width / 2 - (p.left + p.width / 2))}px`);
      layer.style.setProperty('--ty', `${Math.round(t.top + t.height / 2 - (p.top + p.height / 2))}px`);
    });
    return () => cancelAnimationFrame(raf);
  }, [ghosts]);

  // Адаптивный масштаб стола: --cardH вычисляется из свободного места
  // панели поля — высота делится на два ряда пар + вылет защиты, ширина —
  // на три пары между отбоем и колодой. Стол перестаёт вылезать за экран.
  useEffect(() => {
    const root = pageRef.current;
    if (!root || typeof ResizeObserver !== 'function') return;
    const area = root.querySelector<HTMLElement>('[data-table]');
    if (!area) return;
    const fit = () => {
      const w = area.clientWidth;
      const h = area.clientHeight;
      if (w === 0 || h === 0) return;
      // h: 2 ряда × (карта + вылет защиты ≈1.3·cardH) + зазоры/паддинги.
      // w: 3 пары/ряд × ~0.62·cardH карта + ~0.42·cardH запас пары,
      //    + отбой и колода (~1.6·cardH) + ~110px паддингов/зазоров.
      const baseSize = Math.max(
        56,
        Math.round(Math.min(150, (h - 70) / 2.6, (w - 110) / 3.3)),
      );
      const size = `${baseSize}px`;
      const tableSize = `${Math.min(190, Math.round(baseSize * 1.25))}px`;
      if (root.style.getPropertyValue('--cardH') !== size) {
        root.style.setProperty('--cardH', size);
      }
      if (root.style.getPropertyValue('--tableCardH') !== tableSize) {
        root.style.setProperty('--tableCardH', tableSize);
      }
    };
    const ro = new ResizeObserver(fit);
    ro.observe(area);
    fit();
    return () => {
      ro.disconnect();
      root.style.removeProperty('--cardH');
      root.style.removeProperty('--tableCardH');
    };
  }, [state !== null]);

  // Новая партия — сбрасываем закрытие попапа результата.
  useEffect(() => {
    if (!state || state.phase !== 'finished') setResultDismissed(false);
  }, [state]);

  // Завершение партии — один раз зачесть в сессионный счёт
  // (ref-страж против двойного вызова эффекта в dev strict-mode).
  const finishedNow = state?.phase === 'finished';
  const scoredRef = useRef<DurakState | null>(null);
  useEffect(() => {
    if (!finishedNow || !state || scoredRef.current === state) return;
    scoredRef.current = state;
    setScore((s) =>
      state.draw
        ? { ...s, d: s.d + 1 }
        : state.loser === userIdx
          ? { ...s, l: s.l + 1 }
          : { ...s, w: s.w + 1 },
    );
  }, [finishedNow, state]);

  // Лог — докручивать к свежей записи.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state?.log.length]);

  // Авто-«бито»: в фазе подкидки у игрока нет ни одной допустимой карты —
  // единственный легальный ход это пас, заставлять кликать его руками
  // бессмысленно. Небольшая пауза, чтобы ход читался в логе.
  useEffect(() => {
    if (!state || !userActs || state.phase !== 'throwin') return;
    if (legalAttackCards(state, userIdx).length > 0) return;
    const t = setTimeout(() => {
      setState((s) => {
        if (!s || s.phase !== 'throwin') return s;
        return passThrowIn(s, userIdx) ?? s;
      });
    }, Math.round(600 / animSpeed));
    return () => clearTimeout(t);
  }, [state, userActs, animSpeed]);

  // Движение AI: один ход за тик, чтобы пользователь видел последовательность.
  useEffect(() => {
    if (!state || state.phase === 'finished' || userActs) return;
    if (actor === null) return;
    // Такт AI синхронизирован с темпом полётов: следующий ход начинается
    // после приземления карты (deal ~660ms / animSpeed), а не по фиксированным
    // 650ms — иначе при любом tempo≠1 анимации резали друг друга.
    // Небольшой джиттер — живой ритм, а не метроном.
    const pace = Math.round((gameMotion('deal', 'drift').durationMs + 140) / animSpeed + Math.random() * 130);
    const t = setTimeout(() => {
      setState((prev) => {
        if (!prev) return prev;
        // Защитник может взять и в throwin — проверяем до хода бросающего,
        // иначе AI вынужден набирать карты, пока очередь до него не дойдёт.
        const defTake = aiDefenderTake(prev);
        if (defTake) return defTake;
        const a = actorIndex(prev);
        if (a === null || prev.players[a].isUser) return prev;
        const next = aiMove(prev, a);
        // AI «не хочет подкидывать» в фазе throwin — фиксируем пас.
        const final = next ?? (prev.phase === 'throwin' ? passThrowIn(prev, a) ?? prev : prev);
        if (final !== prev) {
          // Карты, добавленные на стол этим ходом, — кандидаты на полёт с места a.
          final.table.forEach((tp, i) => {
            const p = prev.table[i];
            if (!p) flightsRef.current.set(cardId(tp.attack), a);
            else if (!p.defense && tp.defense) flightsRef.current.set(cardId(tp.defense), a);
          });
        }
        return final;
      });
    }, pace);
    return () => clearTimeout(t);
  }, [state, actor, userActs, animSpeed]);

  function start() {
    const seats = [
      { id: 'user', name: 'Вы', personaId: 'nexus', isUser: true },
      ...opponents.map((pid) => {
        const p = PERSONAS.find((x) => x.id === pid)!;
        return { id: pid, name: p.name, personaId: pid };
      }),
    ];
    // Сид свежий каждую партию — кроме случая, когда ввели свой для реплея.
    const s = seedTouched.current ? seed : Math.floor(Math.random() * 1_000_000);
    setSeed(s);
    setState(newGame(seats, s));
  }

  function toggleOpponent(id: string) {
    setOpponents((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
  }

  const hand = useMemo(() => (state ? sortHand(state.players[userIdx].hand, state.trump) : []), [state]);
  // Roving-tabindex по руке: стрелки ←/→/Home/End обходят карты (как chess grid),
  // Enter/Space играет карту у кнопки. Индекс зажат в границы при сжатии руки.
  const [focusCard, setFocusCard] = useState(0);
  const handRef = useRef<HTMLDivElement>(null);
  const handFocus = Math.min(focusCard, Math.max(0, hand.length - 1));

  function onHandKey(e: React.KeyboardEvent) {
    if (hand.length === 0) return;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowLeft': next = handFocus > 0 ? handFocus - 1 : null; break;
      case 'ArrowRight': next = handFocus < hand.length - 1 ? handFocus + 1 : null; break;
      case 'Home': next = 0; break;
      case 'End': next = hand.length - 1; break;
      default: return;
    }
    if (next === null || next === handFocus) return;
    e.preventDefault();
    setFocusCard(next);
    handRef.current?.querySelector<HTMLElement>(`[data-handidx="${next}"]`)?.focus();
  }

  const userAttackCards = state ? legalAttackCards(state, userIdx) : [];
  const userTransferCards = state ? legalTransferCards(state, userIdx) : [];

  function onHandClick(card: Card) {
    if (!state || !userActs) return;
    // Атака/подкидка — один клик.
    if (state.phase === 'attack' || state.phase === 'throwin') {
      if (userAttackCards.some((c) => c.suit === card.suit && c.rank === card.rank)) {
        setState(attack(state, userIdx, card));
      }
      return;
    }
    if (state.phase === 'defend') {
      const open = uncovered(state);
      const pos = open.find((p) =>
        legalDefenseCards(state, userIdx, p).some(
          (c) => c.suit === card.suit && c.rank === card.rank,
        ),
      );
      const canTransfer = userTransferCards.some(
        (c) => c.suit === card.suit && c.rank === card.rank,
      );
      // Карта может и побить, и перевести — уточняем у игрока действие.
      if (pos !== undefined && canTransfer) {
        setChoice({ card, pos });
        return;
      }
      if (pos !== undefined) {
        setState(defend(state, userIdx, pos, card));
        return;
      }
      if (canTransfer) {
        setState(transfer(state, userIdx, card));
      }
    }
  }

  const openTargets = state ? uncovered(state) : [];

  if (!state) {
    return (
      <div className={styles.page} data-screen="durak" data-state="empty" aria-labelledby="durak-title">
        <PanelHeader
          level="screen"
          divider={false}
          titleId="durak-title"
          title="Дурак · Переводной"
          subtitle="Классические правила переводного дурака. Противники — агенты NEXUS (локальная AI-стратегия, без сети). Колода 36 карт, козырь — нижняя карта."
          actions={<StatusBadge status="info" label="ЛОКАЛЬНО" />}
        />
        <div className={styles.setup}>
          <GlassPanel className={styles.setupCard}>
            <div className={styles.setupRow}>
              <span className={styles.setupLabel}>Противники (1–4)</span>
              <div className={styles.personaPick}>
                {AGENT_PERSONAS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={styles.personaChip}
                    data-active={opponents.includes(p.id) || undefined}
                    aria-pressed={opponents.includes(p.id)}
                    onClick={() => toggleOpponent(p.id)}
                  >
                    <img loading="lazy" decoding="async" src={agentSrc(p.id)} alt="" className={styles.personaAvatar} />
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.setupRow}>
              <span className={styles.setupLabel}>Seed <i>(авто)</i></span>
              <input
                className={styles.seedInput}
                type="number"
                aria-label="Seed партии"
                title="По умолчанию — случайный каждую партию; введите свой для реплея"
                value={seed}
                onChange={(e) => {
                  seedTouched.current = true;
                  setSeed(Number(e.target.value) || 0);
                }}
              />
            </div>
            <div className={styles.setupRow}>
              <span className={styles.setupLabel}>Стиль колоды</span>
              <span role="status" aria-live="polite">
                Стиль колоды: {STYLE_LABEL[deckStyle]}
              </span>
              <div
                id="deck-style-picker"
                className={styles.stylePick}
                role="group"
                aria-label="Стиль колоды Durak"
                onKeyDown={onStylePickKey}
              >
                {DECK_STYLES.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    className={styles.styleChip}
                    data-testid={`deck-style-chip-${s}`}
                    data-active={deckStyle === s || undefined}
                    aria-pressed={deckStyle === s}
                    tabIndex={focusedStyleIdx === i ? 0 : -1}
                    aria-label={`${STYLE_LABEL[s]}${deckStyle === s ? ' · активен' : ''}`}
                    title={STYLE_LABEL[s]}
                    onFocus={() => setFocusedStyleIdx(i)}
                    onClick={() => setDeckStyle(s)}
                  >
                    <img
                      loading="lazy"
                      decoding="async"
                      src={backSrc('spades' as const, s)}
                      alt=""
                      className={styles.styleChipImg}
                      onError={artFallback(s, `${ASSET_BASE}/durak/v1/back-spades.webp`)}
                    />
                    <span className={styles.styleChipLabel}>{STYLE_LABEL[s]}</span>
                  </button>
                ))}
              </div>
            </div>
            <Button variant="primary" className={styles.gameBtn} onClick={start} disabled={opponents.length === 0}>
              Начать партию
            </Button>
            <div className={styles.honesty}>
              <span>AI-противники — эвристика, не LLM. Реплей воспроизводится по seed.</span>
            </div>
          </GlassPanel>
        </div>
      </div>
    );
  }

  const finished = state.phase === 'finished';
  // Право взять — у защитника весь кон (defend и throwin), не только в свой ход.
  const userTakes =
    state.defender === userIdx &&
    (state.phase === 'defend' || state.phase === 'throwin') &&
    state.table.length > 0;
  const userCanThrowIn = userActs && state.phase === 'throwin' && userIdx !== state.defender;

  return (
    <div className={styles.page} ref={pageRef} data-screen="durak" data-state={finished ? 'finished' : 'ready'} aria-labelledby="durak-title">
      <PanelHeader
        level="screen"
        divider={false}
        titleId="durak-title"
        title="Дурак · Переводной"
        subtitle={(
          <>
            <span aria-live="polite">{describePhase(state)}</span>
            {` · seed ${state.seed}`}
          </>
        )}
        actions={(
          <div className={styles.headerMeta}>
            <label className={styles.speedCtl} title="Скорость анимации карт — локальная настройка">
              <span className={styles.speedLabel}>Темп</span>
              <input
                type="range"
                className={styles.speedRange}
                min={0.5}
                max={2}
                step={0.25}
                value={animSpeed}
                onChange={(e) => setAnimSpeed(Number(e.target.value))}
                aria-label="Скорость анимации карт"
              />
              <span className={styles.speedVal}>×{animSpeed}</span>
            </label>
            <button
              type="button"
              className={styles.deckStyleBtn}
              onClick={() => setDeckStyle(nextDeckStyle)}
              aria-pressed={deckStyle !== 'v1'}
              aria-controls="deck-style-picker"
              title="Стиль колоды: Таро — painterly, CGI — кинематографичный, Стиль 3/4 — дополнительные наборы, NOIR — тушь (33 карты; 8♠/J♠/A♦ и рубашки — временно арт v1)"
            >
              Арт: {STYLE_SHORT[deckStyle]}
            </button>
            <span className={styles.score} title="Сессионный счёт: победы / поражения / ничьи">
              Счёт {score.w}:{score.l}
              {score.d > 0 && `·${score.d}`}
            </span>
            <StatusBadge status="info" label="ЛОКАЛЬНО" />
            <Button variant="ghost" className={styles.gameBtn} onClick={() => setState(null)}>
              Новая игра
            </Button>
          </div>
        )}
      />

      <div className={styles.board}>
        <div className={styles.opponents}>
          {state.players.slice(1).map((p, i) => {
            const idx = i + 1;
            const role =
              finished
                ? state.loser === idx
                  ? 'дурак'
                  : 'вышел'
                : idx === state.attacker
                  ? 'атакует'
                  : idx === state.defender
                    ? 'защищается'
                    : state.passed.includes(idx)
                      ? 'пас'
                      : '';
            const thinking = !finished && actor === idx;
            return (
              <GlassPanel
                key={p.id}
                className={styles.opponent}
                data-role={role || undefined}
                data-thinking={thinking || undefined}
                data-persona={p.personaId}
                style={{ '--agentBg': `url(${agentBgSrc(p.personaId)})` } as CSSProperties}
              >
                <div className={styles.opponentTop}>
                  <span className={styles.avatarWrap} data-out={p.out || undefined}>
                    <img loading="eager" decoding="async" src={agentSrc(p.personaId)} alt={p.name} className={styles.avatar} />
                  </span>
                  <span className={styles.opponentName}>{p.name}</span>
                  <span className={styles.opponentRole}>{p.out ? 'вышел' : thinking ? `${role || 'ходит'}…` : role}</span>
                </div>
                <div className={styles.opponentHand} data-seat={idx} data-zone="opponent">
                  {Array.from({ length: Math.min(p.hand.length, 10) }).map((_, k) => (
                    <img loading="eager" decoding="async"
                      key={k}
                      src={backSrc(state.trump, deckStyle)}
                      onError={artFallback(deckStyle, backSrc(state.trump, 'v1'))}
                      alt=""
                      className={styles.cardBackImg}
                      data-cardid={`ob-${idx}-${k}`}
                    />
                  ))}
                  <span className={styles.opponentCount}>{p.hand.length}</span>
                </div>
              </GlassPanel>
            );
          })}
        </div>

        <GlassPanel className={styles.tableArea} data-table>
          <i className={styles.corner} data-c="tl" aria-hidden />
          <i className={styles.corner} data-c="tr" aria-hidden />
          <i className={styles.corner} data-c="bl" aria-hidden />
          <i className={styles.corner} data-c="br" aria-hidden />
          <canvas ref={matrixRef} className={styles.matrix} aria-hidden />
          {state.table.length > 0 && (
            <span className={styles.boutChip}>
              кон {state.table.length}/
              {Math.min(state.firstBout ? 5 : 6, state.defenderCapacity)}
            </span>
          )}
          <div className={styles.discardZone} data-empty={state.discard.length === 0 || undefined}>
            <span className={styles.discardStack} data-discard aria-hidden>
              {state.discard.slice(-6).map((c, i) => (
                <img loading="eager" decoding="async"
                  key={i}
                  src={faceSrc(c, deckStyle)}
                  onError={artFallback(deckStyle, faceSrc(c, 'v1'))}
                  alt=""
                  className={styles.discardCard}
                  style={{
                    transform: `translate(-50%, -50%) translate(${JITTER[i].x}px, ${JITTER[i].y}px) rotate(${JITTER[i].r}deg)`,
                    zIndex: i,
                  }}
                />
              ))}
            </span>
            <span className={styles.discardCount}>отбой {state.discard.length}</span>
          </div>
          <div className={styles.tableMain}>
            {state.table.length === 0 && !ghosts && (
              <span className={styles.tableEmpty}>стол пуст</span>
            )}
            {ghosts && (
              <div className={styles.ghostsLayer} data-dir={ghosts.dir} data-ghosts aria-hidden>
                {ghosts.pairs.map((pair, i) => (
                  <span
                    key={i}
                    className={styles.ghostPair}
                    style={
                      {
                        animationDelay: `${(i * ghosts.jit[i].d) / animSpeed}ms`,
                        animationDuration: `${ghosts.jit[i].t / animSpeed}ms`,
                        // Разлёт вокруг реальной цели: --tx/--ty выставляет
                        // эффект по rect'ам приёмника, jit — разброс пары.
                        '--jx': `${ghosts.jit[i].jx}px`,
                        '--jy': `${ghosts.jit[i].jy}px`,
                        '--gr': `${ghosts.jit[i].gr}deg`,
                      } as CSSProperties
                    }
                  >
                    <img loading="eager" decoding="async" src={faceSrc(pair.attack, deckStyle)} onError={artFallback(deckStyle, faceSrc(pair.attack, 'v1'))} alt="" className={styles.cardImg} />
                    {pair.defense && (
                      <img loading="eager" decoding="async"
                        src={faceSrc(pair.defense, deckStyle)}
                        onError={artFallback(deckStyle, faceSrc(pair.defense, 'v1'))}
                        alt=""
                        className={`${styles.cardImg} ${styles.ghostDefense}`}
                      />
                    )}
                  </span>
                ))}
              </div>
            )}
            {state.table.length > 0 && (
              <div className={styles.pairs} data-zone="table">
                {state.table.map((pair, pos) => (
                  <div
                    key={pos}
                    className={styles.pair}
                    data-open={!pair.defense || undefined}
                    data-defendable={
                      userActs && state.phase === 'defend' && !pair.defense
                        ? legalDefenseCards(state, userIdx, pos).length > 0 || undefined
                        : undefined
                    }
                  >
                    <CardFace card={pair.attack} trump={state.trump} deckStyle={deckStyle} />
                    {pair.defense && (
                      <span className={styles.defenseCard}>
                        <CardFace card={pair.defense} trump={state.trump} deckStyle={deckStyle} />
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className={styles.deckZone}>
            <div
              className={styles.deckStack}
              data-deck
              data-empty={state.deck.length === 0 || undefined}
              data-low={(state.deck.length > 0 && state.deck.length <= 6) || undefined}
            >
              <span className={styles.trumpUnder} data-suit={state.trump}>
                <CardFace card={state.trumpCard} trump={state.trump} deckStyle={deckStyle} track={false} />
              </span>
              {state.deck.length > 1 && (
                <span className={styles.deckBacks} aria-hidden>
                  {/* Настоящая стопка: deck[0] — козырь под ней, тянем с конца.
                      Рендерим до 14 верхних — ровный срез, стопка реально тает. */}
                  {state.deck.slice(-Math.min(state.deck.length - 1, 14)).map((c, i, arr) => (
                    <img
                      loading="eager"
                      decoding="async"
                      key={cardId(c)}
                      src={backSrc(state.trump, deckStyle)}
                      onError={artFallback(deckStyle, backSrc(state.trump, 'v1'))}
                      alt=""
                      className={styles.deckBackImg}
                      data-decktop={i === arr.length - 1 || undefined}
                      style={{ transform: `translateX(-50%) translateY(${(arr.length - 1 - i) * -1.5}px)` }}
                    />
                  ))}
                </span>
              )}
              {state.deck.length > 0 && (
                <span className={styles.deckCount}>{state.deck.length}</span>
              )}
            </div>
            <span className={styles.deckMeta}>
              {state.deck.length > 0 ? 'колода' : 'колода пуста'}
            </span>
            <span className={styles.trumpMeta} data-suit={state.trump}>
              козырь {SUIT_GLYPH[state.trump]}
            </span>
          </div>
          {choice && (
            <div className={styles.choicePop} role="dialog" aria-label="Выбор действия">
              <span className={styles.choiceText}>
                {rankLabel(choice.card.rank)}
                {SUIT_GLYPH[choice.card.suit]} — побить атаку или перевести кон?
              </span>
              <div className={styles.choiceBtns}>
                <Button
                  variant="primary"
                  className={styles.gameBtn}
                  onClick={() => {
                    setState(defend(state, userIdx, choice.pos, choice.card));
                    setChoice(null);
                  }}
                >
                  Побить
                </Button>
                <Button
                  variant="ghost"
                  className={styles.gameBtn}
                  onClick={() => {
                    setState(transfer(state, userIdx, choice.card));
                    setChoice(null);
                  }}
                >
                  Перевести
                </Button>
                <button
                  type="button"
                  className={styles.choiceCancel}
                  aria-label="Отмена"
                  onClick={() => setChoice(null)}
                >
                  ✕
                </button>
              </div>
            </div>
          )}
        </GlassPanel>

        <div className={styles.bottomRow} data-finished={finished || undefined}>
          {!finished && (
            <GlassPanel className={styles.handArea} data-active={userActs || undefined}>
              <div className={styles.handTop}>
                <span className={styles.you}>
                  Вы{state.defender === userIdx ? ' · защищаетесь' : state.attacker === userIdx ? ' · атакуете' : ''}
                </span>
                {userActs && <StatusBadge status="syncing" label="ВАШ ХОД" />}
                <span className={styles.handCount}>{hand.length} карт</span>
              </div>
              <div
                className={styles.hand}
                data-zone="hand"
                ref={handRef}
                role="group"
                aria-label="Ваша рука — обзор карт стрелками влево/вправо, Enter играет выделенную"
                onKeyDown={onHandKey}
              >
                {hand.map((c, i) => {
                  const usable =
                    userActs &&
                    (userAttackCards.some((x) => cardId(x) === cardId(c)) ||
                      userTransferCards.some((x) => cardId(x) === cardId(c)) ||
                      (state.phase === 'defend' &&
                        openTargets.some((pos) =>
                          legalDefenseCards(state, userIdx, pos).some(
                            (x) => cardId(x) === cardId(c),
                          ),
                        )));
                  return (
                    <CardFace
                      key={cardId(c)}
                      card={c}
                      trump={state.trump}
                      deckStyle={deckStyle}
                      usable={usable}
                      handIdx={i}
                      ariaDisabled={!(userActs && usable)}
                      tabIndex={i === handFocus ? 0 : -1}
                      onClick={userActs && usable ? () => onHandClick(c) : undefined}
                    />
                  );
                })}
              </div>
              <div className={styles.actions}>
                {/* Защитник может взять в любой момент кона — и пока думает
                    над покрытием (defend), и когда бросающие добавляют
                    (throwin): кнопка не привязана к очереди userActs. */}
                {userTakes && (
                  <Button variant="ghost" className={styles.gameBtn} onClick={() => setState(take(state, userIdx))}>
                    Взять
                  </Button>
                )}
                {userCanThrowIn && (
                  <Button
                    variant="primary"
                    className={styles.gameBtn}
                    onClick={() => {
                      const next = passThrowIn(state, userIdx);
                      if (next) setState(next);
                    }}
                  >
                    {/* Кон заканчивается, когда спасовали все крайние —
                        у не-атакующего это честный «пас», не «бито». */}
                    {state.attacker === userIdx ? 'Бито' : 'Пас'}
                  </Button>
                )}
              </div>
              {state.phase === 'defend' && actor === userIdx && openTargets.length > 0 && (
                <p className={styles.hint}>
                  Клик по золотой карте — она покроет открытую атаку. Карта того же ранга — переведёт
                  кон дальше.
                </p>
              )}
              {userActs && state.phase === 'throwin' && (
                <p className={styles.hint}>
                  Клик по золотой карте — подкидка в кон. «Бито» — завершить кон.
                </p>
              )}
              {userTakes && state.phase === 'throwin' && (
                <p className={styles.hint}>
                  Бросающие могут добавить ещё — «Взять» доступно в любой момент кона.
                </p>
              )}
              {userActs && state.phase === 'attack' && (
                <p className={styles.hint}>Клик по карте — атака. Золотые — доступные ходы.</p>
              )}
            </GlassPanel>
          )}
          <aside className={styles.log}>
            <h2 className={styles.logTitle}>Ход игры</h2>
            <ol className={styles.logList} ref={logRef} tabIndex={0} aria-label="Журнал партии — прокрутка стрелками">
              {state.log.map((entry, i) => (
                <li key={i} data-fresh={i === state.log.length - 1 || undefined}>{entry}</li>
              ))}
            </ol>
          </aside>
        </div>
      </div>

      {finished && !resultDismissed && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-label="Результат партии">
          <GlassPanel className={styles.resultModal}>
            <button
              type="button"
              className={styles.modalClose}
              aria-label="Закрыть"
              onClick={() => setResultDismissed(true)}
            >
              ✕
            </button>
            <h2 className={styles.heading}>
              {state.draw
                ? 'Ничья'
                : state.loser === userIdx
                  ? 'Вы — дурак'
                  : `${state.players[state.loser ?? 0]?.name} — дурак`}
            </h2>
            <div className={styles.standings}>
              {state.players.map((p, i) => (
                <span
                  key={p.id}
                  className={styles.standing}
                  data-loser={!state.draw && state.loser === i ? true : undefined}
                >
                  {p.personaId !== 'nexus' && (
                    <img loading="eager" decoding="async" src={agentSrc(p.personaId)} alt="" className={styles.standingAvatar} />
                  )}
                  {p.name} — {state.draw ? 'вышел' : state.loser === i ? 'дурак' : 'вышел'}
                </span>
              ))}
            </div>
            <p className={styles.subtitle}>
              {state.draw ? 'Все вышли в последнем коне' : 'Партия завершена'} · seed {state.seed}
            </p>
            <Button variant="primary" className={styles.gameBtn} onClick={() => setState(null)}>
              Новая игра
            </Button>
          </GlassPanel>
        </div>
      )}
    </div>
  );
}
