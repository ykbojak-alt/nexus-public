'use client';

import { useState, type ReactNode } from 'react';
import Image from 'next/image';
import { EmptyState } from '@nexus/ui';
import { PERSONAS } from '@nexus/mock-data';
import styles from './assistant-hero.module.css';

// Статика: dev отдаёт /art/…, AI-2 хост монтирует бандл под /_nexus (как durak).
const ASSET_BASE =
  typeof document !== 'undefined' &&
    document.querySelector('script[src*="/_nexus/"], link[href*="/_nexus/"]')
    ? '/_nexus'
    : '';

/** Пять ассистентов, у которых экран строится на общей герой-геометрии. */
export type AssistantHeroId = 'alice' | 'arch' | 'codex' | 'forge' | 'mech';

export interface AssistantHeroChip {
  id: string;
  label: string;
}

export interface AssistantHeroPortrait {
  /** Путь к арту. По умолчанию — `/art/agent-<id>.webp` из манифеста
   *  (`public/art/MANIFEST.md`, V1). Своя обрезка передаётся через src. */
  src?: string;
  /** Alt по манифесту. Пустая строка — строго декоративный образ. */
  alt?: string;
  /** 'circle' — круглый портрет с кольцами; 'figure' — фигура в полный
   *  рост слева (маска-градиент, как alice-main-hero на /home). */
  variant?: 'circle' | 'figure';
}

const personaName = (id: AssistantHeroId): string =>
  PERSONAS.find((p) => p.id === id)?.name ?? id.toUpperCase();

/**
 * Wave-IX IX.3: единый герой ассистента — рамка окна, портрет/фигура,
 * режим-пилюля, quick-chips, честный пусто-стейт.
 *
 * Правила (карточка V2 волны IX):
 * - палитра — только hero.*-токены (pinned на authored-dark, одинаково
 *   на светлой и тёмной теме); геометрия общая у всех пяти ассистентов;
 * - арт отсутствует/не грузится → нейтральный EmptyState «Образ … в
 *   подготовке», никакого фейкового круглого портрета и монограммы;
 * - образ несёт идентичность → реальный alt (manifest text), а не
 *   aria-hidden; пустой alt допустим только для заведомо декоративного;
 * - действия чипов — у владельца экрана через onChip.
 */
export function AssistantHero({
  assistant,
  mode,
  chips,
  onChip,
  portrait,
  fullWidth,
  children,
}: {
  assistant: AssistantHeroId;
  /** Режим-пилюля над контентом (например «ПЕРСОНАЛЬНЫЙ ИНТЕЛЛЕКТ»). */
  mode?: string;
  chips?: readonly AssistantHeroChip[];
  onChip?: (chip: AssistantHeroChip) => void;
  portrait?: AssistantHeroPortrait;
  /** Контент владельца занимает всю ширину карточки, портрет уходит в
   *  полупрозрачный фон. Нужен экранам с живым потоком (эхо рантайма на
   *  главной), где текст важнее иллюминатора. */
  fullWidth?: boolean;
  /** Контент правой колонки — greeting/слоган живёт у экрана-владельца. */
  children?: ReactNode;
}) {
  const [portraitFailed, setPortraitFailed] = useState(false);
  const name = personaName(assistant);
  const role = assistant === 'alice' ? 'ассистента' : 'субагента';
  const src = portrait?.src ?? `${ASSET_BASE}/art/agent-${assistant}.webp`;
  const variant = portrait?.variant ?? 'circle';
  return (
    <div className={styles.hero} data-variant={variant} data-assistant={assistant}
      data-full-width={fullWidth ? 'true' : undefined}>
      <div className={styles.portrait} data-portrait={portraitFailed ? 'empty' : 'art'}>
        {portraitFailed ? (
          <EmptyState variant="inline" title={`Образ ${name} в подготовке`} />
        ) : (
          <Image src={src} alt={portrait?.alt ?? `Образ ${role} ${name}`}
            width={variant === 'figure' ? 600 : 148}
            height={variant === 'figure' ? 544 : 148} priority
            onError={() => setPortraitFailed(true)} />
        )}
      </div>
      <div className={styles.body}>
        {mode != null && mode !== '' && <p className={styles.modePill}>{mode}</p>}
        {children}
        {chips != null && chips.length > 0 && (
          <div className={styles.chips} role="group" aria-label="Быстрые действия">
            {chips.map((chip) => (
              <button key={chip.id} type="button" className={styles.chip}
                title={chip.label} onClick={() => onChip?.(chip)}>
                {chip.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
