/**
 * Local audio adapter (INT-22, W1 side) — codec/seek/volume/queue/lifecycle
 * over a single HTMLAudioElement. Framework-free: screens subscribe to
 * snapshots; the element factory is injectable so tests run without real
 * decode (jsdom has none).
 *
 * Honesty rules (media-playback-and-streaming contract):
 * - Codec is probed at ACCEPT time via `el.canPlayType(mime)` — 'unsupported'
 *   is reported before a track ever enters the queue, not after a decode
 *   error; runtime MEDIA_ERR codes still map to honest states.
 * - Object URLs are owned here: created on accept, revoked on remove/clear/
 *   dispose — callers never touch URL.createObjectURL.
 * - Files never leave the renderer: no upload path exists by design.
 */

import type { AudioTrackState } from '@nexus/ui';

export const MAX_LOCAL_AUDIO_BYTES = 100 * 1024 * 1024;

export interface LocalAudioTrack {
  id: string;
  name: string;
  size: number;
  mime: string;
}

export interface LocalAudioReject {
  name: string;
  reason: string;
}

export interface LocalAudioSnapshot {
  queue: LocalAudioTrack[];
  trackState: Record<string, { state: AudioTrackState; reason?: string }>;
  rejected: LocalAudioReject[];
  currentId: string | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
}

/** Subset of HTMLAudioElement the adapter drives — real Audio() fits,
 *  tests inject a deterministic stub. */
export interface AudioElementLike {
  src: string;
  preload: string;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  dataset: { trackId?: string };
  error: { code: number } | null;
  load(): void;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
  canPlayType?(mime: string): string;
}

export interface LocalAudioAdapterOptions {
  maxBytes?: number;
  createElement?: () => AudioElementLike;
  createObjectURL?: (file: File) => string;
  revokeObjectURL?: (url: string) => void;
}

const defaultElement = (): AudioElementLike => new Audio() as unknown as AudioElementLike;

const MEDIA_ERR: Record<number, { state: AudioTrackState; reason: string }> = {
  1: { state: 'error', reason: 'Загрузка прервана' },
  2: { state: 'error', reason: 'Ошибка чтения файла' },
  3: { state: 'error', reason: 'Ошибка декодирования аудио' },
};

function mediaErrorState(code: number | undefined): { state: AudioTrackState; reason: string } {
  return MEDIA_ERR[code ?? 0] ?? {
    state: 'unsupported',
    reason: 'Кодек не поддерживается встроенным проигрывателем',
  };
}

export class LocalAudioAdapter {
  private readonly maxBytes: number;
  private readonly createURL: (file: File) => string;
  private readonly revokeURL: (url: string) => void;
  private readonly makeElement: () => AudioElementLike;
  private el: AudioElementLike | null = null;
  private readonly urls = new Map<string, string>(); // trackId → object URL
  private seq = 0;
  private listeners = new Set<() => void>();

  private snapshot: LocalAudioSnapshot = {
    queue: [],
    trackState: {},
    rejected: [],
    currentId: null,
    playing: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    muted: false,
  };

  constructor(opts: LocalAudioAdapterOptions = {}) {
    this.maxBytes = opts.maxBytes ?? MAX_LOCAL_AUDIO_BYTES;
    this.createURL = opts.createObjectURL ?? ((f: File) => URL.createObjectURL(f));
    this.revokeURL = opts.revokeObjectURL ?? ((u: string) => URL.revokeObjectURL(u));
    this.makeElement = opts.createElement ?? defaultElement;
    // SSR-safe: the Audio element is created lazily on first interaction —
    // constructing the adapter during server render must not touch DOM APIs.
  }

  private element(): AudioElementLike {
    if (this.el == null) {
      this.el = this.makeElement();
      this.el.preload = 'metadata';
      this.bind(this.el);
    }
    return this.el;
  }

  // --- subscription ------------------------------------------------------

  get state(): Readonly<LocalAudioSnapshot> {
    return this.snapshot;
  }

