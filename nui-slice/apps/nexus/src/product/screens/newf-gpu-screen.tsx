'use client';

/**
 * W81: GPU-рендер экрана терминала — @xterm/xterm + @xterm/addon-webgl
 * на canvas (owner: «NEWF должен работать на GPU и в памяти GPU»).
 *
 * Feed — сырой screen (ANSI) от bridge.screenStream/poll, пишет
 * snapshot-семантикой: term.reset() + term.write() на каждый кадр
 * (потоковая запись дублировала бы содержимое).
 *
 * WebGL недоступен (getContext → null, addon throw, jsdom) → честный
 * fallback на <pre> с тем же текстом — экран не пустеет. До подтверждения
 * WebGL тоже рендерится <pre>: нет промежуточного пустого div с testid.
 */

import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import styles from './newf-agents-panel.module.css';

export const GPU_SCREEN_COLS = 120;
export const GPU_SCREEN_ROWS = 12;

// W5s-F2: лимит параллельных WebGL-контекстов (Chrome ~16): сверх лимита
// панель идёт в <pre>-fallback, контекст не захватывается.
const GPU_CONTEXT_LIMIT = 8;
let gpuContextsInUse = 0;
function acquireGpuContext(): boolean {
  if (gpuContextsInUse >= GPU_CONTEXT_LIMIT) return false;
  gpuContextsInUse += 1;
  return true;
}
function releaseGpuContext(): void {
  gpuContextsInUse = Math.max(0, gpuContextsInUse - 1);
}

function webglAvailable(): boolean {
  let probe: HTMLCanvasElement | null = null;
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  try {
    probe = document.createElement('canvas');
    gl = (probe.getContext('webgl2') ?? probe.getContext('webgl')) as WebGLRenderingContext | WebGL2RenderingContext | null;
    return !!gl;
  } catch {
    return false;
  } finally {
    // W58: освобождаем probe-контекст (лимит ~16 контекстов на браузер)
    if (gl) {
      try { (gl.getExtension('WEBGL_lose_context') as { loseContext?: () => void } | null)?.loseContext?.(); } catch { /* noop */ }
    }
    probe = null;
  }
}

export function NewfGpuScreen({
  screen,
  testId,
}: {
  screen: string;
  testId?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const [gpuOk, setGpuOk] = useState<boolean | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !webglAvailable() || !acquireGpuContext()) {
      setGpuOk(false);
      return;
    }
    let term: Terminal | null = null;
    let addon: WebglAddon | null = null;
    let disposed = false;
    const teardown = () => {
      if (disposed) return;
      disposed = true;
      addon?.dispose();
      term?.dispose();
      releaseGpuContext();
      termRef.current = null;
    };
    try {
      term = new Terminal({
        cols: GPU_SCREEN_COLS,
        rows: GPU_SCREEN_ROWS,
        fontSize: 10,
        fontFamily: 'var(--font-mono, monospace)',
        convertEol: true,
        scrollback: 0,
        disableStdin: true,
      });
      addon = new WebglAddon();
      term.loadAddon(addon); // probe WebGL-контекста — throw при недоступности
      term.open(host);
    } catch {
      term?.dispose();
      releaseGpuContext();
      setGpuOk(false);
      return;
    }
    termRef.current = term;
    setGpuOk(true);
    // W58: подписка на WebGL context-loss → честный fallback на <pre>.
    // W5s-F1: при потере контекста — полный teardown (addon+Terminal+слот),
    // иначе GPU-объекты утекают.
    const onContextLoss = (e: Event) => {
      e.preventDefault();
      teardown();
      setGpuOk(false);
    };
    const canvas = host.querySelector('canvas');
    canvas?.addEventListener('webglcontextlost', onContextLoss);
    return () => {
      canvas?.removeEventListener('webglcontextlost', onContextLoss);
      teardown();
    };
  }, []);

  // W5s-F3: backpressure — пишем не чаще кадра (rAF-coalesce), иначе
  // быстрый поток screen-пропов забивает parser очередь кадрами.
  const pendingRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (gpuOk !== true) return;
    pendingRef.current = screen;
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      const term = termRef.current;
      const next = pendingRef.current;
      if (!term || next === null) return;
      pendingRef.current = null;
      term.reset();
      term.write(next);
    });
  }, [screen, gpuOk]);
  useEffect(() => () => {
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <>
      <div
        ref={hostRef}
        className={styles.gpuScreen}
        data-testid={gpuOk === true ? testId : undefined}
        hidden={gpuOk !== true}
      />
      {gpuOk !== true && (
        <pre className={styles.summaryScreenPre} data-testid={testId}>
          {screen || '…'}
        </pre>
      )}
    </>
  );
}
