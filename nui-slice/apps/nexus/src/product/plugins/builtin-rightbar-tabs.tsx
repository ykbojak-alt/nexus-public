/**
 * Встроенные вкладки правой докинг-панели — плагины в keyed-слоте
 * `rightbar.tabs`. «Сессии» переиспользует панель волны XIV (там свои
 * seam'ы и честные состояния); «Окна» — компактный список окон шины
 * по реальному ds.bus.listSessions (seam отсутствует → unavailable).
 */
'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import type { BusSession } from '../../integrations/ai2/contracts/bus';
import { getDataSource } from '../data-source';
import { runWhileDocumentVisible } from '../visible-interval';
import type { NeuPluginDef } from './plugin-host';
import styles from './right-dock.module.css';

/**
 * Панель «Сессии» — экран волны XIV (19 KB). Вкладку статически тянул
 * `builtin.ts` → `right-dock` → каркас, поэтому экран попадал в shared-бандл
 * каждой страницы (даже `/_not-found`). Паттерн тот же, что у палитры и
 * карточки подтверждений в app-shell: тяжёлое — по требованию.
 */
const AgentSessionsPanelLazy = dynamic(
  () => import('../screens/agent-sessions').then((m) => m.AgentSessionsPanel),
  { ssr: false },
);

function BusWindowsTab() {
  const ds = getDataSource();
  const router = useRouter();
  const [rows, setRows] = useState<BusSession[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (ds.bus == null) return;
    let alive = true;
    const poll = () => {
      ds.bus!.listSessions().then(
        (v) => { if (alive) { setRows(v); setFailed(false); } },
        () => { if (alive) setFailed(true); },
      );
    };
    poll();
    const stopPolling = runWhileDocumentVisible(poll, 15_000);
    return () => { alive = false; stopPolling(); };
  }, [ds]);

  if (ds.bus == null) {
    return <p className={styles.tabNote}>Нет данных — seam окон не подключён у источника.</p>;
  }
  if (failed) {
    return <p className={styles.tabNote}>Нет данных — хост не ответил.</p>;
  }
  if (rows == null) {
    return <p className={styles.tabNote}>Читаю окна…</p>;
  }
  if (rows.length === 0) {
    return <p className={styles.tabNote}>Окон в каталоге нет.</p>;
  }
  return (
    <ul className={styles.winList}>
      {rows.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            className={styles.winRow}
            onClick={() => router.push('/runtime?tab=bus')}
            title={`Окно ${s.window} — открыть «Окна и шина»`}
          >
            <span className={styles.winId} data-state={s.status}>{s.window}</span>
            <span className={styles.winTitle}>{s.title}</span>
            <span className={styles.winStatus}>{s.status}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export const RIGHTBAR_TABS_PLUGIN: NeuPluginDef = {
  manifest: {
    id: 'nexus.rightbar-tabs',
    version: '1.0.0',
    title: 'Вкладки правой панели',
    description: 'Сессии агента и окна шины — докинг-вкладки справа.',
    icon: '◧',
    builtin: true,
    permissions: ['чтение сессий'],
  },
  rows: [
    { rowId: 'sessions', slot: 'rightbar.tabs', key: 'sessions', title: 'Сессии', order: 10 },
    { rowId: 'windows', slot: 'rightbar.tabs', key: 'windows', title: 'Окна шины', order: 20 },
  ],
  activate(ctx) {
    ctx.contribute('sessions', { title: 'Сессии', component: AgentSessionsPanelLazy });
    ctx.contribute('windows', { title: 'Окна шины', component: BusWindowsTab });
  },
};