  /** Re-renders on every adapter-originated change; returns unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<LocalAudioSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  private setTrackState(id: string, s: { state: AudioTrackState; reason?: string }): void {
    this.set({ trackState: { ...this.snapshot.trackState, [id]: s } });
  }

  // --- element wiring ----------------------------------------------------

  private bind(el: AudioElementLike): void {
    el.addEventListener('timeupdate', () => this.set({ currentTime: el.currentTime }));
    el.addEventListener('loadedmetadata', () => {
      const id = el.dataset.trackId;
      this.set({ duration: Number.isFinite(el.duration) ? el.duration : 0 });
      if (id) this.setTrackState(id, { state: 'ready' });
    });
    el.addEventListener('ended', () => {
      const id = el.dataset.trackId;
      this.set({ playing: false });
      if (id) this.setTrackState(id, { state: 'ended' });
    });
    el.addEventListener('error', () => {
      const id = el.dataset.trackId;
      this.set({ playing: false });
      if (id) this.setTrackState(id, mediaErrorState(el.error?.code));
    });
  }

  // --- intake ------------------------------------------------------------

  /** Codec honesty: `canPlayType('')` → unknown (probe later at decode);
   *  explicit '"/""' result → 'unsupported' rejected before the queue. */
  private codecVerdict(file: File): 'ok' | 'reject' | 'unknown' {
    const mime = file.type;
    if (!mime) return 'unknown';
    const el = this.element();
    if (typeof el.canPlayType !== 'function') return 'unknown';
    const verdict = el.canPlayType(mime);
    if (verdict === 'probably' || verdict === 'maybe') return 'ok';
    return 'reject';
  }

  addFiles(files: Iterable<File>): void {
    const accepted: LocalAudioTrack[] = [];
    const rejected: LocalAudioReject[] = [];
    const state = { ...this.snapshot.trackState };
    for (const f of files) {
      if (f.size > this.maxBytes) {
        rejected.push({ name: f.name, reason: 'Файл больше 100 MiB — лимит локального медиаконтракта' });
        continue;
      }
      if (f.type !== '' && !f.type.startsWith('audio/')) {
        rejected.push({ name: f.name, reason: `Тип «${f.type}» не является аудио` });
        continue;
      }
      if (this.codecVerdict(f) === 'reject') {
        rejected.push({ name: f.name, reason: `Кодек «${f.type}» не поддерживается этим WebView` });
        continue;
      }
      const id = `t${++this.seq}-${f.name}`;
      this.urls.set(id, this.createURL(f));
      accepted.push({ id, name: f.name, size: f.size, mime: f.type });
      state[id] = { state: 'ready' };
    }
    if (accepted.length === 0 && rejected.length === 0) return;
    this.set({
      queue: [...this.snapshot.queue, ...accepted],
      rejected: [...this.snapshot.rejected, ...rejected],
      trackState: state,
    });
  }

  // --- transport ---------------------------------------------------------

  select(id: string): void {
    const url = this.urls.get(id);
    if (url == null) return;
    this.set({ currentId: id, playing: false, currentTime: 0, duration: 0 });
    const el = this.element();
    el.dataset.trackId = id;
    el.src = url;
    el.load();
    this.setTrackState(id, { state: 'loading' });
  }

  togglePlay(): void {
    const id = this.snapshot.currentId;
    if (id == null) return;
    if (this.snapshot.playing) {
      this.element().pause();
      this.set({ playing: false });
      if (this.snapshot.trackState[id]?.state === 'playing') {
        this.setTrackState(id, { state: 'paused' });
      }
      return;
    }
    this.element().play()
      .then(() => {
        this.set({ playing: true });
        this.setTrackState(id, { state: 'playing' });
      })
      .catch(() => {
        this.setTrackState(id, {
          state: 'error',
          reason: 'Воспроизведение отклонено браузером',
        });
      });
  }

  next(): void {
    const i = this.index();
    const q = this.snapshot.queue;
    if (i >= 0 && i < q.length - 1) this.select(q[i + 1].id);
  }

  prev(): void {
    const i = this.index();
    if (i > 0) this.select(this.snapshot.queue[i - 1].id);
  }

  seek(seconds: number): void {
    if (this.snapshot.currentId == null) return;
    this.element().currentTime = seconds;
  }

  setVolume(v: number): void {
    const volume = Math.min(1, Math.max(0, v));
    this.element().volume = volume;
    this.set({ volume });
  }

  setMuted(m: boolean): void {
    this.element().muted = m;
    this.set({ muted: m });
  }

  index(): number {
    return this.snapshot.queue.findIndex((t) => t.id === this.snapshot.currentId);
  }

  // --- lifecycle -----------------------------------------------------------

  clear(): void {
    if (this.el != null) {
      this.el.pause();
      this.el.src = '';
    }
    for (const url of this.urls.values()) this.revokeURL(url);
    this.urls.clear();
    this.set({
      queue: [],
      trackState: {},
      rejected: [],
      currentId: null,
      playing: false,
      currentTime: 0,
      duration: 0,
    });
  }

  /** Final teardown — pauses, revokes every URL, detaches the UI. */
  dispose(): void {
    this.clear();
    this.listeners.clear();
  }
}
