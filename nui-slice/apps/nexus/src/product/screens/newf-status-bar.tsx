'use client';

/**
 * W59: глобальная status-bar (28px, herdr-паритет gap #1).
 *
 * Машина · branch · N agents (+N needs you) · Ctrl+P hints.
 * Данные: bridge.machines.list() (машины), bridge.terminalsSummary()
 * (агенты/статусы). Branch — опционально, из worktrees (первый
 * совпавший по space/имени).
 */

import { useEffect, useState } from 'react';
import type { MachineRecord, NewfBridge, TermSummary } from './newf-live';
import styles from './newf-agents-panel.module.css';

export interface StatusBarProps {
  bridge: NewfBridge;
}

export function StatusBar({ bridge }: StatusBarProps) {
  const [machines, setMachines] = useState<MachineRecord[]>([]);
  const [terms, setTerms] = useState<TermSummary[]>([]);
  const [branch, setBranch] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        if (bridge.machines) {
          const m = await bridge.machines.list();
          if (alive) setMachines(m);
        }
        if (bridge.terminalsSummary) {
          const s = await bridge.terminalsSummary();
          if (alive) setTerms(s.terminals);
        }
        if (bridge.worktrees) {
          const w = await bridge.worktrees('D:/<repo>');
          const first = w.find((x) => !x.main);
          if (alive) setBranch(first?.branch?.replace(/^refs\/heads\//, '') ?? null);
        }
      } catch { /* офлайн — честно молчим */ }
    };
    void tick();
    const id = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [bridge]);

  const machinesNames = machines.map((m) => m.name).filter(Boolean).join(' · ') || 'localhost';
  const needsYou = terms.filter((t) => t.state === 'blocked' || t.state === 'error').length;
  const agents = terms.length;

  return (
    <footer className={styles.statusBar} data-testid="status-bar">
      <span className={styles.statusItem} data-testid="status-machine">🖥 {machinesNames}</span>
      {branch && <span className={styles.statusItem} data-testid="status-branch">⎇ {branch}</span>}
      <span className={styles.statusItem} data-testid="status-agents">
        ● {agents} agents
        {needsYou > 0 && <span className={styles.statusNeeds} data-testid="status-needs"> · {needsYou} needs you</span>}
      </span>
      <span className={`${styles.statusItem} ${styles.statusHint}`} data-testid="status-hint">Ctrl+P commands</span>
    </footer>
  );
}

export default StatusBar;
