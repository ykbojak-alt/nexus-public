'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, GlassPanel, PanelHeader, StatusBadge } from '@nexus/ui';
import {
  SOLS_MODE_LABEL,
  SPREADS,
  dailySeed,
  draw,
  type SolsDraw,
  type SolsMode,
} from './engine';
import { runWhileDocumentVisible } from '../visible-interval';
import { SOLS_SECTION_LABEL, type SolsSection } from './cards';
import styles from './oracle.module.css';

const ASSET_BASE =
  typeof document !== 'undefined' &&
    document.querySelector('script[src*="/_nexus/"], link[href*="/_nexus/"]')
    ? '/_nexus'
    : '';
const cardSrc = (n: number) => `${ASSET_BASE}/sols/cards/${String(n).padStart(2, '0')}.webp`;
const backSrc = (section: string) => `${ASSET_BASE}/sols/backs/${section}.webp`;

// Порядок режимов — как в руководстве: сначала простые, дальше глубже.
const MODES: SolsMode[] = [
  'daily', 'note', 'mirror', 'voices', 'space', 'flow', 'crossroad', 'path', 'choice', 'song',
];

/* Геометрия раскладов на круглой скатерти (референс-пакет
 * 2026-10-13-solas-oracle-pack): центр слота в точке, координаты — %.
 * Назначение следует семантике позиций из руководства, не Rider-Waite. */
const SPREAD_LAYOUT: Partial<Record<SolsMode, { x: number; y: number }[]>> = {
  note: [{ x: 50, y: 50 }],
  mirror: [{ x: 50, y: 22 }, { x: 26, y: 66 }, { x: 74, y: 66 }],
  voices: [{ x: 22, y: 56 }, { x: 50, y: 30 }, { x: 78, y: 56 }],
  flow: [{ x: 15, y: 70 }, { x: 37, y: 48 }, { x: 59, y: 60 }, { x: 82, y: 32 }],
  crossroad: [{ x: 50, y: 52 }, { x: 50, y: 16 }, { x: 50, y: 84 }, { x: 18, y: 50 }, { x: 82, y: 50 }],
  path: [{ x: 14, y: 80 }, { x: 32, y: 62 }, { x: 50, y: 50 }, { x: 68, y: 36 }, { x: 86, y: 20 }],
  choice: [{ x: 30, y: 26 }, { x: 30, y: 62 }, { x: 70, y: 26 }, { x: 70, y: 62 }, { x: 40, y: 86 }, { x: 60, y: 86 }],
  song: [{ x: 50, y: 15 }, { x: 80, y: 32 }, { x: 80, y: 70 }, { x: 50, y: 85 }, { x: 20, y: 70 }, { x: 50, y: 51 }, { x: 20, y: 32 }],
};

/* Список позиций режима — daily/space генерируют свою строку, остальные —
 * из SPREADS. Используется превью-карточкой лендинга и табом «Схема». */
function positionsFor(mode: SolsMode, space: SolsSection): string[] {
  if (mode === 'daily') return ['Карта дня'];
  if (mode === 'space') return [`Пространство ${SOLS_SECTION_LABEL[space]}`];
  return SPREADS[mode].positions;
}

/* Пул секции позиции — для окраски силуэтов мини-диаграммы ('all' → нейтрально).
 * Для space-превью силуэт тонируется выбранным пространством. */
function poolsFor(mode: SolsMode, space: SolsSection): ('all' | SolsSection)[] {
  if (mode === 'space') return [space];
  if (mode === 'daily') return ['all'];
  return SPREADS[mode].pools;
}

const pluralPositions = (n: number) =>
  n === 1 ? 'позиция' : n >= 2 && n <= 4 ? 'позиции' : 'позиций';

/** Позиции слотов: авторская геометрия по режиму; fallback — круг, 1 карта — центр. */
function layoutFor(mode: SolsMode, n: number): { x: number; y: number }[] {
  const l = SPREAD_LAYOUT[mode];
  if (l && l.length === n) return l;
  if (n === 1) return [{ x: 50, y: 50 }];
  return Array.from({ length: n }, (_, i) => ({
    x: Math.round(50 + 37 * Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / n)),
    y: Math.round(50 + 37 * Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / n)),
  }));
}

