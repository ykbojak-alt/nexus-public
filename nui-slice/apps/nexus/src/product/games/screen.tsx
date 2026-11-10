'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  PERSONAS,
  type UnrealSceneHostState,
  type UnrealSceneStatus,
} from '@nexus/mock-data';
import {
  Button,
  EmptyState,
  ErrorState,
  GlassPanel,
  PanelHeader,
  StatusBadge,
  type NexusStatus,
} from '@nexus/ui';
import { getDataSource, useDataSource } from '../data-source';
import { DIFFICULTY_LABEL, type Difficulty } from '../chess/ai';
import { SOLS_MODE_LABEL, type SolsMode } from '../oracle/engine';
import { SOLS_SECTION_LABEL, type SolsSection } from '../oracle/cards';
import { useReducedMotion } from '../use-reduced-motion';
import styles from './games.module.css';

const ASSET_BASE =
  typeof document !== 'undefined' &&
    document.querySelector('script[src*="/_nexus/"], link[href*="/_nexus/"]')
    ? '/_nexus'
    : '';

interface GameDef {
  href: string;
  title: string;
  desc: string;
  art: string;
  artAlt: string;
  tag: string;
  /** available — playable route exists; soon — honest placeholder, no link. */
  status: 'available' | 'soon';
  /** У игры есть scene-payload для UE-моста (scene-snapshot.ts) — только
   *  такие карточки показывают статус сцены, остальные его не выдумывают. */
  scene?: boolean;
  meta: readonly string[];
  keys: {
    score?: string;
    seed?: string;
    result?: string;
  };
}

const GAMES: readonly GameDef[] = [
  {
    href: '/durak',
    title: 'Дурак · Переводной',
    desc: 'Классический переводной дурак на 36 картах против персон NEXUS: подкидки и переводы, козырь, атака и защита. Детерминированный seed-реплей каждой раздачи, регулятор темпа и анимированный стол в духе кристаллических гравюр. Счёт ведётся локально — без сети и серверов.',
    art: `${ASSET_BASE}/durak/game-catalog-cover.mp4`,
    artAlt: 'Туз треф в кристаллическом оформлении',
    tag: 'карточная',
    status: 'available',
    scene: true,
    meta: ['2–4 игрока', '36 карт', 'seed-реплей', 'регулятор темпа'],
    keys: { score: 'nexus.durak.score', seed: 'nexus.durak.lastSeed' },
  },
  {
    href: '/chess',
    title: 'Шахматы',
    desc: 'Шахматы с полным набором правил FIDE: рокировка, взятие на проходе, превращение с выбором фигуры, ничья по повторению и правилу 50 ходов. Откат хода и подсказка, ARIA-доступная доска. Локальный AI-соперник и seed-реплей партии.',
    art: `${ASSET_BASE}/chess/game-catalog-cover.mp4`,
    artAlt: 'Шахматная доска и партия',
    tag: 'стратегия',
    status: 'available',
    scene: true,
    meta: ['1 игрок vs AI', 'полные правила', 'откат и подсказка', 'ARIA-доска'],
    keys: { seed: 'nexus.chess.lastSeed', result: 'nexus.chess.lastResult' },
  },
  {
    href: '/oracle',
    title: 'Song of Light and Shadow',
    desc: 'Метафорическая колода Myth-technologies: 64 карты Света, Тени и Знания с авторскими гравюрами. Три расклада — карта дня, триада и перекрёстный — плюс журнал сессий. Каждая карта несёт вопрос для рефлексии, результат расклада сохраняется локально.',
    art: `${ASSET_BASE}/sols/game-catalog-cover.mp4`,
    artAlt: 'Карта Солнце',
    tag: 'оракул',
    status: 'available',
    meta: ['64 карты', '3 расклада', 'карта дня', 'журнал сессий'],
    keys: {},
  },
  {
    href: '/games/nes',
    title: 'NES · эмулятор',
    desc: 'Встроенный эмулятор NES в браузере на jsnes (MIT): загрузка .nes, клавиатура и геймпад, сохранение состояния в любой момент. Только легальные homebrew-ROM с открытыми лицензиями — каталог с описаниями и прямыми ссылками на авторов.',
    art: `${ASSET_BASE}/nes/game-catalog-cover.mp4`,
    artAlt: 'Пиксельная консоль NES',
    tag: 'эмулятор',
    status: 'available',
    meta: ['клавиатура', 'save-state', 'jsnes · MIT', 'homebrew ROM'],
    keys: {},
  },
  {
    href: '/games/machina',
    title: 'MACHINA',
    desc: 'Третьеличный 3D экшен-платформер: камера за спиной героини, прыжки между техно-платформами, рывок с неуязвимостью, парри, заряженный выстрел и босс с фазами. В бою помогает анимированный голографический тигр. Модель героини пока временная.',
    art: `${ASSET_BASE}/games/machina/game-catalog-preview.mp4`,
    artAlt: 'Героиня MACHINA и голографический тигр на платформе в руинах ночного города',
    tag: 'экшен',
    status: 'available',
    meta: ['3D-камера за спиной', 'рывок · парри · заряд', 'мехи с анимациями', 'тигр-компаньон + босс'],
    keys: {},
  },
  {
    href: '/games/genesis',
    title: 'GENESIS',
    desc: 'Третьеличный хоррор на борту станции «ГЕНЕЗИС»: процедурные коридоры в стиле Ishimura, 9 стволов, монстры с расчленёнкой, главы с целями, босс и сюжет. Главная героиня — MECH. Всё генерируется из seed — детерминированные уровни.',
    art: `${ASSET_BASE}/genesis/game-catalog-cover.mp4`,
    artAlt: 'Коридор станции «ГЕНЕЗИС»',
    tag: 'хоррор',
    status: 'available',
    meta: ['9 стволов', '5 типов монстров', 'процедурные уровни', '4 главы + босс'],
    keys: {},
  },
] as const;

