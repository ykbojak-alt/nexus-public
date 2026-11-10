'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Button, EmptyState, ErrorState, GlassPanel, LoadingState, PanelHeader, StatusBadge, type NexusStatus } from '@nexus/ui';
import { AudioPlayer, ProviderEmbed, ProviderSearchResults, type ProviderSearchState } from '@nexus/ui';
import type { AudioTrack } from '@nexus/ui';
import type { GeneratedImage, YouTubeHit } from '@nexus/mock-data';
import type { Ai2Feature } from '../../integrations/ai2/contracts/capabilities';
import { isAi2ApiError } from '../../integrations/ai2/api/errors';
import { LocalAudioAdapter } from '../../integrations/local-audio/local-audio-adapter';
import { getDataSource, useDataSource, getDataSourceKind } from '../data-source';
import styles from './screens.module.css';

function extractIframeSrc(raw: string): string {
  const m = /src\s*=\s*["']([^"']+)["']/i.exec(raw);
  return (m ? m[1] : raw).trim();
}

export function parseYandex(raw: string):
  | { kind: 'embed'; src: string }
  | { kind: 'page'; src: string }
  | { kind: 'reject'; reason: string } {
  const src = extractIframeSrc(raw);
  if (!src) return { kind: 'reject', reason: 'Пустой ввод — вставьте embed-код или ссылку' };
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return { kind: 'reject', reason: 'Не удалось распознать адрес' };
  }
  if (url.protocol !== 'https:') return { kind: 'reject', reason: 'Принимается только https' };
  if (url.host !== 'music.yandex.ru') {
    return { kind: 'reject', reason: `Домен «${url.host}» вне allowlist Яндекс Музыки` };
  }
  if (url.pathname.startsWith('/iframe/')) return { kind: 'embed', src };
  return { kind: 'page', src };
}

const YT_ID = /^[A-Za-z0-9_-]{6,}$/;

export function parseYouTubeId(raw: string): string | null {
  const src = extractIframeSrc(raw);
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return YT_ID.test(src) ? src : null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.host.replace(/^www\.|^m\./, '');
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return YT_ID.test(id) ? id : null;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') {
      const id = url.searchParams.get('v') ?? '';
      return YT_ID.test(id) ? id : null;
    }
    const m = /^\/(embed|shorts)\/([A-Za-z0-9_-]+)/.exec(url.pathname);
    if (m && YT_ID.test(m[2])) return m[2];
  }
  return null;
}

export function MediaScreen() {
  return (
    <div className={styles.page} data-screen="media" aria-labelledby="media-title">
      <PanelHeader level="screen" divider={false} titleId="media-title" title="Медиаплеер" />
      <p className={styles.disclaimer}>
        Локальные файлы не покидают браузер. Внешние сервисы воспроизводятся
        собственными официальными плеерами — их контролы и брендинг сохранены.
      </p>
      <MediaSourcesSection />
      <div className={styles.mediaGrid}>
        <YouTubeSection />
        <LocalAudioSection />
        <YandexSection />
        <ImageGenSection />
      </div>
    </div>
  );
}

/**
 * Seam-статусы источников на самом экране (диспетч W3 п.12): маршрут /media —
 * просмотр и воспроизведение; монтажная «Студия» из legacy-карты намеренно
 * не заявлена и не эмулируется. Строки показывают, какие seam'ы реализованы
 * активным источником данных — без выдуманной поддержки.
 */
function MediaSourcesSection() {
  const ds = useDataSource();
  const kind = useMemo(getDataSourceKind, []);
  const rows: { name: string; status: NexusStatus; note: string }[] = [
    {
      name: 'Источник данных',
      status: kind === 'live' ? 'online' : kind === 'mock' ? 'info' : 'offline',
      note: kind === 'live' ? 'LIVE — AI-2 хост' : kind === 'mock' ? 'DEMO — мок-источник' : 'недоступен',
    },
    {
      name: 'Локальное аудио',
      status: 'online',
      note: 'браузерный адаптер — файлы не покидают устройство',
    },
    {
      name: 'Внешние плееры (YouTube, Яндекс Музыка)',
      status: 'online',
      note: 'официальный embed — вход и контент на стороне сервиса',
    },
    {
      name: 'YouTube — поиск (Data API)',
      status: ds.searchYouTube != null ? 'online' : 'offline',
      note: ds.searchYouTube != null ? 'реализован в источнике' : 'нет в источнике данных',
    },
    {
      name: 'Генерация изображений',
      status: ds.generateImage != null ? 'online' : 'offline',
      note: ds.generateImage != null
        ? 'seam реализован — поддержка проверяется хостом ниже'
        : 'нет в источнике данных',
    },
  ];
  return (
    <GlassPanel className={styles.panel} data-state="ready" data-testid="media-sources">
      <h2 className={styles.panelTitle}>Статус источников</h2>
      <ul className={styles.selectList} aria-label="Доступность источников медиа">
        {rows.map((r) => (
          <li key={r.name} className={styles.selectSub} data-source-state={r.status === 'online' ? 'ready' : 'unavailable'}>
            <StatusBadge status={r.status} label={r.status === 'online' ? 'ДОСТУПНО' : r.status === 'offline' ? 'НЕДОСТУПНО' : 'DEMO'} />{' '}
            <strong>{r.name}</strong> — {r.note}
          </li>
        ))}
      </ul>
      <p className={styles.emptyHint}>
        Экран — просмотр и воспроизведение. Монтажная студия («Studio» из legacy-карты)
        не заявлена в этой версии и намеренно не эмулируется.
      </p>
    </GlassPanel>
  );
}

