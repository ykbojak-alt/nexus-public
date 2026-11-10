declare module 'jsnes' {
  export interface FrameBuffer {
    buffer: Uint32Array;
  }
  export interface NesOptions {
    onFrame?: (frame: FrameBuffer) => void;
    onAudioSample?: (left: number, right: number) => void;
    sampleRate?: number;
    emulateSound?: boolean;
  }
  export interface ControllerPort {
    buttonDown(button: number): void;
    buttonUp(button: number): void;
  }
  export class NES {
    constructor(options?: NesOptions);
    /** 1.x — бинарная строка; 2.x — также Uint8Array. */
    loadROM(data: string | Uint8Array): void;
    frame(): void;
    reset(): void;
    buttonDown(player: number, button: number): void;
    buttonUp(player: number, button: number): void;
    /** 2.x: контроллеры-порты вместо индексов. */
    controller1?: ControllerPort;
    controller2?: ControllerPort;
    on?(event: 'frame', handler: (frame: FrameBuffer) => void): void;
    toJSON(): string;
    fromJSON(json: string): void;
  }
  export const Controller: {
    BUTTON_A: number;
    BUTTON_B: number;
    BUTTON_SELECT: number;
    BUTTON_START: number;
    BUTTON_UP: number;
    BUTTON_DOWN: number;
    BUTTON_LEFT: number;
    BUTTON_RIGHT: number;
  };
}
