'use client';

/**
 * Perf (NUE-UI perf-budget dozhim): @xterm/xterm + @xterm/addon-webgl
 * (~450 KB raw в роут-чанке) грузятся только когда терминальный экран
 * реально открыт. Раньше `NewfGpuScreen` импортировался статически из
 * `newf.tsx` и `newf-terminals-grid.tsx` → xterm попадал в начальный
 * чанк /newf и /newf-terminals (поднимал их выше лимита 1000 KB).
 *
 * Fallback повторяет регион «Terminal screen» и не несёт данных-testid:
 * проверки ждут настоящий экран через findBy, пустая рамка не матчится.
 */
import dynamic from 'next/dynamic';
import { LoadingState } from '@nexus/ui';

export const NewfGpuScreenLazy = dynamic(
  () => import('./newf-gpu-screen').then((m) => m.NewfGpuScreen),
  {
    loading: () => (
      <section role="region" aria-label="Terminal screen" data-state="loading">
        <LoadingState>Загрузка терминала…</LoadingState>
      </section>
    ),
  },
);