const IMAGE_PROMPT_MAX = 600;

/** INT-23 — remote image generation via the host; keys never leave the
 *  server. Availability is read from `features.imageGen` (live) or inferred
 *  from the mock seam; unsupported/unconfigured renders `unavailable` with
 *  the host's reason verbatim. */
function ImageGenSection() {
  const ds = useDataSource();
  const kind = useMemo(getDataSourceKind, []);
  const seam = ds.generateImage;
  const [feature, setFeature] = useState<Ai2Feature | null>(null);
  const [capsState, setCapsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [enrich, setEnrich] = useState('enrich');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GeneratedImage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadCaps = () => {
    if (!ds.getCapabilities) {
      // Mock has no capability endpoint — the seam itself is the capability.
      setFeature(null);
      setCapsState('ready');
      return;
    }
    setCapsState('loading');
    ds.getCapabilities()
      .then((c) => { setFeature(c.features.imageGen); setCapsState('ready'); })
      .catch(() => setCapsState('error'));
  };
  useEffect(() => { if (seam != null) loadCaps(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [seam == null]);

  const models = feature?.models ?? [];
  const supported = seam != null && (feature == null || feature.supported);

  const generate = async () => {
    const text = prompt.trim();
    if (seam == null || !text || busy || !supported) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await seam({ prompt: text, model: model || undefined, enrich: enrich === 'enrich' ? true : enrich === 'raw' ? false : undefined }));
    } catch (e) {
      // Surface the host's message verbatim when it gave one (422/503).
      setError(isAi2ApiError(e) ? e.message : 'Генерация не выполнена — сервис отклонил запрос.');
    } finally {
      setBusy(false);
    }
  };

  const state = seam == null ? 'unavailable'
    : capsState === 'loading' ? 'loading'
      : capsState === 'error' ? 'error'
        : !supported ? 'unavailable'
          : busy ? 'loading' : 'ready';

  return (
    <GlassPanel className={styles.panel} data-state={state} data-testid="media-imagegen">
      <h2 className={styles.panelTitle}>Генерация изображения</h2>
      {kind === 'mock' && <StatusBadge status="info" label="DEMO" />}
      {seam == null && (
        <p className={styles.emptyHint}>Источник данных не предоставляет генерацию изображений.</p>
      )}
      {capsState === 'loading' && seam != null && <LoadingState>Проверка возможности генерации…</LoadingState>}
      {capsState === 'error' && (
        <ErrorState variant="inline" title="Не удалось проверить возможность генерации." onRetry={loadCaps} retryLabel="Повторить" />
      )}
      {capsState === 'ready' && !supported && (
        <p className={styles.emptyHint}>Генерация изображений недоступна: {feature?.reason ?? 'хост не сообщил причину'}.</p>
      )}
      {capsState === 'ready' && supported && (
        <>
          <label className={styles.label}>
            Запрос ({prompt.length}/{IMAGE_PROMPT_MAX})
            <textarea
              className={styles.textarea}
              value={prompt}
              maxLength={IMAGE_PROMPT_MAX}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Опишите изображение…"
              aria-label="Запрос генерации изображения"
            />
          </label>
          <div className={styles.formRow}>
            {models.length > 0 && (
              <select className={styles.select} value={model} onChange={(e) => setModel(e.target.value)} aria-label="Модель генерации">
                <option value="">модель по умолчанию</option>
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
            <select className={styles.select} value={enrich} onChange={(e) => setEnrich(e.target.value)} aria-label="Обогащение промпта">
              <option value="enrich">обогащённый промпт</option>
              <option value="raw">исходный промпт</option>
            </select>
            <Button variant="primary" size="sm" onClick={generate} disabled={!prompt.trim() || busy}>
              {busy ? 'Генерация…' : 'Сгенерировать'}
            </Button>
          </div>
          {error && <p className={styles.error} role="alert">{error}</p>}
          {result && (
            <figure className={styles.formRow} style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
              <img loading="lazy" decoding="async"
                src={`data:${result.mime};base64,${result.imageB64}`}
                alt={result.prompt}
                width={256}
                style={{ borderRadius: 8, display: 'block' }}
              />
              <figcaption className={styles.emptyHint}>
                модель: {result.model} · {Math.max(1, Math.round(result.bytes / 1024))} КБ ·
                стоимость: {result.costUsd != null ? `$${result.costUsd.toFixed(4)}` : 'н/д'}
                {result.enriched && result.enrichedPrompt != null && (
                  <> · обогащённый промпт: {result.enrichedPrompt}</>
                )}
              </figcaption>
            </figure>
          )}
        </>
      )}
      <p className={styles.emptyHint}>
        Генерация выполняется на стороне хоста через удалённые API — ключи провайдеров не покидают сервер.
      </p>
    </GlassPanel>
  );
}

function LocalAudioSection() {
  const inputRef = useRef<HTMLInputElement>(null);
  // INT-22: codec/queue/seek/volume/lifecycle live in the adapter — the
  // section renders its snapshot; object URLs never leave the adapter.
  const adapterRef = useRef<LocalAudioAdapter | null>(null);
  adapterRef.current ??= new LocalAudioAdapter();
  const adapter = adapterRef.current;
  const snap = useSyncExternalStore(
    (cb) => adapter.subscribe(cb),
    () => adapter.state,
    () => adapter.state,
  );
  useEffect(() => () => adapter.dispose(), [adapter]);

  const { queue: tracks, trackState, rejected, currentId } = snap;
  const idx = adapter.index();
  const queue: AudioTrack[] = tracks.map((t) => ({
    id: t.id,
    name: t.name,
    state: trackState[t.id]?.state,
    reason: trackState[t.id]?.reason,
  }));

  return (
    <GlassPanel className={styles.panel} data-state={tracks.length ? 'ready' : 'empty'} data-testid="media-local">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Локальное аудио</h2>
        {tracks.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => adapter.clear()}>Очистить очередь</Button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        multiple
        hidden
        aria-label="Выбрать аудиофайлы"
        onChange={(e) => { adapter.addFiles(e.target.files ?? []); e.target.value = ''; }}
      />
      <AudioPlayer
        queue={queue}
        currentId={currentId ?? undefined}
        playing={snap.playing}
        currentTime={snap.currentTime}
        duration={snap.duration}
        volume={snap.volume}
        muted={snap.muted}
        onTogglePlay={currentId != null ? () => adapter.togglePlay() : undefined}
        onPrev={idx > 0 ? () => adapter.prev() : undefined}
        onNext={idx >= 0 && idx < tracks.length - 1 ? () => adapter.next() : undefined}
        onSeek={(sec) => adapter.seek(sec)}
        onVolume={(v) => adapter.setVolume(v)}
        onToggleMute={() => adapter.setMuted(!snap.muted)}
        onSelect={(id) => adapter.select(id)}
        onAddFiles={() => inputRef.current?.click()}
      />
      {tracks.length === 0 && (
        <EmptyState variant="inline" title="Выберите аудиофайл — до выбора NEXUS не читает локальные файлы." />
      )}
      {rejected.length > 0 && (
        <ul className={styles.selectList} aria-label="Отклонённые файлы">
          {rejected.map((r, i) => (
            <li key={`${r.name}-${i}`} className={styles.selectSub}>
              {r.name} — {r.reason}
            </li>
          ))}
        </ul>
      )}
    </GlassPanel>
  );
}

function YandexSection() {
  const [input, setInput] = useState('');
  const [embed, setEmbed] = useState<{ src: string; kind: 'embed' | 'page' } | null>(null);
  const [reject, setReject] = useState<string | null>(null);

  const apply = () => {
    const parsed = parseYandex(input);
    if (parsed.kind === 'reject') {
      setEmbed(null);
      setReject(parsed.reason);
    } else {
      setReject(null);
      setEmbed({ src: parsed.src, kind: parsed.kind });
    }
  };

  const state = reject != null ? 'error' : embed == null ? 'idle' : embed.kind === 'embed' ? 'ready' : 'blocked';

  return (
    <GlassPanel className={styles.panel} data-state={state} data-testid="media-yandex">
      <h2 className={styles.panelTitle}>Яндекс Музыка</h2>
      <div className={styles.formRow}>
        <input
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Embed-код или ссылка music.yandex.ru…"
          aria-label="Ссылка или embed Яндекс Музыки"
        />
        <Button variant="primary" size="sm" onClick={apply} disabled={!input.trim()}>
          Открыть
        </Button>
      </div>
      <ProviderEmbed
        provider="Яндекс Музыка"
        state={state}
        reason={reject ?? (embed?.kind === 'page' ? 'Страница сервиса — откройте её в браузере, встраивается только /iframe/ адрес' : undefined)}
        onOpenExternal={embed ? () => window.open(embed.src, '_blank', 'noopener') : undefined}
      >
        {embed?.kind === 'embed' && (
          <iframe
            src={embed.src}
            title="Яндекс Музыка — встроенный плеер"
            width="100%"
            height="150"
            frameBorder={0}
            allow="encrypted-media"
          />
        )}
      </ProviderEmbed>
      <p className={styles.emptyHint}>
        Принимается официальный embed (music.yandex.ru/iframe/) — вход, подписка и доступ
        к контенту остаются на стороне Яндекса.
      </p>
    </GlassPanel>
  );
}

function YouTubeSection() {
  const ds = useDataSource();
  const kind = useMemo(getDataSourceKind, []);
  const [input, setInput] = useState('');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [reject, setReject] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<YouTubeHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);

  const openLink = () => {
    const id = parseYouTubeId(input);
    if (id == null) {
      setVideoId(null);
      setReject('Не удалось получить video id — поддерживаются watch-, youtu.be-, embed- и shorts-ссылки');
    } else {
      setReject(null);
      setVideoId(id);
    }
  };

  const search = async () => {
    if (ds.searchYouTube == null || !query.trim()) return;
    setSearching(true);
    setSearchError(false);
    try {
      setHits(await ds.searchYouTube(query.trim()));
    } catch {
      setSearchError(true);
      setHits(null);
    } finally {
      setSearching(false);
    }
  };

  const playerState = reject != null ? 'error' : videoId == null ? 'idle' : 'ready';
  const searchState: ProviderSearchState =
    ds.searchYouTube == null ? 'unavailable'
      : searching ? 'loading'
        : searchError ? 'error'
          : hits == null ? 'idle'
            : hits.length === 0 ? 'empty' : 'ready';

  return (
    <GlassPanel className={styles.panel} data-state={playerState} data-testid="media-youtube">
      <h2 className={styles.panelTitle}>YouTube</h2>
      <div className={styles.formRow}>
        <input
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ссылка на видео YouTube…"
          aria-label="Ссылка на видео YouTube"
        />
        <Button variant="primary" size="sm" onClick={openLink} disabled={!input.trim()}>
          Открыть
        </Button>
      </div>
      <ProviderEmbed
        provider="YouTube"
        state={playerState}
        reason={reject ?? undefined}
        onOpenExternal={videoId ? () => window.open(`https://www.youtube.com/watch?v=${videoId}`, '_blank', 'noopener') : undefined}
      >
        {videoId != null && (
          <iframe
            src={`https://www.youtube.com/embed/${videoId}`}
            title="YouTube — официальный плеер"
            width="100%"
            height="360"
            frameBorder={0}
            allow="encrypted-media; picture-in-picture; web-share"
            allowFullScreen
          />
        )}
      </ProviderEmbed>

      <div className={styles.formRow}>
        <input
          className={styles.input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
          placeholder="Поиск публичных видео…"
          aria-label="Поиск видео YouTube"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={search}
          loading={searching}
          disabled={ds.searchYouTube == null || !query.trim()}
        >
          Искать
        </Button>
      </div>
      <ProviderSearchResults
        source="YouTube Data API"
        origin={kind === 'live' ? 'live' : 'mock'}
        state={searchState}
        reason={
          ds.searchYouTube == null
            ? 'Поиск недоступен — адаптер источника не реализует YouTube Data API.'
            : searchError ? 'Ошибка поиска — повторите запрос.' : undefined
        }
        items={(hits ?? []).map((h) => ({
          id: h.videoId,
          title: h.title,
          meta: `${h.channelTitle} · ${h.publishedAt.slice(0, 10)}`,
        }))}
        onSelect={(id) => { setReject(null); setVideoId(id); }}
        selectedId={videoId ?? undefined}
      />
      <p className={styles.emptyHint}>
        Видео воспроизводится официальным плеером YouTube — autoplay, скачивание
        и фоновое воспроизведение не предоставляются.
      </p>
    </GlassPanel>
  );
}
