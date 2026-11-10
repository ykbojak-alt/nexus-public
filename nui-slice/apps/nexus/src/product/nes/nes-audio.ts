/**
 * Звук NES: jsnes отдаёт пары сэмплов (left, right) на своём sampleRate
 * (по умолчанию 44100). Здесь — кольцевой буфер + AudioWorkletNode;
 * на браузерах без AudioWorklet — фолбэк на deprecated ScriptProcessorNode.
 * Без resample-костылей в ядре: при несовпадении частот — интерполяция
 * до частоты AudioContext на стороне потребителя (worklet или onaudioprocess).
 */

const SOURCE_RATE = 44100;
const RING_SECONDS = 0.5;
/** Сколько сэмплов копим перед postMessage в worklet (меньше — ниже latency). */
const BATCH = 512;

/**
 * Код процессора инлайним строкой и грузим через Blob URL — так работает и
 * jsnes 2.1 (browser/speakers.js): не нужны бандлер-специфичные импорты.
 * Процессор держит свой кольцевой буфер и повторяет логику onaudioprocess:
 * если данных меньше кванта — тишина (underrun), иначе nearest-sample resample.
 *
 * Ресемплинг — дробный фазовый аккумулятор (phase): на каждый квант
 * потребляется floor(phase + len*ratio) сэмплов и остаток фазы переносится
 * дальше — суммарный счётчик не дрейфует (CODEX review FIX-1: на 48 kHz
 * floor(128 * 0.91875) = 117 давал слип ~0.6 сэмпла на квант).
 */
const WORKLET_CODE = `
class NexusNesAudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    var opts = (options && options.processorOptions) || {};
    this.capacity = Math.max(1, opts.capacity || 22050);
    this.ratio = opts.ratio || 1;
    this.left = new Float32Array(this.capacity);
    this.right = new Float32Array(this.capacity);
    this.head = 0;
    this.tail = 0;
    this.phase = 0;
    var self = this;
    this.port.onmessage = function (e) {
      var left = e.data.left;
      var right = e.data.right;
      if (!left || !right) return;
      for (var i = 0; i < left.length; i += 1) {
        self.left[self.head] = left[i];
        self.right[self.head] = right[i];
        self.head = (self.head + 1) % self.capacity;
        if (self.head === self.tail) self.tail = (self.tail + 1) % self.capacity;
      }
    };
  }

  process(inputs, outputs) {
    var out = outputs[0];
    if (!out || out.length < 2) return true;
    var outL = out[0];
    var outR = out[1];
    var size = this.capacity;
    // Входных сэмплов на квант — с учётом накопленной дробной фазы.
    var need = Math.floor(this.phase + outL.length * this.ratio);
    var available = (this.head - this.tail + size) % size;
    if (available < need) {
      outL.fill(0);
      outR.fill(0);
      return true;
    }
    var phase = this.phase;
    for (var i = 0; i < outL.length; i += 1) {
      var pos = (this.tail + Math.floor(phase)) % size;
      outL[i] = this.left[pos];
      outR[i] = this.right[pos];
      phase += this.ratio;
    }
    this.tail = (this.tail + need) % size;
    this.phase = phase - need; // дробный остаток — в следующий квант
    return true;
  }
}

registerProcessor('nexus-nes-audio', NexusNesAudioProcessor);
`;

export class NesAudio {
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private left = new Float32Array(0);
  private right = new Float32Array(0);
  private head = 0;
  private tail = 0;
  private muted = false;
  private ratio = 1;
  /** Дробная фаза чтения для fallback-пути — как this.phase в worklet. */
  private phase = 0;
  private batchL = new Float32Array(BATCH);
  private batchR = new Float32Array(BATCH);
  private batchPos = 0;

