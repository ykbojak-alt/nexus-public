'use client';

import type { ReactNode } from 'react';
import { Button } from '../../actions/button/button';
import { IconButton } from '../../actions/icon-button/icon-button';
import { Slider } from '../../inputs/slider/slider';
import { StatusBadge, type NexusStatus } from '../../feedback/status-badge/status-badge';
import type { AudioTrackState } from '../types';
import styles from '../runtime.module.css';

export interface AudioTrack {
  id: string;
  /** File name — display name only, never a raw local path. */
  name: string;
  state?: AudioTrackState;
  /** Verbatim failure reason for unsupported/error. */
  reason?: string;
}

const TRACK_STATUS: Record<AudioTrackState, NexusStatus> = {
  ready: 'waiting',
  loading: 'syncing',
  playing: 'executing',
  paused: 'paused',
  ended: 'complete',
  unsupported: 'warning',
  error: 'error',
};

export interface AudioPlayerProps {
  className?: string;
  /** Local queue in user selection order. */
  queue?: AudioTrack[];
  /** Currently selected/loaded track id. */
  currentId?: string;
  playing?: boolean;
  currentTime?: number;
  duration?: number;
  /** 0–1. */
  volume?: number;
  muted?: boolean;
  onTogglePlay?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onSeek?: (seconds: number) => void;
  onVolume?: (volume: number) => void;
  onToggleMute?: () => void;
  onSelect?: (id: string) => void;
  /** Opens the host file picker; component never reads paths itself. */
  onAddFiles?: () => void;
}

function fmt(sec: number | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Local audio queue/player — presentational layer only. The caller owns the
 *  HTMLAudioElement, object URLs and decoding; this component renders honest
 *  state and routes the contract controls (play/pause, prev/next, seek,
 *  time/duration, volume/mute, selection) through callbacks. Remote provider
 *  players (Yandex, YouTube) keep their own controls and must not reuse this. */
export function AudioPlayer({
  className, queue = [], currentId, playing, currentTime, duration,
  volume = 1, muted, onTogglePlay, onPrev, onNext, onSeek, onVolume,
  onToggleMute, onSelect, onAddFiles,
}: AudioPlayerProps) {
  const current = queue.find((t) => t.id === currentId);
  const failed = current != null && (current.state === 'unsupported' || current.state === 'error');
  return (
    <div className={[styles.audioPlayer, className].filter(Boolean).join(' ')} data-testid="audio-player">
      <div className={styles.audioNow}>
        <div className={styles.audioTrackName} title={current?.name}>
          {current?.name ?? 'No file selected'}
        </div>
        {current?.state != null && (
          <StatusBadge status={TRACK_STATUS[current.state]} label={current.state} />
        )}
      </div>
      {failed && current.reason != null && (
        <p className={styles.audioReason} role="status">{current.reason}</p>
      )}
      <div className={styles.audioControls}>
        <IconButton icon="act.chevron" aria-label="Previous track" size="sm"
          className={styles.audioFlip} onClick={onPrev} disabled={onPrev == null} />
        <IconButton icon={playing === true ? 'act.pause' : 'act.play'}
          aria-label={playing === true ? 'Pause' : 'Play'}
          onClick={onTogglePlay} disabled={onTogglePlay == null || current == null || failed} />
        <IconButton icon="act.chevron" aria-label="Next track" size="sm"
          onClick={onNext} disabled={onNext == null} />
        <span className={styles.audioTime}>
          <span>{fmt(currentTime)}</span>
          <Slider label="Seek" min={0} max={duration ?? 0} value={currentTime ?? 0}
            onChange={(v) => onSeek?.(v)}
            disabled={onSeek == null || current == null || failed} className={styles.audioSeek} />
          <span>{fmt(duration)}</span>
        </span>
        <span className={styles.audioVolume}>
          <Button variant="ghost" size="sm" onClick={onToggleMute} disabled={onToggleMute == null}>
            {muted === true ? 'Unmute' : 'Mute'}
          </Button>
          <Slider label="Volume" min={0} max={1} step={0.01} value={muted === true ? 0 : volume}
            onChange={(v) => onVolume?.(v)}
            disabled={onVolume == null} className={styles.audioVolumeSlider} />
        </span>
      </div>
      {queue.length > 0 && (
        <ul className={styles.audioQueue}>
          {queue.map((track) => (
            <li key={track.id}>
              <button type="button" className={styles.audioQueueRow}
                data-current={track.id === currentId || undefined}
                data-state={track.state}
                onClick={() => onSelect?.(track.id)}>
                <span className={styles.audioQueueName} title={track.name}>{track.name}</span>
                {track.state != null && (
                  <StatusBadge status={TRACK_STATUS[track.state]} label={track.state} />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {onAddFiles != null && (
        <Button variant="ghost" size="sm" onClick={onAddFiles}>Add files…</Button>
      )}
    </div>
  );
}
