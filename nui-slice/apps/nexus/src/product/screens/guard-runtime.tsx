'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, GlassPanel, PanelHeader, StatusBadge } from '@nexus/ui';
import { GuardShield } from '@nexus/patterns';
import { getDataSource, useDataSource } from '../data-source';
import type { FsWriteRequest } from '../../integrations/ai2/contracts/fs';
import styles from './guard-runtime.module.css';

export const GUARD_IDENTITY = {
  id: 'guard',
  name: 'G.U.A.R.D.',
  expansion: 'Guardian Utility for Antivirus Response & Defense',
  role: 'Антивирусный ИИ-агент Runtime',
} as const;

type Tickets =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'unavailable' }
  | { state: 'ready'; value: FsWriteRequest[] };

const fmtTime = (epoch?: number | null) =>
  epoch == null ? '—' : new Date(epoch * 1000).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function GuardRuntimeScreen() {
  const ds = useDataSource();
  // B.5 security-ops слой: реальные fs-тикеты как очередь/инциденты.
  // ds.fs может отсутствовать (mock намеренно без seam) → unavailable.
  const [tickets, setTickets] = useState<Tickets>({ state: 'loading' });
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const fs = ds.fs;
    if (!fs) { setTickets({ state: 'unavailable' }); return; }
    fs.requests().then(
      (value) => setTickets({ state: 'ready', value }),
      () => setTickets({ state: 'error' }),
    );
  }, [ds]);
  useEffect(() => { refresh(); }, [refresh]);

  const decide = async (id: string, decision: 'approve' | 'deny') => {
    const fs = ds.fs;
    if (!fs || busyId) return;
    setBusyId(id);
    try {
      await (decision === 'approve' ? fs.approve(id) : fs.deny(id));
    } catch {
      // seam-сбой — просто перечитаем очередь ниже.
    } finally {
      setBusyId(null);
      refresh();
    }
  };

  const list = tickets.state === 'ready' ? tickets.value : [];
  const pending = list.filter((t) => t.status === 'pending');
  const incidents = list.filter((t) => t.status === 'denied' || t.status === 'expired');

  return (
    <section className={styles.page} data-screen="guard-runtime" tabIndex={0} aria-labelledby="guard-runtime-title">
      <p className={styles.eyebrow}>NEXUS · RUNTIME AGENT</p>
      <PanelHeader
        level="screen"
        divider={false}
        titleId="guard-runtime-title"
        title={GUARD_IDENTITY.name}
        subtitle={GUARD_IDENTITY.expansion}
        actions={<StatusBadge status="online" label="АКТИВЕН В RUNTIME UI" />}
      />

      <div className={styles.grid}>
        <GlassPanel className={styles.statusCard}>
          <GuardShield
            state="unavailable"
            title="G.U.A.R.D. — статус защиты"
            description="Провайдер защиты не подключён — проверки не выполняются."
            width={132}
            height={148}
          />
          <div className={styles.statusCopy}>
            <p className={styles.eyebrow}>СТАТУС АГЕНТА</p>
            <h2 className={styles.panelTitle}>{GUARD_IDENTITY.name}</h2>
            <p className={styles.role}>{GUARD_IDENTITY.role}</p>
            <StatusBadge status="active" label="АКТИВЕН В RUNTIME UI" />
            <p className={styles.body}>Агент зарегистрирован как отдельная роль Runtime; активны только профиль и интерфейс. Проверка файла не запущена.</p>
          </div>
        </GlassPanel>
        <GlassPanel className={styles.statusCard}>
          <div className={styles.plug} aria-hidden="true">
            <svg viewBox="0 0 24 24" role="presentation">
              <path d="M9 3v5M15 3v5M7 8h10v4a5 5 0 0 1-5 5 5 5 0 0 1-5-5V8Zm5 9v4" />
            </svg>
          </div>
          <div className={styles.statusCopy}>
            <p className={styles.eyebrow}>ПОСТАВЩИК ЗАЩИТЫ</p>
            <h2 className={styles.panelTitle}>AVG Antivirus</h2>
            <StatusBadge status="warning" label="АДАПТЕР НЕ ПОДКЛЮЧЁН" />
            <p className={styles.body}>Спецификация интеграции подготовлена (`docs/product/guard-avg-integration-contract.md`). Подключения нет — действие «Подключить» появится вместе с адаптером, не раньше.</p>
          </div>
        </GlassPanel>
      </div>

      <div className={styles.grid}>
        <GlassPanel className={styles.panel}>
          <h2 className={styles.panelTitle}>Граница текущей версии</h2>
          <ul className={styles.list}>
            <li>Агент зарегистрирован как отдельная роль Runtime; визуальная персона и цветовая тема не подменяют роль.</li>
            <li>UI не запускает процессы AVG и не читает файлы без явного выбора пользователя.</li>
            <li>Сканирование и любые действия над обнаруженным файлом появятся только после реализации и проверки AVG-адаптера.</li>
          </ul>
        </GlassPanel>
        <GlassPanel className={styles.panel} data-state="unavailable">
          <h2 className={styles.panelTitle}>События аудита</h2>
          <p className={styles.body}>Событий нет: аудит и журнал проверок появятся после подключения провайдера. До этого времени счётчики и лента не отображаются.</p>
        </GlassPanel>
      </div>

      {/* B.5: security-ops раскладка на реальных fs-тикетах. Очередь =
          pending заявки на запись (approve/deny через ds.fs); инциденты =
          denied/expired. Ошибки tool_call остаются в трейсе прогона —
          глобальной ленты ошибок в контракте нет. */}
      <section aria-label="Операции безопасности">
        <div className={styles.grid}>
          <GlassPanel className={styles.panel} data-testid="guard-queue" data-state={tickets.state}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>Очередь решений</h2>
              {tickets.state === 'ready' && <span className={styles.count}>{pending.length}</span>}
            </div>
            {tickets.state === 'ready' ? (
              pending.length === 0 ? (
                <p className={styles.body}>Нет ожидающих заявок на запись.</p>
              ) : (
                <ul className={styles.tickets}>
                  {pending.map((t) => (
                    <li key={t.id} className={styles.ticketRow} data-testid="guard-ticket">
                      <div className={styles.ticketMeta}>
                        <b>{t.op}</b> <code>{t.root}:{t.path}</code>
                        <small>прогон {t.runId.slice(0, 8)} · {t.size} Б · {fmtTime(t.createdAt)}</small>
                        {t.preview && (
                          <details className={styles.preview}><summary>превью</summary><pre>{t.preview}</pre></details>
                        )}
                      </div>
                      <div className={styles.ticketActions}>
                        <Button type="button" disabled={busyId != null} onClick={() => void decide(t.id, 'approve')}>Одобрить</Button>
                        <Button type="button" disabled={busyId != null} onClick={() => void decide(t.id, 'deny')}>Отклонить</Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )
            ) : tickets.state === 'unavailable' ? (
              <p className={styles.body}>fs-seam не подключён — очередь заявок недоступна.</p>
            ) : tickets.state === 'error' ? (
              <p className={styles.body}>Не удалось прочитать очередь заявок.</p>
            ) : (
              <p className={styles.body}>Читаю очередь…</p>
            )}
          </GlassPanel>
          <GlassPanel className={styles.panel} data-testid="guard-incidents" data-state={tickets.state}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>Инциденты</h2>
              {tickets.state === 'ready' && <span className={styles.count}>{incidents.length}</span>}
            </div>
            {tickets.state === 'ready' ? (
              incidents.length === 0 ? (
                <p className={styles.body}>Инцидентов нет — отклонённых и истёкших заявок не было.</p>
              ) : (
                <ul className={styles.tickets}>
                  {incidents.map((t) => (
                    <li key={t.id} className={styles.ticketRow} data-testid="guard-incident">
                      <div className={styles.ticketMeta}>
                        <StatusBadge status={t.status === 'denied' ? 'error' : 'warning'} label={t.status} />
                        <b>{t.op}</b> <code>{t.root}:{t.path}</code>
                        <small>прогон {t.runId.slice(0, 8)} · решено {fmtTime(t.resolvedAt)}</small>
                      </div>
                    </li>
                  ))}
                </ul>
              )
            ) : tickets.state === 'unavailable' ? (
              <p className={styles.body}>fs-seam не подключён — лента инцидентов недоступна.</p>
            ) : tickets.state === 'error' ? (
              <p className={styles.body}>Не удалось прочитать историю заявок.</p>
            ) : (
              <p className={styles.body}>Читаю инциденты…</p>
            )}
            <p className={styles.note}>Ошибки инструментов остаются в трейсе конкретного прогона — глобальной ленты ошибок в контракте нет.</p>
          </GlassPanel>
        </div>
        <p className={styles.note}>Карта активности не рисуется: точек-источников в контрактах нет — честная легенда без фиктивной геометрии.</p>
      </section>
    </section>
  );
}
