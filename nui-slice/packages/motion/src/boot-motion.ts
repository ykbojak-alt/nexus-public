/**
 * Boot-motion family — волна XIV W4: движение стартового экрана
 * загрузки NEU (экран строит W3). Авторская хореография — как у
 * game-motion — живёт вне замороженной шкалы (80/140/240/420/700):
 * handoff-вейл держит полосу 600–900 мс из брифа, фигура ассистента
 * доходит до 900 мс. Значения зеркалируют токены (та же конвенция,
 * что presets.ts/game-motion.ts).
 *
 * Полоса прогресса анимирует только реальные приращения value —
 * никакого фальшивого ускорения: глагол `fill` — переход ширины к
 * уже наблюдаемому проценту; неизвестный этап — `shimmer` (движущийся
 * маркер над пустой дорожкой) вместо выдуманной доли.
 *
 * Reduced-motion/snapshot: всё схлопывается в 0ms — экран доходит до
 * конечного состояния мгновенно (упрощённый вариант = статика).
 */

/** Семантические глаголы стартового экрана. */
export type BootMotionVerb =
  | 'emblem'    // 700ms — появление логотипа NEXUS (fade+rise)
  | 'figure'    // 900ms — проявление образа ассистента (fade+scale)
  | 'fill'      // 240ms — подрастание полосы к реальной доле
  | 'shimmer'   // 1400ms — подметка неопределённого состояния
  | 'handoff';  // 700ms — вейл-кроссфейд на целевой экран boot

/** Easings — имена токенов `easing.*` (primitives/motion.tokens.json). */
export type BootMotionEasing = 'launch' | 'glide' | 'dissolve';

export const BOOT_MOTION_MS: Record<BootMotionVerb, number> = {
  emblem: 700,
  figure: 900,
  fill: 240,
  shimmer: 1400,
  handoff: 700,
};

export const BOOT_MOTION_EASING: Record<BootMotionEasing, string> = {
  launch: 'cubic-bezier(0.22, 0.9, 0.35, 1)',
  glide: 'cubic-bezier(0.25, 0.7, 0.3, 1)',
  dissolve: 'cubic-bezier(0.35, 0.6, 0.4, 1)',
};

export interface BootMotionSpec {
  /** WAAPI/CSS-ready длительность. 0 под reduced-motion/snapshot. */
  durationMs: number;
  easing: string;
  reduced: boolean;
}

export type BootStageState = 'loading' | 'ok' | 'failed' | 'skipped' | 'unavailable';

export interface BootSequenceProgressInput {
  profile: BootStageState | null;
  host: BootStageState | null;
  synchronization: readonly BootStageState[] | null;
  readiness: BootStageState | null;
}

export interface BootSequenceProgress {
  /** Percent only after a real stage has settled; null means no settled event. */
  value: number | null;
  completed: number | null;
  total: number | null;
  syncCompleted: number | null;
  syncTotal: number | null;
}

function settled(state: BootStageState | null): boolean {
  return state != null && state !== 'loading';
}

/** Derive progress from observed profile/host/sync/readiness stage states. */
export function bootSequenceProgress(input: BootSequenceProgressInput): BootSequenceProgress {
  const { profile, host, synchronization, readiness } = input;
  if (synchronization == null) {
    return { value: null, completed: null, total: null, syncCompleted: null, syncTotal: null };
  }
  const syncCompleted = synchronization.filter(settled).length;
  const completed = [profile, host, ...synchronization, readiness].filter(settled).length;
  const total = synchronization.length + 3;
  return {
    value: completed > 0 && total > 0 ? Math.round((completed / total) * 100) : null,
    completed,
    total,
    syncCompleted,
    syncTotal: synchronization.length,
  };
}

/**
 * Resolve a boot-motion verb to duration + easing. `handoff` зажат
 * брифом в полосу 600–900 мс — spec возвращает 700; reduced-motion и
 * snapshot схлопывают всё в 0ms, конечное состояние достижимо без
 * ожидания часов.
 */
export function bootMotion(
  verb: BootMotionVerb,
  easing: BootMotionEasing = 'launch',
  opts: { reducedMotion?: boolean; snapshot?: boolean } = {},
): BootMotionSpec {
  const reduced = opts.reducedMotion === true || opts.snapshot === true;
  return {
    durationMs: reduced ? 0 : BOOT_MOTION_MS[verb],
    easing: BOOT_MOTION_EASING[easing],
    reduced,
  };
}

/**
 * Одноразовый seam перехода boot→целевой экран: экран загрузки ставит
 * флаг перед router.replace, целевой экран читает и стирает его. Цель
 * может быть /home или /agent-select; прямые заходы без флага статичны.
 */
export const BOOT_HANDOFF_KEY = 'nexus:boot-handoff';

/** Поставить флаг перехода из boot перед фактическим router.replace. */
export function markBootHandoff(): void {
  try {
    globalThis.sessionStorage?.setItem(BOOT_HANDOFF_KEY, '1');
  } catch {
    /* storage недоступен — вейл просто не сыграет */
  }
}

/** Одноразово прочитать и стереть флаг. True только после реального boot. */
export function consumeBootHandoff(): boolean {
  try {
    const hit = globalThis.sessionStorage?.getItem(BOOT_HANDOFF_KEY) === '1';
    if (hit) globalThis.sessionStorage?.removeItem(BOOT_HANDOFF_KEY);
    return hit;
  } catch {
    return false;
  }
}
