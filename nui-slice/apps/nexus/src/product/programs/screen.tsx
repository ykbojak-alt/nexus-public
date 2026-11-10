'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import Link from 'next/link';
import {
  EmptyState,
  GlassPanel,
  PanelHeader,
  StatusBadge,
  type NexusStatus,
} from '@nexus/ui';
import {
  PROGRAMS_MANIFEST,
  type ProgramManifestEntry,
} from './manifest';
import {
  createHttpProgramInstaller,
  createLocalProgramInstaller,
  createCompositeProgramInstaller,
  type Installer,
  type InstallerState,
  type InstallTarget,
} from './installer-factories';
import { useReducedMotion } from '../use-reduced-motion';
import styles from './programs.module.css';
import gamesStyles from '../games/games.module.css';

const ASSET_BASE =
  typeof document !== 'undefined' &&
  document.querySelector('script[src*="/_nexus/"], link[href*="/_nexus/"]')
    ? '/_nexus'
    : '';

const STATUS_LABEL: Record<ProgramManifestEntry['status'], string> = {
  available: 'ON',
  downloadable: 'СКАЧАТЬ',
  setup: 'НАСТРОИТЬ',
  soon: 'СКОРО',
};

const IDLE_STATE: InstallerState = {
  stage: 'idle',
  progress: null,
  error: null,
  version: null,
  installDir: null,
  verifiedBytes: null,
  simulated: true,
};

function formatSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} МБ`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${bytes} Б`;
}

function resolveAsset(path: string): string {
  return path.startsWith('/') ? `${ASSET_BASE}${path}` : path;
}

// ─── Installer renderer ─────────────────────────────────────────────────

const STAGE_LABEL: Record<InstallerState['stage'], string> = {
  idle: 'СКАЧАТЬ',
  downloading: 'ЗАГРУЗКА',
  downloaded: 'ГОТОВО',
  installing: 'УСТАНОВКА',
  installed: 'УСТАНОВЛЕНО',
  error: 'ОШИБКА',
};

const STUB_STAGE_LABEL: Record<string, string> = {
  downloaded: 'ПРОВЕРЕН',
  installing: 'СОХРАНЕНИЕ',
  installed: 'ПРОВЕРЕН · STUB',
};

function stageLabel(state: InstallerState, entry: ProgramManifestEntry): string {
  if (state.simulated || entry.packageKind !== 'stub') {
    return STAGE_LABEL[state.stage];
  }
  return STUB_STAGE_LABEL[state.stage] ?? STAGE_LABEL[state.stage];
}

interface InstallerUIProps {
  entry: ProgramManifestEntry;
  installer: Installer;
}

