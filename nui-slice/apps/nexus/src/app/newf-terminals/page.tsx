'use client';

import { useMemo } from 'react';
import { TerminalsGrid } from '../../product/screens/newf-terminals-grid';
import { createCoreBridge } from '../../product/screens/newf-live';
import { withMagnetize } from '../../product/screens/newf-magnetize';
import { StatusBar } from '../../product/screens/newf-status-bar';

const MagnetizedTerminals = withMagnetize('terms-grid', 'TERMINALS')(TerminalsGrid);

/** Isolated live demo for the NEWF Terminals summary grid (W35). */
export default function NewfTerminalsPage() {
  // W92: ?bridge=<url> — проверка GPU-рендера на scratch-ядре без :5684.
  const bridge = useMemo(
    () => createCoreBridge(
      typeof window !== 'undefined'
        ? (new URLSearchParams(window.location.search).get('bridge') ?? undefined)
        : undefined,
    ),
    [],
  );
  return (
    <>
      <MagnetizedTerminals bridge={bridge} />
      <StatusBar bridge={bridge} />
    </>
  );
}
