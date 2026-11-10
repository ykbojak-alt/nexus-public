'use client';

/**
 * P1-2: единый «честный пусто-стейт» для экранов.
 *
 * Выделен из social.tsx и применяется ко всем поверхностям: label+subtitle,
 * без лишних декоративных разделителей и без выдуманных данных. Под капотом —
 * EmptyState variant="inline" (role="status", data-testid="empty-state").
 */
import { EmptyState } from '@nexus/ui';

export interface HonestEmptyProps {
  /** Короткая метка («Нет данных», «Ростер пуст», …). */
  label: string;
  /** Пояснение: почему данных нет и что дальше (опционально). */
  subtitle?: string;
}

export function HonestEmpty({ label, subtitle }: HonestEmptyProps) {
  return <EmptyState variant="inline" title={label} body={subtitle} />;
}