/* Подпись под слотом — короткая часть позиции до тире; полная строка
 * живёт в aria-label и в табе «Схема». */
const posShort = (p: string) => p.split('—')[0].split('·')[0].trim();

/* Журнал раскладов — честно локальный (этот браузер), без аккаунта. */
interface JournalEntry {
  ts: number;
  mode: SolsMode;
  seed: number;
  intention: string | null;
  space?: SolsSection;
  cards: number[];
}

const JOURNAL_KEY = 'nexus.sols.journal';
const JOURNAL_MAX = 24;

function loadJournal(): JournalEntry[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(JOURNAL_KEY) ?? '[]');
    return Array.isArray(v)
      ? v.filter(
        (e): e is JournalEntry =>
          !!e && typeof e.seed === 'number' && Array.isArray(e.cards) && (MODES as string[]).includes(e.mode),
      )
      : [];
  } catch {
    return [];
  }
}

type SideTab = 'read' | 'map' | 'log';
const SIDE_TABS: { id: SideTab; label: string }[] = [
  { id: 'read', label: 'Разбор' },
  { id: 'map', label: 'Схема' },
  { id: 'log', label: 'Журнал' },
];

const fmtJournalTs = (ts: number) =>
  new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/* Число позиций на режим — значок на чипе и мини-диаграмма. */
const MODE_COUNT: Record<SolsMode, number> = {
  daily: 1,
  space: 1,
  ...Object.fromEntries(Object.entries(SPREADS).map(([k, v]) => [k, v.positions.length])),
} as Record<SolsMode, number>;

const SECTIONS: SolsSection[] = ['light', 'shadow', 'gnosis'];

/* Сессионный таймер — HH:MM:SS elapsed от момента тяги/просмотра. */
const fmtElapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};

/* Скатерть — тёмный диск с тонкой золотой геометрией (референс-пакет:
   navy velvet + concentric rings + compass spokes + moon-phase обод +
   венец лепестков вокруг ядра). SVG-линии — не фото-фон: детерминированы,
   карты остаются главным слоем. Координаты в %-системе viewBox 0 0 100 100. */
function ClothArt() {
  const spoke = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return {
      x1: 50 + 15.5 * Math.cos(a),
      y1: 50 + 15.5 * Math.sin(a),
      x2: 50 + 36.5 * Math.cos(a),
      y2: 50 + 36.5 * Math.sin(a),
    };
  };
  return (
    <svg className={styles.clothSvg} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="48.4" className={styles.cgRim} />
      <circle cx="50" cy="50" r="45.8" className={styles.cgFaint} />
      {/* Лунные фазы по ободу — 16 точек, крупные на cardinal-направлениях */}
      {Array.from({ length: 16 }, (_, i) => {
        const a = (i * Math.PI) / 8 - Math.PI / 2;
        const full = i % 4 === 0;
        return (
          <circle
            key={`m${i}`}
            cx={50 + 44.2 * Math.cos(a)}
            cy={50 + 44.2 * Math.sin(a)}
            r={full ? 1.5 : 0.85}
            className={full ? styles.cgMoonFull : styles.cgMoonOpen}
          />
        );
      })}
      <circle cx="50" cy="50" r="37.5" className={styles.cgThin} />
      {[0, 45, 90, 135].map((d) => (
        <line key={`s${d}`} {...spoke(d)} className={styles.cgThin} />
      ))}
      {/* Венец лепестков вокруг ядра */}
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        return (
          <circle
            key={`p${i}`}
            cx={50 + 25 * Math.cos(a)}
            cy={50 + 25 * Math.sin(a)}
            r={12.5}
            className={styles.cgThin}
          />
        );
      })}
      <circle cx="50" cy="50" r="14" className={styles.cgThin} />
      <circle cx="50" cy="50" r="4.2" className={styles.cgCore} />
    </svg>
  );
}

