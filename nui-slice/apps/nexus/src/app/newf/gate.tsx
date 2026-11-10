'use client';

import { useEffect, useState } from 'react';
import { NewfPopScreen, NewfScreen } from '../../product/screens/newf';
import { NewfLuxScreen } from '../../product/screens/newf-lux';
import { VoiceUiContext } from '../../product/screens/voice-ui';
import { VoicePanel } from './voice-panel';

interface NewfQuery {
  live: boolean;
  bridge?: string;
  backend?: string;
  shell?: string;
  /** #552b: OS-level pop-out — адрес терминала в отдельном окне. */
  pop?: string;
}

/** Синхронное чтение live-параметров из location.search (fix #372).
 *  Вызывается как инициализатор useState → выполняется на клиенте ПРИ
 *  гидрации (не только в useEffect), поэтому live/bridge/backend доступны
 *  уже с первичного клиентского рендера. На сервере (SSR/static export)
 *  `window` отсутствует → возвращаем дефолт {live:false}, без ошибки.
 *  Fallback: инлайн-boot-скрипт (page.tsx) кладёт window.__NEWF_QUERY__,
 *  если window.location.search по какой-то причине недоступен. */
function readNewfQuery(): NewfQuery {
  if (typeof window === 'undefined') {
    return { live: false };
  }
  const raw = (window as unknown as { __NEWF_QUERY__?: string }).__NEWF_QUERY__
    ?? window.location.search;
  const q = new URLSearchParams(raw);
  const live = q.get('live') === '1' || q.get('live') === 'true';
  const bridge = q.get('bridge') || undefined;
  const backend = q.get('backend') || undefined;
  const shell = q.get('shell') || undefined;
  const pop = q.get('pop') || undefined;
  return { live, ...(bridge ? { bridge } : {}), ...(backend ? { backend } : {}), ...(shell ? { shell } : {}), ...(pop ? { pop } : {}) };
}

/** Клиентский гейт: читает ?live=1&bridge=<url>&shell=lux из location.search
 *  (output:'export' — searchParams server-компонента недоступен).
 *  shell=lux — композиция minimal-lux (newf-lux.tsx), иначе layout-движок.
 *  #372: параметры читаются СИНХРОННО в инициализаторе useState (до/во
 *  время гидрации), а не только в useEffect — live работает и на static export. */
export function NewfGate({ layoutJson }: { layoutJson?: string }) {
  // Нейтральный дефолт в инициализаторе: первый клиентский рендер при
  // гидрации обязан совпасть с серверным static HTML (без live/voice),
  // иначе React #418 (hydration mismatch). Параметры из location.search
  // применяются в useEffect — сразу после гидрации.
  const [params, setParams] = useState<NewfQuery>(() => ({ live: false }));
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
    setParams((prev) => {
      const next = readNewfQuery();
      const same =
        prev.live === next.live &&
        prev.bridge === next.bridge &&
        prev.backend === next.backend &&
        prev.shell === next.shell;
      return same ? prev : next;
    });
  }, []);
  const voiceUi = { open: voiceOpen, setOpen: setVoiceOpen, active: hydrated && Boolean(params.bridge?.trim()) };
  const voice = hydrated ? <VoicePanel bridgeBase={params.bridge} /> : null;
  // #552b: ?pop=<addr> — страница одного терминала в OS-окне.
  if (params.pop) {
    return (
      <NewfPopScreen live={params.live} bridgeBase={params.bridge} backend={params.backend} address={params.pop} />
    );
  }
  if (params.shell === 'lux') {
    return (
      <VoiceUiContext.Provider value={voiceUi}>
        <NewfLuxScreen live={params.live} bridgeBase={params.bridge} backend={params.backend} />
        {voice}
      </VoiceUiContext.Provider>
    );
  }
  return (
    <VoiceUiContext.Provider value={voiceUi}>
      <NewfScreen live={params.live} bridgeBase={params.bridge} backend={params.backend} layoutJson={layoutJson} />
      {voice}
    </VoiceUiContext.Provider>
  );
}
