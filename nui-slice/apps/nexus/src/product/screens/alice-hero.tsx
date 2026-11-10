'use client';

import type { ReactNode } from 'react';
import { AssistantHero, type AssistantHeroChip, type AssistantHeroPortrait } from './assistant-hero';

export type { AssistantHeroChip as AliceHeroChip };

/**
 * R-W3.0 / wave-IX: совместимость — AliceHero теперь частный случай
 * общего `AssistantHero` (та же рамка, токены и пусто-стейт у всех
 * пяти ассистентов). Новые экраны — `AssistantHero assistant="…"`.
 */
export function AliceHero({
  mode,
  chips,
  onChip,
  portrait,
  fullWidth,
  children,
}: {
  /** Режим-пилюля над контентом (например «ПЕРСОНАЛЬНЫЙ ИНТЕЛЛЕКТ»). */
  mode?: string;
  chips?: readonly AssistantHeroChip[];
  onChip?: (chip: AssistantHeroChip) => void;
  /** Портрет героя — по умолчанию `/art/agent-alice.webp` из манифеста;
   *  /home (NUE1) передаёт фигурный вариант из art-манифеста.
   *  Ассет не грузится → честный EmptyState. */
  portrait?: AssistantHeroPortrait;
  /** Контент на всю ширину, портрет — фон (живое эхо рантайма). */
  fullWidth?: boolean;
  /** Контент правой колонки — greeting/слоган живёт у экрана-владельца. */
  children?: ReactNode;
}) {
  return (
    <AssistantHero assistant="alice" mode={mode} chips={chips} onChip={onChip} portrait={portrait}
      fullWidth={fullWidth}>
      {children}
    </AssistantHero>
  );
}
