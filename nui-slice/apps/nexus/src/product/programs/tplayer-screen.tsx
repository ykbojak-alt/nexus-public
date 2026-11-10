'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { GlassPanel, PanelHeader, StatusBadge } from '@nexus/ui';
import styles from './vloader.module.css';
import { getTPlayerToken, syncTPlayerTokenFromProfile } from './tplayer-token';
import { useProfile } from '../profile/profile-store';

/**
 * NEXUS TPlayer — локальный стриминг торрентов и медиа.
 *
 * Каталог торрентов (NUE-3, восстановлен из rollback-чанка 3745tj6o6nm-n.js):
 * поиск по Internet Archive (advancedsearch.php q+mediatype:movies), карточки
 * результатов (play → metadata → первый стрим-файл; .torrent → download), честные
 * loading/error с retry. Прямые fetch на archive.org разрешены CSP (connect-src).
 * Engine-контур пакета TPlayer — same-origin прокси /api/tplayer
 * (сервер проксирует на :8786, token-auth включён, заголовок X-Nexus-TPlayer).
 * Probe + magnet/.torrent форма; недоступен/401 → честный статус.
 */

const ENGINE_URL = '/api/tplayer';
const HISTORY_KEY = 'nexus.tplayer.history';

/** Тип статуса engine — единый словарь для всех поверхностей (P1-4). */
type EngineStatus = 'probing' | 'online' | 'offline' | 'auth-required';

const ENGINE_BADGE: Record<EngineStatus, { status: 'complete' | 'warning' | 'info' | 'error'; label: string }> = {
  online: { status: 'complete', label: 'ENGINE ONLINE' },
  'auth-required': { status: 'warning', label: 'TOKEN REQUIRED' },
  probing: { status: 'info', label: 'CHECKING…' },
  offline: { status: 'error', label: 'ENGINE OFFLINE' },
};

/** Честный idle: без токена probe не запускаем — сразу TOKEN REQUIRED. */
function initialEngineStatus(): EngineStatus {
  return getTPlayerToken() ? 'probing' : 'auth-required';
}

/** Fetch к engine через серверный прокси: + X-Nexus-TPlayer из localStorage. */
async function engineFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = getTPlayerToken();
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) headers['X-Nexus-TPlayer'] = token;
  return fetch(`${ENGINE_URL}${path}`, { ...init, headers });
}

interface CatalogItem {
  id: string;
  title: string;
  year: string;
}

interface CatalogFile {
  name: string;
  size: number;
  format: string;
  length: string; // "HH:MM:SS" из metadata, если есть
  kind: 'audio' | 'video' | 'other';
  url: string;
}

interface FilesPanel {
  item: CatalogItem;
  files: CatalogFile[];
  state: 'loading' | 'ready' | 'error';
  reason: string;
}

type CatalogState =
  | { stage: 'idle' }
  | { stage: 'loading' }
  | { stage: 'error'; reason: string }
  | { stage: 'ready'; items: CatalogItem[] };

interface PlayItem {
  id: string;
  name: string;
  kind: 'stream' | 'file' | 'torrent';
  src: string;
}

interface TorrentJob {
  id: string;
  name: string;
  state: string;
  pct: number;
  peers: number;
  error: string;
}

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '?';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

const AUDIO_EXT_RE = /\.(mp3|ogg|wav|m4a|flac)$/i;

