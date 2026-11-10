/**
 * Точка монтирования слота в экране: keyed-запись рендерится на месте,
 * где был блок — вид страницы при включённых плагинах не меняется;
 * запись снята патчем/выгрузкой → честно null (место схлопывается,
 * ошибок и заглушек нет). `list`-вариант рендерит все записи подряд.
 */
'use client';

import type { ComponentType } from 'react';
import { useSlot, useSlotEntry } from './plugin-host';
import './builtin';

export interface SlotMountProps<P> {
  slot: string;
  /** ключ записи для keyed-слота */
  entry?: string;
  /** пропсы компонента записи */
  props?: P;
  /** запасной рендер, когда записи нет (по умолчанию — null) */
  fallback?: React.ReactNode;
}

export function SlotMount<P extends object>({ slot, entry, props, fallback = null }: SlotMountProps<P>) {
  const hit = useSlotEntry<ComponentType<P>>(slot, entry);
  if (hit == null) return <>{fallback}</>;
  const C = hit.value;
  return <C {...(props as P)} />;
}

export function SlotOutlet<P extends object>({ slot, props }: { slot: string; props?: P }) {
  const entries = useSlot<ComponentType<P>>(slot);
  return (
    <>
      {entries.map((e) => {
        const C = e.value;
        return <C key={`${e.pluginId}:${e.rowId}`} {...(props as P)} />;
      })}
    </>
  );
}