interface Persisted {
  score?: string;
  seed?: number;
  result?: string;
}

const RESULT_LABEL: Record<string, string> = {
  w: 'победа',
  l: 'поражение',
  d: 'ничья',
};

/** Статус UE-моста — verbatim словарь хоста (UnrealSceneStatus), лейблы
 *  только локализованные, без выдуманных «партий в сети». */
const SCENE_STATUS: Record<UnrealSceneStatus, { badge: NexusStatus; label: string }> = {
  'not-installed': { badge: 'info', label: 'НЕ УСТАНОВЛЕНА' },
  starting: { badge: 'thinking', label: 'ЗАПУСКАЕТСЯ' },
  connected: { badge: 'active', label: 'ПОДКЛЮЧЕНА' },
  stale: { badge: 'paused', label: 'УСТАРЕЛА' },
  disconnected: { badge: 'offline', label: 'ОТКЛЮЧЕНА' },
  error: { badge: 'error', label: 'ОШИБКА' },
  unknown: { badge: 'warning', label: 'НЕИЗВЕСТНО' },
};

type SceneQuery =
  | { state: 'absent' }
  | { state: 'loading' }
  | { state: 'ready'; host: UnrealSceneHostState }
  | { state: 'error'; reason: string };

/* ---- Панель запуска (порт принятой реализации) ---- */

const LAUNCH_BG: Record<string, string> = {
  '/durak': '/durak/Background.png',
  '/chess': '/chess/Background.png',
  '/oracle': '/sols/Background.png',
  '/games/nes': '/nes/Background.png',
  '/games/genesis': '/genesis/Background.png',
  '/games/machina': '/games/machina/Background.png',
};

const DECK_STYLES = ['v1', 'v2', 'v3', 'v4', 'v5'] as const;
type DeckStyle = (typeof DECK_STYLES)[number];
const DECK_STYLE_LABEL: Record<DeckStyle, string> = {
  v1: 'Золотое Таро · живопись',
  v2: 'Неоновый CGI · кинематограф',
  v3: 'Холодная сталь · стиль III',
  v4: 'Северное сияние · стиль IV',
  v5: 'NOIR · тушь и свет',
};

const OPPONENTS = PERSONAS.filter((p) => p.id !== 'nexus');
const DIFFICULTIES = Object.keys(DIFFICULTY_LABEL) as Difficulty[];

// Тот же порядок раскладов, что в oracle/screen.tsx (руководство: простые → глубже).
const ORACLE_MODES: SolsMode[] = [
  'daily', 'note', 'mirror', 'voices', 'space', 'flow', 'crossroad', 'path', 'choice', 'song',
];
const ORACLE_SPACES = Object.keys(SOLS_SECTION_LABEL) as SolsSection[];

const CONFIG_GAMES = ['/durak', '/chess', '/oracle'] as const;

