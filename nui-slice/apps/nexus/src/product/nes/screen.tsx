'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, GlassPanel, PanelHeader, StatusBadge } from '@nexus/ui';
import { KEY_BINDING, NesCore, type NesButton } from './nes-core';
import { NesAudio } from './nes-audio';
import styles from './nes.module.css';

const ASSET_BASE =
  typeof document !== 'undefined' &&
    document.querySelector('script[src*="/_nexus/"], link[href*="/_nexus/"]')
    ? '/_nexus'
    : '';

const SCREEN_W = 256;
const SCREEN_H = 240;
const STATE_KEY_PREFIX = 'nexus.nes.state.';

/** FNV-1a — стабильный ключ на ROM без зависимостей. */
function hashStr(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const stateKeyFor = (romId: string) => `${STATE_KEY_PREFIX}${hashStr(romId)}`;

/** Валидный iNES: магия "NES\x1a" и правдоподобный размер (16 КБ … 4 МБ). */
function isValidNes(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || bytes.length > 4 * 1024 * 1024) return false;
  return bytes[0] === 0x4e && bytes[1] === 0x45 && bytes[2] === 0x53 && bytes[3] === 0x1a;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / (1024 * 1024)).toFixed(2)} МБ`;
}

interface FileInfo {
  name: string;
  size: number;
  status: 'valid' | 'error';
  message?: string;
}

/** Сохранение привязано к ROM: в значении лежит id, при загрузке сверяем. */
interface SavedState {
  rom: string;
  state: string;
}

function readState(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeState(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Кадр jsnes — little-endian ABGR (0xAABBGGRR), раскладываем в RGBA. */
function blit(pixels: Uint32Array, ctx: CanvasRenderingContext2D): void {
  const image = ctx.createImageData(SCREEN_W, SCREEN_H);
  for (let i = 0; i < SCREEN_W * SCREEN_H; i += 1) {
    const v = pixels[i];
    image.data[i * 4] = v & 0xff;
    image.data[i * 4 + 1] = (v >> 8) & 0xff;
    image.data[i * 4 + 2] = (v >> 16) & 0xff;
    image.data[i * 4 + 3] = 0xff;
  }
  ctx.putImageData(image, 0, 0);
}

export function NesScreen() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const coreRef = useRef<NesCore | null>(null);
  const [romTitle, setRomTitle] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasState, setHasState] = useState(false);
  const [romId, setRomId] = useState<string | null>(null);
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // Браузер приостановил AudioContext (autoplay policy) — показываем «▶ Звук».
  const [audioSuspended, setAudioSuspended] = useState(false);
  const audioRef = useRef<NesAudio | null>(null);

  /** Дефолтная схема WASD+E/F+стрелки + переназначенные клавиши из localStorage. */
  const DEFAULT_KEYS: Record<string, NesButton> = { ...KEY_BINDING };
  const [keyBinding, setKeyBinding] = useState<Record<string, NesButton>>(() => {
    try {
      const saved = window.localStorage.getItem('nexus.nes.keys');
      if (saved) return { ...DEFAULT_KEYS, ...JSON.parse(saved) };
    } catch {}
    return { ...DEFAULT_KEYS };
  });
  const [remapping, setRemapping] = useState<NesButton | null>(null);

  const saveKeys = useCallback((bindings: Record<string, NesButton>) => {
    setKeyBinding(bindings);
    try { window.localStorage.setItem('nexus.nes.keys', JSON.stringify(bindings)); } catch {}
  }, []);

  const core = useCallback(() => {
    if (!coreRef.current) coreRef.current = new NesCore();
    return coreRef.current;
  }, []);

  useEffect(() => {
    return () => {
      coreRef.current?.destroy();
      coreRef.current = null;
      audioRef.current?.stop();
      audioRef.current = null;
    };
  }, []);

  const clearCanvas = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  }, []);

  // AudioContext — только по user-gesture. ВАЖНО: создаём/resume'им СИНХРОННО
  // в обработчике клика — после await fetch/arrayBuffer transient activation
  // уже потерян и ctx родился бы suspended (CODEX review FIX-2).
  const ensureAudio = useCallback(() => {
    const audio = audioRef.current ?? new NesAudio();
    audioRef.current = audio;
    if (!audio.onStateChange) {
      audio.onStateChange = (s) => setAudioSuspended(s === 'suspended');
    }
    audio.start();
    audio.setMuted(muted);
    return audio;
  }, [muted]);

  const startCore = useCallback((bytes: Uint8Array, title: string) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    setError(null);
    try {
      const c = core();
      c.onFrame((pixels) => {
        blit(pixels, ctx);
        audioRef.current?.flush();
      });
      const audio = ensureAudio();
      c.onAudioSample((left, right) => audio.push(left, right));
      c.load(bytes);
      c.start();
      setRomTitle(title);
      setRomId(`${title}|${bytes.length}`);
      setRunning(true);
    } catch (e) {
      core().stop();
      setRunning(false);
      setRomTitle(null);
      setRomId(null);
      clearCanvas();
      setError(`Невалидный ROM: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [core, clearCanvas, ensureAudio]);

  const loadRomFile = useCallback(async (file: File) => {
    ensureAudio(); // синхронно, пока живо событие выбора файла
    const bytes = new Uint8Array(await file.arrayBuffer());
    const title = file.name.replace(/\.nes$/i, '');
    if (!isValidNes(bytes)) {
      setFileInfo({ name: file.name, size: bytes.length, status: 'error', message: 'не .nes или битый файл' });
      setError(`«${file.name}» — невалидный ROM (ожидается iNES-заголовок NES\\x1A, 16 КБ…4 МБ).`);
      core().stop();
      setRunning(false);
      setRomTitle(null);
      setRomId(null);
      clearCanvas();
      return;
    }
    setFileInfo({ name: file.name, size: bytes.length, status: 'valid' });
    startCore(bytes, title);
  }, [startCore, core, clearCanvas, ensureAudio]);

  const togglePause = useCallback(() => {
    const c = core();
    if (!c.loaded) return;
    if (c.isRunning) { c.stop(); setRunning(false); } else { c.start(); setRunning(true); }
  }, [core]);

  const reset = useCallback(() => {
    core().reset();
  }, [core]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    audioRef.current?.setMuted(next);
  }, [muted]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void stageRef.current?.requestFullscreen();
    }
  }, []);

  // Esc/жест выхода из fullscreen не проходит через toggle — синкаемся по событию.
  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const saveState = useCallback(() => {
    if (!romId) {
      setError('Сначала загрузите ROM — сохранение привязано к игре.');
      return;
    }
    const json = core().saveState();
    if (!json) return;
    const saved: SavedState = { rom: romId, state: json };
    if (!writeState(stateKeyFor(romId), JSON.stringify(saved))) {
      setError('localStorage недоступен (квота/режим) — состояние не сохранено.');
      return;
    }
    setHasState(true);
  }, [core, romId]);

  const loadState = useCallback(() => {
    if (!romId) {
      setError('Сначала загрузите ROM — состояние привязано к игре.');
      return;
    }
    const raw = readState(stateKeyFor(romId));
    if (!raw) return;
    let saved: SavedState | null = null;
    try {
      const parsed = JSON.parse(raw) as Partial<SavedState>;
      if (typeof parsed?.state === 'string') saved = { rom: String(parsed.rom ?? ''), state: parsed.state };
    } catch {
      saved = null;
    }
    if (!saved) {
      // legacy-формат без конверта: принимаем как состояние текущего ROM
      core().loadState(raw);
      return;
    }
    if (saved.rom !== romId) {
      setError('Сохранение относится к другому ROM — загрузите его и повторите.');
      return;
    }
    core().loadState(saved.state);
  }, [core, romId]);

  useEffect(() => {
    setHasState(Boolean(romId && readState(stateKeyFor(romId))));
  }, [romId]);

  useEffect(() => {
    if (!running) return;
    const pressed = new Set<NesButton>();
    const BUTTONS: Array<[number, NesButton]> = [
      [0, 'A'], [1, 'B'], [8, 'SELECT'], [9, 'START'],
      [12, 'UP'], [13, 'DOWN'], [14, 'LEFT'], [15, 'RIGHT'],
    ];
    let raf = 0;
    const poll = () => {
      const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
      const active = new Set<NesButton>();
      for (const pad of pads) {
        if (!pad) continue;
        for (const [index, button] of BUTTONS) {
          if (pad.buttons[index]?.pressed) active.add(button);
        }
        const [ax, ay] = pad.axes;
        if (typeof ax === 'number' && Math.abs(ax) > 0.5) active.add(ax > 0 ? 'RIGHT' : 'LEFT');
        if (typeof ay === 'number' && Math.abs(ay) > 0.5) active.add(ay > 0 ? 'DOWN' : 'UP');
      }
      for (const button of active) if (!pressed.has(button)) { pressed.add(button); core().press(button, true); }
      for (const button of [...pressed]) if (!active.has(button)) { pressed.delete(button); core().press(button, false); }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => {
      cancelAnimationFrame(raf);
      for (const button of pressed) core().press(button, false);
    };
  }, [core, running]);

  // Захват клавиши для переназначения кнопки NES (Escape — отмена).
  useEffect(() => {
    if (!remapping) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === 'Escape') {
        setRemapping(null);
        return;
      }
      const next = { ...keyBinding };
      for (const [k, v] of Object.entries(next)) {
        if (v === remapping || k === e.key) delete next[k];
      }
      next[e.key] = remapping;
      saveKeys(next);
      setRemapping(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [remapping, keyBinding, saveKeys]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (!running) return;
      const button: NesButton | undefined = keyBinding[e.key];
      if (!button) return;
      e.preventDefault();
      core().press(button, true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (!running) return;
      const button: NesButton | undefined = keyBinding[e.key];
      if (!button) return;
      core().press(button, false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [core, running, keyBinding]);

  const touch = (button: NesButton) => ({
    onPointerDown: () => core().press(button, true),
    onPointerUp: () => core().press(button, false),
    onPointerLeave: () => core().press(button, false),
    onPointerCancel: () => core().press(button, false),
  });

  return (
    <div className={styles.page} data-screen="nes">
      <PanelHeader
        level="screen"
        divider={false}
        title="NES · эмулятор"
        subtitle={romTitle ? `${romTitle} · 256×240` : 'Встроенный веб-эмулятор (jsnes, MIT)'}
        actions={<StatusBadge status="info" label="ЛОКАЛЬНО" />}
      />

      <GlassPanel className={styles.keysPanel}>
        <h3>Управление</h3>
        <div className={styles.keysGrid}>
          {(['UP', 'DOWN', 'LEFT', 'RIGHT', 'A', 'B', 'START', 'SELECT'] as NesButton[]).map(button => (
            <button
              key={button}
              type="button"
              className={styles.keyBtn}
              data-remapping={remapping === button || undefined}
              onClick={() => setRemapping(button)}
            >
              <span className={styles.keyName}>{button}</span>
              <span className={styles.keyValue}>
                {remapping === button ? 'нажмите клавишу…' : (Object.entries(keyBinding).find(([, v]) => v === button)?.[0] ?? '—')}
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className={styles.keyReset}
          onClick={() => {
            saveKeys({ ...DEFAULT_KEYS });
            try { window.localStorage.removeItem('nexus.nes.keys'); } catch {}
          }}
        >
          Сброс к умолчанию
        </button>
      </GlassPanel>

      <GlassPanel className={styles.stage}>
        <div ref={stageRef} className={styles.fsContainer}>
        <canvas
          ref={canvasRef}
          width={SCREEN_W}
          height={SCREEN_H}
          className={styles.canvas}
          aria-label="Экран NES"
        />
        <div className={styles.touch} role="group" aria-label="Тач-управление NES">
          <span />
          <button type="button" className={styles.touchBtn} aria-label="Вверх" {...touch('UP')}>▲</button>
          <span />
          <button type="button" className={styles.touchBtn} aria-label="Влево" {...touch('LEFT')}>◀</button>
          <span />
          <button type="button" className={styles.touchBtn} aria-label="Вправо" {...touch('RIGHT')}>▶</button>
          <span />
          <button type="button" className={styles.touchBtn} aria-label="Вниз" {...touch('DOWN')}>▼</button>
          <span />
        </div>
        <div className={styles.touchMeta} role="group" aria-label="Тач-кнопки NES">
          <button type="button" className={styles.touchBtn} aria-label="Кнопка B" {...touch('B')}>B</button>
          <button type="button" className={styles.touchBtn} aria-label="Кнопка A" {...touch('A')}>A</button>
          <button type="button" className={styles.touchBtn} aria-label="Select" {...touch('SELECT')}>Sel</button>
          <button type="button" className={styles.touchBtn} aria-label="Start" {...touch('START')}>Sta</button>
        </div>
        </div>
        <div className={styles.controls}>
          <Button variant="primary" onClick={togglePause} disabled={!romTitle}>
            {running ? 'Пауза' : 'Продолжить'}
          </Button>
          <Button variant="ghost" onClick={reset} disabled={!romTitle}>Сброс</Button>
          <Button variant="ghost" onClick={saveState} disabled={!romTitle}>Сохранить</Button>
          <Button variant="ghost" onClick={loadState} disabled={!hasState} title={hasState ? 'Загрузить сохранение' : 'Нет сохранения для этого ROM'}>Загрузить</Button>
          <Button variant="ghost" onClick={toggleMute} disabled={!romTitle} aria-pressed={muted} title="Звук эмулятора">
            {muted ? 'Звук: выкл' : 'Звук: вкл'}
          </Button>
          {audioSuspended && (
            <Button
              variant="primary"
              onClick={() => audioRef.current?.start()}
              title="Браузер приостановил звук (autoplay policy) — возобновить"
            >
              ▶ Звук
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={toggleFullscreen}
            aria-pressed={fullscreen}
            title={fullscreen ? 'Выйти из полноэкранного режима (Esc)' : 'Игра на весь экран'}
          >
            {fullscreen ? 'Окно' : 'Во весь экран'}
          </Button>
          <label className={styles.filePick}>
            <span>ROM с диска…</span>
            <input
              type="file"
              accept=".nes"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void loadRomFile(file);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        {fileInfo && (
          <p className={styles.fileInfo} data-status={fileInfo.status} role="status">
            {fileInfo.name} · {formatBytes(fileInfo.size)} ·{' '}
            {fileInfo.status === 'valid' ? 'валидный .nes' : `ошибка: ${fileInfo.message ?? 'невалидный ROM'}`}
          </p>
        )}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </GlassPanel>

      <p className={styles.keys}>
        Управление: стрелки — крестовина, Z — A, X — B, Enter — Start, Shift — Select.
        Геймпад: кнопки 0/1 — A/B, 8/9 — Select/Start, крестовина или левый стик.
      </p>
      <p className={styles.hint}>
        Только легальные ROM: homebrew, public domain, CC. Коммерческие игры не поставляются —
        загружайте собственные дампы.
      </p>
      <p className={styles.hint}>
        Сохранение привязано к ROM (ключ по названию и размеру файла). Состояние jsnes не
        содержит данных картриджа — при смене ROM старый слот не подхватывается.
      </p>
    </div>
  );
}
