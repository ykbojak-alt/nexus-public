'use client';

/**
 * GameShell — общая обёртка игровых экранов (chess, durak, oracle, games).
 *
 * Снимает дублирование: PanelHeader со статусом, GlassPanel-контейнер,
 * гейм-моушн (verb/easing → CSS-переменные для анимаций игры), работа
 * интервалов только при видимом документе.
 *
 * Контракты взяты из реальных API пакетов:
 * - @nexus/motion: GameMotionVerb ('fly' | 'snappy' | …), GameMotionEasing
 *   ('launch' | 'arc' | …). Игровые motion-примитивы разрешены только
 *   игровым экранам (граница W4-1007: game-motion-boundary.test.ts), поэтому
 *   общая обёртка передаёт глагол и плавность дальше именами, а длительность
 *   и кривую разворачивает сам игровой экран.
 * - @nexus/ui: PanelHeader не имеет пропа badge — статус-бейдж идёт в
 *   actions; GlassPanel не имеет motion-пропов — моушн передаётся CSS-переменными.
 * - @nexus/ui: NexusStatus не содержит 'ready' — для «готово» используется 'online'.
 */
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { GlassPanel, PanelHeader, StatusBadge } from '@nexus/ui';
import type { GameMotionEasing, GameMotionVerb } from '@nexus/motion';
import { usePersonas } from './personas';
import { useProfile } from './profile/profile-store';
import { runWhileDocumentVisible } from './visible-interval';
import styles from './game-shell.module.css';

export interface GameShellProps {
  /** Game identifier for analytics / theming */
  game: string;
  /** Screen title shown in PanelHeader */
  title: string;
  /** Optional subtitle */
  subtitle?: string;
  /** Main game content */
  children: ReactNode;
  /** Optional header actions (buttons, etc.) */
  headerActions?: ReactNode;
  /** Optional footer */
  footer?: ReactNode;
  /** Whether to run animation frame while visible (default: true) */
  respectVisibility?: boolean;
  /** Custom motion verb for this game */
  motionVerb?: GameMotionVerb;
  /** Custom motion easing */
  motionEasing?: GameMotionEasing;
  /** Additional CSS class */
  className?: string;
}

export function GameShell({
  game,
  title,
  subtitle,
  children,
  headerActions,
  footer,
  respectVisibility = true,
  motionVerb = 'fly',
  motionEasing = 'launch',
  className,
}: GameShellProps) {
  const { profile } = useProfile();
  const personas = usePersonas();
  const personaName =
    personas?.find((p) => p.id === (profile?.agentId ?? 'nexus'))?.name ?? 'NEXUS';
  // Заголовок документа — эффект, а не побочный эффект рендера.
  useEffect(() => {
    document.title = `${title} — NEXUS`;
  }, [title]);

  const motionVars = {
    '--game-motion-verb': motionVerb,
    '--game-motion-easing': motionEasing,
  } as CSSProperties;

  return (
    <div className={`${styles.shell} ${className ?? ''}`} data-game={game} style={motionVars}>
      <div className={styles.inner}>
        <PanelHeader
          title={title}
          subtitle={subtitle}
          actions={
            <>
              <StatusBadge status="online" label={personaName} />
              {headerActions}
            </>
          }
        />
        <GlassPanel className={styles.panel}>
          {children}
        </GlassPanel>
        {footer && (
          <footer className={styles.footer}>
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/**
 * Hook for game screens to register document-visibility-aware intervals.
 * Wraps runWhileDocumentVisible with game-specific context and cleans the
 * interval up on unmount.
 */
export function useGameInterval(
  callback: () => void,
  intervalMs: number,
  game: string,
  enabled = true,
): void {
  useEffect(() => {
    if (typeof window === 'undefined' || !enabled) return;
    const stop = runWhileDocumentVisible(callback, intervalMs);
    return stop;
    // game — только для документации вызова; поведение не зависит от него.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callback, intervalMs, game, enabled]);
}
