// Вендорованное ядро jsnes 2.1.0 (Apache-2.0, см. vendor/jsnes/LICENSE) —
// с патчем sprite-0-hit (см. FORGE patch в vendor/jsnes/ppu/index.js).
import { Controller, NES, type ButtonKey } from './vendor/jsnes/index.js';

export type NesButton = 'A' | 'B' | 'START' | 'SELECT' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

// ButtonKey (0-9), а не number: nes.buttonDown/Up типизированы как ButtonKey
// в vendor .d.ts — Record<…, number> давал TS2345 при прямом вызове.
const BUTTON_CODE: Record<NesButton, ButtonKey> = {
  A: Controller.BUTTON_A,
  B: Controller.BUTTON_B,
  START: Controller.BUTTON_START,
  SELECT: Controller.BUTTON_SELECT,
  UP: Controller.BUTTON_UP,
  DOWN: Controller.BUTTON_DOWN,
  LEFT: Controller.BUTTON_LEFT,
  RIGHT: Controller.BUTTON_RIGHT,
};

/** Клавиатура → кнопки NES (раскладка как у классических веб-эмуляторов). */
export const KEY_BINDING: Record<string, NesButton> = {
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
  w: 'UP',
  W: 'UP',
  a: 'LEFT',
  A: 'LEFT',
  s: 'DOWN',
  S: 'DOWN',
  d: 'RIGHT',
  D: 'RIGHT',
  e: 'A',
  E: 'A',
  f: 'B',
  F: 'B',
  z: 'A',
  Z: 'A',
  x: 'B',
  X: 'B',
  Enter: 'START',
  Shift: 'SELECT',
};

/** jsnes.loadROM ждёт бинарную строку, а не Uint8Array. */
function toBinaryString(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return out;
}

type ControllerLike = { buttonDown?: (button: number) => void; buttonUp?: (button: number) => void };
type NesLike = NES & {
  controller1?: ControllerLike;
  on?: (event: string, handler: (frame: { buffer: Uint32Array }) => void) => void;
  /** jsnes 2.x: подстройка аудио-таймера под фактический fps хоста. */
  setFramerate?: (rate: number) => void;
};

/** NTSC NES: 60.0988 fps — эмулятор гоняем по настоящей частоте, не по частоте монитора. */
const NES_FPS = 60.0988;
const FRAME_MS = 1000 / NES_FPS;
/** Сколько кадров максимум догоняем за один rAF (защита от спирали после свёртки вкладки). */
const MAX_CATCHUP_MS = FRAME_MS * 5;

/**
 * Тонкая обёртка над jsnes (MIT): загрузка ROM, кадровый цикл по rAF,
 * ввод и сохранения. Рендер — Uint32Array 256×240, раскладывается в canvas
 * вызывающей стороной (ядро не знает про DOM-канвас).
 *
 * API-адаптивность: jsnes 1.x принимает бинарную строку и `nes.buttonDown(1, b)`,
 * 2.x — `controller1.buttonDown(b)` (и допускает Uint8Array). Обе формы
 * поддерживаются через feature-detection, чтобы обёртка не зависела от минорной
 * версии пакета.
 */
export class NesCore {
  private nes: NesLike | null = null;
  private raf = 0;
  private running = false;
  private last = 0;
  private acc = 0;
  private frameHandler: ((pixels: Uint32Array) => void) | null = null;
  private audioHandler: ((left: number, right: number) => void) | null = null;

  load(bytes: Uint8Array): void {
    this.stop();
    // jsnes 2.x: onFrame(buffer: Uint32Array) напрямую (не объект).
    const emit = (frame: Uint32Array | { buffer: Uint32Array }) =>
      this.frameHandler?.(frame instanceof Uint32Array ? frame : frame.buffer);
    const audio = (left: number, right: number) => this.audioHandler?.(left, right);
    const nes = new NES({ onFrame: emit, onAudioSample: audio, emulateSound: true, sampleRate: 44100 }) as NesLike;
    // Аудио-таймер papu по умолчанию считает на 60 fps — честно сообщаем NTSC-частоту.
    nes.setFramerate?.(NES_FPS);
    // 2.x: Uint8Array; 1.x: бинарная строка. Пробуем современный путь первым.
    try {
      (nes.loadROM as unknown as (data: Uint8Array | string) => void)(bytes);
    } catch {
      nes.loadROM(toBinaryString(bytes));
    }
    this.nes = nes;
  }

  onFrame(handler: (pixels: Uint32Array) => void): void {
    this.frameHandler = handler;
  }

  /** Пары сэмплов jsnes (left, right) на 44100 Гц. */
  onAudioSample(handler: (left: number, right: number) => void): void {
    this.audioHandler = handler;
  }

  get loaded(): boolean {
    return this.nes !== null;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (!this.nes || this.running) return;
    this.running = true;
    this.last = 0;
    this.acc = 0;
    // Накопление времени: rAF тикает с частотой монитора (60/120/144 Гц),
    // а nes.frame() — по фиксированным 60.0988 fps. На быстрых дисплеях
    // кадры пропускаются, на медленных — догоняются (до MAX_CATCHUP_MS).
    const step = (now: number) => {
      if (!this.running || !this.nes) return;
      if (this.last === 0) this.last = now;
      const dt = Math.min(now - this.last, MAX_CATCHUP_MS);
      this.last = now;
      this.acc += dt;
      while (this.acc >= FRAME_MS) {
        this.acc -= FRAME_MS;
        this.nes.frame();
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  reset(): void {
    this.nes?.reset();
  }

  press(button: NesButton, down: boolean): void {
    const nes = this.nes;
    if (!nes) return;
    const code = BUTTON_CODE[button];
    const ctrl = nes.controller1;
    if (down) {
      if (ctrl?.buttonDown) ctrl.buttonDown(code);
      else nes.buttonDown(1, code);
    } else if (ctrl?.buttonUp) {
      ctrl.buttonUp(code);
    } else {
      nes.buttonUp(1, code);
    }
  }

  saveState(): string | null {
    if (!this.nes) return null;
    const data = this.nes.toJSON();
    return typeof data === 'string' ? data : JSON.stringify(data);
  }

  loadState(json: string): void {
    if (!this.nes) return;
    let parsed: unknown;
    try { parsed = JSON.parse(json); } catch { parsed = json; }
    (this.nes.fromJSON as unknown as (d: unknown) => void)(parsed);
  }

  destroy(): void {
    this.stop();
    this.frameHandler = null;
    this.nes = null;
  }
}
