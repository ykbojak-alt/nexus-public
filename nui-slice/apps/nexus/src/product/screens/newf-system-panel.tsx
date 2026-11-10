'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchBridgeApi } from './newf-live';
import styles from './newf-system-panel.module.css';

export const POLL_MS = 300;

export interface SystemSnapshot {
  cpu_pct: number;
  mem_used: number;
  mem_total: number;
  disks: { letter: string; free: number; total: number }[];
  net: { rx_bps: number; tx_bps: number };
  gpu: { pct: number; vram_used: number; vram_total: number; temp: number } | null;
  uptime_s: number;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  const gb = n / (1024 * 1024 * 1024);
  return gb >= 1 ? `${gb.toFixed(1)}G` : `${(n / (1024 * 1024)).toFixed(0)}M`;
}

export function barPct(value: number, total?: number): number {
  if (total && total > 0) return Math.max(0, Math.min(100, (value / total) * 100));
  return Math.max(0, Math.min(100, value));
}

export function formatUptime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${h}h ${m}m ${sec}s`;
}

export interface NewfSystemPanelProps {
  base?: string;
  pollMs?: number;
}

type LoadState = 'loading' | 'ok' | 'offline';

export function NewfSystemPanel({ base = '', pollMs = POLL_MS }: NewfSystemPanelProps) {
  const [snap, setSnap] = useState<SystemSnapshot | null>(null);
  const [load, setLoad] = useState<LoadState>('loading');
  const inflight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (inflight.current) return;
      inflight.current = true;
      try {
        const res = await fetchBridgeApi(`${base}/api/core/system`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SystemSnapshot;
        if (cancelled) return;
        setSnap(data);
        setLoad('ok');
      } catch {
        if (cancelled) return;
        setLoad((prev) => (snap ? prev : 'offline'));
      } finally {
        inflight.current = false;
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [base, pollMs, snap]);

  const cpuPct = snap ? barPct(snap.cpu_pct) : 0;
  const memPct = snap ? barPct(snap.mem_used, snap.mem_total) : 0;

  return (
    <section className={styles.panel}>
      <header className={styles.header}>SYSTEM</header>
      {load === 'loading' && <div className={styles.muted}>loading…</div>}
      {load === 'offline' && !snap && <div className={styles.muted}>core offline</div>}
      {snap && (
        <>
          <div className={styles.row}>
            <span className={styles.label}>CPU</span>
            <div className={styles.bar}><div className={styles.fill} style={{ width: `${cpuPct}%` }} /></div>
            <span className={styles.value}>{cpuPct.toFixed(0)}%</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>MEM</span>
            <div className={styles.bar}><div className={styles.fill} style={{ width: `${memPct}%` }} /></div>
            <span className={styles.value}>{formatBytes(snap.mem_used)}/{formatBytes(snap.mem_total)}</span>
          </div>
          <table className={styles.disks}>
            <tbody>
              {snap.disks.map((d) => {
                const freePct = d.total > 0 ? (d.free / d.total) * 100 : 0;
                return (
                  <tr key={d.letter}>
                    <td>{d.letter}</td>
                    <td>{formatBytes(d.free)} free</td>
                    <td>{freePct.toFixed(0)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className={styles.row}>
            <span className={styles.label}>NET</span>
            <span className={styles.value}>rx {snap.net.rx_bps.toFixed(0)} tx {snap.net.tx_bps.toFixed(0)} b/s</span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>GPU</span>
            <span className={styles.value}>
              {snap.gpu
                ? `${snap.gpu.pct.toFixed(0)}% ${snap.gpu.vram_used}/${snap.gpu.vram_total}MB ${snap.gpu.temp.toFixed(0)}°C`
                : 'no gpu'}
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>UP</span>
            <span className={styles.value}>{formatUptime(snap.uptime_s)}</span>
          </div>
        </>
      )}
    </section>
  );
}