const SETUP_COPY: Record<string, { kicker: string; title: string; desc: string }> = {
  '/durak': {
    kicker: 'DURAK // MATCH CONFIG',
    title: 'Новая партия Дурак',
    desc: 'Настройте партию и начинайте сразу — движок игры остаётся прежним.',
  },
  '/chess': {
    kicker: 'CHESS // MATCH CONFIG',
    title: 'Новая партия · Шахматы',
    desc: 'Соперник, сложность и seed — доска открывается сразу готовой партией.',
  },
  '/oracle': {
    kicker: 'ORACLE // SPREAD CONFIG',
    title: 'Новый расклад · Оракул',
    desc: 'Расклад и пространство — карты тянутся сразу на столе оракула.',
  },
};

const randSeed = () => Math.floor(1e6 * Math.random());

const BARS = Array.from({ length: 42 }, (_, i) =>
  Math.round(26 + (0.34 * Math.sin(0.72 * i) + 0.26 * Math.sin(0.27 * i + 1.3) + 0.6) * 52),
);

const pad6 = (n: number) => String(Math.max(0, Math.floor(n))).padStart(6, '0');

const readStored = (key: string): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

function SignalBars({ label }: { label: string }) {
  return (
    <div className={styles.durakBars} aria-hidden="true">
      <span className={styles.durakBarsLabel}>{label}</span>
      <span className={styles.durakBarsWave}>
        {BARS.map((h, i) => (
          <span key={i} className={styles.durakBar} style={{ ['--bar' as string]: `${h}%` }} />
        ))}
      </span>
    </div>
  );
}

function SeedField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (seed: number) => void;
}) {
  return (
    <div className={styles.durakField}>
      <div className={styles.durakFieldHead}>
        <span className={styles.durakSetupLabel}>{label}</span>
        <button
          type="button"
          className={styles.durakRandom}
          aria-label="Случайный seed"
          onClick={() => onChange(randSeed())}
        >
          ⟳ RANDOM
        </button>
      </div>
      <div className={styles.durakFieldShell}>
        <span className={styles.durakFieldIcon} aria-hidden="true">#</span>
        <input
          type="number"
          className={styles.durakSeed}
          min={0}
          max={Number.MAX_SAFE_INTEGER}
          value={value}
          onChange={(e) => onChange(Math.floor(Number(e.target.value)))}
        />
      </div>
    </div>
  );
}

interface ComboOption {
  value: string;
  text: string;
}