export function OracleScreen() {
  const [mode, setMode] = useState<SolsMode>('voices');
  const [space, setSpace] = useState<SolsSection>('light');
  const [result, setResult] = useState<SolsDraw | null>(null);
  const [revealed, setRevealed] = useState<boolean[]>([]);
  const [intention, setIntention] = useState('');
  const [sideTab, setSideTab] = useState<SideTab>('read');
  const [drawTs, setDrawTs] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);
  // Журнал грузится после маунта — SSR-пререндер не трогает localStorage.
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  useEffect(() => { setJournal(loadJournal()); }, []);
  useEffect(() => () => {
    if (copiedTimerRef.current != null) window.clearTimeout(copiedTimerRef.current);
  }, []);

  // Launch-параметры: /oracle?mode=mirror&space=shadow&seed=N&start=1
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // ?mode — только существующие режимы (MODES); невалидное игнорируем.
    const m = params.get('mode');
    let useMode: SolsMode = mode;
    if (m != null && (MODES as string[]).includes(m)) {
      useMode = m as SolsMode;
      setMode(m as SolsMode);
    }
    // ?space — только валидные пространства (SECTIONS: light/shadow/gnosis).
    const sp = params.get('space');
    let useSpace: SolsSection = space;
    if (sp != null && (SECTIONS as string[]).includes(sp)) {
      useSpace = sp as SolsSection;
      setSpace(sp as SolsSection);
    }
    // ?seed — детерминированный расклад; ?start=1 — автозапуск (в журнал).
    const sd = Number(params.get('seed'));
    if (params.get('start') === '1') {
      const seed =
        sd > 0 ? sd : useMode === 'daily' ? dailySeed() : Math.floor(Math.random() * 1_000_000);
      record(draw(useMode, seed, useSpace));
    }
  }, []);

  // Сессионный таймер — тикает, пока на столе есть расклад.
  useEffect(() => {
    if (!result) return;
    setNow(Date.now());
    return runWhileDocumentVisible(() => setNow(Date.now()), 1000);
  }, [result]);

  // Фокус на карте — скролл к её разбору в правой колонке.
  useEffect(() => {
    if (focusIdx == null) return;
    const el = document.getElementById(`sols-read-${focusIdx}`);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, [focusIdx]);

  // Раскрытие карт — по одной, с паузой; reduced-motion — все сразу.
  useEffect(() => {
    if (!result) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setRevealed(result.cards.map(() => true));
      return;
    }
    setRevealed(result.cards.map(() => false));
    const timers = result.cards.map((_, i) =>
      window.setTimeout(
        () => setRevealed((r) => r.map((v, j) => (j === i ? true : v))),
        420 + i * 550,
      ),
    );
    return () => timers.forEach(window.clearTimeout);
  }, [result]);

  function record(r: SolsDraw) {
    setResult(r);
    setSideTab('read');
    setDrawTs(Date.now());
    setFocusIdx(null);
    setCopied(false);
    const entry: JournalEntry = {
      ts: Date.now(),
      mode: r.mode,
      seed: r.seed,
      intention: intention.trim() || null,
      space: r.space,
      cards: r.cards.map((c) => c.n),
    };
    setJournal((j) => {
      const next = [entry, ...j].slice(0, JOURNAL_MAX);
      try { window.localStorage.setItem(JOURNAL_KEY, JSON.stringify(next)); } catch { }
      return next;
    });
  }

  function pull() {
    // Тяга всегда свежая — случайный seed каждый раз.
    record(draw(mode, Math.floor(Math.random() * 1_000_000), space));
  }

  function replay(e: JournalEntry) {
    // Реплей по seed — тот же расклад; в журнал не пишется (это просмотр).
    setMode(e.mode);
    if (e.space) setSpace(e.space);
    setIntention(e.intention ?? '');
    setResult(draw(e.mode, e.seed, e.space ?? 'light'));
    setSideTab('read');
    setDrawTs(Date.now());
    setFocusIdx(null);
    setCopied(false);
  }

  function pickMode(m: SolsMode) {
    setMode(m);
    setResult(null);
    setFocusIdx(null);
    if (m === 'daily') {
      // Карта дня — детерминирована датой: одна на всех в этот день.
      record(draw('daily', dailySeed()));
    }
  }

  function pickDeck(s: SolsSection) {
    // Рубашка колоды — выбор пространства: режим «Одно пространство», секция s.
    setMode('space');
    setSpace(s);
    setResult(null);
    setFocusIdx(null);
  }

  function openCard(i: number) {
    setFocusIdx(i);
    setSideTab('read');
  }

  function copyReading() {
    if (!result) return;
    const lines = [
      `SOLAS · ${SOLS_MODE_LABEL[result.mode]} · seed ${result.seed}`,
      intention.trim() ? `Рамка: «${intention.trim()}»` : null,
      '',
      ...result.cards.flatMap((c, i) => [
        `${i + 1}. ${result.positions[i]}`,
        `   №${String(c.n).padStart(2, '0')} ${c.ru} (${c.en}) — ${SOLS_SECTION_LABEL[c.section]}`,
        `   ${c.essence}`,
        `   Ресурс: ${c.resource}`,
        `   Риск: ${c.risk}`,
        `   «${c.phrase}»`,
        `   ${c.question}`,
        '',
      ]),
    ].filter((l): l is string => l !== null);
    void navigator.clipboard?.writeText(lines.join('\n')).then(() => {
      setCopied(true);
      if (copiedTimerRef.current != null) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(() => {
        copiedTimerRef.current = null;
        setCopied(false);
      }, 1600);
    }).catch(() => { });
  }

  const activeDesc =
    mode === 'daily'
      ? 'Одна и та же карта у всех в эту дату — детерминированно по дате'
      : mode === 'space'
        ? `Одна карта из пространства ${SOLS_SECTION_LABEL[space]}`
        : SPREADS[mode].desc;

  const ready = revealed.every(Boolean) && revealed.length > 0;
  const layout = result ? layoutFor(result.mode, result.cards.length) : [];
  // Превью выбранного расклада на лендинге (до тяги).
  const previewPositions = positionsFor(mode, space);
  const previewLayout = layoutFor(mode, previewPositions.length);
  const previewPools = poolsFor(mode, space);
  const revealedCount = revealed.filter(Boolean).length;
  /* Чипы ключевых секций — реальный состав тяги, не выдуманные «метрики». */
  const tally = result
    ? SECTIONS.map((s) => [s, result.cards.filter((c) => c.section === s).length] as const)
      .filter(([, n]) => n > 0)
    : [];

  return (
    <div className={styles.page} data-screen="oracle" data-state={result ? 'ready' : 'empty'} aria-labelledby="oracle-title">
      <PanelHeader
        level="screen"
        divider={false}
        titleId="oracle-title"
        title="Song of Light and Shadow"
        subtitle={result ? `${SOLS_MODE_LABEL[result.mode]} · seed ${result.seed}` : '64 карты · Свет, Тень, Знание. Не ответы — пространство для встречи с собой.'}
        actions={<StatusBadge status="info" label="ЛОКАЛЬНО" />}
      />

      <div className={styles.main}>
        <section className={styles.stageCol}>
          <div className={styles.modes} role="group" aria-label="Расклад">
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                className={styles.modeChip}
                data-on={mode === m || undefined}
                onClick={() => pickMode(m)}
              >
                {SOLS_MODE_LABEL[m]}
                <span className={styles.modeCount}>{MODE_COUNT[m]}</span>
              </button>
            ))}
          </div>
          {mode === 'space' && !result && (
            <div className={styles.modes} role="group" aria-label="Пространство">
              {(['light', 'shadow', 'gnosis'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={styles.modeChip}
                  data-section={s}
                  data-on={space === s || undefined}
                  onClick={() => setSpace(s)}
                >
                  {SOLS_SECTION_LABEL[s]}
                </button>
              ))}
            </div>
          )}
          <p className={styles.modeDesc}>{activeDesc}</p>

          <div className={styles.stage}>
            {!result && (
              <GlassPanel className={styles.intro}>
                <div className={styles.introMain}>
                  {/* Честная рамка колоды — из референс-концепта, совпадает
                      с продуктовым правилом «рефлексия, не предсказание». */}
                  <blockquote className={styles.heroQuote}>
                    «Карты — не будущее.<br />Они — язык возможностей.»
                    <cite className={styles.heroCite}>SOLAS · пространство рефлексии</cite>
                  </blockquote>

                  {/* Рубашки — селектор пространства: клик ведёт на режим
                      «Одно пространство» с выбранной секцией. */}
                  <div className={styles.deckRow} role="group" aria-label="Колода — пространство">
                    {SECTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={styles.deckPick}
                        data-section={s}
                        data-on={(mode === 'space' && space === s) || undefined}
                        onClick={() => pickDeck(s)}
                        title={`Потянуть одну карту из пространства «${SOLS_SECTION_LABEL[s]}»`}
                      >
                        <img loading="lazy" decoding="async" src={backSrc(s)} alt="" className={styles.deckBack} />
                        <span className={styles.deckName}>{SOLS_SECTION_LABEL[s]}</span>
                      </button>
                    ))}
                  </div>

                  <p className={styles.introText}>
                    Назовите тему одним предложением, определите горизонт — и потяните заранее
                    выбранное количество карт. Схема не меняется после того, как результат увиден.
                  </p>
                  <label className={styles.intentionLabel}>
                    Рамка чтения — фиксируется в журнале, на тягу не влияет
                    <input
                      className={styles.intention}
                      type="text"
                      maxLength={200}
                      placeholder="Например: направление в работе на этот сезон"
                      value={intention}
                      onChange={(e) => setIntention(e.target.value)}
                    />
                  </label>

                  <div className={styles.introActions}>
                    <Button variant="primary" className={styles.gameBtn} onClick={pull}>
                      {mode === 'space'
                        ? `Потянуть из ${SOLS_SECTION_LABEL[space]}`
                        : 'Потянуть карты'}
                    </Button>
                    {journal[0] && (
                      <Button
                        variant="ghost"
                        className={styles.gameBtn}
                        onClick={() => replay(journal[0])}
                        title={`Реплей по seed ${journal[0].seed} от ${fmtJournalTs(journal[0].ts)}`}
                      >
                        Продолжить · {SOLS_MODE_LABEL[journal[0].mode]}
                      </Button>
                    )}
                  </div>

                  {/* Reading options — фактические параметры, не декорация. */}
                  <p className={styles.optionsLine}>
                    {SOLS_MODE_LABEL[mode]} · {previewPositions.length}{' '}
                    {pluralPositions(previewPositions.length)} · колода 64 — Свет 18 · Тень 38 · Знание 8
                    {mode === 'space' ? ` · пространство ${SOLS_SECTION_LABEL[space]}` : ''}
                  </p>
                </div>

                {/* Превью выбранного расклада — паттерн CURRENT READING
                    из референса: мини-диаграмма + список позиций. */}
                <div className={styles.template}>
                  <div className={styles.templateHead}>
                    <span className={styles.templateLabel}>Расклад</span>
                    <span className={styles.templateName}>{SOLS_MODE_LABEL[mode]}</span>
                    <span className={styles.templateMeta}>
                      {previewPositions.length} {pluralPositions(previewPositions.length)}
                    </span>
                  </div>
                  <div className={styles.templateDiagram} aria-hidden="true">
                    <ClothArt />
                    {previewLayout.map((pt, i) => (
                      <span
                        key={i}
                        className={styles.mapDot}
                        style={{ left: `${pt.x}%`, top: `${pt.y}%` }}
                        data-section={previewPools[i] !== 'all' ? previewPools[i] : undefined}
                      >
                        {i + 1}
                      </span>
                    ))}
                  </div>
                  <ol className={styles.templatePositions}>
                    {previewPositions.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ol>
                </div>
              </GlassPanel>
            )}

            {result && (
              <GlassPanel className={styles.spread}>
                <div className={styles.session}>
                  <span>{SOLS_MODE_LABEL[result.mode]}</span>
                  <span>seed {result.seed}</span>
                  <span aria-live="polite">раскрыто {revealedCount}/{result.cards.length}</span>
                  <span className={styles.sessionTimer}>{fmtElapsed(now - (drawTs ?? now))}</span>
                  {tally.map(([s, n]) => (
                    <span key={s} className={styles.sessionSec} data-section={s}>
                      {SOLS_SECTION_LABEL[s]} ×{n}
                    </span>
                  ))}
                  {intention.trim() && <span className={styles.sessionIntention}>рамка: «{intention.trim()}»</span>}
                </div>

                <div className={styles.cloth} data-count={result.cards.length}>
                  <ClothArt />
                  {result.cards.map((c, i) => (
                    <button
                      key={`${result.seed}-${i}`}
                      type="button"
                      className={styles.slot}
                      style={{ left: `${layout[i].x}%`, top: `${layout[i].y}%` }}
                      data-revealed={revealed[i] || undefined}
                      data-focus={focusIdx === i || undefined}
                      onClick={() => {
                        setRevealed((r) => r.map((v, j) => (j === i ? !v : v)));
                        openCard(i);
                      }}
                      aria-label={`${result.positions[i]}: ${c.ru}`}
                    >
                      <span className={styles.flip}>
                        <img loading="lazy" decoding="async" src={backSrc(c.section)} alt="" className={styles.face} />
                        <img loading="lazy" decoding="async" src={cardSrc(c.n)} alt={c.ru} className={`${styles.face} ${styles.faceFront}`} />
                      </span>
                      <span className={styles.slotPos}>
                        <span className={styles.slotNum}>{i + 1}</span>
                        {posShort(result.positions[i])}
                      </span>
                    </button>
                  ))}
                </div>

                <div className={styles.stageActions}>
                  <Button variant="ghost" className={styles.gameBtn} onClick={pull}>
                    Новая тяга
                  </Button>
                  <Button
                    variant="ghost"
                    className={styles.gameBtn}
                    onClick={copyReading}
                    disabled={!ready}
                    title={ready ? 'Текст разбора — в буфер обмена' : 'Доступно, когда все карты раскрыты'}
                  >
                    {copied ? 'Скопировано' : 'Копия разбора'}
                  </Button>
                  <Button variant="ghost" className={styles.gameBtn} onClick={() => setResult(null)}>
                    Сменить режим
                  </Button>
                </div>
              </GlassPanel>
            )}
          </div>
        </section>

        <GlassPanel className={styles.side}>
          <div
            className={styles.sideTabs}
            role="tablist"
            aria-label="Разбор расклада"
            onKeyDown={(e) => {
              const idx = SIDE_TABS.findIndex((t) => t.id === sideTab);
              const next =
                e.key === 'ArrowRight' ? (idx + 1) % SIDE_TABS.length
                  : e.key === 'ArrowLeft' ? (idx - 1 + SIDE_TABS.length) % SIDE_TABS.length
                    : e.key === 'Home' ? 0
                      : e.key === 'End' ? SIDE_TABS.length - 1
                        : -1;
              if (next >= 0) {
                e.preventDefault();
                setSideTab(SIDE_TABS[next].id);
              }
            }}
          >
            {SIDE_TABS.map((t) => (
              <button
                key={t.id}
                id={`sols-tab-${t.id}`}
                role="tab"
                aria-selected={sideTab === t.id}
                aria-controls={`sols-panel-${t.id}`}
                tabIndex={sideTab === t.id ? 0 : -1}
                className={styles.sideTab}
                data-active={sideTab === t.id}
                onClick={() => setSideTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div
            role="tabpanel"
            id={`sols-panel-${sideTab}`}
            aria-labelledby={`sols-tab-${sideTab}`}
            tabIndex={0}
            className={styles.sidePanel}
          >
            {sideTab === 'read' &&
              (result ? (
                <div className={styles.readings} data-ready={ready || undefined}>
                  {intention.trim() && (
                    <p className={styles.readIntention}>Рамка: «{intention.trim()}»</p>
                  )}
                  {result.cards.map((c, i) => (
                    <div
                      key={i}
                      id={`sols-read-${i}`}
                      className={styles.reading}
                      data-section={c.section}
                      data-focus={focusIdx === i || undefined}
                    >
                      <div className={styles.readHead}>
                        <span className={styles.readNum}>{String(c.n).padStart(2, '0')}</span>
                        <span className={styles.readName}>{c.ru}</span>
                        <span className={styles.readEn}>{c.en}</span>
                        <span className={styles.readSec} data-section={c.section}>
                          {SOLS_SECTION_LABEL[c.section]}
                        </span>
                      </div>
                      <p className={styles.readPos}>{i + 1}. {result.positions[i]}</p>
                      <p className={styles.essence}>{c.essence}</p>
                      <div className={styles.pairRow}>
                        <div className={styles.pair}>
                          <span className={styles.pairLabel}>Ресурс</span>
                          <p>{c.resource}</p>
                        </div>
                        <div className={styles.pair}>
                          <span className={styles.pairLabel}>Риск</span>
                          <p>{c.risk}</p>
                        </div>
                      </div>
                      <blockquote className={styles.phrase}>«{c.phrase}»</blockquote>
                      <p className={styles.question}>{c.question}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={styles.sideEmpty}>
                  Выберите расклад и потяните карты — разбор позиций появится здесь.
                </p>
              ))}

            {sideTab === 'map' &&
              (result ? (
                <div className={styles.mapWrap}>
                  <div className={styles.mapDiagram}>
                    <ClothArt />
                    {layout.map((pt, i) => (
                      <span
                        key={i}
                        className={styles.mapDot}
                        style={{ left: `${pt.x}%`, top: `${pt.y}%` }}
                        data-revealed={revealed[i] || undefined}
                      >
                        {i + 1}
                      </span>
                    ))}
                  </div>
                  <ol className={styles.mapList}>
                    {result.positions.map((p, i) => (
                      <li key={i}>
                        <button
                          type="button"
                          className={styles.mapItem}
                          data-focus={focusIdx === i || undefined}
                          onClick={() => {
                            setRevealed((r) => r.map((v, j) => (j === i ? true : v)));
                            openCard(i);
                          }}
                          title={revealed[i] ? 'Показать разбор карты' : 'Раскрыть карту и показать разбор'}
                        >
                          <span className={styles.mapListPos}>{p}</span>
                          <span className={styles.mapListCard}>
                            {revealed[i] ? `№${String(result.cards[i].n).padStart(2, '0')} · ${result.cards[i].ru}` : 'карта закрыта'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <p className={styles.sideEmpty}>
                  Схема покажет геометрию позиций после тяги.
                </p>
              ))}

            {sideTab === 'log' && (
              journal.length === 0 ? (
                <p className={styles.sideEmpty}>
                  Журнал пуст. Хранит расклады этого браузера локально — до {JOURNAL_MAX} записей.
                </p>
              ) : (
                <ol
                  className={styles.journal}
                  tabIndex={0}
                  aria-label="Журнал раскладов — прокрутка стрелками"
                  onKeyDown={(e) => {
                    // Тот же контракт, что у listbox реестра: стрелки двигают
                    // фокус между записями, Enter — нативная активация.
                    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
                    const items = Array.from(
                      e.currentTarget.querySelectorAll<HTMLElement>(`.${styles.journalItem}`),
                    );
                    if (items.length === 0) return;
                    e.preventDefault();
                    const cur = items.indexOf(document.activeElement as HTMLElement);
                    const next = e.key === 'Home' ? 0
                      : e.key === 'End' ? items.length - 1
                        : cur < 0 ? (e.key === 'ArrowDown' ? 0 : items.length - 1)
                          : (cur + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                    items[next].focus();
                  }}
                >
                  {journal.map((e, i) => (
                    <li key={`${e.seed}-${e.ts}`}>
                      <button
                        type="button"
                        className={styles.journalItem}
                        onClick={() => replay(e)}
                        title="Повторить расклад по seed"
                      >
                        <span className={styles.journalHead}>
                          <span>{SOLS_MODE_LABEL[e.mode]}</span>
                          <span className={styles.journalTs}>{fmtJournalTs(e.ts)}</span>
                        </span>
                        <span className={styles.journalMeta}>
                          seed {e.seed} · карт: {e.cards.length}
                          {e.space ? ` · ${SOLS_SECTION_LABEL[e.space]}` : ''}
                        </span>
                        {e.intention && <span className={styles.journalIntention}>«{e.intention}»</span>}
                        <span className={styles.journalCards}>
                          {e.cards.map((n) => String(n).padStart(2, '0')).join(' · ')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )
            )}
          </div>
        </GlassPanel>
      </div>

      <p className={styles.honesty}>
        Толкования — из полного руководства колоды (v5). Это инструмент рефлексии, не предсказание.
      </p>
    </div>
  );
}
