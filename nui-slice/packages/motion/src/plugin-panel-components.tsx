import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react';
import styles from './plugin-panel-motion.module.css';
import {
  PLUGIN_MOTION_BUDGET,
  PLUGIN_SURFACE_MOTION_MS,
  assessPluginMotionBudget,
  type PluginDockMode,
  type PluginMotionMeasurement,
} from './plugin-panel-motion';

function useReducedMotionPreference(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (query == null) return;
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible',
  );
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    update();
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

export interface PluginPanelLayoutProps extends HTMLAttributes<HTMLDivElement> {
  mode: PluginDockMode;
  /** CSS length; the host supplies its real, constrained dock width. */
  panelWidth?: string | number;
  resizing?: boolean;
  center: ReactNode;
  panel: ReactNode;
  centerLabel?: string;
  panelLabel?: string;
}

/** Two-track shell: the center track and dock edge share one transition. */
export function PluginPanelLayout({
  mode,
  panelWidth = '45%',
  resizing = false,
  center,
  panel,
  centerLabel = 'Рабочая область',
  panelLabel = 'Правая панель',
  className,
  style,
  ...rest
}: PluginPanelLayoutProps) {
  const reduced = useReducedMotionPreference();
  const inert = mode === 'hidden';
  const width = typeof panelWidth === 'number' ? `${panelWidth}px` : panelWidth;
  return (
    <div
      className={[styles.layout, className].filter(Boolean).join(' ')}
      data-mode={mode}
      data-resizing={resizing || undefined}
      data-reduced-motion={reduced || undefined}
      style={{ ...style, '--nexus-plugin-panel-width': width } as React.CSSProperties}
      {...rest}
    >
      <main className={styles.center} aria-label={centerLabel}>{center}</main>
      <aside
        className={styles.dock}
        aria-label={panelLabel}
        aria-hidden={inert}
        inert={inert || undefined}
      >
        {panel}
      </aside>
    </div>
  );
}

export type PluginMotionItemKind = 'tab' | 'floating' | 'pluginBlock';

export interface PluginMotionItemProps extends HTMLAttributes<HTMLDivElement> {
  kind: PluginMotionItemKind;
  present: boolean;
  children: ReactNode;
}

/** Keeps exiting content mounted for its motion, then removes it from layout. */
export function PluginMotionItem({
  kind,
  present,
  children,
  className,
  ...rest
}: PluginMotionItemProps) {
  const reduced = useReducedMotionPreference();
  const [mounted, setMounted] = useState(present);
  const [entered, setEntered] = useState(present);
  useEffect(() => {
    if (present) {
      if (!mounted) {
        setMounted(true);
        setEntered(reduced);
        return;
      }
      if (!entered) {
        if (reduced) {
          setEntered(true);
          return;
        }
        const frame = window.requestAnimationFrame(() => setEntered(true));
        return () => window.cancelAnimationFrame(frame);
      }
      return;
    }
    if (!mounted) return;
    setEntered(false);
    if (reduced) {
      setMounted(false);
      return;
    }
    const timeout = window.setTimeout(
      () => setMounted(false),
      PLUGIN_SURFACE_MOTION_MS[kind],
    );
    return () => window.clearTimeout(timeout);
  }, [entered, kind, mounted, present, reduced]);

  if (!mounted) return null;
  return (
    <div
      className={[
        styles.item,
        styles[kind],
        className,
      ].filter(Boolean).join(' ')}
      data-present={entered || undefined}
      aria-hidden={!present || !entered}
      inert={!present || !entered || undefined}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface PluginMotionPerformance extends PluginMotionMeasurement {
  supported: boolean;
}

/**
 * Opt-in real rAF/Long Tasks sample; idle by default and paused while the
 * document is hidden. Unsupported Long Tasks remain null, not zero.
 */
export function usePluginMotionPerformance(
  active = false,
  windowMs = PLUGIN_MOTION_BUDGET.windowMs,
): PluginMotionPerformance {
  const [measurement, setMeasurement] = useState<PluginMotionMeasurement>(() =>
    assessPluginMotionBudget(null, null));
  const [supported, setSupported] = useState(false);
  const visible = useDocumentVisible();

  useEffect(() => {
    if (!active || !visible || typeof requestAnimationFrame !== 'function') {
      setSupported(false);
      setMeasurement(assessPluginMotionBudget(null, null));
      return;
    }
    setMeasurement(assessPluginMotionBudget(null, null));
    let frames = 0;
    let stopped = false;
    let frame = 0;
    let longTaskCount = 0;
    let longTasksSupported = false;
    let previousSample = performance.now();
    let observer: PerformanceObserver | undefined;
    setSupported(true);

    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration >= PLUGIN_MOTION_BUDGET.longTaskMs) longTaskCount += 1;
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
      longTasksSupported = true;
    } catch {
      longTasksSupported = false;
    }

    const tick = () => {
      if (stopped) return;
      frames += 1;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = now - previousSample;
      const fps = elapsed > 0 ? Math.round((frames / elapsed) * 1000) : null;
      setMeasurement(assessPluginMotionBudget(
        fps,
        longTasksSupported ? longTaskCount : null,
      ));
      frames = 0;
      longTaskCount = 0;
      previousSample = now;
    }, windowMs);

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      window.clearInterval(timer);
      observer?.disconnect();
    };
  }, [active, visible, windowMs]);

  return { ...measurement, supported };
}
