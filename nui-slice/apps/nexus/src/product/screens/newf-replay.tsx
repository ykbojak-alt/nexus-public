'use client';

/**
 * W16: Session-replay player (.cast).
 * Принимает текст .cast (asciinema: по строке JSON [start, delay, type, data]).
 * Управление: play/pause, speed (0.5/1/2), seek (нов).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './newf-agents-panel.module.css';

export interface ReplayPlayerProps {
  castText: string;
  title?: string;
}

interface CastFrame {
  delay: number;
  data: string;
}

export function parseCast(text: string): CastFrame[] {
  const frames: CastFrame[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    try {
      const parsed = JSON.parse(t) as unknown[];
      if (Array.isArray(parsed) && parsed.length >= 4 && parsed[2] === 'o') {
        frames.push({ delay: Number(parsed[1]) || 0, data: String(parsed[3] ?? '') });
      }
    } catch { /* пропускаем строки */ }
  }
  return frames;
}

const SPEEDS = [0.5, 1, 2] as const;

export function ReplayPlayer({ castText, title }: ReplayPlayerProps) {
  const frames = useMemo(() => parseCast(castText), [castText]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [index, setIndex] = useState(0);
  const [output, setOutput] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // seek: показываем консолидированный вывод до index
  useEffect(() => {
    let acc = '';
    for (let i = 0; i < index && i < frames.length; i += 1) acc += frames[i].data;
    setOutput(acc);
  }, [index, frames]);

  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      setIndex((prev) => {
        if (prev >= frames.length) { setPlaying(false); return prev; }
        const delay = Math.max(10, (frames[prev]?.delay ?? 50) / speed);
        timer.current = setTimeout(tick, delay);
        return prev + 1;
      });
    };
    tick();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [playing, speed, frames.length]);

  const canPlay = frames.length > 0;

  return (
    <section className={styles.group} role="region" aria-label="Replay" data-testid="replay-player">
      <h3 className={styles.groupTitle}>
        REPLAY <span className={styles.groupCount}>{title ?? `${frames.length} frames`}</span>
      </h3>
      <div className={styles.replayControls}>
        <button
          type="button"
          data-testid="replay-play"
          disabled={!canPlay}
          onClick={() => setPlaying((p) => !p)}
        >{playing ? '❚❚' : '▶'}</button>
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            data-testid={`replay-speed-${s}`}
            className={speed === s ? styles.filterActive : styles.filterChip}
            onClick={() => setSpeed(s)}
          >{s}x</button>
        ))}
        <input
          type="range"
          min={0}
          max={Math.max(0, frames.length - 1)}
          value={index}
          aria-label="Seek"
          data-testid="replay-seek"
          onChange={(e) => setIndex(Number(e.target.value))}
        />
        <span data-testid="replay-position">{index}/{frames.length}</span>
      </div>
      <pre className={styles.replayOutput} data-testid="replay-output">{output || '…'}</pre>
    </section>
  );
}