export function TPlayerScreen() {
  const { profile } = useProfile();
  const [src, setSrc] = useState('');
  const [message, setMessage] = useState('готов · локальный плеер · перетащите файлы на экран');
  const [shelf, setShelf] = useState<PlayItem[]>([]);
  const [catalog, setCatalog] = useState<CatalogState>({ stage: 'idle' });
  const [filesPanel, setFilesPanel] = useState<FilesPanel | null>(null);
  const [query, setQuery] = useState('');
  const [engine, setEngine] = useState<EngineStatus>(initialEngineStatus);
  const [jobs, setJobs] = useState<TorrentJob[]>([]);
  const [torrentInput, setTorrentInput] = useState('');
  const engineRef = useRef(engine);
  engineRef.current = engine;

  // Синк токена TPlayer из профиля в localStorage (до probe/запросов).
  useEffect(() => {
    if (profile?.tplayerToken) {
      syncTPlayerTokenFromProfile(profile.tplayerToken);
    }
  }, [profile?.tplayerToken]);

  // Список воспроизведения — из localStorage (история каталога/сессии).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(HISTORY_KEY);
      if (!raw) return;
      const items: string[] = JSON.parse(raw);
      if (Array.isArray(items)) {
        setShelf(items.map((src) => ({ id: `h-${src}`, name: src, kind: 'file' as const, src })).slice(0, 12));
      }
    } catch { /* повреждённая история — игнор */ }
  }, []);

  // Probe прокси /api/tplayer — честный статус (401 → токен не задан/неверен).
  // Без токена probe не слаем: статус auth-required (idle-честность); как
  // только токен появился (например, из Настроек) — следующий тик пробует снова.
  useEffect(() => {
    let alive = true;
    const probe = async () => {
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 2000);
      try {
        const res = await engineFetch('/', { signal: ctrl.signal });
        window.clearTimeout(timer);
        if (res.status === 401) {
          if (alive) setEngine('auth-required');
          return;
        }
        const body = await res.json();
        if (alive) setEngine(body?.ok === true && body?.engine === 'nexus-p2p' ? 'online' : 'offline');
      } catch {
        window.clearTimeout(timer);
        if (alive) setEngine('offline');
      }
    };
    const tick = () => {
      if (!alive) return;
      if (!getTPlayerToken()) {
        setEngine('auth-required');
        return;
      }
      void probe();
    };
    tick();
    const iv = window.setInterval(tick, 10000);
    return () => { alive = false; window.clearInterval(iv); };
  }, []);

  const play = (nextSrc: string, label: string) => {
    setSrc(nextSrc);
    setMessage(label);
  };

  const pushShelf = (item: PlayItem) => {
    setShelf((prev) => [item, ...prev.filter((p) => p.src !== item.src)].slice(0, 24));
  };

  const saveCatalogHistory = (src: string) => {
    try {
      const prev: string[] = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || '[]');
      const next = [src, ...prev.filter((s) => s !== src)].slice(0, 12);
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch { /* quota/priv — история не обязательна */ }
  };

  const addTorrent = async (idOrUrl: string, label: string) => {
    try {
      const res = await engineFetch('/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: idOrUrl }),
      });
      if (res.status === 401) {
        setMessage('engine: требуется токен TPlayer — укажите в Настройках → Токен TPlayer');
        return;
      }
      const body = await res.json();
      if (!body?.ok) {
        setMessage(`engine отклонил раздачу: ${body?.error ?? 'ошибка'}`);
        return;
      }
      const jobId = String(body.id);
      setJobs((prev) => [{ id: jobId, name: String(body.name ?? label), state: 'queue', pct: 0, peers: 0, error: '' }, ...prev]);
      setMessage(`engine · раздача «${body.name ?? label}» в очереди`);
    } catch {
      setMessage('engine недоступен — прокси /api/tplayer не отвечает');
    }
  };

  const addTorrentFile = async (url: string) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      let bin = '';
      new Uint8Array(buf).forEach((b) => { bin += String.fromCharCode(b); });
      await addTorrent(btoa(bin), url.split('/').pop() ?? url);
    } catch (e) {
      setMessage(`не удалось скачать .torrent: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const search = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setCatalog({ stage: 'loading' });
    try {
      const res = await fetch(
        `https://archive.org/advancedsearch.php?q=${encodeURIComponent(trimmed)}+AND+mediatype:movies` +
        '&fl[]=identifier&fl[]=title&fl[]=year&rows=12&page=1&output=json',
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const docs: unknown[] = body?.response?.docs ?? [];
      const items = docs
        .map((d) => {
          const row = d as Record<string, unknown>;
          return {
            id: String(row.identifier ?? ''),
            title: String(row.title ?? row.identifier ?? ''),
            year: String(row.year ?? ''),
          };
        })
        .filter((i) => i.id);
      setCatalog({ stage: 'ready', items });
    } catch (e) {
      setCatalog({ stage: 'error', reason: e instanceof Error ? e.message : String(e) });
    }
  };

  const playCatalog = async (item: CatalogItem) => {
    if (filesPanel?.item.id === item.id && filesPanel.state === 'ready') return;
    setFilesPanel({ item, files: [], state: 'loading', reason: '' });
    setMessage(`каталог · загружаю файлы «${item.title}»…`);
    try {
      const res = await fetch(`https://archive.org/metadata/${encodeURIComponent(item.id)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const files: unknown[] = body?.files ?? [];
      const list: CatalogFile[] = files
        .map((f) => f as Record<string, unknown>)
        .filter((f) => typeof f.name === 'string' && f.name)
        .map((f) => {
          const name = String(f.name);
          const url = `https://archive.org/download/${encodeURIComponent(item.id)}/${encodeURIComponent(name)}`;
          let kind: CatalogFile['kind'] = 'other';
          if (/\.(mp3|ogg|wav|m4a|flac)$/i.test(name)) kind = 'audio';
          else if (/\.(mp4|webm|mkv|m4v|ogv)$/i.test(name)) kind = 'video';
          return {
            name,
            url,
            kind,
            size: Number(f.length ?? 0),
            format: String(f.format ?? ''),
            length: String(f.length ?? '') === '0' ? '' : String(f.length ?? ''),
          };
        })
        .sort((a, b) => b.size - a.size);
      if (list.length === 0) {
        setFilesPanel({ item, files: [], state: 'error', reason: 'в элементе нет файлов' });
        setMessage(`каталог · в «${item.title}» нет файлов`);
        return;
      }
      setFilesPanel({ item, files: list, state: 'ready', reason: '' });
      // Авто-выбор самого крупного медиафайла для немедленного play.
      const firstMedia = list.find((f) => f.kind !== 'other');
      if (firstMedia) {
        saveCatalogHistory(firstMedia.url);
        pushShelf({ id: `c-${crypto.randomUUID()}`, name: `${item.title} · ${firstMedia.name}`, kind: 'stream', src: firstMedia.url });
        play(firstMedia.url, `каталог · ${item.title}`);
      }
    } catch (e) {
      setFilesPanel({ item, files: [], state: 'error', reason: e instanceof Error ? e.message : String(e) });
      setMessage(`каталог · ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const playFile = (item: CatalogItem, file: CatalogFile) => {
    saveCatalogHistory(file.url);
    pushShelf({ id: `c-${crypto.randomUUID()}`, name: `${item.title} · ${file.name}`, kind: file.kind === 'audio' ? 'file' : 'stream', src: file.url });
    play(file.url, `каталог · ${item.title}`);
  };

  const downloadFile = async (file: CatalogFile) => {
    setMessage(`скачиваю ${file.name}…`);
    try {
      const res = await fetch(file.url, { mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
      setMessage(`скачано: ${file.name}`);
    } catch (e) {
      setMessage(`не удалось скачать ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const submitTorrent = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = torrentInput.trim();
    if (!raw) return;
    if (/^magnet:/i.test(raw) || /\.torrent(\?|#|$)/i.test(raw)) {
      if (engineRef.current !== 'online') {
        setMessage(engineRef.current === 'auth-required'
          ? 'торрент-раздачи: требуется токен TPlayer — укажите в Настройках → Токен TPlayer'
          : 'прокси /api/tplayer недоступен — engine не отвечает');
        return;
      }
      setTorrentInput('');
      if (/^magnet:/i.test(raw)) void addTorrent(raw, raw.slice(0, 48));
      else void addTorrentFile(raw);
      return;
    }
    saveCatalogHistory(raw);
    pushShelf({ id: `u-${crypto.randomUUID()}`, name: raw, kind: 'stream', src: raw });
    play(raw, raw);
  };

  return (
    <main className={styles.page} data-screen="tplayer" aria-labelledby="tplayer-title">
      <PanelHeader
        level="screen"
        divider={false}
        titleId="tplayer-title"
        title="NEXUS TPLAYER"
        subtitle="Локальный стриминг торрентов и медиа — без серверов и аккаунтов"
        actions={<StatusBadge
          status={ENGINE_BADGE[engine].status}
          label={ENGINE_BADGE[engine].label}
        />}
      />

      <div className={styles.grid}>
        <GlassPanel className={styles.panel}>
          <p className={styles.kicker}>Локальное приложение · открытый исходный код</p>
          <h2 className={styles.heading}>Torrent → play за секунду</h2>
          <p className={styles.body}>
            NEXUS TPlayer — интеграция открытого TorrentPlayer (Tauri, Rust + Svelte,
            MIT/Apache-2.0). Приложение стримит торренты и медиа локально: без серверов,
            аккаунтов и телеметрии. NEXUS добавляет карточку и страницу запуска;
            воспроизведение идёт в отдельном окне, не через браузер NEXUS.
          </p>

          <div className={styles.steps} aria-label="Установка и запуск">
            <div className={styles.step}>
              <span className={styles.stepLabel}>1 · Скачать релиз</span>
              <pre><code>github.com/torrentplayer/torrentplayer → Releases</code></pre>
            </div>
            <div className={styles.step}>
              <span className={styles.stepLabel}>2 · Или собрать из исходников</span>
              <pre><code>git clone + cargo tauri build</code></pre>
            </div>
            <div className={styles.step}>
              <span className={styles.stepLabel}>3 · Открыть magnet/файл</span>
              <pre><code>TPlayer → вставить magnet-ссылку</code></pre>
            </div>
          </div>
        </GlassPanel>

        <GlassPanel className={styles.panel}>
          <p className={styles.kicker}>Что нужно знать</p>
          <ul className={styles.facts}>
            <li>Desktop-приложение: Windows, macOS, Linux.</li>
            <li>Стримит torrent, видео и аудио с перемоткой к любому моменту.</li>
            <li>Без серверов, аккаунтов и телеметрии — трафик P2P идёт напрямую.</li>
            <li>NEXUS не проксирует торренты и не скачивает контент через браузер.</li>
          </ul>
          <div className={styles.links}>
            <a href="https://github.com/torrentplayer/torrentplayer" target="_blank" rel="noopener noreferrer">
              Репозиторий GitHub · MIT/Apache-2.0
            </a>
            <Link href="/programs">Назад в «Программы»</Link>
          </div>
        </GlassPanel>
      </div>

      <div className={styles.tplayerShelf} aria-label="Плеер и каталог торрентов">
        {src !== '' && (
          AUDIO_EXT_RE.test(src) ? (
            <audio className={styles.tplayerVideo} src={src} controls aria-label="Проигрыватель NEXUS TPlayer (аудио)" />
          ) : (
            <video
              className={styles.tplayerVideo}
              src={src}
              controls
              playsInline
              aria-label="Проигрыватель NEXUS TPlayer"
            />
          )
        )}
        {shelf.length > 0 && (
          <ul className={styles.tplayerList} aria-label="История воспроизведения">
            {shelf.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={styles.tplayerChip}
                  data-kind={item.kind === 'file' ? 'file' : 'stream'}
                  title={item.src}
                  onClick={() => play(item.src, `история · ${item.name}`)}
                >
                  {item.name}
                </button>
              </li>
            ))}
          </ul>
        )}

        <GlassPanel className={styles.panel} aria-label="Каталог торрентов">
          <p className={styles.kicker}>Каталог торрентов · Internet Archive</p>
          <form
            className={styles.tplayerBar}
            onSubmit={(e) => { e.preventDefault(); void search(query); }}
          >
            <input
              className={styles.input}
              type="search"
              aria-label="Поиск по каталогу"
              placeholder="Найти видео в публичном архиве…"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
            />
            <button type="submit" className={styles.runButton}>Искать</button>
          </form>

          {catalog.stage === 'loading' && (
            <p className={styles.fieldLabel} role="status">ищу в архиве…</p>
          )}
          {catalog.stage === 'error' && (
            <p className={styles.fieldLabel} role="alert">
              каталог недоступен: {catalog.reason}
              <button type="button" className={styles.runButton} onClick={() => void search(query)}>
                Повторить
              </button>
            </p>
          )}
          {catalog.stage === 'ready' && catalog.items.length === 0 && (
            <p className={styles.fieldLabel}>ничего не найдено</p>
          )}
          {catalog.stage === 'ready' && catalog.items.length > 0 && (
            <ul className={styles.tplayerCatalog} aria-label="Результаты каталога">
              {catalog.items.map((item) => (
                <li key={item.id} className={styles.tplayerCatalogRow}>
                  <button
                    type="button"
                    className={styles.tplayerChip}
                    data-kind="stream"
                    title={`${item.title} — открыть файлы`}
                    onClick={() => void playCatalog(item)}
                  >
                    {item.title}{item.year ? ` · ${item.year}` : ''}
                  </button>
                  <a
                    className={styles.tplayerChip}
                    data-kind="file"
                    href={`https://archive.org/download/${encodeURIComponent(item.id)}/${encodeURIComponent(item.id)}_archive.torrent`}
                    title="Скачать .torrent и скормить engine пакета"
                    download
                  >
                    .torrent
                  </a>
                </li>
              ))}
            </ul>
          )}

          {filesPanel && (
            <div className={styles.tplayerFiles} aria-label={`Файлы ${filesPanel.item.title}`}>
              <p className={styles.fieldLabel}>
                Файлы: {filesPanel.item.title}
                {filesPanel.state === 'loading' && ' · загружаю…'}
                {filesPanel.state === 'error' && ` · ошибка: ${filesPanel.reason}`}
              </p>
              {filesPanel.state === 'ready' && (
                <ul className={styles.tplayerCatalog} aria-label="Файлы элемента">
                  {filesPanel.files.map((file) => (
                    <li key={file.name} className={styles.tplayerCatalogRow}>
                      <button
                        type="button"
                        className={styles.tplayerChip}
                        data-kind={file.kind === 'audio' ? 'audio' : file.kind === 'video' ? 'stream' : 'file'}
                        title={`${file.name} · ${file.size > 0 ? formatSize(file.size) : 'размер неизвестен'} · ${file.format || file.kind}${file.length ? ` · ${file.length}` : ''}`}
                        onClick={() => playFile(filesPanel.item, file)}
                      >
                        {file.name} · {file.size > 0 ? formatSize(file.size) : '?'} · {file.format || file.kind}
                      </button>
                      <button
                        type="button"
                        className={styles.tplayerChip}
                        data-kind="file"
                        title={`Скачать ${file.name}`}
                        onClick={() => void downloadFile(file)}
                      >
                        ⇩
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </GlassPanel>

        <GlassPanel className={styles.panel} aria-label="Раздачи">
          <div className={styles.tplayerEngineRow}>
            <p className={styles.fieldLabel} role="status">
              {engine === 'online' ? 'engine прокси /api/tplayer: онлайн'
                : engine === 'auth-required' ? 'engine прокси /api/tplayer: требуется токен — укажите в Настройках → Токен TPlayer'
                  : engine === 'probing' ? 'проверяю прокси /api/tplayer…'
                    : 'engine прокси /api/tplayer недоступен — engine не отвечает'}
            </p>
            <Link className={styles.tplayerBack} href="/programs">Назад в «Программы»</Link>
          </div>
          <form className={styles.toolForm} onSubmit={submitTorrent}>
            <input
              className={styles.input}
              type="url"
              aria-label="magnet или .torrent URL"
              placeholder="magnet:?xt=… или https://…/file.torrent"
              value={torrentInput}
              onChange={(e) => setTorrentInput(e.currentTarget.value)}
            />
            <button type="submit" className={styles.runButton}>Взять раздачу</button>
          </form>
          {jobs.length > 0 && (
            <ul className={styles.tplayerJobs} aria-label="Раздачи engine">
              {jobs.map((job) => (
                <li key={job.id} className={styles.tplayerJob} data-state={job.state}>
                  <span className={styles.tplayerJobTitle}>{job.name}</span>
                  <span className={styles.tplayerJobLine}>
                    {job.error || `${job.state}${job.pct > 0 ? ` · ${Math.round(job.pct)}%` : ''}${job.peers > 0 ? ` · ${job.peers} пиров` : ''}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className={styles.fieldLabel} role="status">{message}</p>
        </GlassPanel>
      </div>

      <aside className={styles.notice} aria-label="Правила использования">
        <strong>Используйте только разрешённый контент.</strong>
        <span>
          Перед просмотром проверьте права на материал. Интеграция NEXUS не обходит
          ограничения доступа и не хостит торренты.
        </span>
      </aside>
    </main>
  );
}