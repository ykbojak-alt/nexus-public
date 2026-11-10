'use client';

/** Вкладка «Агенты» Runtime (выделено из runtime.tsx). */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AgentHandoff, AgentPresence } from '@nexus/patterns';
import type { HandoffLink, PresenceEntry } from '@nexus/patterns';
import { getDataSource, useDataSource } from '../../data-source';
import { peekWarm } from '../../runtime-warmup';
import styles from '../screens.module.css';

export function AgentsTab() {
  const router = useRouter();
  const ds = useDataSource();
  // Гидратация (NQ #418): тёплый снапшот применяется в эффекте — первый
  // кадр на сервере и клиенте совпадает (null → loading).
  const [presence, setPresence] = useState<PresenceEntry[] | null>(null);
  const [handoffs, setHandoffs] = useState<HandoffLink[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let live = true;
    const wp = peekWarm<PresenceEntry[]>('presence');
    if (wp != null) setPresence(wp);
    const wh = peekWarm<HandoffLink[]>('handoffs');
    if (wh != null) setHandoffs(wh);
    Promise.all([ds.listPresence(), ds.listHandoffs()])
      .then(([p, h]) => {
        if (!live) return;
        setPresence(p);
        setHandoffs(h);
      })
      .catch(() => live && setLoadError(true));
    return () => { live = false; };
  }, [ds]);

  const state = loadError ? 'error' : presence == null || handoffs == null ? 'loading' : 'ready';

  return (
    <div className={styles.twoCol} data-testid="tab-agents">
      <AgentPresence
        entries={presence ?? []}
        state={state === 'ready' && (presence?.length ?? 0) === 0 ? 'empty' : state}
        title="Присутствие сейчас"
      />
      <div>
        <AgentHandoff links={handoffs ?? []} state={state} title="Передачи" />
        <p className={styles.emptyHint}>
          <button type="button" className={styles.linkBtn} onClick={() => router.push('/agents')}>
            Полная инспекция агентов →
          </button>
        </p>
      </div>
    </div>
  );
}
