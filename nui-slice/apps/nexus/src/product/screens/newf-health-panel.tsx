'use client';

/**
 * W27: Health-panel — core/audit/sse статусы в одном view.
 * W34: кнопка «Diag» — открывает правый diagnostics-drawer
 * (CustomEvent nexusus:diag-toggle; сам drawer слушает и клавишу d).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NewfBridge } from './newf-live';
import { DIAG_TOGGLE_EVENT } from './newf-diag-drawer';
import styles from './newf-agents-panel.module.css';

type Health = 'ok' | 'offline' | 'unknown';

export interface HealthPanelProps {
  bridge: NewfBridge;
}

export function HealthPanel({ bridge }: HealthPanelProps) {
  const [core, setCore] = useState<Health>('unknown');
  const [coreDetail, setCoreDetail] = useState<string>('');
  const [audit, setAudit] = useState<Health>('unknown');
  const [auditTotal, setAuditTotal] = useState<number | null>(null);
  const [sse, setSse] = useState<Health>('unknown');
  const [sseDetail, setSseDetail] = useState<string>('');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    // core
    if (bridge.capabilities) {
      try {
        const caps = await bridge.capabilities();
        if (!mounted.current) return;
        setCore('ok');
        setCoreDetail(`v${caps.version ?? '?'} · ${Object.keys(caps.endpoints).length} endpoints`);
      } catch {
        if (mounted.current) { setCore('offline'); setCoreDetail('capabilities unavailable'); }
      }
    } else {
      setCore('unknown');
      setCoreDetail('capabilities отсутствует');
    }
    // audit
    if (bridge.audit) {
      try {
        const res = await bridge.audit({ limit: 1 });
        if (!mounted.current) return;
        setAudit('ok');
        setAuditTotal(res.total);
      } catch {
        if (mounted.current) setAudit('offline');
      }
    } else {
      setAudit('unknown');
    }
    // sse
    if (bridge.streamEvents) {
      let got = false;
      const off = bridge.streamEvents(
        () => { got = true; off(); },
        () => { if (mounted.current && !got) { setSse('offline'); setSseDetail('поток не доступен'); } },
        ['status'],
      );
      setTimeout(() => {
        if (!mounted.current) return;
        if (got) { setSse('ok'); setSseDetail('alive'); }
        else { setSse('unknown'); setSseDetail('no events (5s)'); }
      }, 5000);
      // cleanup после проверки
      setTimeout(off, 6000);
    } else {
      setSse('unknown');
      setSseDetail('streamEvents отсутствует');
    }
  }, [bridge]);

  useEffect(() => { void refresh(); }, [refresh]);

  const cellClass = (h: Health) => h === 'ok' ? styles.healthOk : h === 'offline' ? styles.healthBad : styles.healthUnknown;

  return (
    <section className={styles.group} role="region" aria-label="Health" data-testid="health-panel">
      <h3 className={styles.groupTitle}>
        HEALTH
        <button
          type="button"
          className={styles.filterChip}
          data-testid="health-diag-open"
          title="Диагностика (клавиша d)"
          onClick={() => window.dispatchEvent(new CustomEvent(DIAG_TOGGLE_EVENT))}
        >
          Diag
        </button>
      </h3>
      <div className={styles.healthRow}>
        <span className={`${styles.healthCell} ${cellClass(core)}`} data-testid="health-core" title={coreDetail}>
          core · {core}{coreDetail ? ` · ${coreDetail}` : ''}
        </span>
        <span className={`${styles.healthCell} ${cellClass(audit)}`} data-testid="health-audit">
          audit · {audit}{auditTotal !== null ? ` (${auditTotal})` : ''}
        </span>
        <span className={`${styles.healthCell} ${cellClass(sse)}`} data-testid="health-sse" title={sseDetail}>
          sse · {sse}{sseDetail ? ` · ${sseDetail}` : ''}
        </span>
      </div>
    </section>
  );
}