function InstallerUI({ entry, installer }: InstallerUIProps) {
  const [state, setState] = useState<InstallerState>(() =>
    installer.state(entry.id),
  );
  const [target, setTarget] = useState<InstallTarget['kind']>('storage');
  const [dir, setDir] = useState<FileSystemHandle | null>(null);

  useEffect(() => {
    const unsub = installer.subscribe(entry.id, setState);
    setState(installer.state(entry.id));
    return unsub;
  }, [installer, entry.id]);

  const isStub = !state.simulated && entry.packageKind === 'stub';
  const showDir = typeof (window as any).showDirectoryPicker === 'function';
  const showDownloads = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';

  const targetPayload: InstallTarget =
    target === 'directory' && dir
      ? { kind: 'directory', dir }
      : target === 'downloads'
        ? { kind: 'downloads' }
        : { kind: 'storage' };

  const downloadAndInstall = useCallback(() => {
    void (
      state.stage === 'downloaded'
        ? Promise.resolve()
        : installer.download(entry.id)
    )
      .then(() => installer.install(entry.id, targetPayload))
      .catch(() => {});
  }, [installer, entry.id, state.stage, targetPayload]);

  if (state.stage === 'downloading' || state.stage === 'installing') {
    const pct = Math.round((state.progress ?? 0) * 100);
    const label =
      state.stage === 'downloading' ? 'ЗАГРУЗКА' : isStub ? 'СОХРАНЕНИЕ' : 'УСТАНОВКА';
    return (
      <div className={gamesStyles.installerRow} role="group" aria-label="Прогресс установки">
        <div
          className={gamesStyles.progress}
          role="progressbar"
          aria-label={`${label} ${entry.nexusName}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className={gamesStyles.progressFill} style={{ width: `${pct}%` }} />
        </div>
        <span className={gamesStyles.progressLabel}>{`${label} · ${pct}%`}</span>
      </div>
    );
  }

  if (state.stage === 'installed') {
    const newerAvailable =
      entry.version != null && state.version != null && state.version !== entry.version;
    const versionNote = state.version != null ? `v${state.version}` : null;
    return (
      <div className={gamesStyles.installerRow}>
        <span className={gamesStyles.installerStage}>
          {stageLabel(state, entry)}
          {newerAvailable ? ` · ЕСТЬ ${entry.version}` : ''}
        </span>
        {entry.href != null ? (
          <Link className={gamesStyles.installerAction} href={entry.href}>
            {isStub ? 'СТРАНИЦА' : 'ОТКРЫТЬ'}
          </Link>
        ) : (
          <span className={gamesStyles.installerHint} aria-disabled="true">
            Страница продукта недоступна
          </span>
        )}
        {newerAvailable && (
          <button
            type="button"
            className={gamesStyles.installerAction}
            onClick={() => void installer.update(entry.id, targetPayload).catch(() => {})}
          >
            {`ОБНОВИТЬ · ${entry.version}`}
          </button>
        )}
        <button
          type="button"
          className={gamesStyles.installerSecondary}
          onClick={() => void installer.uninstall(entry.id)}
        >
          УДАЛИТЬ
        </button>
        <span className={gamesStyles.installerHint}>
          {state.simulated
            ? 'локально · симуляция установки'
            : isStub
              ? `stub-пакет${versionNote ? ` · ${versionNote}` : ''} · sha256 проверен${state.verifiedBytes ? ` · ${state.verifiedBytes} Б` : ''}${state.installDir ? ` · ${state.installDir}` : ''} · приложение не запускается`
              : `sha256 проверен${versionNote ? ` · ${versionNote}` : ''}${state.verifiedBytes ? ` · ${state.verifiedBytes} Б` : ''}${state.installDir ? ` · ${state.installDir}` : ''}${newerAvailable ? ` · доступно v${entry.version}` : ''} · запуск — заглушка на страницу продукта`}
        </span>
      </div>
    );
  }

  if (state.stage === 'error') {
    return (
      <div className={gamesStyles.installerRow}>
        <div className={gamesStyles.installerRow} data-part="target">
          <span className={gamesStyles.targetLabel}>КУДА</span>
          <button
            type="button"
            className={gamesStyles.targetChip}
            data-active={target === 'storage' || undefined}
            onClick={() => setTarget('storage')}
          >
            ХРАНИЛИЩЕ
          </button>
          {showDownloads && (
            <button
              type="button"
              className={gamesStyles.targetChip}
              data-active={target === 'downloads' || undefined}
              onClick={() => setTarget('downloads')}
            >
              ЗАГРУЗКИ
            </button>
          )}
          {showDir && (
            <button
              type="button"
              className={gamesStyles.targetChip}
              data-active={target === 'directory' || undefined}
              onClick={() => {
                (window as any)
                  .showDirectoryPicker({ mode: 'readwrite' })
                  .then((d: FileSystemHandle) => {
                    setDir(d);
                    setTarget('directory');
                  })
                  .catch(() => {});
              }}
            >
              {dir ? `ПАПКА: ${(dir as any).name.toUpperCase()}` : 'ПАПКА…'}
            </button>
          )}
        </div>
        <button type="button" className={gamesStyles.installerAction} onClick={downloadAndInstall}>
          ПОВТОРИТЬ
        </button>
        {state.error && (
          <span className={gamesStyles.installerError} role="alert">
            {state.error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={gamesStyles.installerRow}>
      <div className={gamesStyles.installerRow} data-part="target">
        <span className={gamesStyles.targetLabel}>КУДА</span>
        <button
          type="button"
          className={gamesStyles.targetChip}
          data-active={target === 'storage' || undefined}
          onClick={() => setTarget('storage')}
        >
          ХРАНИЛИЩЕ
        </button>
        {showDownloads && (
          <button
            type="button"
            className={gamesStyles.targetChip}
            data-active={target === 'downloads' || undefined}
            onClick={() => setTarget('downloads')}
          >
            ЗАГРУЗКИ
          </button>
        )}
        {showDir && (
          <button
            type="button"
            className={gamesStyles.targetChip}
            data-active={target === 'directory' || undefined}
            onClick={() => {
              (window as any)
                .showDirectoryPicker({ mode: 'readwrite' })
                .then((d: FileSystemHandle) => {
                  setDir(d);
                  setTarget('directory');
                })
                .catch(() => {});
            }}
          >
            {dir ? `ПАПКА: ${(dir as any).name.toUpperCase()}` : 'ПАПКА…'}
          </button>
        )}
      </div>
      <button
        type="button"
        className={gamesStyles.installerAction}
        onClick={downloadAndInstall}
      >
        {state.stage === 'downloaded' ? (isStub ? 'СОХРАНИТЬ' : 'УСТАНОВИТЬ') : 'СКАЧАТЬ'}
      </button>
    </div>
  );
}
// ─── Tile renderer (H from bundle) ──────────────────────────────────────

interface TileProps {
  entry: ProgramManifestEntry;
  installer: Installer | null;
  selected: boolean;
  dimmed: boolean;
  pinned: boolean;
  onTogglePinned: () => void;
  onSelect: () => void;
  refCb?: (el: HTMLButtonElement | null) => void;
}

function Tile({ entry, installer, selected, dimmed, pinned, onTogglePinned, onSelect, refCb }: TileProps) {
  const [installerState, setInstallerState] = useState<InstallerState | null>(() =>
    installer ? installer.state(entry.id) : null,
  );

  useEffect(() => {
    if (!installer) return;
    const unsub = installer.subscribe(entry.id, setInstallerState);
    setInstallerState(installer.state(entry.id));
    return unsub;
  }, [installer, entry.id]);

  const isDownloadable = entry.status === 'downloadable';
  const artResolved = resolveAsset(entry.art);
  const isVideo = artResolved.endsWith('.mp4');
  const displayArt = isVideo ? artResolved : artResolved;

  const media = (
    <div
      className={`${gamesStyles.tileMedia} ${styles.tileMediaP} ${isVideo ? '' : styles.tileMediaStatic}`}
    >
      {isVideo ? (
        <video
          src={artResolved}
          aria-label={entry.artAlt}
          className={`${gamesStyles.tileMediaVideo} ${styles.tileMediaVideoP}`}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          data-motion-preview
        />
      ) : (
        <img
          loading="lazy"
          decoding="async"
          src={artResolved}
          alt={entry.artAlt}
          className={styles.tileMediaImg}
        />
      )}
      <div className={`${gamesStyles.tileMediaOverlay} ${styles.tileOverlayP}`}>
        <span className={`${gamesStyles.tileTitle} ${styles.tileTitleP}`}>
          {entry.nexusName}
        </span>
        <div className={`${gamesStyles.tileMeta} ${styles.tileMetaP}`}>
          {entry.meta.map((m, i) => (
            <span key={m} className={`${gamesStyles.tileMetaChip} ${styles.tileChipP}`} data-c={i % 6}>
              {m}
            </span>
          ))}
        </div>
        <div className={`${gamesStyles.tileFoot} ${styles.tileFootP}`}>
          <span
            className={`${gamesStyles.tileStatus} ${
              entry.status === 'available' || isDownloadable
                ? gamesStyles.tileStatusOk
                : gamesStyles.tileStatusSoon
            } ${styles.tileStatusP} ${entry.status === 'soon' ? styles.tileStatusSoonP : ''}`}
          >
            {isDownloadable
              ? installerState?.stage === 'idle' || installerState == null
                ? 'ПАКЕТ'
                : stageLabel(installerState, entry)
              : STATUS_LABEL[entry.status]}
          </span>
        </div>
      </div>
    </div>
  );

  if (entry.status === 'soon') {
    return (
      <div className={gamesStyles.tile} role="listitem" data-program-id={entry.id} data-selected={selected || undefined} aria-hidden={dimmed || undefined} inert={dimmed || undefined}>
        <button
          type="button"
          className={styles.pinBtn}
          aria-pressed={pinned}
          aria-label={`${pinned ? 'Открепить' : 'Закрепить'} ${entry.nexusName}`}
          data-testid={`pin-${entry.id}`}
          onClick={onTogglePinned}
        >
          {pinned ? '📌' : '·'}
        </button>
        <div className={gamesStyles.tileMain} aria-disabled="true" data-status="soon">
          {media}
        </div>
      </div>
    );
  }

  return (
    <div className={`${gamesStyles.tile} ${styles.programTile}`} role="listitem" data-program-id={entry.id} data-selected={selected || undefined} aria-hidden={dimmed || undefined} inert={dimmed || undefined}>
      <button
        type="button"
        className={styles.pinBtn}
        aria-pressed={pinned}
        aria-label={`${pinned ? 'Открепить' : 'Закрепить'} ${entry.nexusName}`}
        data-testid={`pin-${entry.id}`}
        onClick={onTogglePinned}
      >
        {pinned ? '📌' : '·'}
      </button>
      <button
        type="button"
        ref={refCb}
        className={`${gamesStyles.tileMain} ${gamesStyles.tileMainButton}`}
        aria-label={entry.nexusName}
        aria-expanded={selected}
        aria-controls="program-launch-panel"
        onClick={onSelect}
      >
        {media}
      </button>
    </div>
  );
}

// ─── Launch panel (eN from bundle) ─────────────────────────────────────

interface LaunchPanelProps {
  entry: ProgramManifestEntry;
  installer: Installer | null;
  pinned: boolean;
  onTogglePinned: () => void;
  onClose: () => void;
}

function LaunchPanel({ entry, installer, pinned, onTogglePinned, onClose }: LaunchPanelProps) {
  const bayArt = entry.bayArt ?? entry.art;
  const bayArtResolved = resolveAsset(bayArt);
  const isVideo = bayArtResolved.endsWith('.mp4');
  const bayBg = entry.bayBg ? `--launch-bg: url("${resolveAsset(entry.bayBg)}")` : undefined;

  const specs: [string, string][] = [];
  if (entry.version) specs.push(['Версия', entry.version]);
  if (entry.sizeBytes) specs.push(['Размер', formatSize(entry.sizeBytes)]);
  if (entry.sha256) specs.push(['SHA-256', `${entry.sha256.slice(0, 12)}…`]);
  specs.push(['Лицензия', entry.upstreamLicense ?? (entry.artifactUrl ? 'собственная разработка' : '—')]);
  if (entry.minClientVersion) specs.push(['Клиент ≥', entry.minClientVersion]);

  // Embedded components available for craft only
  const hasEmbed = entry.id === 'craft';
  const isDownloadable = entry.status === 'downloadable';

  return (
    <section
      id="program-launch-panel"
      role="region"
      aria-labelledby="program-launch-title"
      data-testid="program-launch-panel"
      className={styles.launchPanel}
      style={bayBg ? { ['--launch-bg' as string]: `url(${resolveAsset(entry.bayBg)})` } : undefined}
    >
      <header className={styles.launchHeader}>
        <div className={styles.launchMedia} aria-hidden="true">
          {isVideo ? (
            <video
              src={bayArtResolved}
              className={styles.launchMediaFill}
              autoPlay
              muted
              loop
              playsInline
            />
          ) : (
            <img src={bayArtResolved} alt="" loading="eager" className={styles.launchMediaFill} />
          )}
        </div>
        <div className={styles.launchHeadText}>
          <span className={styles.launchKicker} aria-hidden="true">
            NEXUS // PROGRAM BAY · {entry.tag}
          </span>
          <h2 id="program-launch-title" className={styles.launchTitle} tabIndex={-1}>
            {entry.nexusName}
          </h2>
          <p className={styles.launchDesc}>{entry.desc}</p>
          <div className={styles.launchMeta}>
            {entry.version && (
              <span className={styles.launchChip} data-kind="version">
                v{entry.version}
              </span>
            )}
            {entry.packageKind && (
              <span className={styles.launchChip} data-kind="kind">
                {entry.packageKind === 'app' ? 'APP' : 'STUB'}
              </span>
            )}
            {entry.meta.map((m) => (
              <span key={m} className={styles.launchChip}>
                {m}
              </span>
            ))}
            <button
              type="button"
              className={styles.launchChip}
              data-kind="pinned"
              aria-pressed={pinned}
              onClick={onTogglePinned}
            >
              {pinned ? 'ЗАКРЕПЛЕНО' : 'ЗАКРЕПИТЬ'}
            </button>
          </div>
        </div>
        <button
          type="button"
          className={styles.launchClose}
          aria-label="Назад к программам"
          onClick={onClose}
        >
          <span className={styles.launchCloseIcon} aria-hidden="true">◄</span>
          Назад к программам
        </button>
      </header>

      {/* Embedded application section — only for craft */}
      {hasEmbed && (
        <section className={styles.launchSection} aria-label="Приложение">
          <h3 className={styles.launchSectionTitle}>Приложение</h3>
          <div className={styles.launchBody}>
            <div style={{ width: '100%', height: '600px', minWidth: 0 }}>
              {entry.id === 'craft' && (
                <iframe
                  src="/tools/craft"
                  style={{ width: '100%', height: '100%', border: 'none', borderRadius: '8px' }}
                  title="NEXUS Craft"
                />
              )}
            </div>
          </div>
        </section>
      )}

      {/* Installer section — only for downloadable programs */}
      {isDownloadable && (
        <section className={styles.launchSection} aria-label="Установка">
          <h3 className={styles.launchSectionTitle}>Установка</h3>
          {installer ? (
            <InstallerUI entry={entry} installer={installer} />
          ) : (
            <p className={styles.launchNote}>Инсталлер загружается…</p>
          )}
        </section>
      )}

      {/* Package specs section */}
      {specs.length > 0 && (
        <section className={styles.launchSection} aria-label="Пакет">
          <h3 className={styles.launchSectionTitle}>Пакет</h3>
          <dl className={styles.launchSpecs}>
            {specs.map(([key, value]) => (
              <div key={key} className={styles.launchSpec}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* Open screen link — only if href exists and route is real */}
      {entry.href != null && (
        <div className={styles.launchActions}>
          <Link href={entry.href} className={styles.launchLink}>
            Открыть экран
          </Link>
        </div>
      )}
    </section>
  );
}
// ─── ProgramsScreen (main) ──────────────────────────────────────────────

const PINNED_STORAGE_KEY = 'nexus.programs.pinned';

function readPinned(): string[] {
  try {
    const raw = window.localStorage.getItem(PINNED_STORAGE_KEY);
    if (raw == null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

function writePinned(ids: string[]): void {
  try {
    window.localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // localStorage недоступен — пины молча не сохраняются.
  }
}

type ProgramFilter = 'all' | 'available' | 'downloadable' | 'soon';

const FILTER_LABEL: Record<ProgramFilter, string> = {
  all: 'ВСЕ',
  available: 'ГОТОВО',
  downloadable: 'СКАЧАТЬ',
  soon: 'СКОРО',
};

export function ProgramsScreen() {
  const programs = PROGRAMS_MANIFEST.programs;
  const listRef = useRef<HTMLDivElement>(null);
  const [installer, setInstaller] = useState<Installer | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [panelFocusTick, setPanelFocusTick] = useState(0);
  const panelTitleRef = useRef<HTMLHeadingElement>(null);
  const tileRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const reduced = useReducedMotion();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ProgramFilter>('all');
  const [pinned, setPinned] = useState<string[]>([]);

  useEffect(() => {
    setPinned(readPinned());
  }, []);

  const togglePinned = useCallback((id: string) => {
    setPinned((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [id, ...prev];
      writePinned(next);
      return next;
    });
  }, []);

  const visiblePrograms = useMemo(() => {
    const q = query.trim().toLowerCase();
    return programs
      .filter((p) => filter === 'all' || p.status === filter)
      .filter((p) => !q || p.nexusName.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q))
      .sort((a, b) => {
        const pa = pinned.includes(a.id) ? 0 : 1;
        const pb = pinned.includes(b.id) ? 0 : 1;
        return pa - pb;
      });
  }, [programs, query, filter, pinned]);

  // Lazy-load composite installer (HTTP + local fallback)
  useEffect(() => {
    let alive = true;
    const init = async () => {
      const httpMap: Record<string, Installer> = {};
      for (const p of programs) {
        if (p.artifactUrl != null) {
          httpMap[p.id] = createHttpProgramInstaller({
            id: p.id,
            nexusName: p.nexusName,
            artifactUrl: p.artifactUrl,
            sha256: p.sha256!,
            sizeBytes: p.sizeBytes!,
            version: p.version,
            minClientVersion: p.minClientVersion,
          });
        }
      }
      const local = createLocalProgramInstaller({
        knownIds: programs.map((p) => p.id),
      });
      const composite = createCompositeProgramInstaller(httpMap, local);
      if (alive) setInstaller(composite);
    };
    init().catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Resume motion-preview videos on tab return (from bundle pattern)
  useEffect(() => {
    if (selected != null) return;
    const videos = Array.from(
      listRef.current?.querySelectorAll<HTMLVideoElement>('[data-motion-preview]') ?? [],
    );
    if (videos.length === 0) return;
    const kick = (v: HTMLVideoElement) => {
      if (document.visibilityState !== 'visible' || !v.paused) return;
      v.muted = true;
      const p = v.play();
      if (p) p.catch(() => {});
    };
    const tick = () => videos.forEach(kick);
    document.addEventListener('visibilitychange', tick);
    const iv = window.setInterval(tick, 1000);
    tick();
    return () => {
      document.removeEventListener('visibilitychange', tick);
      window.clearInterval(iv);
    };
  }, [selected == null]);

  // Focus management: panel title on open, tile on close
  useEffect(() => {
    if (selected != null && panelFocusTick > 0) {
      panelTitleRef.current?.focus();
    }
  }, [selected, panelFocusTick]);

  // Escape closes the panel and returns focus to the tile that opened it
  const closePanelRef = useRef<(id: string | null) => void>(() => {});
  closePanelRef.current = (id) => {
    setSelected(null);
    if (id != null) tileRefs.current[id]?.focus();
  };
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;
  useEffect(() => {
    if (selected == null) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePanelRef.current(selectedRef.current);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected]);

  const openPanel = useCallback((id: string) => {
    setSelected(id);
    setPanelFocusTick((n) => n + 1);
  }, []);

  const closePanel = useCallback((id: string | null) => {
    setSelected(null);
    if (id != null) tileRefs.current[id]?.focus();
  }, []);

  const selectedEntry = programs.find((p) => p.id === selected) ?? null;
  const showHeader = selected == null;

  return (
    <div
      className={gamesStyles.page}
      data-screen="programs"
      data-state="ready"
      aria-labelledby={showHeader ? 'programs-title' : undefined}
    >
      {showHeader && (
        <PanelHeader
          level="screen"
          divider={false}
          titleId="programs-title"
          title="Программы"
          subtitle="Продуктовая линейка NEXUS — локальные интеграции, без облака."
          actions={<StatusBadge status="info" label="ЛОКАЛЬНО" />}
        />
      )}

      {programs.length === 0 ? (
        <EmptyState
          title="Программы не зарегистрированы"
          body="Манифест продуктов пуст — интеграции появятся здесь."
          reason="в манифесте нет ни одного продукта"
        />
      ) : (
        <>
          <div className={styles.catalogToolbar} data-state={selected != null ? 'hidden' : 'idle'} aria-label="Поиск и фильтр программ">
            <input
              type="search"
              className={styles.catalogSearch}
              placeholder="Поиск по программам…"
              aria-label="Поиск по программам"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className={styles.catalogFilters} role="group" aria-label="Фильтр по статусу">
              {(Object.keys(FILTER_LABEL) as ProgramFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={styles.catalogFilter}
                  data-active={filter === f || undefined}
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                >
                  {FILTER_LABEL[f]}
                </button>
              ))}
            </div>
            {pinned.length > 0 && (
              <span className={styles.catalogNote} data-testid="programs-pinned-count">
                Закреплено: {pinned.length}
              </span>
            )}
          </div>
          <div
            className={`${gamesStyles.selectionLayout} ${styles.programSelection}`}
            data-program-selection={selected != null ? 'active' : 'idle'}
            onKeyDown={(e: ReactKeyboardEvent<HTMLElement>) => {
              if (e.key === 'Escape' && selected != null) {
                e.preventDefault();
                closePanel(selected);
                return;
              }
              const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
              const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
              if (!fwd && !back && e.key !== 'Home' && e.key !== 'End') return;
              const tiles = Array.from(
                e.currentTarget.querySelectorAll<HTMLElement>(
                  `button.${gamesStyles.tileMain}, a.${gamesStyles.tileMain}, div.${gamesStyles.tileMain}`,
                ),
              ).filter((el) => el.closest('[aria-hidden="true"]') == null);
              if (tiles.length === 0) return;
              e.preventDefault();
              const cur = tiles.indexOf(document.activeElement as HTMLElement);
              const next =
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? tiles.length - 1
                    : cur < 0
                      ? fwd
                        ? 0
                        : tiles.length - 1
                      : (cur + (fwd ? 1 : -1) + tiles.length) % tiles.length;
              tiles[next].focus();
            }}
          >
            <div
              className={`${gamesStyles.list} ${styles.programList}`}
              role="list"
              aria-label="Программы"
              ref={listRef}
            >
              {visiblePrograms.map((entry) => (
                <Tile
                  key={entry.id}
                  entry={entry}
                  installer={installer}
                  selected={selected === entry.id}
                  dimmed={selected != null && selected !== entry.id}
                  pinned={pinned.includes(entry.id)}
                  onTogglePinned={() => togglePinned(entry.id)}
                  refCb={(el) => {
                    tileRefs.current[entry.id] = el;
                  }}
                  onSelect={() => (selected === entry.id ? closePanel(entry.id) : openPanel(entry.id))}
                />
              ))}
              {visiblePrograms.length === 0 && (
                <EmptyState
                  variant="inline"
                  title="Ничего не найдено"
                  body="Измените запрос или фильтр."
                />
              )}
            </div>

            {selectedEntry != null && (
              <LaunchPanel
                entry={selectedEntry}
                installer={installer}
                pinned={pinned.includes(selectedEntry.id)}
                onTogglePinned={() => togglePinned(selectedEntry.id)}
                onClose={() => closePanel(selectedEntry.id)}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