function FieldCombobox({
  label,
  glyph,
  hint,
  listId,
  value,
  options,
  onChange,
}: {
  label: string;
  glyph: string;
  hint?: string;
  listId: string;
  value: string;
  options: readonly ComboOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  const openList = useCallback(() => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }, [options, value]);

  const close = useCallback((focus = false) => {
    setOpen(false);
    if (focus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, close]);

  const pick = (i: number) => {
    const opt = options[i];
    if (opt) onChange(opt.value);
    close(true);
  };

  const onTriggerKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === 'Tab' && open) {
      close();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        openList();
        return;
      }
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a + d + options.length) % options.length);
      return;
    }
    if (e.key === 'Home' && open) {
      e.preventDefault();
      setActive(0);
      return;
    }
    if (e.key === 'End' && open) {
      e.preventDefault();
      setActive(options.length - 1);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (open) pick(active);
      else openList();
    }
  };

  const activeId = `${listId}-${options[active]?.value ?? ''}`;
  return (
    <div className={styles.durakField} ref={rootRef}>
      <div className={styles.durakFieldHead}>
        <span className={styles.durakSetupLabel}>{label}</span>
        {hint != null && <span className={styles.durakFieldHint}>{hint}</span>}
      </div>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? activeId : undefined}
        className={`${styles.durakFieldShell} ${styles.durakDeckTrigger}`}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onTriggerKey}
      >
        <span className={styles.durakFieldIcon} aria-hidden="true">{glyph}</span>
        <span className={styles.durakDeckOptionText}>{current?.text}</span>
      </button>
      {open && (
        <ul className={styles.durakDeckList} id={listId} role="listbox" aria-label={label}>
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${o.value}`}
              role="option"
              aria-selected={o.value === value}
              data-active={i === active || undefined}
              className={styles.durakDeckOption}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(i)}
            >
              <span className={styles.durakDeckOptionMark} aria-hidden="true">
                {o.value === value ? '▸' : '·'}
              </span>
              <span className={styles.durakDeckOptionText}>{o.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function GamesScreen() {
  const router = useRouter();
  const reduced = useReducedMotion();
  const [persist, setPersist] = useState<Record<string, Persisted>>({});
  const ds = useDataSource();
  const [sceneQ, setSceneQ] = useState<SceneQuery>({ state: 'loading' });
  const [sceneRetry, setSceneRetry] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [panelFocusTick, setPanelFocusTick] = useState(0);
  const tileRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tileBoxRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const panelRef = useRef<HTMLElement | null>(null);
  const panelTitleRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Настройки панелей — persist-инициализация с SSR-гардом (конвенция durak).
  const [durakOpponents, setDurakOpponents] = useState<string[]>(['alice', 'mech', 'forge']);
  const [durakSeed, setDurakSeed] = useState<number>(() => randSeed());
  const [durakDeck, setDurakDeck] = useState<DeckStyle>(() =>
    (DECK_STYLES as readonly string[]).includes(readStored('nexus.durak.deckStyle') ?? '')
      ? (readStored('nexus.durak.deckStyle') as DeckStyle)
      : 'v1',
  );
  const [chessOpponent, setChessOpponent] = useState<string>(() => {
    const v = readStored('nexus.chess.opponent');
    return OPPONENTS.some((p) => p.id === v) ? (v as string) : 'alice';
  });
  const [chessSeed, setChessSeed] = useState<number>(() => randSeed());
  const [chessDifficulty, setChessDifficulty] = useState<Difficulty>(() => {
    const v = readStored('nexus.chess.difficulty');
    return DIFFICULTIES.includes(v as Difficulty) ? (v as Difficulty) : 'easy';
  });
  const [oracleMode, setOracleMode] = useState<SolsMode>(() => {
    const v = readStored('nexus.oracle.mode');
    return ORACLE_MODES.includes(v as SolsMode) ? (v as SolsMode) : 'voices';
  });
  const [oracleSpace, setOracleSpace] = useState<SolsSection>(() => {
    const v = readStored('nexus.oracle.space');
    return ORACLE_SPACES.includes(v as SolsSection) ? (v as SolsSection) : 'light';
  });
  const [oracleSeed, setOracleSeed] = useState<number>(() => randSeed());

  useEffect(() => {
    const seam = ds.unrealScene;
    if (seam == null) {
      setSceneQ({ state: 'absent' });
      return;
    }
    let alive = true;
    setSceneQ({ state: 'loading' });
    seam.getState().then(
      (host) => { if (alive) setSceneQ({ state: 'ready', host }); },
      (e) => {
        if (alive) setSceneQ({ state: 'error', reason: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => { alive = false; };
  }, [ds, sceneRetry]);

  useEffect(() => {
    const out: Record<string, Persisted> = {};
    for (const g of GAMES) {
      const p: Persisted = {};
      if (g.keys.score) {
        try {
          const s = JSON.parse(window.localStorage.getItem(g.keys.score) ?? 'null');
          if (s && (s.w || s.l || s.d)) {
            p.score = `Счёт ${s.w}:${s.l}${s.d ? `·${s.d}` : ''}`;
          }
        } catch {
          /* повреждённая запись — молча пропускаем */
        }
      }
      if (g.keys.seed) {
        const n = Number(window.localStorage.getItem(g.keys.seed));
        if (n > 0) p.seed = n;
      }
      if (g.keys.result) {
        const r = window.localStorage.getItem(g.keys.result);
        if (r && RESULT_LABEL[r]) p.result = `последняя — ${RESULT_LABEL[r]}`;
      }
      if (p.score || p.seed || p.result) out[g.href] = p;
    }
    setPersist(out);
  }, []);

  // Резюм превью-видео при возврате на вкладку (принятый эффект бандла).
  useEffect(() => {
    const videos = Array.from(
      listRef.current?.querySelectorAll<HTMLVideoElement>('[data-motion-preview]') ?? [],
    );
    if (videos.length === 0) return;
    const kick = (v: HTMLVideoElement) => {
      if (document.visibilityState !== 'visible' || !v.paused) return;
      v.muted = true;
      const p = v.play();
      if (p) p.catch(() => {});
    };
    const tick = () => videos.forEach(kick);
    document.addEventListener('visibilitychange', tick);
    const iv = window.setInterval(tick, 1000);
    tick();
    return () => {
      document.removeEventListener('visibilitychange', tick);
      window.clearInterval(iv);
    };
  }, [selected == null]);

  // Фокус: при открытии панели — в её заголовок, при закрытии — назад на плитку.
  useEffect(() => {
    if (selected != null && panelFocusTick > 0) {
      panelTitleRef.current?.focus();
    }
  }, [selected, panelFocusTick]);

  // Десктоп-раскладка (≥1024px): панель синхронизирует высоту с выбранной
  // плиткой — строка грида не прыгает при открытии. ResizeObserver следит
  // за ростом плитки (persist-секция, метрики), rAF — за первым кадром.
  useEffect(() => {
    if (selected == null) return;
    const tile = tileBoxRefs.current[selected];
    const panel = panelRef.current;
    if (tile == null || panel == null) return;
    const mq = typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 1024px)')
      : null;
    const sync = () => {
      if (mq != null && !mq.matches) {
        panel.style.removeProperty('height');
        return;
      }
      panel.style.height = `${tile.offsetHeight}px`;
    };
    const raf = () => requestAnimationFrame(sync);
    raf();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(raf) : null;
    ro?.observe(tile);
    mq?.addEventListener('change', raf);
    return () => {
      ro?.disconnect();
      mq?.removeEventListener('change', raf);
      panel.style.removeProperty('height');
    };
  }, [selected]);

  const openPanel = (href: string) => {
    setSelected(href);
    setPanelFocusTick((n) => n + 1);
  };
  const closePanel = (href: string | null) => {
    setSelected(null);
    if (href != null) tileRefs.current[href]?.focus();
  };

  const selectedGame = GAMES.find((g) => g.href === selected) ?? null;
  const setupCopy = selectedGame ? SETUP_COPY[selectedGame.href] : undefined;

  const toggleOpponent = (id: string) => {
    setDurakOpponents((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < 4 ? [...cur, id] : cur,
    );
  };

  const launchUrl = (g: GameDef): string => {
    if (g.href === '/durak') {
      const opp = durakOpponents.join(',');
      return `${g.href}?start=1&opponents=${opp}&seed=${durakSeed}&deckStyle=${durakDeck}`;
    }
    if (g.href === '/chess') {
      return `${g.href}?start=1&opponent=${chessOpponent}&difficulty=${chessDifficulty}&seed=${chessSeed}`;
    }
    if (g.href === '/oracle') {
      return `${g.href}?start=1&mode=${oracleMode}&space=${oracleSpace}&seed=${oracleSeed}`;
    }
    return g.href;
  };

  const durakValid = durakOpponents.length > 0 && Number.isSafeInteger(durakSeed) && durakSeed >= 0;
  const chessValid = Number.isSafeInteger(chessSeed) && chessSeed >= 0;
  const oracleValid = Number.isSafeInteger(oracleSeed) && oracleSeed >= 0;

  const renderSetup = (g: GameDef) => {
    if (g.href === '/durak') {
      return (
        <>
          <fieldset className={styles.durakSetupFieldset}>
            <legend className={styles.durakSetupLabel}>Противники (1–4)</legend>
            <div className={styles.durakOpponentList} role="group" aria-label="Противники">
              {OPPONENTS.map((p, i) => {
                const inParty = durakOpponents.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={styles.durakOpponent}
                    data-c={i % 6}
                    aria-pressed={inParty}
                    onClick={() => toggleOpponent(p.id)}
                  >
                    <img
                      className={styles.durakOpponentAvatar}
                      src={`${ASSET_BASE}/art/agent-${p.id}.webp`}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                    <span className={styles.durakOpponentName}>{p.name}</span>
                    <span className={styles.durakOpponentRail} aria-hidden="true" />
                    <span className={styles.durakOpponentState}>
                      {inParty ? 'В партии' : 'Свободен'}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className={styles.durakFields}>
            <SeedField label="Seed партии" value={durakSeed} onChange={setDurakSeed} />
            <FieldCombobox
              label="Стиль колоды"
              glyph="♦"
              hint="DECK"
              listId="deck-style-list"
              value={durakDeck}
              options={DECK_STYLES.map((d) => ({ value: d, text: DECK_STYLE_LABEL[d] }))}
              onChange={(v) => setDurakDeck(v as DeckStyle)}
            />
          </div>
          <SignalBars label="DECK SIGNAL // STANDBY" />
        </>
      );
    }
    if (g.href === '/chess') {
      return (
        <>
          <fieldset className={styles.durakSetupFieldset}>
            <legend className={styles.durakSetupLabel}>Соперник</legend>
            <div
              className={`${styles.durakOpponentList} ${styles.setupRosterCompact}`}
              role="group"
              aria-label="Соперник"
            >
              {OPPONENTS.map((p, i) => {
                const atBoard = chessOpponent === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={styles.durakOpponent}
                    data-c={i % 6}
                    aria-pressed={atBoard}
                    onClick={() => setChessOpponent(p.id)}
                  >
                    <img
                      className={styles.durakOpponentAvatar}
                      src={`${ASSET_BASE}/art/agent-${p.id}.webp`}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                    <span className={styles.durakOpponentName}>{p.name}</span>
                    <span className={styles.durakOpponentRail} aria-hidden="true" />
                    <span className={styles.durakOpponentState}>
                      {atBoard ? 'За доской' : 'Свободен'}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className={styles.durakFields}>
            <SeedField label="Seed партии" value={chessSeed} onChange={setChessSeed} />
            <div className={styles.durakField}>
              <div className={styles.durakFieldHead}>
                <span className={styles.durakSetupLabel}>Сложность</span>
              </div>
              <div className={styles.setupChips} role="group" aria-label="Сложность">
                {DIFFICULTIES.map((d, i) => (
                  <button
                    key={d}
                    type="button"
                    className={styles.setupChip}
                    data-c={i % 6}
                    aria-pressed={chessDifficulty === d}
                    onClick={() => setChessDifficulty(d)}
                  >
                    {DIFFICULTY_LABEL[d]}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <SignalBars label="BOARD ENGINE // READY" />
        </>
      );
    }
    if (g.href === '/oracle') {
      return (
        <>
          <div className={styles.durakFields}>
            <FieldCombobox
              label="Расклад"
              glyph="☾"
              hint="SPREAD"
              listId="oracle-mode-list"
              value={oracleMode}
              options={ORACLE_MODES.map((m) => ({ value: m, text: SOLS_MODE_LABEL[m] }))}
              onChange={(v) => setOracleMode(v as SolsMode)}
            />
            <div className={styles.durakField}>
              <div className={styles.durakFieldHead}>
                <span className={styles.durakSetupLabel}>Пространство</span>
              </div>
              <div className={styles.setupChips} role="group" aria-label="Пространство">
                {ORACLE_SPACES.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    className={styles.setupChip}
                    data-c={i % 6}
                    aria-pressed={oracleSpace === s}
                    onClick={() => setOracleSpace(s)}
                  >
                    {SOLS_SECTION_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
            <SeedField label="Seed расклада" value={oracleSeed} onChange={setOracleSeed} />
          </div>
          <SignalBars label="DECK SIGNAL // STANDBY" />
        </>
      );
    }
    return <SignalBars label="LAUNCH BAY // READY" />;
  };

  const footerNote = (g: GameDef): string => {
    if (g.href === '/durak') return `SEED ${pad6(durakSeed)} · ПРОТИВНИКИ ${durakOpponents.length}/4`;
    if (g.href === '/chess') {
      const name = OPPONENTS.find((p) => p.id === chessOpponent)?.name ?? chessOpponent;
      return `SEED ${pad6(chessSeed)} · ${name} · ${DIFFICULTY_LABEL[chessDifficulty]}`;
    }
    if (g.href === '/oracle') {
      return `${SOLS_MODE_LABEL[oracleMode]} · ${SOLS_SECTION_LABEL[oracleSpace]} · SEED ${pad6(oracleSeed)}`;
    }
    return 'ENGINE // LOCAL';
  };

  const launchLabel = (g: GameDef): string => {
    if (g.href === '/oracle') return 'Тянуть карты';
    if (g.href === '/durak' || g.href === '/chess') return 'Начать партию';
    return 'Играть →';
  };

  const launchDisabled = (g: GameDef): boolean => {
    if (g.href === '/durak') return !durakValid;
    if (g.href === '/chess') return !chessValid;
    if (g.href === '/oracle') return !oracleValid;
    return false;
  };

  return (
    <div className={styles.page} data-screen="games" data-state="ready" aria-labelledby={selected == null ? 'games-title' : undefined}>
      {selected == null && (
        <PanelHeader
          level="screen"
          divider={false}
          titleId="games-title"
          title="Игры"
          subtitle="Локальные партии с персонами NEXUS — детерминированно, без сети."
          actions={(
            <span className={styles.headerBadges}>
              <StatusBadge status="info" label="ЛОКАЛЬНО" />
              {sceneQ.state === 'ready' && (
                <StatusBadge
                  status={SCENE_STATUS[sceneQ.host.status]?.badge ?? 'warning'}
                  label={`СЦЕНА ${SCENE_STATUS[sceneQ.host.status]?.label ?? 'НЕИЗВЕСТНО'}`}
                  data-testid="games-scene-badge"
                />
              )}
              {sceneQ.state === 'ready' && sceneQ.host.source === 'mock' && (
                <StatusBadge status="info" label="MOCK" data-testid="games-scene-demo" />
              )}
            </span>
          )}
        />
      )}

      {sceneQ.state === 'ready' && sceneQ.host.reason != null && (
        <p className={styles.sceneNote} data-testid="games-scene-note">{sceneQ.host.reason}</p>
      )}
      {sceneQ.state === 'error' && (
        <ErrorState
          variant="inline"
          title="Состояние 3D-сцены недоступно"
          body={sceneQ.reason}
          onRetry={() => setSceneRetry((n) => n + 1)}
        />
      )}

      {GAMES.length === 0 ? (
        <EmptyState
          title="Игры не зарегистрированы"
          body="Реестр сцен пуст — локальные партии появятся здесь."
          reason="в реестре нет ни одной сцены"
        />
      ) : (
      <div
        className={styles.selectionLayout}
        data-durak-selection={selected != null ? 'active' : 'idle'}
        onKeyDown={(e: ReactKeyboardEvent<HTMLElement>) => {
          if (e.key === 'Escape' && selected != null) {
            e.preventDefault();
            closePanel(selected);
            return;
          }
          const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
          const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
          if (!fwd && !back && e.key !== 'Home' && e.key !== 'End') return;
          const tiles = Array.from(
            e.currentTarget.querySelectorAll<HTMLElement>(`a.${styles.tileMain}, button.${styles.tileMain}`),
          ).filter((el) => el.closest('[aria-hidden="true"]') == null);
          if (tiles.length === 0) return;
          e.preventDefault();
          const cur = tiles.indexOf(document.activeElement as HTMLElement);
          const next = e.key === 'Home' ? 0
            : e.key === 'End' ? tiles.length - 1
              : cur < 0 ? (fwd ? 0 : tiles.length - 1)
                : (cur + (fwd ? 1 : -1) + tiles.length) % tiles.length;
          tiles[next].focus();
        }}
      >
        <div className={styles.list} role="list" aria-label="Игры" ref={listRef}>
          {GAMES.map((g) => {
            const p = persist[g.href];
            const isSelected = selected === g.href;
            const hidden = selected != null && !isSelected;
            const card = g.art.endsWith('.mp4') ? (
              <GlassPanel className={styles.tileMedia}>
                <video
                  src={g.art}
                  poster={g.art.replace('.mp4', '.jpg')}
                  aria-label={g.artAlt}
                  className={styles.tileMediaVideo}
                  data-motion-preview
                  preload={reduced ? 'none' : 'auto'}
                  loop
                  muted
                  playsInline
                  onError={(e) => {
                    const t = e.currentTarget;
                    if (!t.dataset.fbk) {
                      t.dataset.fbk = '1';
                      t.poster = '';
                      t.src = g.art.replace('.mp4', '.jpg');
                    }
                  }}
                />
                <span className={styles.tileMediaOverlay}>
                  <span className={styles.tileTitle}>{g.title}</span>
                  <span className={styles.tileMeta}>
                    {g.meta.map((m, i) => (
                      <span key={m} data-c={i % 6} className={styles.tileMetaChip}>{m}</span>
                    ))}
                    {g.scene === true && sceneQ.state === 'ready' && (
                      <span className={styles.tileMetaChip} data-testid={`scene-chip-${g.href}`}>
                        {`сцена · ${(SCENE_STATUS[sceneQ.host.status]?.label ?? 'НЕИЗВЕСТНО').toLowerCase()}`}
                      </span>
                    )}
                  </span>
                  <span className={styles.tileFoot}>
                    <span className={`${styles.tileStatus} ${g.status === 'available' ? styles.tileStatusOk : styles.tileStatusSoon}`}>
                      {g.status === 'available' ? 'ON' : 'СКОРО'}
                    </span>
                  </span>
                </span>
              </GlassPanel>
            ) : (
              <GlassPanel className={styles.tileInner}>
                <span className={styles.tileArt}>
                  <img loading="lazy" decoding="async" src={g.art} alt={g.artAlt} className={styles.tileImg} />
                </span>
                <span className={styles.tileBody}>
                  <span className={styles.tileTitle}>{g.title}</span>
                  <span className={styles.tileMeta}>
                    {g.meta.map((m, i) => (
                      <span key={m} data-c={i % 6} className={styles.tileMetaChip}>{m}</span>
                    ))}
                  </span>
                  <span className={styles.tileFoot}>
                    <span className={`${styles.tileStatus} ${g.status === 'available' ? styles.tileStatusOk : styles.tileStatusSoon}`}>
                      {g.status === 'available' ? 'ON' : 'СКОРО'}
                    </span>
                  </span>
                </span>
              </GlassPanel>
            );
            return (
              <div
                key={g.href}
                ref={(el) => { tileBoxRefs.current[g.href] = el; }}
                className={`${styles.tile}${g.href === '/games/machina' ? ` ${styles.machinaTile}` : ''}`}
                role="listitem"
                data-featured={g.href === '/games/machina' || undefined}
                data-durak-card={g.href === '/durak' || undefined}
                data-selected-game={isSelected || undefined}
                aria-hidden={hidden || undefined}
                inert={hidden || undefined}
              >
                {g.status === 'available' ? (
                  <button
                    type="button"
                    ref={(el) => { tileRefs.current[g.href] = el; }}
                    className={`${styles.tileMain} ${styles.tileMainButton}`}
                    aria-expanded={isSelected}
                    aria-controls="game-launch-panel"
                    onClick={() => (isSelected ? closePanel(g.href) : openPanel(g.href))}
                  >
                    {card}
                  </button>
                ) : (
                  <div className={styles.tileMain} aria-disabled="true" data-status="soon">
                    {card}
                  </div>
                )}
                {p && !hidden && (
                  <div className={styles.tilePersist}>
                    {p.score && <span className={styles.tileScore}>{p.score}</span>}
                    {p.result && <span className={styles.tileResult}>{p.result}</span>}
                    {p.seed && (
                      <Link href={`${g.href}?seed=${p.seed}`} className={styles.tileReplay}>
                        Реплей · seed {p.seed}
                      </Link>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {selectedGame != null && (
          <section
            ref={panelRef}
            id="game-launch-panel"
            role="region"
            aria-labelledby="game-launch-title"
            data-testid="game-launch-panel"
            className={`${styles.durakSetup} ${styles.durakSetupPanel} ${styles.durakSetupPanelOpen}`}
            style={{ ['--durak-bg' as string]: `url(${LAUNCH_BG[selectedGame.href] ?? ''})` }}
          >
            <header className={styles.durakSetupHeader}>
              <div className={styles.durakSetupHeadText}>
                <span className={styles.durakSetupKicker}>
                  {setupCopy?.kicker ?? 'NEXUS // LAUNCH BAY'}
                </span>
                <h2
                  id="game-launch-title"
                  ref={panelTitleRef}
                  tabIndex={-1}
                  className={styles.durakSetupTitle}
                >
                  {setupCopy?.title ?? `Запуск игры${selectedGame.title ? ` · ${selectedGame.title}` : ''}`}
                </h2>
                <p className={styles.durakSetupDescription}>
                  {setupCopy?.desc ?? 'Запуск игры в её экране — движок и сохранения остаются прежними.'}
                </p>
              </div>
              <button
                type="button"
                className={styles.durakSetupClose}
                aria-label="Закрыть панель запуска"
                onClick={() => closePanel(selectedGame.href)}
              >
                <span className={styles.durakSetupCloseIcon} aria-hidden="true">✕</span>
              </button>
            </header>
            <div className={styles.durakSetupBody}>
              {renderSetup(selectedGame)}
            </div>
            <footer className={styles.durakSetupFooter}>
              <span className={styles.durakSetupFooterNote}>{footerNote(selectedGame)}</span>
              <Button
                variant="primary"
                disabled={launchDisabled(selectedGame)}
                className={styles.durakStart}
                onClick={() => router.push(launchUrl(selectedGame))}
              >
                {launchLabel(selectedGame)}
              </Button>
            </footer>
          </section>
        )}
      </div>
      )}
    </div>
  );
}
