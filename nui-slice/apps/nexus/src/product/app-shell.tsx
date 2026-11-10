'use client';

import { usePathname, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { IconRail, NexusThemeProvider, StatusBadge, Tooltip, WindowFrame, type CommandItem, type NexusStatus, type RailSection } from '@nexus/ui';
import { NexusIcon } from '@nexus/icons';
import type { RunSummary } from '@nexus/mock-data/types';
import { usePersonas } from './personas';
import Link from 'next/link';
import { getDesktopBridge, getDesktopBridgeLazy, getDesktopBridgeSync } from '../integrations/ai2/desktop-bridge/adapter';
import type { NexusDesktopBridge } from '../integrations/ai2/desktop-bridge/types';
import { getDataSource, getDataSourceMode, useDataSource, type DataSourceMode } from './data-source';
import { matchKeyboardShortcut, matchesShortcut, shortcutHint, type ShortcutId } from './keyboard-shortcuts';
import type { ProgramManifest } from './programs/manifest';
import { RightDockToggle, rightDockWidth, useDockExit, useRightDock } from './plugins/right-dock';
import { railMotion } from '@nexus/motion';
import { BarDragGrip, BarEdge, BarHandle, BarTools, beginBarDrag, beginBarMove, useModularBars } from './modular-bars';
import {
  activeRunIdFromLocation,
  pendingPluginInstallNoticeCount,
  playPluginInstallSound,
  usePluginInstallNotices,
  usePluginInstallNotificationPreferences,
} from './plugins/plugin-install-notifications';
import { ASSET_BASE, artAssetUrl } from './asset-base';

function onWindowDragRegionMouseDown(event: ReactMouseEvent<HTMLElement>) {
  // pywebview listens for mousedown on body; reserve only right-button drags
  // for moving the frameless window so left-click controls remain usable.
  if (event.button === 0 && event.currentTarget.classList.contains('pywebview-drag-region')) {
    event.stopPropagation();
  }
}

/**
 * NEO2 P0: единый бейдж источника. До mount (SSR/первый кадр) — null →
 * «SYNCING», без ложного «MOCK» в raw HTML; после mount — реальный режим.
 * Для пункта P1-1 словарь меток общий (sourceModeLabel в data-source.ts).
 */
export function sourceBadgeView(mode: DataSourceMode | null): { status: NexusStatus; label: string; title: string } {
  if (mode === null) {
    return { status: 'info', label: 'SYNCING', title: 'Определяю источник данных…' };
  }
  if (mode === 'live') {
    return { status: 'online', label: 'LIVE', title: 'Данные из подключённого AI-2 runtime' };
  }
  if (mode === 'misconfigured') {
    return {
      status: 'offline',
      label: 'CONFIG',
      title: 'Для web dev live-режима задайте корректный NEXT_PUBLIC_AI2_BASE_URL',
    };
  }
  return { status: 'info', label: 'MOCK', title: 'Детерминированные mock-данные — не live-интеграция' };
}

function onWindowDragRegionContextMenu(event: ReactMouseEvent<HTMLElement>) {
  if (event.currentTarget.classList.contains('pywebview-drag-region')) event.preventDefault();
}
import { updateProfile, useProfile } from './profile/profile-store';
import { RailCoreCard, RailLinkedAgents } from './rail-agents';
import { RailDeckAgents } from './rail-deck-agents';
import { runWhileDocumentVisible } from './visible-interval';
import { installErrorJournal } from './error-journal';
import { installThemeColorProbe } from './theme-color-probe';
import { ShellErrorBoundary } from './shell-error-boundary';
import styles from './app-shell.module.css';

// wave-XIII W4 perf: палитра — on-demand UI, выносится из first-load
// общего чанка (dynamic + ssr:false в клиентском компоненте).
const CommandPaletteLazy = dynamic(() => import('./palette-lazy'), { ssr: false });
const ShortcutsHintLazy = dynamic(() => import('./shortcuts-hint').then((m) => m.ShortcutsHint), { ssr: false });
// Карточка подтверждений + sync-парсинг (runtime-ops) грузятся по требованию —
// иначе весь runtime-ops попадает в shared-бандл каждого маршрута.
const PluginInstallConfirmationLazy = dynamic(
  () => import('./plugins/plugin-install-confirmation').then((m) => m.PluginInstallConfirmation),
  { ssr: false },
);
// Разметка правого дока грузится при открытии панели: по умолчанию док
// скрыт, и его вкладки не должны попадать в shared-бандл каждого маршрута.
const RightDockPanel = dynamic(
  () => import('./plugins/right-dock-panel').then((m) => m.RightDockPanel),
  { ssr: false },
);

export function shouldPollRuntimeConfirmations(pathname: string): boolean {
  return pathname === '/runtime';
}

// runtime-wave2 A1: меню = разделы референса (таблица диспетча, порядок
// сохранён). Разделы с несколькими экранами несут children — подсписок
// раскрывается у активного раздела (контекстный сайдбар, main-delta #12).
// Alt+1…9 следует позиции раздела в рейле.
type NavLeaf = RailSection & { match?: readonly string[] };
type NavSection = Omit<RailSection, 'children'> & { match?: readonly string[]; children?: readonly NavLeaf[] };

// Решение Yury 17.10 (задача #53): рельс окна ALICE — девять разделов с
// листов NEU\Alice. Прежние разделы (Mission Control, Intelligence,
// Studio, Compute, Data, Agents, Runtime, AGENT-A, Library) остаются
// экранами-листами внутри новых разделов — ни один маршрут не потерян.
// Alt+1…9 следует позиции раздела в рейле.
const SECTIONS: readonly NavSection[] = [
  {
    id: 'main', label: 'Главная', icon: 'agent.alice', crest: 'mission', href: '/home',
    children: [
      { id: 'main-home', href: '/home', label: 'AGENT-A' },
      { id: 'mission', href: '/mission-control', label: 'Nexus Link' },
    ],
  },
  {
    id: 'dialogs', label: 'Диалоги', icon: 'nav.command', crest: 'dialogs', href: '/dialogs',
    children: [
      { id: 'dialogs-overview', href: '/dialogs', label: 'Обзор' },
      { id: 'agents', href: '/agents', label: 'Агенты и сессии' },
    ],
  },
  {
    id: 'social', label: 'Соц. Сети', icon: 'agent.nexus', crest: 'knowledge', href: '/social',
    children: [
      { id: 'social-hub', href: '/social', label: 'Nexus Link' },
      { id: 'telegram', href: '/telegram', label: 'Telegram' },
      { id: 'instagram', href: '/instagram', label: 'Instagram' },
      { id: 'youtube', href: '/youtube', label: 'YouTube' },
      { id: 'x', href: '/x', label: 'X' },
    ],
  },
  {
    // Игры/Программы — top-level рельс (решение 01.11): экраны /forge,
    // /models, /media, /noir вынесены из навигации как побочные.
    id: 'games', label: 'Игры', icon: 'act.play', href: '/games',
    match: ['/games', '/durak', '/chess', '/oracle'],
  },
  {
    id: 'programs', label: 'Программы', icon: 'agent.forge', crest: 'tools', href: '/programs',
    match: ['/programs', '/tools'],
  },
  {
    id: 'memory', label: 'Память', icon: 'agent.codex', crest: 'memory', href: '/memory',
    children: [
      { id: 'memory-overview', href: '/memory', label: 'Память' },
      { id: 'intelligence-overview', href: '/intelligence', label: 'Интеллект' },
      // REAL-BUGS /models: /models is a sub-screen of Intelligence
      // (section-intelligence.tsx: «Подэкраны: /memory, /models»). Without a
      // leaf the browser-review gate finds no aria-current="page" in nav on
      // /models. Leaf link + match (not a new top-level section) keeps the
      // rail's 9-section numbering intact.
      { id: 'models-overview', href: '/models', label: 'Модели', match: ['/models'] },
      { id: 'library-overview', href: '/library', label: 'Библиотека' },
      { id: 'data-overview', href: '/data', label: 'Данные' },
    ],
  },
  {
    // NUE-3 (owner): вкладка «Nexus Deck» вычищена — в nav остаётся только
    // лист deck; прежние субагентские роуты (/runtime/guard, /arch, /mech,
    // /codex, /compute, /local-agent, /runs) доступны по прямым адресам и
    // открываются из других экранов, но пунктов в этой вкладке не имеют.
    // Лист deck — единственный лист вкладки; он несёт page-current на своей
    // странице и на служебных путях раздела (/runtime, /run), чтобы
    // browser-review gate находил ровно один aria-current="page" в nav.
    id: 'processes', label: 'Nexus Deck', icon: 'act.play', crest: 'processes', href: '/deck', match: ['/deck', '/runtime', '/run'],
    children: [
      { id: 'deck', href: '/deck', label: 'Nexus Deck', match: ['/deck', '/runtime', '/run'] },
    ],
  },
  {
    id: 'evals', label: 'Оценки', icon: 'act.check', crest: 'evals',
    children: [
      { id: 'usage', href: '/settings/usage', label: 'Учёт расхода' },
      { id: 'scenarios', href: '/runtime?tab=scenario', label: 'Сценарии' },
    ],
  },
  {
    id: 'settings', label: 'Настройки', icon: 'nav.settings', crest: 'settings', href: '/settings',
    children: [
      { id: 'settings-general', href: '/settings', label: 'Общие' },
      { id: 'plugins', href: '/plugins', label: 'Плагины' },
      { id: 'connections', href: '/connections', label: 'Подключения' },
    ],
  },
];

const SECONDARY_PALETTE_ROUTES = [
  { href: '/forge', label: 'FORGE' },
  { href: '/media', label: 'Медиаплеер' },
  { href: '/noir', label: 'NOIR' },
] as const;

const routeHits = (item: { href?: string; match?: readonly string[] }, pathname: string): boolean =>
  item.match != null
    ? item.match.some((m) => pathname === m || pathname.startsWith(`${m}/`))
    : item.href != null && (pathname === item.href || pathname.startsWith(`${item.href}/`));

/** Активный лист (подэкраны важнее префиксов разделов) + секция-владелец. */
function navPosition(pathname: string): { section: NavSection | null; leaf: NavLeaf | null } {
  for (const s of SECTIONS) {
    for (const c of s.children ?? []) {
      if (routeHits(c, pathname)) return { section: s, leaf: c };
    }
  }
  for (const s of SECTIONS) {
    if (routeHits(s, pathname)) return { section: s, leaf: null };
  }
  return { section: null, leaf: null };
}

/** Первый экран раздела — цель клика по родительской строке и Alt+N. */
function sectionHref(s: NavSection): string | null {
  return s.children?.[0]?.href ?? s.href ?? null;
}

/** Приоритет 16.10 — узкая полоса разделов (~56px) при свёрнутой панели:
 *  те же 9 разделов и тот же набор иконок, что в полном рейле; активный
 *  раздел подсвечен; разделы с подэкранами открывают меню по наведению
 *  (задержка на закрытие — мостик через зазор) и по клику. Подписи —
 *  title/aria-label verbatim из рейла. «Ещё» внизу открывает палитру. */
function RailStrip({
  activeSectionId,
  activeLeafId,
  onPalette,
  onNavigate,
  onPrefetch,
  tools,
  side = 'left',
}: {
  activeSectionId: string | null;
  activeLeafId: string | null;
  onPalette: () => void;
  onNavigate: (href: string) => void;
  /** UI-5: прогрев маршрутов при наведении/фокусе пунктов навигации. */
  onPrefetch?: (href: string | null | undefined) => void;
  /** Хром модульного бара (⇄ перенос, ▴ разворот, × закрыть). */
  tools?: ReactNode;
  /** Сторона рейла — тултипы открываются в свободную сторону
   *  (правый рейл → влево, левый → вправо), не поверх иконку. */
  side?: 'left' | 'right';
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLElement>(null);
  const tipPos = side === 'right' ? 'left' : 'right';
  // ArrowDown/ArrowRight на кнопке раздела открывает меню И переносит
  // фокус на первый пункт (menubar-контракт); клик/Enter — только открывает.
  const focusFirstRef = useRef(false);
  useEffect(() => {
    if (openId == null || !focusFirstRef.current) return;
    focusFirstRef.current = false;
    const first = wrapRef.current?.querySelector<HTMLElement>('[role="menu"] a[role="menuitem"]');
    first?.focus();
  }, [openId]);

  const closeMenu = () => setOpenId(null);
  const scheduleClose = () => {
    if (closeTimer.current != null) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(closeMenu, 200);
  };
  const cancelClose = () => {
    if (closeTimer.current != null) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  };
  const openMenu = (id: string, el: HTMLElement) => {
    cancelClose();
    const r = el.getBoundingClientRect();
    // ≤560px (контейнер): стрип — горизонтальная полоса, меню падает вниз.
    const wrap = wrapRef.current?.getBoundingClientRect();
    const horizontal = wrap != null && wrap.width > wrap.height;
    setMenuPos(horizontal ? { top: r.bottom + 4, left: r.left } : { top: r.top, left: r.right - 2 });
    setOpenId(id);
  };

  useEffect(() => {
    if (openId == null) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) closeMenu();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (matchesShortcut(e, 'modal.dismiss')) closeMenu();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      cancelClose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId != null]);

  const onMenuKey = (e: ReactKeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const links = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('a[role="menuitem"]'));
    if (links.length === 0) return;
    e.preventDefault();
    const i = links.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % links.length : (i - 1 + links.length) % links.length;
    links[next]?.focus();
  };

  return (
    <nav ref={wrapRef} className={styles.strip} aria-label="Разделы" data-testid="rail-strip">
      {tools != null && <div className={styles.stripTools}>{tools}</div>}
      <ul className={styles.stripList}>
        {SECTIONS.map((s, index) => {
          const leafOwner = activeLeafId != null && (s.children ?? []).some((c) => c.id === activeLeafId);
          const active = s.id === activeSectionId;
          const marked = active || leafOwner;
          const sub = s.children ?? [];
          const itemCls = styles.stripBtn;
          const icon = s.icon != null ? <NexusIcon name={s.icon} size={22} /> : <span aria-hidden="true">{s.label.slice(0, 1)}</span>;
          const keyHint = shortcutHint(`rail.section.${index + 1}` as ShortcutId);
          return (
            <li
              key={s.id}
              className={styles.stripItem}
              onMouseEnter={(e) => { if (sub.length > 0) openMenu(s.id, e.currentTarget); }}
              onMouseLeave={scheduleClose}
            >
              {sub.length > 0 ? (
                <Tooltip content={s.label} kbd={keyHint} position={tipPos}>
                  <button
                    type="button"
                    className={itemCls}
                    data-active={marked || undefined}
                    aria-label={s.label}
                    aria-haspopup="menu"
                    aria-expanded={openId === s.id}
                    onMouseEnter={() => {
                      // UI-5: прогрев маршрутов раздела — родитель + подэкраны.
                      onPrefetch?.(s.href);
                      for (const c of sub) onPrefetch?.(c.href);
                    }}
                    onFocus={() => onPrefetch?.(s.href)}
                    onClick={(e) => (openId === s.id ? closeMenu() : openMenu(s.id, e.currentTarget))}
                    onKeyDown={(e) => {
                      if (e.key !== 'ArrowDown' && e.key !== 'ArrowRight') return;
                      e.preventDefault();
                      focusFirstRef.current = true;
                      openMenu(s.id, e.currentTarget);
                    }}
                  >
                    {icon}
                  </button>
                </Tooltip>
              ) : (
                <Tooltip content={s.label} kbd={keyHint} position={tipPos}>
                  <Link
                    href={s.href ?? '#'}
                    className={itemCls}
                    data-active={marked || undefined}
                    aria-label={s.label}
                    aria-current={active ? 'page' : undefined}
                    onMouseEnter={() => onPrefetch?.(s.href)}
                    onFocus={() => onPrefetch?.(s.href)}
                    onClick={(e) => { e.preventDefault(); if (s.href != null) onNavigate(s.href); }}
                  >
                    {icon}
                  </Link>
                </Tooltip>
              )}
              {openId === s.id && sub.length > 0 && menuPos != null && (
                <ul
                  className={styles.stripMenu}
                  role="menu"
                  aria-label={s.label}
                  style={{ top: menuPos.top, left: menuPos.left }}
                  onMouseEnter={cancelClose}
                  onMouseLeave={scheduleClose}
                  onKeyDown={onMenuKey}
                >
                  {sub.map((c) => (
                    <li key={c.id} role="none">
                      <Link
                        role="menuitem"
                        href={c.href ?? '#'}
                        className={styles.stripMenuLink}
                        aria-current={c.id === activeLeafId ? 'page' : undefined}
                        onMouseEnter={() => onPrefetch?.(c.href)}
                        onFocus={() => onPrefetch?.(c.href)}
                        onClick={(e) => {
                          e.preventDefault();
                          closeMenu();
                          if (c.href != null) onNavigate(c.href);
                        }}
                      >
                        {c.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <div className={styles.stripFoot}>
        {/* #53: «Настройки» — 8-й раздел рельса, отдельная иконка внизу
            полосы больше не нужна (дублировала доступное имя). */}
        <Tooltip
          content="Открыть командную палитру"
          kbd={[shortcutHint('palette.modk'), shortcutHint('palette.alt0')]}
          position={tipPos}
        >
          <button
            type="button"
            className={styles.stripBtn}
            aria-label="Все разделы — палитра"
            onClick={onPalette}
          >
            <NexusIcon name="nav.command" size={22} />
          </button>
        </Tooltip>
      </div>
    </nav>
  );
}

/** VII V1.5: экраны приветствия и выбора ассистента — полноэкранные по
 *  start.png, без рельса и рамки разделов. Так в рейле не остаётся экранов
 *  вне девяти разделов; frameless-окно сохраняет нативный тайтлбар. */
const BARE_ROUTES: readonly string[] = ['/', '/welcome', '/agent-select', '/mobile'];

/** Маршруты, рендерящие ALICE-home. `/home` — канонический, `/runtime/alice`
 *  — служебный алиас, пока visual-target `alice-home-01` в манифесте ссылается
 *  на него. Оба рендерят один адаптер, поэтому сцена окна и прозрачная шапка
 *  включаются на обоих: иначе манифест снимает не утверждённый вид. */
const ALICE_HOME_ROUTES: readonly string[] = [
  '/home',
  '/home/',
  '/runtime/alice',
  '/runtime/alice/',
];

/** Границы frameless-окна: края 5px, углы 14px; dir — compass-стороны,
 *  по которым тащится указатель. Кнопки окна вне drag-региона — в спеке
 *  DESKTOP_UI_SPEC это поведение нативного тайтлбара. */
const RESIZE_EDGES = [
  { dir: 'n', style: { top: 0, left: 14, right: 14, height: 5 }, cursor: 'ns-resize' },
  { dir: 's', style: { bottom: 0, left: 14, right: 14, height: 5 }, cursor: 'ns-resize' },
  { dir: 'w', style: { left: 0, top: 14, bottom: 14, width: 5 }, cursor: 'ew-resize' },
  { dir: 'e', style: { right: 0, top: 14, bottom: 14, width: 5 }, cursor: 'ew-resize' },
  { dir: 'nw', style: { top: 0, left: 0, width: 14, height: 14 }, cursor: 'nwse-resize' },
  { dir: 'ne', style: { top: 0, right: 0, width: 14, height: 14 }, cursor: 'nesw-resize' },
  { dir: 'sw', style: { bottom: 0, left: 0, width: 14, height: 14 }, cursor: 'nesw-resize' },
  { dir: 'se', style: { bottom: 0, right: 0, width: 14, height: 14 }, cursor: 'nwse-resize' },
] as const;

const MIN_W = 960;
const MIN_H = 640;

function ResizeZones({ bridge }: { bridge: NexusDesktopBridge }) {
  const rafRef = useRef(0);
  const pendingRef = useRef<[number, number, number, number] | null>(null);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const begin = (dir: string) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = {
      x: e.screenX,
      y: e.screenY,
      bx: window.screenX,
      by: window.screenY,
      bw: window.outerWidth,
      bh: window.outerHeight,
    };
    const flush = () => {
      rafRef.current = 0;
      const p = pendingRef.current;
      if (p != null) {
        pendingRef.current = null;
        void bridge.setBounds(p[0], p[1], p[2], p[3]);
      }
    };
    const onMove = (ev: PointerEvent) => {
      const dx = ev.screenX - start.x;
      const dy = ev.screenY - start.y;
      let x = start.bx;
      let y = start.by;
      let w = start.bw;
      let h = start.bh;
      if (dir.includes('e')) w = start.bw + dx;
      if (dir.includes('s')) h = start.bh + dy;
      if (dir.includes('w')) {
        x = start.bx + dx;
        w = start.bw - dx;
      }
      if (dir.includes('n')) {
        y = start.by + dy;
        h = start.bh - dy;
      }
      if (w < MIN_W) {
        if (dir.includes('w')) x -= MIN_W - w;
        w = MIN_W;
      }
      if (h < MIN_H) {
        if (dir.includes('n')) y -= MIN_H - h;
        h = MIN_H;
      }
      pendingRef.current = [Math.round(x), Math.round(y), Math.round(w), Math.round(h)];
      if (!rafRef.current) rafRef.current = requestAnimationFrame(flush);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      flush();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <>
      {RESIZE_EDGES.map((z) => (
        <div
          key={z.dir}
          className={styles.resizeZone}
          style={{ ...z.style, cursor: z.cursor }}
          aria-hidden="true"
          onPointerDown={begin(z.dir)}
        />
      ))}
    </>
  );
}

/** Native window actions rendered as glyphs in the upper-right titlebar. */
function TrafficLights({ bridge }: { bridge: NexusDesktopBridge }) {
  const [maximized, setMaximized] = useState(false);
  return (
    <div
      className={styles.traffic}
      data-testid="window-traffic"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={`${styles.tl} ${styles.tlMin}`}
        aria-label="Свернуть окно"
        title="Свернуть"
        onClick={() => void bridge.minimize()}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <path d="M2 6h8" />
        </svg>
      </button>
      <button
        type="button"
        className={`${styles.tl} ${styles.tlMax}`}
        aria-label={maximized ? 'Восстановить размер окна' : 'Развернуть окно на весь экран'}
        title={maximized ? 'Восстановить' : 'Развернуть на весь экран'}
        onClick={() => void bridge.toggleMaximize().then((s) => s != null && setMaximized(s))}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <rect x="2.25" y="2.25" width="7.5" height="7.5" />
        </svg>
      </button>
      <button
        type="button"
        className={`${styles.tl} ${styles.tlClose}`}
        aria-label="Закрыть окно"
        title="Закрыть"
        onClick={() => void bridge.closeWindow()}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <path d="M2 2l8 8M10 2L2 10" />
        </svg>
      </button>
    </div>
  );
}

/** Компактный регулятор доступа AGENT-A к ФС в топбаре (fs-access W3):
 *  тот же профиль и те же обновления, что у регулятора под композитором
 *  Runtime — это второй вход в одну и ту же настройку. Поповер по паттерну
 *  contourPick (mousedown вне панели + Escape). Без fs-seam режим и список
 *  корней всё равно редактируются (это профиль), а validate — честный
 *  unavailable, как в runtime.tsx. */
function FsAccessControl() {
  const { profile } = useProfile();
  const ds = useDataSource(); // #418 (wave #418-2): mount-gated
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [fsPath, setFsPath] = useState('');
  const [fsErr, setFsErr] = useState<string | null>(null);
  const [fsBusy, setFsBusy] = useState(false);
  // #418 (wave #418-2): fsMode/fsRoots rendered into the button (line ~607);
  // SSR uses null profile → read_only + [] defaults; profile applies post-mount.
  const [fsMounted, setFsMounted] = useState(false);
  useEffect(() => setFsMounted(true), []);
  const fsMode = fsMounted ? profile?.fsMode ?? 'read_only' : 'read_only';
  const fsRoots = fsMounted ? profile?.fsRoots ?? [] : [];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (matchesShortcut(e, 'modal.dismiss')) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const addFsRoot = async () => {
    const p = fsPath.trim();
    if (!p || ds.fs == null || fsBusy) return;
    if (fsRoots.some((r) => r.path === p)) {
      setFsErr('Этот корень уже в списке доступа.');
      return;
    }
    setFsBusy(true);
    setFsErr(null);
    try {
      const v = await ds.fs.validate(p);
      if (!v.ok) {
        setFsErr(v.reason ?? 'Хост отклонил путь без причины.');
        return;
      }
      const canon = v.path ?? p;
      const id = canon.split(/[\\/]/).filter(Boolean).pop() ?? `root-${fsRoots.length + 1}`;
      updateProfile({ fsRoots: [...fsRoots, { id, path: canon }] });
      setFsPath('');
    } catch (err) {
      setFsErr(err instanceof Error ? err.message : String(err));
    } finally {
      setFsBusy(false);
    }
  };

  return (
    <div className={styles.fsWrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.fsBtn}
        data-state={ds.fs == null ? 'unavailable' : 'ready'}
        data-testid="fs-authority"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Доступ AGENT-A к файлам — режим и корни (fs-access)"
        onClick={() => { setOpen((o) => !o); setFsErr(null); }}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2Z" />
        </svg>
        <span>{fsMode === 'read_write' ? 'RW' : 'RO'}</span>
        {fsRoots.length > 0 && <span className={styles.fsCount}>{fsRoots.length}</span>}
      </button>
      {open && (
        <div className={styles.fsPop} role="dialog" aria-label="Доступ AGENT-A к файлам">
          <div className={styles.fsPopTitle}>Доступ AGENT-A к файлам</div>
          <div className={styles.fsModeRow} role="radiogroup" aria-label="Режим доступа">
            <button
              type="button"
              role="radio"
              aria-checked={fsMode === 'read_only'}
              className={styles.fsChoice}
              data-selected={fsMode === 'read_only' || undefined}
              onClick={() => updateProfile({ fsMode: 'read_only' })}
            >
              только чтение
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={fsMode === 'read_write'}
              className={styles.fsChoice}
              data-selected={fsMode === 'read_write' || undefined}
              onClick={() => updateProfile({ fsMode: 'read_write' })}
            >
              чтение+запись
            </button>
          </div>
          <div className={styles.fsRootsList}>
            {fsRoots.length === 0 && (
              <span className={styles.fsNote}>
                корни не заданы — прогон ограничен рабочей папкой хоста
              </span>
            )}
            {fsRoots.map((r) => (
              <button
                key={r.id}
                type="button"
                className={styles.fsChip}
                title={`${r.path} — убрать из списка`}
                aria-label={`Убрать корень ${r.id}`}
                onClick={() => updateProfile({ fsRoots: fsRoots.filter((x) => x.id !== r.id) })}
              >
                {r.id} ×
              </button>
            ))}
          </div>
          {ds.fs != null ? (
            <div className={styles.fsAddRow}>
              <input
                className={styles.fsInput}
                value={fsPath}
                onChange={(e) => setFsPath(e.target.value)}
                placeholder="D:/path/to/root"
                aria-label="Путь корня доступа"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void addFsRoot(); }
                }}
              />
              <button
                type="button"
                className={styles.fsChoice}
                disabled={fsBusy || !fsPath.trim()}
                onClick={() => void addFsRoot()}
              >
                {fsBusy ? 'Проверка…' : 'Добавить'}
              </button>
            </div>
          ) : (
            <div className={styles.fsNote}>
              fs-контур недоступен в этом источнике — корни сохранятся для live-рантайма
            </div>
          )}
          {fsErr && <div className={styles.fsErr} role="alert">{fsErr}</div>}
        </div>
      )}
    </div>
  );
}

/** main-delta #15: datetime-чип топбара. Клиентский рендер после mount —
 *  серверного времени у статик-экспорта нет, SSR-кадр честно пустой. */
function Clock() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setText(`${d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`);
    };
    tick();
    return runWhileDocumentVisible(tick, 20_000);
  }, []);
  if (text == null) return null;
  return <span className={styles.clock} data-testid="clock">{text}</span>;
}

/** NUE window transparency: регулятор 100…10 % — Win32 layered через
 *  desktop-мост; без оболочки (браузер/SSR) показывается отключённым. */
function WindowOpacityCtl({ bridge }: { bridge: NexusDesktopBridge }) {
  const { profile } = useProfile();
  // #418 (wave #418-2): SSR profile=null → 100; client first frame → stored value.
  // Gate on the shell's mounted flag (re-exported via a local useState) so
  // the text "100%" matches in both renders; stored value applies post-mount.
  // bridge.available is also mount-gated: the AI-2 host injects
  // window.pywebview.api before hydration, so SSR (apiOf()=null → false)
  // and client first frame (api injected → true) diverge on disabled/title.
  const [opacityMounted, setOpacityMounted] = useState(false);
  useEffect(() => setOpacityMounted(true), []);
  const pct = opacityMounted ? Math.round(profile?.windowOpacity ?? 100) : 100;
  const bridgeAvailable = opacityMounted && bridge.available;
  const set = (v: number) => {
    const clamped = Math.max(10, Math.min(100, Math.round(v)));
    updateProfile({ windowOpacity: clamped });
    void bridge.setWindowOpacity(clamped / 100);
  };
  return (
    <label
      className={styles.opacityCtl}
      data-testid="window-opacity"
      onMouseDown={(event) => event.stopPropagation()}
      title={
        bridgeAvailable
          ? 'Непрозрачность окна — 100…10 %'
          : 'Прозрачность окна доступна только в desktop-оболочке'
      }
    >
      <span className={styles.opacityLabel}>Окно</span>
      <input
        type="range"
        className={styles.opacityRange}
        min={10}
        max={100}
        step={5}
        value={pct}
        disabled={!bridgeAvailable}
        onChange={(e) => set(Number(e.target.value))}
        aria-label="Непрозрачность окна"
      />
      <span className={styles.opacityVal}>{pct}%</span>
    </label>
  );
}

const RUN_VERB: Record<string, string> = {
  done: 'завершён',
  error: 'завершился ошибкой',
  timeout: 'превысил лимит времени',
  cancelled: 'остановлен',
};

type Notice = { id: string; title: string; sub: string; href: string };

/** main-delta #15: bell → центр уведомлений. Состав — только наблюдаемое:
 *  ожидающие заявки (listApprovals, seam опционален) + завершённые прогоны
 *  из listRuns. Счётчик на кнопке = заявки, ждущие решения — единственное
 *  actionable; прогоны информационные, в счёт не идут. */
function NotificationBell({
  bridge,
  osNotificationsEnabled,
}: {
  bridge: NexusDesktopBridge;
  osNotificationsEnabled: boolean;
}) {
  const ds = useDataSource(); // #418 (wave #418-2): mount-gated
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sentInstallNotices = useRef(new Set<string>());
  const [pending, setPending] = useState<number>(0);
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [approvalsDown, setApprovalsDown] = useState(false);
  const installNotices = usePluginInstallNotices();
  const installPreferences = usePluginInstallNotificationPreferences();
  const installPending = pendingPluginInstallNoticeCount(installNotices);
  const badgeCount = pending + (installPreferences.badgeEnabled ? installPending : 0);
  // wave-XII header-bell: окна шины — переход busy→idle означает полученный
  // ответ (контракт XI: busy = задача в inbox ждёт ответа). Первый опрос
  // только засевает снимок — события показываем только с наблюдаемого
  // перехода, не от исторического состояния.
  const busPrevRef = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (matchesShortcut(e, 'modal.dismiss')) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    let alive = true;
    const poll = () => {
      const approvalsP = ds.listApprovals != null
        ? ds.listApprovals({ status: 'pending' }).catch(() => null)
        : Promise.resolve(null);
      const busP = ds.bus != null
        ? ds.bus.listSessions().catch(() => null)
        : Promise.resolve(null);
      Promise.all([approvalsP, ds.listRuns({ limit: 8 }).catch(() => [] as RunSummary[]), busP]).then(([appr, runs, sessions]) => {
        if (!alive) return;
        setApprovalsDown(ds.listApprovals != null && appr == null);
        setPending(appr?.length ?? 0);
        const items: Notice[] = (appr ?? []).map((a) => ({
          id: `ap:${a.approvalId}`,
          title: a.detail || a.action,
          sub: `Заявка ждёт решения${a.scope != null ? ` · ${a.scope}` : ''}`,
          href: `/runtime?run=${encodeURIComponent(a.runId)}`,
        }));
        for (const r of runs) {
          if (r.finishedAt == null) continue;
          items.push({
            id: `run:${r.runId}`,
            title: r.taskText,
            sub: `Прогон ${RUN_VERB[r.status] ?? r.status}`,
            href: `/runtime?run=${encodeURIComponent(r.runId)}`,
          });
          if (items.length >= 7) break;
        }
        // Ответ окна по шине: наблюдаемый переход busy→idle.
        if (sessions != null) {
          const prev = busPrevRef.current;
          const next = new Map<string, string>();
          const replied: typeof sessions = [];
          for (const s of sessions) {
            next.set(s.window, s.status);
            if (prev?.get(s.window) === 'busy' && s.status === 'idle') replied.push(s);
          }
          busPrevRef.current = next;
          if (prev != null) {
            for (const s of replied.slice(0, Math.max(0, 8 - items.length))) {
              items.push({
                id: `bus:${s.window}`,
                title: `Окно «${s.title}» ответило`,
                sub: `шина · ${s.window}`,
                href: '/runtime',
              });
            }
          }
        }
        setNotices(items);
      });
    };
    poll();
    const stopPolling = runWhileDocumentVisible(poll, 30_000);
    return () => { alive = false; stopPolling(); };
  }, [ds]);

  // Per-run confirmation GET is the only W1 source for pending card details.
  // The current Runtime route supplies the real run id; previously observed
  // cards stay in the in-memory session store when the user leaves that route.
  useEffect(() => {
    if (ds.listToolConfirmations == null || !shouldPollRuntimeConfirmations(pathname)) return;
    let alive = true;
    const poll = () => {
      const runId = activeRunIdFromLocation();
      if (runId == null) return;
      ds.listToolConfirmations!(runId).then(
        (rows) => {
          if (!alive) return;
          void import('./plugins/plugin-install-sync')
            .then((m) => { if (alive) m.syncPluginInstallNoticesFromHost(runId, rows); });
        },
        () => { /* SDK off / run not found: no fabricated pending cards */ },
      );
    };
    poll();
    const stopPolling = runWhileDocumentVisible(poll, 10_000);
    return () => { alive = false; stopPolling(); };
  }, [ds, pathname]);

  // OS notification (including its sound) is opt-in twice: the existing
  // profile setting and the install-notification preference. The in-app
  // badge remains independently configurable.
  useEffect(() => {
    if (!installPreferences.soundEnabled) return;
    for (const notice of installNotices) {
      if (
        notice.outcome != null
        || notice.decision != null
        || sentInstallNotices.current.has(`${notice.runId}:${notice.confirmation.callId}`)
      ) continue;
      const id = `${notice.runId}:${notice.confirmation.callId}`;
      sentInstallNotices.current.add(id);
      playPluginInstallSound();
      if (osNotificationsEnabled && bridge.available) {
        void bridge.notify('Подтверждение установки плагина', 'Агент ожидает решения по локальному bundle.')
          .catch(() => false);
      }
    }
  }, [bridge, installNotices, installPreferences.soundEnabled, osNotificationsEnabled]);

  return (
    <div className={styles.bellWrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.bellBtn}
        data-testid="notif-bell"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={badgeCount > 0 ? `Уведомления — ${badgeCount} ждёт решения` : 'Уведомления'}
        title="Уведомления: заявки и завершённые прогоны"
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M12 22a2.4 2.4 0 0 0 2.4-2.4H9.6A2.4 2.4 0 0 0 12 22Zm7.2-6v-5.4a7.2 7.2 0 0 0-5.4-6.97V3a1.8 1.8 0 1 0-3.6 0v.63a7.2 7.2 0 0 0-5.4 6.97V16l-2 2v1.2h18.4V18l-2-2Z" />
        </svg>
        {badgeCount > 0 && <span className={styles.bellBadge}>{badgeCount}</span>}
      </button>
      {open && (
        <div className={styles.notifPop} role="dialog" aria-label="Уведомления">
          <div className={styles.notifTitle}>Уведомления</div>
          {approvalsDown && (
            <div className={styles.notifNote}>Очередь заявок недоступна — источник не ответил.</div>
          )}
          {ds.listApprovals == null && (
            <div className={styles.notifNote}>Заявки на доступ этот источник не отдаёт.</div>
          )}
          {installNotices.map((notice) => (
            <PluginInstallConfirmationLazy
              key={`plugin-install:${notice.runId}:${notice.confirmation.callId}`}
              notice={notice}
              onDecide={ds.respondToolConfirmation == null
                ? undefined
                : (decision) => ds.respondToolConfirmation!(notice.runId, notice.confirmation.callId, decision)}
            />
          ))}
          {notices == null ? (
            <div className={styles.notifEmpty}>Читаю события…</div>
          ) : notices.length === 0 && installNotices.length === 0 ? (
            <div className={styles.notifEmpty}>Новых событий нет.</div>
          ) : (
            notices.length > 0 && <div className={styles.notifList}>
              {notices.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={styles.notifItem}
                  onClick={() => { setOpen(false); router.push(n.href); }}
                >
                  <span className={styles.notifItemTitle}>{n.title}</span>
                  <span className={styles.notifItemSub}>{n.sub}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** W4-1012 railOut: прежний режим рейла на окно exit-анимации при →hidden
 *  (зеркало useDockExit для навигации; 0ms → null при reduced-motion —
 *  рейл размонтируется мгновенно, без промежуточных кадров). */
function useNavExit(mode: 'full' | 'strip' | 'hidden'): 'full' | 'strip' | null {
  const [exitMode, setExitMode] = useState<'full' | 'strip' | null>(null);
  const prevModeRef = useRef(mode);
  useEffect(() => {
    const prev = prevModeRef.current;
    prevModeRef.current = mode;
    if (mode !== 'hidden') {
      setExitMode(null); // bail, если уже null — повторного рендера нет
      return;
    }
    if (prev === 'hidden') return;
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const spec = railMotion('railOut', 'dissolve', { reducedMotion: reduced });
    if (spec.durationMs === 0) return;
    setExitMode(prev);
    const t = window.setTimeout(() => setExitMode(null), spec.durationMs);
    return () => window.clearTimeout(t);
  }, [mode]);
  return mode === 'hidden' ? exitMode : null;
}

const RECENT_PALETTE_KEY = 'nexus.palette.recent';
const RECENT_PALETTE_LIMIT = 8;

/** «Недавнее» в палитре — last-used элементы (id/label/hint), localStorage. */
function readRecentPaletteItems(): CommandItem[] {
  try {
    const raw = window.localStorage.getItem(RECENT_PALETTE_KEY);
    if (raw == null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r): r is CommandItem => {
        const x = r as { id?: unknown; label?: unknown; hint?: unknown };
        return typeof x.id === 'string' && typeof x.label === 'string';
      })
      .slice(0, RECENT_PALETTE_LIMIT);
  } catch {
    return [];
  }
}

function pushRecentPaletteItem(item: CommandItem): void {
  try {
    const next = [item, ...readRecentPaletteItems().filter((r) => r.id !== item.id)]
      .slice(0, RECENT_PALETTE_LIMIT);
    window.localStorage.setItem(RECENT_PALETTE_KEY, JSON.stringify(next));
  } catch {
    // localStorage недоступен (приватный режим) — recent молча не сохраняется.
  }
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // UI-5: прогрев маршрутов при наведении/фокусе — следующий экран уже в
  // кэше к моменту клика (perceived speed). No-op, если хост его не умеет.
  const prefetchHref = useCallback((href: string | null | undefined) => {
    if (!href || href === '#') return;
    try {
      router.prefetch(href);
    } catch {
      // Хост без prefetch/не-роут — no-op.
    }
  }, [router]);
  const { profile, persisted } = useProfile();
  // perf XVI W1: каталог персон — ленивый import(), до ответа дефолт 'NEXUS'
  // (тот же, что у personaName при неизвестном id).
  const personas = usePersonas();
  const agentPersonaName =
    personas?.find((p) => p.id === (profile?.agentId ?? 'nexus'))?.name ?? 'NEXUS';
  // PKG5 slice-1: манифест программ (меню/палитра) — lazy import(), не в
  // shared-бандле первого кадра. До загрузки палитра просто без program-пунктов.
  const [programsManifest, setProgramsManifest] = useState<ProgramManifest | null>(null);
  useEffect(() => {
    let alive = true;
    import('./programs/manifest').then((m) => {
      if (alive) setProgramsManifest(m.PROGRAMS_MANIFEST);
    });
    return () => { alive = false; };
  }, []);
  const dsMode = useMemo(getDataSourceMode, []);
  // #418 (QODER-verify-418, 02.11): getDataSourceMode() читает DOM через
  // isAi2Embedded() (querySelector script[src*="/_nexus/"]). На пререндере
  // document нет → MOCK; после синхро sync-ai2-static.mjs клиент видит LIVE →
  // hydration-расхождение бейджа = root-cause React #418 × 14 переходов.
  // Приём (б) 19f9a4ea: сервер печатает детерминированный дефолт ('MOCK'),
  // динамический режим клиент применяет post-mount — mismatch уходит.
  // (effectiveDsMode вычисляется ниже, после объявления mounted.)
  // XVI: правая докинг-панель — состояние сессии (hidden/push/fullscreen,
  // вкладки из слота rightbar.tabs). Жива до дерева: хоткей Ctrl+B
  // поднимает панель из скрытого состояния.
  const dock = useRightDock();
  // W4-1008 slideOut: прежний режим на окно exit-анимации (0ms → null при
  // reduced-motion — панель размонтируется мгновенно, как раньше).
  const dockExit = useDockExit(dock);
  // Модульные бары NUE: режим/сторона/размер каждого края — из профиля.
  const bars = useModularBars();
  // Frameless-окно (easy_drag=0 у хоста): перетаскивание — за тайтлбар
  // и топбар через pywebview-drag-region; ресайз — JS-зоны краёв → мост.
  // frameless запоминаем в sessionStorage: навигация по разделам идёт полной
  // перезагрузкой окна (статик-экспорт), и без кэша тайтлбар каждый раз ждал
  // бы async-детект — мигание хрома. Значение флага за время сессии окна не
  // меняется (задаётся при создании окна на хосте).
  // Мост всегда существует: ленивый читает window.pywebview.api в момент
  // вызова, поэтому тайтлбар рендерится по кэшу frameless до конца
  // async-детекта; когда api доинжектится, setBridge подставит живой.
  const [bridge, setBridge] = useState<NexusDesktopBridge>(
    () => getDesktopBridgeSync() ?? getDesktopBridgeLazy(),
  );
  const [frameless, setFrameless] = useState<boolean>(() => {
    try {
      return window.sessionStorage.getItem('nexus:frameless') === '1';
    } catch {
      return false;
    }
  });
  // mounted-гейт: SSR/первый клиентский кадр всегда без хрома окна — иначе
  // значения из sessionStorage/api дадут hydration-mismatch. Потеря — один
  // кадр, не секунды async-детекта, как было без кэша.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // #418: server/prerender — без бейджа источника (не выводим «MOCK» в raw
  // SSR HTML: настоящий источник определяется только после mount). После
  // mount — реальный режим (live/misconfigured/mock).
  const effectiveDsMode = mounted ? dsMode : null;
  // dsh-заимствования (BORROWED.md): журнал ошибок рендерера в localStorage
  // + theme-color зонд для браузерного хрома. Оба идемпотентны.
  useEffect(() => {
    installErrorJournal();
    installThemeColorProbe();
  }, []);
  // ALICE slideshow (wave-XXV W3): 51 слайдов по 33 с, crossfade.
  // #418 (wave #418-2): SSR/первый кадр → false (default theme);
  // profile themeId applies post-mount only.
  const isAliceTheme = mounted && (profile?.themeId ?? 'nexus') === 'alice';
  const shellRef = useRef<HTMLDivElement>(null);
  const navAtRight = bars.nav.side === 'right';
  const topHidden = bars.top.mode === 'hidden';
  const topAtBottom = bars.top.side === 'bottom';
  const headerActive = !topAtBottom && !topHidden;
  const floating = bars.positions;
  const topFloating = floating.top != null;
  const navFloating = floating.nav != null;
  const dockFloating = floating.dock != null;
  const beginMoveBar = (id: 'top' | 'bottom' | 'nav' | 'dock', orientation: 'horizontal' | 'vertical') =>
    (e: ReactPointerEvent<HTMLElement>) => beginBarMove(e, {
      id,
      orientation,
      shell: shellRef.current,
      floating: floating[id] != null,
      onFloat: (position) => bars.setPosition(id, position),
      onDock: (side) => bars.setSide(id, side),
    });
  const moveGrip = (id: 'top' | 'bottom' | 'nav' | 'dock', orientation: 'horizontal' | 'vertical') =>
    beginMoveBar(id, orientation);
  const moveBarSurface = (id: 'top' | 'bottom' | 'nav' | 'dock', orientation: 'horizontal' | 'vertical') =>
    (e: ReactPointerEvent<HTMLElement>) => {
      const target = e.target;
      if (target instanceof Element && target.closest(
        'button, a, input, textarea, select, summary, [role="button"], [role="slider"], [role="separator"], [contenteditable="true"]',
      )) return;
      beginMoveBar(id, orientation)(e);
    };
  const moveGripKey = (id: 'top' | 'bottom' | 'nav' | 'dock', orientation: 'horizontal' | 'vertical') =>
    (e: ReactKeyboardEvent<HTMLButtonElement>) => {
      const negative = orientation === 'horizontal' ? e.key === 'ArrowLeft' : e.key === 'ArrowUp';
      const positive = orientation === 'horizontal' ? e.key === 'ArrowRight' : e.key === 'ArrowDown';
      if (!negative && !positive) return;
      e.preventDefault();
      const shell = shellRef.current;
      const surface = shell?.querySelector<HTMLElement>(`[data-bar-surface="${id}"], [data-bar-id="${id}"]`);
      if (shell == null || surface == null) return;
      const shellRect = shell.getBoundingClientRect();
      const rect = surface.getBoundingClientRect();
      const current = floating[id] ?? { x: rect.left - shellRect.left, y: rect.top - shellRect.top };
      const delta = positive ? 16 : -16;
      const x = orientation === 'horizontal' ? current.x + delta : current.x;
      const y = orientation === 'vertical' ? current.y + delta : current.y;
      bars.setPosition(id, {
        x: Math.max(0, Math.min(shellRect.width - rect.width, x)),
        y: Math.max(0, Math.min(shellRect.height - rect.height, y)),
      });
    };
  const slideOrderRef = useRef<number[]>([]);
  const slideIndexRef = useRef(0);

  const shuffleSlides = useCallback(() => {
    const arr = Array.from({ length: 121 }, (_, i) => i);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    slideOrderRef.current = arr;
    slideIndexRef.current = 0;
  }, []);

  useEffect(() => {
    if (!isAliceTheme || !shellRef.current) return;
    const shell = shellRef.current;
    // Индекс — только ref: состояние никто не читал, setState на каждый тик
    // перерендеривал всю оболочку раз в 33 с без единого потребителя.
    shuffleSlides();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let img: HTMLImageElement | null = null;
    // Мягкий кроссфейд (было: opacity-дим всего окна 0.3 → мерцание).
    // Новый слайд грузится заранее, потом вводится слоем ::after поверх
    // текущего (data-sliding → opacity 1, 1.4с). По окончании картинка
    // становится базовой (--alice-slide на ::before), верхний слой
    // сбрасывается в 0 поверх того же изображения — снятие невидимо.
    const beginSlide = () => {
      const idx = slideIndexRef.current;
      const slideNum = slideOrderRef.current[idx] ?? idx;
      const n = String(slideNum + 1).padStart(2, '0');
      const url = `url('${ASSET_BASE}/slides/alice-slide-${n}-1280.webp')`;
      const im = new Image();
      img = im;
      // decode() даёт готовый битмап до старта фейда — без него распаковка
      // 1280px кадра ложится рывком на главный поток в момент смены.
      const beginFade = () => {
        if (!shell.isConnected) return;
        shell.style.setProperty('--alice-slide-2', url);
        shell.setAttribute('data-sliding', '');
        timer = setTimeout(() => {
          if (!shell.isConnected) return;
          shell.style.setProperty('--alice-slide', url);
          shell.removeAttribute('data-sliding');
          // --alice-slide-2 НЕ снимаем: ::after ещё 1.4с затухает к 0, и без
          // картинки на нём оставался бы один светлый scrim-градиент — это и
          // давало светлую вспышку после смены. С затуханием поверх того же
          // изображения снятие слоя невидимо; var перезапишется след. тиком.
          // Предзагрузка следующего слайда — к его тику он уже декодирован.
          const nextIdx = (slideIndexRef.current + 1) % 121;
          const nextNum = slideOrderRef.current[nextIdx] ?? nextIdx;
          const nextN = String(nextNum + 1).padStart(2, '0');
          const pre = new Image();
          pre.src = ASSET_BASE + '/slides/alice-slide-' + nextN + '-1280.webp';
          pre.decode?.().catch(() => { });
        }, 1500);
      };
      im.src = `${ASSET_BASE}/slides/alice-slide-${n}-1280.webp`;
      if (im.decode != null) {
        im.decode().then(beginFade, () => { im.onload = beginFade; });
      } else {
        im.onload = beginFade;
      }
    };
    beginSlide();
    const stopSlideLoop = runWhileDocumentVisible(() => {
      slideIndexRef.current = (slideIndexRef.current + 1) % 121;
      if (slideIndexRef.current === 0) shuffleSlides();
      beginSlide();
    }, 33000);
    return () => {
      stopSlideLoop();
      if (timer) clearTimeout(timer);
      if (img) img.onload = null;
      shell.removeAttribute('data-sliding');
    };
  }, [isAliceTheme, shuffleSlides]);
  useEffect(() => {
    let on = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    // pywebview инжектит window.pywebview.api асинхронно — на холодном
    // старте WebView2 это может занять десятки секунд. Поллим до ~минуты,
    // а не сдаёмся после двух проходов: промах в browser-fallback раньше
    // навсегда прятал тайтлбар. Кэш frameless пишется ТОЛЬКО по авторитетному
    // ответу хоста (b.available) — фолбэк isFrameless() всегда false, и его
    // запись отравляла сессию '0'.
    const detect = () => {
      getDesktopBridge({ timeoutMs: 5000 })
        .then((b) => {
          if (!on) return null;
          if (!b.available) {
            if (attempt < 12) {
              attempt += 1;
              retry = setTimeout(detect, 3000);
            }
            return null;
          }
          setBridge(b);
          return b.isFrameless();
        })
        .then((f) => {
          if (!on || f == null) return;
          setFrameless(f);
          try {
            window.sessionStorage.setItem('nexus:frameless', f ? '1' : '0');
          } catch { /* storage недоступен — бар остаётся на флаге состояния */ }
        })
        .catch(() => { });
    };
    detect();
    return () => {
      on = false;
      if (retry) clearTimeout(retry);
    };
  }, []);

  // Персист прозрачности окна: сохранённое значение применяется, когда
  // мост доступен (старт оболочки / детект api). 100 % не применяем —
  // дефолт окна и так непрозрачный, лишний Win32-вызов не нужен.
  const windowOpacityPct = profile?.windowOpacity;
  useEffect(() => {
    if (!bridge.available || windowOpacityPct == null || windowOpacityPct >= 100) return;
    void bridge.setWindowOpacity(windowOpacityPct / 100);
  }, [bridge, windowOpacityPct]);

  // Приоритет 16.10: три состояния левой панели — full | strip | hidden.
  // Чтение профиля: navMode ?? (navCollapsed ? 'hidden' : 'full') — старый
  // флаг (значил «всё скрыто») мапится на hidden; запись держит оба поля
  // согласованными (navCollapsed=true только при hidden).
  const navMode: 'full' | 'strip' | 'hidden' =
    mounted
      ? profile?.navMode ?? (profile?.navCollapsed === true ? 'hidden' : 'full')
      : 'full'; // #418 (wave #418-2): SSR/first-frame default; profile value applies post-mount
  const setNavMode = (m: 'full' | 'strip' | 'hidden') =>
    updateProfile({ navMode: m, navCollapsed: m === 'hidden' });
  // W4-1012 railOut: прежний режим на окно exit-анимации при →hidden.
  const navExit = useNavExit(navMode);
  // Клик по кнопке — цикл состояний; двойной клик скрывает левый рельс.
  const cycleNavMode = () =>
    setNavMode(navMode === 'full' ? 'strip' : navMode === 'strip' ? 'hidden' : 'full');

  // main-delta #13: Cmd-K палитра — индекс = разделы (статика) + прогоны и
  // агенты из источника. Данные подтягиваются лениво при первом открытии —
  // на каждый mount страницы лишних запросов нет.
  const ds = useDataSource(); // #418 (wave #418-2): mount-gated
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteExtra, setPaletteExtra] = useState<CommandItem[] | null>(null);
  const [paletteRecent, setPaletteRecent] = useState<CommandItem[]>([]);
  const openPalette = () => setPaletteOpen(true);
  useEffect(() => {
    if (!paletteOpen) return;
    setPaletteRecent(readRecentPaletteItems());
  }, [paletteOpen]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchesShortcut(e, 'palette.modk')) {
        e.preventDefault();
        openPalette();
        return;
      }
      if (matchesShortcut(e, 'palette.alt0')) {
        e.preventDefault();
        openPalette();
        return;
      }
      const shortcut = matchKeyboardShortcut(e);
      const railMatch = shortcut?.id.match(/^rail\.section\.(\d)$/);
      const idx = railMatch == null ? -1 : Number(railMatch[1]) - 1;
      const target = idx >= 0 ? SECTIONS[idx] : undefined;
      const href = target != null ? sectionHref(target) : null;
      if (href != null) {
        e.preventDefault();
        router.push(href);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  useEffect(() => {
    if (!paletteOpen || paletteExtra != null) return;
    let alive = true;
    Promise.all([
      ds.listRuns({ limit: 8 }).catch(() => null),
      ds.listAgents().catch(() => null),
      ds.bus != null ? ds.bus.listSessions().catch(() => null) : Promise.resolve(null),
      ds.opencode != null ? ds.opencode.listCommands().catch(() => null) : Promise.resolve(null),
    ]).then(
      ([runs, agents, sessions, ocCmds]) => {
        if (!alive) return;
        const windows = sessions == null
          ? []
          : Array.from(new Map(sessions.map((s) => [s.window, s])).values());
        setPaletteExtra([
          ...(runs ?? []).map((r) => ({ id: `run:${r.runId}`, label: r.taskText, hint: 'прогон' })),
          ...(agents ?? []).map((a) => ({ id: `agent:${a.name}`, label: a.name, hint: 'агент' })),
          ...windows.map((w) => ({ id: `bus:${w.window}`, label: w.title, hint: 'окно' })),
          ...(ocCmds ?? []).map((c) => ({ id: `oc:${c.id}`, label: c.label, hint: 'opencode' })),
        ]);
      },
    );
    return () => { alive = false; };
  }, [paletteOpen, paletteExtra, ds]);
  // wave-XII header-search: серверный поиск по памяти — debounce, verbatim
  // текст записи; ошибка источника → подмешанных пунктов нет (честно молчим,
  // локальные результаты продолжают фильтроваться). Query последнего вызова
  // нужна пункту памяти для перехода на /memory?tab=archive&q=…
  const [memQuery, setMemQuery] = useState('');
  const [memItems, setMemItems] = useState<CommandItem[]>([]);
  useEffect(() => {
    if (!paletteOpen) { setMemItems([]); setMemQuery(''); return; }
    const q = memQuery.trim();
    if (q.length < 2) { setMemItems([]); return; }
    let alive = true;
    const t = setTimeout(() => {
      ds.searchMemory(q).then(
        (hits) => {
          if (!alive) return;
          setMemItems(
            hits.slice(0, 6).map((h) => ({
              id: `mem:${h.id}`,
              label: h.text.length > 80 ? `${h.text.slice(0, 80)}…` : h.text,
              hint: 'память',
            })),
          );
        },
        () => { if (alive) setMemItems([]); },
      );
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [paletteOpen, memQuery, ds]);
  const paletteItems = useMemo<CommandItem[]>(
    () => [
      // Палитра индексирует конечные экраны: у разделов с подэкранами —
      // дети, у одиночных — сам раздел. Hint показывает раздел-владелец.
      ...SECTIONS.flatMap((s) =>
        s.children?.length
          ? s.children.map((c) => ({ id: `nav:${c.href}`, label: c.label, hint: s.label }))
          : [{ id: `nav:${s.href}`, label: s.label, hint: 'раздел' }],
      ),
      ...SECONDARY_PALETTE_ROUTES.map((route) => ({
        id: `nav:${route.href}`,
        label: route.label,
        hint: 'Ещё',
      })),
      ...(programsManifest?.programs ?? [])
        .filter((p) => p.href != null)
        .map((p) => ({
          id: `program:${p.id}`,
          label: p.nexusName,
          hint: 'программа',
        })),
      ...(paletteExtra ?? []),
    ],
    [paletteExtra, programsManifest],
  );

  // «Недавнее» — last-used пункты ПОВЕРХ статических. Внутри static-набора
  // id уже есть (например program:bus), поэтому recent-дубликаты не
  // добавляются — иначе Cmd+K покажет два одинаковых пункта.
  const recentPaletteItems = useMemo(() => paletteRecent, [paletteRecent]);
  const palettePick = useMemo(() => {
    const known = new Set(paletteItems.map((i) => i.id));
    return [
      ...recentPaletteItems.filter((r) => !known.has(r.id)),
      ...paletteItems,
    ];
  }, [paletteItems, recentPaletteItems]);

  // Верхняя полоса WindowFrame: brand | tabs(поиск по центру) | tools.
  // Поиск — тот же вход в командную палитру, что Ctrl+K; живёт только на
  // сцене ALICE-home (эталон ALICEhome), чтобы прочие маршруты не получали
  // чужой ритм полосы.
  // #418 (wave #418-2): SSR prerenders the bare route '/home'; the AI-2 host
  // serves the page under an asset prefix so usePathname() first frame reads
  // '/_nexus/home.html'. Gate on `mounted` so both sides render topSearch=null
  // (frameTabs empty) on the first committed frame; the real pathname applies
  // post-mount, by which point the router has resolved the bare route.
  const aliceHomeBar = mounted && ALICE_HOME_ROUTES.includes(pathname);
  const topSearch = aliceHomeBar ? (
    <button
      type="button"
      className={styles.topSearch}
      onClick={openPalette}
      aria-label="Поиск разделов, прогонов и агентов — командная палитра"
      title="Командная палитра"
      data-testid="topbar-search"
    >
      <NexusIcon name="nav.search" size={16} />
      {/* Подпись = что палитра действительно ищет: разделы, прогоны, агенты,
          записи памяти (см. placeholder CommandPalette). */}
      <span className={styles.topSearchLabel}>Поиск разделов, прогонов, агентов…</span>
      <kbd className={styles.topSearchKbd} aria-hidden="true">
        {shortcutHint('palette.modk')}
      </kbd>
    </button>
  ) : undefined;
  const topBrand = (
    <>
      <button
        type="button"
        className={styles.navToggle}
        aria-pressed={navMode !== 'full'}
        aria-label={
          navMode === 'full'
            ? 'Свернуть панель разделов (клик — в узкую полосу, двойной клик — скрыть)'
            : navMode === 'strip'
              ? 'Свернуть полосу разделов (клик — скрыть, двойной клик — скрыть)'
              : 'Показать панель разделов'
        }
        title={
          navMode === 'full'
            ? 'Свернуть в узкую полосу · двойной клик — скрыть'
            : navMode === 'strip'
              ? 'Скрыть панель · двойной клик — скрыть'
              : 'Показать панель разделов'
        }
        onClick={cycleNavMode}
        onDoubleClick={() => setNavMode('hidden')}
        data-testid="nav-toggle"
      >
        {navMode === 'full' ? '❬' : '❭'}
      </button>
      <span className={styles.brand}>NEXUS</span>
      <span className={styles.identity} title="Профиль локальный — данные рантайма остаются на сервере">
        {/* #418 (wave #418-2): profile/agentPersonaName only after mount — SSR and
            first CSR frame both render '—' · 'NEXUS'; the real values apply post-mount. */}
        {(mounted ? profile?.name || '—' : '—')} · {(mounted ? agentPersonaName : 'NEXUS')}
      </span>
      {!persisted && (
        <StatusBadge status="warning" label="Профиль не сохраняется" data-testid="profile-unpersisted" />
      )}
    </>
  );
  // main-delta #15: bell + datetime — правый кластер полосы эталона.
  const topTools = (
    <>
      {/* Группы правого кластера разделены волосиной: без неё восемь
          разнотипных контролов читались как одна шумная строка. */}
      <span className={styles.topToolGroup}>
        <Tooltip content="Переместить шапку" kbd="← / →">
          <BarDragGrip label="Переместить шапку; стрелки ←/→ двигают на 16 px" onPointerDown={moveGrip('top', 'horizontal')} onKeyDown={moveGripKey('top', 'horizontal')} />
        </Tooltip>
        <BarTools
          onMove={() => bars.move('top')}
          onToggleSlim={() => bars.setTopMode(bars.top.mode === 'slim' ? 'full' : 'slim')}
          onClose={() => bars.setTopMode('hidden')}
          slim={bars.top.mode === 'slim'}
          moveLabel={bars.top.side === 'bottom' ? 'Шапку наверх' : 'Шапку вниз'}
          slimLabel={bars.top.mode === 'slim' ? 'Развернуть шапку' : 'Свернуть шапку в тонкую полосу'}
          closeLabel="Закрыть шапку (вернуть — полоса у края)"
        />
      </span>
      <span className={styles.topDivider} aria-hidden="true" />
      <RightDockToggle dock={dock} />
      <WindowOpacityCtl bridge={bridge} />
      <span className={styles.topDivider} aria-hidden="true" />
      {/* #418 (wave #418-2): SSR/первый кадр → false (default); profile value post-mount */}
      <NotificationBell bridge={bridge} osNotificationsEnabled={mounted && profile?.osNotifications === true} />
      <Clock />
      <span className={styles.topDivider} aria-hidden="true" />
      <FsAccessControl />
      <StatusBadge
        status={sourceBadgeView(effectiveDsMode).status}
        label={sourceBadgeView(effectiveDsMode).label}
        data-testid="source-badge"
        title={sourceBadgeView(effectiveDsMode).title}
      />
      {mounted && frameless && headerActive && !topFloating && <TrafficLights bridge={bridge} />}
    </>
  );

  const { section: activeSection, leaf: activeLeaf } = navPosition(pathname);
  // #418 (wave #418-2, regression on /agents /data /settings): the app is
  // served under a host asset prefix in the synced static export — the client's
  // usePathname() first frame reads the page URL `/_nexus/<route>.html`, not
  // the bare route `/agents` that SSR prerendered against. navPosition() on
  // that prefixed path returns null, so the client's first frame renders the
  // icon-rail with NO active section/leaf while the server emitted
  // data-active="true" on the matching section → React #418 (the rail
  // `<li>` in the NX-HYD chain). Gate the rail's active state on `mounted`
  // (same "приём (б)" as effectiveDsKind below): server and the first CSR
  // frame both render an inactive rail; the real active section/leaf applies
  // post-mount, by which point the router has resolved the bare pathname.
  const railActiveId = mounted ? activeLeaf?.id ?? activeSection?.id : undefined;
  const sidebar = (
    <div
      className={styles.navDock}
      data-bar-surface={!navFloating ? 'nav' : undefined}
      onPointerDown={moveBarSurface('nav', 'vertical')}
    >
      <IconRail
        variant="list"
        aria-label="Разделы"
        sections={SECTIONS}
        activeId={railActiveId}
        onPrefetch={prefetchHref}
        header={
          <>
            <BarTools
              onMove={() => bars.move('nav')}
              onToggleSlim={() => setNavMode('strip')}
              onClose={() => setNavMode('hidden')}
              slim={false}
              moveLabel={bars.nav.side === 'right' ? 'Навигацию влево' : 'Навигацию вправо'}
              slimLabel="Свернуть навигацию в иконки"
              closeLabel="Скрыть навигацию (вернуть — полоса у края)"
            />
            {/* Ручка перемещения пузыря — у правого края шапки (аннотация
              владельца 2026-10-29); вордмарк NEXUS убран: он дублировал
              бренд топбара над панелью. */}
            <span className={styles.railGrip}>
              <Tooltip content="Переместить панель разделов" kbd="↑ / ↓">
                <BarDragGrip label="Переместить панель разделов; стрелки ↑/↓ двигают на 16 px" onPointerDown={moveGrip('nav', 'vertical')} onKeyDown={moveGripKey('nav', 'vertical')} />
              </Tooltip>
            </span>
          </>
        }
        onSelect={(id) => {
          const leaf = SECTIONS.flatMap((s) => s.children ?? []).find((c) => c.id === id);
          const sec = leaf != null ? undefined : SECTIONS.find((s) => s.id === id);
          const secondary = SECONDARY_PALETTE_ROUTES.find((route) => `nav:${route.href}` === id);
          const href = leaf?.href ?? (sec != null ? sectionHref(sec) : secondary?.href ?? null);
          if (href != null) router.push(href);
        }}
        footer={
          <>
            {/* #53 (листы ALICE): под списком разделов — связанные агенты
              с реальным состоянием процессов, карточка NEXUS CORE,
              затем Settings и профиль оператора. */}
            <RailLinkedAgents />
            {/* Отдельной строки «Настройки» в подвале нет: раздел списка уже
                даёт и пункт, и подэкраны (Общие / Плагины), а
                aria-current="page" по контракту гейта ровно один в nav. */}
            {/* Профиль внизу сайдбара — круглый аватар с инициалом, как в
              reference MAIN.png («JD · Jordan Day · Operator»). */}
            <Link href="/settings" prefetch={false} className={styles.sideProfile} title="Профиль оператора — Настройки">
              <span className={styles.sideAvatar} aria-hidden="true">
                {/* #418 (wave #418-2): SSR/first-frame renders 'N'; profile applies post-mount */}
                {(mounted ? ((profile?.name ?? '').trim()[0] ?? 'N') : 'N').toUpperCase()}
              </span>
              <span className={styles.sideProfileText}>
                <span className={styles.sideProfileName}>{mounted ? (profile?.name?.trim() || 'Оператор') : 'Оператор'}</span>
                <span className={styles.sideProfileRole}>{mounted ? agentPersonaName : 'NEXUS'} · агент</span>
              </span>
            </Link>
            <RailCoreCard />
            <RailDeckAgents />
          </>
        }
      />
      {/* Кромка растягивания рейла: ширина 200…480 px, в профиль. */}
      <BarHandle
        edge={bars.nav.side === 'right' ? 'left' : 'right'}
        label="Ширина панели разделов — тянуть или стрелки ←/→"
        onDragStart={(e) =>
          beginBarDrag(e, {
            axis: 'x',
            start: bars.nav.width ?? 272,
            min: 200,
            max: 480,
            sign: bars.nav.side === 'right' ? -1 : 1,
            apply: bars.setNavWidth,
            // Live: только CSS var на shellWrap — без записи профиля и
            // ре-рендера оболочки на каждый pointermove; профиль — на pointerup.
            live: (px) => {
              if (navFloating) {
                shellRef.current?.querySelector<HTMLElement>('[data-bar-id="nav"]')
                  ?.style.setProperty('width', `${px}px`);
              } else {
                shellRef.current?.style.setProperty(
                  navAtRight ? '--nexus-window-frame-right-width' : '--nexus-frame-left', `${px}px`);
              }
            },
            commit: bars.setNavWidth,
          })
        }
        onKeyStep={(dir) => bars.setNavWidth((bars.nav.width ?? 272) + dir * 16)}
        value={bars.nav.width ?? 272}
        min={200}
        max={480}
      />
    </div>
  );

  // Нижняя строка подсказок снята (аннотация владельца 2026-10-29): хоткеи
  // живут в палитре (Ctrl+K) и в справке «?», отдельный бар не нужен.
  // bars.bottom остаётся в профиле (совместимость формы состояния), но
  // больше не рендерится и не занимает слот WindowFrame.


  // BARE_ROUTES (VII V1.5): приветствие и выбор ассистента полноэкранные —
  // без WindowFrame/рейла; frameless-окно сохраняет невидимую drag-полосу
  // со «светофором» и зоны ресайза (экран без хрома не должен терять
  // управление окном).
  const bare = BARE_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
  // #418 (wave #418-2, QODER §14): gate the profile theme on `mounted`.
  // useProfile's getServerSnapshot returns null, so SSR prerenders the default
  // nexus theme; the client's first frame must match it, or React discards
  // the whole [data-nexus-root] subtree (hydration #418). Post-mount the
  // profile theme/density apply — the document mirror follows in the same
  // frame via NexusThemeProvider's useLayoutEffect.
  const theme = mounted ? profile?.themeId ?? 'nexus' : 'nexus';
  const density = mounted ? profile?.density ?? 'standard' : 'standard';
  if (bare) {
    return (
      <NexusThemeProvider theme={theme} density={density}>
        <div className={styles.windowRoot}>
          {mounted && frameless && (
            <div
              className={`${styles.bareDrag} pywebview-drag-region`}
              onMouseDown={onWindowDragRegionMouseDown}
              onContextMenu={onWindowDragRegionContextMenu}
              title="Правая кнопка + перетаскивание — перемещение окна"
            >
              <TrafficLights bridge={bridge} />
            </div>
          )}
          {/* Landmark-контракт app-shell.spec: ровно один <main> на каждом
              экране, включая bare-роуты без WindowFrame. */}
          <main className={styles.bareMain}><ShellErrorBoundary>{children}</ShellErrorBoundary></main>
          {mounted && frameless && <ResizeZones bridge={bridge} />}
        </div>
      </NexusThemeProvider>
    );
  }

  // --- Модульные бары NUE: стороны из профиля, слоты раздаются по ним. --
  const railStripNode = (
    <RailStrip
      // #418 (wave #418-2): same mounted-gate as railActiveId — the strip
      // mirrors the icon-rail active state; without it the first CSR frame
      // (prefixed usePathname) diverges from the SSR prerender.
      activeSectionId={mounted ? activeSection?.id ?? null : null}
      activeLeafId={mounted ? activeLeaf?.id ?? null : null}
      onPalette={openPalette}
      onNavigate={(href) => router.push(href)}
      onPrefetch={prefetchHref}
      side={navAtRight ? 'right' : 'left'}
      tools={
        <>
          <Tooltip content="Переместить панель разделов" kbd="↑ / ↓">
            <BarDragGrip label="Переместить панель разделов; стрелки ↑/↓ двигают на 16 px" onPointerDown={moveGrip('nav', 'vertical')} onKeyDown={moveGripKey('nav', 'vertical')} />
          </Tooltip>
          <BarTools
            onMove={() => bars.move('nav')}
            onToggleSlim={() => setNavMode('full')}
            onClose={() => setNavMode('hidden')}
            slim
            moveLabel={navAtRight ? 'Навигацию влево' : 'Навигацию вправо'}
            slimLabel="Развернуть навигацию"
            closeLabel="Скрыть навигацию (вернуть — полоса у края)"
          />
        </>
      }
    />
  );
  const navContent =
    navMode === 'full' ? (
      sidebar
    ) : navMode === 'strip' ? (
      railStripNode
    ) : navExit != null ? (
      /* railOut keep-alive: прежний рейл инертен и отыгрывает exit-fade;
         колонка держит прежнюю ширину и схлопывается после размонтирования —
         fade не гоняет перекомпоновку контента (зеркало dockExit). */
      <div data-nav-exit inert style={{ display: 'contents' }}>
        {navExit === 'full' ? sidebar : railStripNode}
      </div>
    ) : (
      /* hidden: пустой держатель колонки — ширина анимируется
         к 0, навигации в дереве нет вовсе (честное «всё скрыто»,
         без aria-hidden на фокусируемом контенте). */
      <div className={styles.stripHidden} aria-hidden="true" />
    );

  const dockPanel =
    dock.state.mode === 'hidden' ? (
      dockExit == null ? undefined : (
        // Keep-alive кадр: режим заморожен на прежнем, панель инертна и
        // отыгрывает slideOut; колонка держит прежнюю ширину и схлопывается
        // после размонтирования — fade не гоняет перекомпоновку контента.
        <RightDockPanel
          dock={{ ...dock, state: { ...dock.state, mode: dockExit } }}
          side={bars.dockSide}
          onMove={() => bars.move('dock')}
          onDragStart={moveGrip('dock', 'vertical')}
          onDragKeyDown={moveGripKey('dock', 'vertical')}
          onSurfacePointerDown={moveBarSurface('dock', 'vertical')}
          floating={dockFloating}
          exiting
        />
      )
    ) : (
      <RightDockPanel
        dock={dock}
        side={bars.dockSide}
        onMove={() => bars.move('dock')}
        onDragStart={moveGrip('dock', 'vertical')}
        onDragKeyDown={moveGripKey('dock', 'vertical')}
        onSurfacePointerDown={moveBarSurface('dock', 'vertical')}
        floating={dockFloating}
      />
    );

  // Шапка, перенесённая вниз: тот же brand|tools, горизонтальная строка.
  const topbarDock = topAtBottom && !topHidden && !topFloating ? (
    <div
      className={`${styles.topbarDock}${mounted && frameless ? ' pywebview-drag-region' : ''}`}
      data-bar-surface="top"
      title={mounted && frameless ? 'Правая кнопка + перетаскивание — перемещение окна' : undefined}
      data-testid="topbar-bottom"
      onPointerDown={moveBarSurface('top', 'horizontal')}
      onMouseDown={onWindowDragRegionMouseDown}
      onContextMenu={onWindowDragRegionContextMenu}
    >
      <div className={styles.topbarCluster}>{topBrand}</div>
      <div className={styles.topbarSpacer} />
      <div className={styles.topbarCluster}>{topTools}</div>
    </div>
  ) : undefined;

  // Шапка: slim — 44 px; перенос/скрытие — минимальная полоса (в frameless
  // остаётся drag-зоной со «светофором», в браузере header не рендерится).
  const headerH = headerActive
    ? bars.top.mode === 'slim'
      ? 44
      : (bars.top.height ?? 72)
    : 44;

  // При exit keep-alive колонка сохраняет прежнюю ширину: панель гаснет
  // на месте, схлопывание колонки начинается после её размонтирования.
  const dockW = dock.state.mode === 'hidden' && dockExit != null
    ? rightDockWidth({ ...dock.state, mode: dockExit })
    : rightDockWidth(dock.state);
  const shellVars = {
    '--nexus-window-frame-header-height': `${headerH}px`,
  } as CSSProperties;
  // ALICE-home: единая заливка — увеличенная сцена дома (outpaint 2048×1152)
  // лежит под всей рамкой: рейл, шапка и контент берут один и тот же кадр,
  // поэтому второго кропа той же картинки на стекле больше нет.
  let shellScene: string | undefined;
  if (mounted) {
    const vars = shellVars as Record<string, string>;
    if (ALICE_HOME_ROUTES.includes(pathname)) {
      vars['--nexus-frame-scene'] = artAssetUrl('alice-home-extended.png');
      shellScene = 'alice-home';
    }
    // W4-1012: в keep-alive окне колонка держит прежнюю ширину рейла —
    // схлопывание к 0 начинается после размонтирования exit-кадра.
    const navColWidth = navFloating
      ? 0
      : navMode === 'hidden'
        ? (navExit == null ? 0 : navExit === 'strip' ? 56 : (bars.nav.width ?? 272))
        : navMode === 'strip' ? 56 : (bars.nav.width ?? 272);
    if (navAtRight) {
      // Рейл справа: правой колонкой управляет его ширина; слева — док.
      vars['--nexus-window-frame-right-width'] = `${navColWidth}px`;
      if ((dock.state.mode !== 'hidden' || dockExit != null) && !dockFloating) vars['--nexus-frame-left'] = `${dockW}px`;
      else if (dockFloating) vars['--nexus-frame-left'] = '0px';
    } else {
      if (!navFloating && navExit != null)
        vars['--nexus-frame-left'] = `${navExit === 'strip' ? 56 : (bars.nav.width ?? 272)}px`;
      else if (!navFloating && navMode === 'full' && bars.nav.width != null)
        vars['--nexus-frame-left'] = `${bars.nav.width}px`;
      else if (navFloating) vars['--nexus-frame-left'] = '0px';
      vars['--nexus-window-frame-right-width'] = `${(dock.state.mode !== 'hidden' || dockExit != null) && !dockFloating ? dockW : 0}px`;
    }
  }

  return (
    <NexusThemeProvider theme={theme} density={density}>
      <div className={styles.windowRoot}>
        <div
          className={styles.shellWrap}
          data-app-shell
          data-nav={navFloating ? 'hidden' : navMode}
          data-nav-side={navAtRight ? 'right' : 'left'}
          data-scene={shellScene}
          ref={shellRef}
          style={shellVars}
        >
          <WindowFrame
            nav={navFloating ? 'hidden' : navMode}
            navSide={navAtRight ? 'right' : 'left'}
            brand={headerActive && !topFloating ? topBrand : undefined}
            tabs={headerActive && !topFloating ? topSearch : undefined}
            tools={
              headerActive && !topFloating
                ? topTools
                : mounted && frameless
                  ? <TrafficLights bridge={bridge} />
                  : undefined
            }
            // #53: data-persona на frameEdge — волосина рамки по ассистенту
            // (канон: геометрия одна, цвет по персоне) и селектор сцен.
            data-persona={mounted ? (profile?.agentId ?? 'nexus') : 'nexus'}
            // XVI: ширины колонок — shellVars на shellWrap выше (гейт
            // mounted против hydration-mismatch по style, NQ-103).
            right={navAtRight ? (navFloating ? undefined : navContent) : (dockFloating ? undefined : dockPanel)}
            left={navAtRight ? (dockFloating ? undefined : dockPanel) : (navFloating ? undefined : navContent)}
            bottom={topbarDock}
            // frameless-окно: верхняя полоса — drag-регион pywebview.
            // Верхняя полоса остаётся прозрачным drag-регионом поверх общей сцены.
            topProps={{
              className: `${mounted && frameless ? 'pywebview-drag-region ' : ''}${styles.frameTopGlow} ${styles.frameTopGlass}`.trim(),
              onMouseDown: onWindowDragRegionMouseDown,
              onContextMenu: onWindowDragRegionContextMenu,
              title: mounted && frameless ? 'Правая кнопка + перетаскивание — перемещение окна' : undefined,
              'data-bar-surface': headerActive && !topFloating ? 'top' : undefined,
              'data-bar-mode': headerActive && !topFloating ? bars.top.mode : undefined,
              onPointerDown: moveBarSurface('top', 'horizontal'),
            }}
          >
            <ShellErrorBoundary>{children}</ShellErrorBoundary>
          </WindowFrame>
          <div
            className={styles.floatingBarLayer}
            data-floating-overlay
            role="region"
            aria-label="Плавающие панели и сообщения"
          >
            {topFloating && !topHidden && (
              <div
                className={`${styles.floatingBar} ${styles.floatingBarTop}${mounted && frameless ? ' pywebview-drag-region' : ''}`}
                data-bar-surface="top"
                data-bar-id="top"
                onMouseDown={onWindowDragRegionMouseDown}
                onContextMenu={onWindowDragRegionContextMenu}
                onPointerDown={moveBarSurface('top', 'horizontal')}
                style={{
                  left: floating.top!.x,
                  top: floating.top!.y,
                  height: bars.top.height ?? headerH,
                }}
              >
                <div className={styles.topbarCluster}>{topBrand}</div>
                <div className={styles.topbarSpacer} />
                <div className={styles.topbarCluster}>{topTools}</div>
                {bars.top.mode !== 'slim' && (
                  <span
                    className={styles.floatingTopResize}
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label="Высота плавающей шапки — тянуть или стрелки ↑/↓"
                    aria-valuenow={bars.top.height ?? headerH}
                    aria-valuemin={44}
                    aria-valuemax={120}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                      e.preventDefault();
                      bars.setTopHeight((bars.top.height ?? headerH) + (e.key === 'ArrowDown' ? 8 : -8));
                    }}
                    onPointerDown={(e) => {
                      const surface = e.currentTarget.closest<HTMLElement>('[data-bar-id="top"]');
                      beginBarDrag(e, {
                        axis: 'y',
                        start: bars.top.height ?? headerH,
                        min: 44,
                        max: 120,
                        sign: 1,
                        apply: bars.setTopHeight,
                        live: (px) => surface?.style.setProperty('height', `${px}px`),
                        commit: bars.setTopHeight,
                      });
                    }}
                  />
                )}
              </div>
            )}
            {navFloating && navMode !== 'hidden' && (
              <div
                className={`${styles.floatingBar} ${styles.floatingBarNav}`}
                data-bar-surface="nav"
                data-bar-id="nav"
                onPointerDown={moveBarSurface('nav', 'vertical')}
                style={{ left: floating.nav!.x, top: floating.nav!.y, width: bars.nav.width ?? 272 }}
              >
                {navContent}
              </div>
            )}
            {dockFloating && dockPanel != null && (
              <div
                className={`${styles.floatingBar} ${styles.floatingBarDock}`}
                data-bar-surface="dock"
                data-bar-id="dock"
                onPointerDown={moveBarSurface('dock', 'vertical')}
                style={{ left: floating.dock!.x, top: floating.dock!.y, width: dockW }}
              >
                {dockPanel}
              </div>
            )}
          </div>
          {/* Кромка ресайза шапки — в оверлее shellWrap у нижней кромки
              header'а (в самой шапке drag-зона frameless, детям нельзя). */}
          {headerActive && !topFloating && bars.top.mode !== 'slim' && (
            <span
              className={styles.topResize}
              role="separator"
              aria-orientation="horizontal"
              aria-label="Высота шапки — тянуть или стрелки ↑/↓"
              aria-valuenow={headerH}
              aria-valuemin={44}
              aria-valuemax={120}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                e.preventDefault();
                bars.setTopHeight(headerH + (e.key === 'ArrowDown' ? 8 : -8));
              }}
              onPointerDown={(e) =>
                beginBarDrag(e, {
                  axis: 'y',
                  start: headerH,
                  min: 44,
                  max: 120,
                  sign: 1,
                  apply: (px) => bars.setTopHeight(px),
                  // Live: var на shellWrap двигает и шапку, и content-окно;
                  // профиль — однократно на pointerup.
                  live: (px) => shellRef.current?.style.setProperty(
                    '--nexus-window-frame-header-height', `${px}px`),
                  commit: (px) => bars.setTopHeight(px),
                })
              }
            />
          )}
          {/* Полосы-возврат закрытых баров: всегда доступный путь открыть
              бар обратно, иначе при закрытой шапке UI был бы безвыходным. */}
          {topHidden && (
            <BarEdge
              side={topAtBottom ? 'bottom' : 'top'}
              label="Показать шапку"
              onRestore={() => bars.setTopMode('full')}
            />
          )}
          {navMode === 'hidden' && (
            <BarEdge
              side={navAtRight ? 'right' : 'left'}
              label="Показать панель разделов"
              onRestore={() => setNavMode('full')}
            />
          )}
          {dock.state.mode === 'hidden' && (
            <Tooltip content="Показать правую панель" kbd={shortcutHint('dock.toggle')}>
              <BarEdge
                side={bars.dockSide}
                label="Показать правую панель"
                onRestore={() => dock.setMode('push')}
                nativeTitle={false}
              />
            </Tooltip>
          )}
        </div>
        {mounted && frameless && <ResizeZones bridge={bridge} />}
        {paletteOpen && (
          <CommandPaletteLazy
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            items={palettePick}
            serverItems={memItems}
            placeholder="Раздел, прогон, агент или запись памяти…"
            onQuery={setMemQuery}
            onSelect={(id) => {
              const [kind, ...rest] = id.split(':');
              const target = rest.join(':');
              const sel = paletteItems.find((i) => i.id === id) ?? recentPaletteItems.find((i) => i.id === id);
              if (sel != null) {
                pushRecentPaletteItem(sel);
                setPaletteRecent([sel, ...recentPaletteItems.filter((i) => i.id !== sel.id)].slice(0, RECENT_PALETTE_LIMIT));
              }
              if (kind === 'nav') router.push(target);
              else if (kind === 'run') router.push(`/runtime?run=${encodeURIComponent(target)}`);
              else if (kind === 'agent') router.push('/agents');
              else if (kind === 'bus') router.push('/runtime?tab=bus');
              else if (kind === 'oc') router.push('/settings');
              else if (kind === 'program') {
                const href = programsManifest?.programs.find((p) => p.id === target)?.href;
                if (href != null) router.push(href);
              }
              else if (kind === 'mem') {
                const q = memQuery.trim();
                router.push(`/memory?tab=archive${q ? `&q=${encodeURIComponent(q)}` : ''}`);
              }
            }}
          />
        )}
        <ShortcutsHintLazy />
      </div>
    </NexusThemeProvider>
  );
}