  /** Создаётся только по user-gesture (autoplay policy). */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    const size = Math.max(1, Math.floor(SOURCE_RATE * RING_SECONDS));
    this.left = new Float32Array(size);
    this.right = new Float32Array(size);
    // Вход 44100 → выход ctx.sampleRate: на N выходных отсчётов нужно
    // N * (44100/rate) входных сэмплов, поэтому ratio именно такой.
    this.ratio = SOURCE_RATE / ctx.sampleRate;
    this.ctx = ctx;
    ctx.onstatechange = () => this.onStateChange?.(ctx.state);
    if (ctx.audioWorklet) {
      const url = URL.createObjectURL(new Blob([WORKLET_CODE], { type: 'application/javascript' }));
      ctx.audioWorklet
        .addModule(url)
        .then(() => {
          URL.revokeObjectURL(url);
          if (this.ctx !== ctx) return; // stop() успел сработать
          const node = new AudioWorkletNode(ctx, 'nexus-nes-audio', {
            outputChannelCount: [2],
            processorOptions: { capacity: this.left.length, ratio: this.ratio },
          });
          node.connect(ctx.destination);
          // Пока модуль грузился, сэмплы копились в главном кольце — сливаем.
          this.flushRingToWorklet(node);
          this.worklet = node;
        })
        .catch(() => {
          URL.revokeObjectURL(url);
          if (this.ctx !== ctx) return;
          this.startScriptProcessor(ctx);
        });
    } else {
      this.startScriptProcessor(ctx);
    }
    void ctx.resume();
  }

  /** Deprecated-путь: оставлен как фолбэк для браузеров без audioWorklet. */
  private startScriptProcessor(ctx: AudioContext): void {
    const node = ctx.createScriptProcessor(2048, 0, 2);
    node.onaudioprocess = (event) => {
      const outL = event.outputBuffer.getChannelData(0);
      const outR = event.outputBuffer.getChannelData(1);
      const size = this.left.length;
      const need = Math.floor(this.phase + outL.length * this.ratio);
      const available = (this.head - this.tail + size) % size;
      if (size === 0 || available < need) {
        // underrun: тишина, позиция не двигается (без «залипания» старого окна)
        outL.fill(0);
        outR.fill(0);
        return;
      }
      let phase = this.phase;
      for (let i = 0; i < outL.length; i += 1) {
        const pos = (this.tail + Math.floor(phase)) % size;
        outL[i] = this.muted ? 0 : this.left[pos] ?? 0;
        outR[i] = this.muted ? 0 : this.right[pos] ?? 0;
        phase += this.ratio;
      }
      this.tail = (this.tail + need) % size;
      this.phase = phase - need;
    };
    node.connect(ctx.destination);
    this.node = node;
  }

  /** Сливает накопленное в главном кольце в worklet (в порядке записи). */
  private flushRingToWorklet(node: AudioWorkletNode): void {
    const size = this.left.length;
    const count = (this.head - this.tail + size) % size;
    if (count === 0) return;
    const left = new Float32Array(count);
    const right = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const pos = (this.tail + i) % size;
      left[i] = this.left[pos];
      right[i] = this.right[pos];
    }
    node.port.postMessage({ left, right });
    this.head = 0;
    this.tail = 0;
  }

  /** Вызывается из onAudioSample jsnes. */
  push(left: number, right: number): void {
    if (!this.ctx) return;
    if (this.worklet) {
      this.batchL[this.batchPos] = this.muted ? 0 : left;
      this.batchR[this.batchPos] = this.muted ? 0 : right;
      this.batchPos += 1;
      if (this.batchPos >= BATCH) this.flush();
      return;
    }
    const size = this.left.length;
    if (size === 0) return;
    this.left[this.head] = left;
    this.right[this.head] = right;
    this.head = (this.head + 1) % size;
    if (this.head === this.tail) this.tail = (this.tail + 1) % size;
  }

  /** Отправляет хвост неполного батча — вызывается после каждого кадра. */
  flush(): void {
    if (!this.worklet || this.batchPos === 0) return;
    this.worklet.port.postMessage({
      left: this.batchL.slice(0, this.batchPos),
      right: this.batchR.slice(0, this.batchPos),
    });
    this.batchPos = 0;
  }

  /** Колбэк на смену состояния AudioContext — для индикатора «звук приостановлен». */
  onStateChange: ((state: AudioContextState) => void) | null = null;

  /** AudioContext создан, но браузер его приостановил (autoplay policy). */
  get suspended(): boolean {
    return this.ctx !== null && this.ctx.state === 'suspended';
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get running(): boolean {
    return this.ctx !== null;
  }

  stop(): void {
    this.node?.disconnect();
    this.node = null;
    this.worklet?.disconnect();
    this.worklet = null;
    this.batchPos = 0;
    void this.ctx?.close();
    this.ctx = null;
  }
}
