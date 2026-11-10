'use client';

import { useMemo, useState } from 'react';
import { EmptyState, ErrorState, GlassPanel, LoadingState, PanelHeader, StatusBadge } from '@nexus/ui';
import {
  AgendaRow, DocsItem, ServiceCard, type ServiceConnectionState,
} from '@nexus/ui';
import type {
  PickedDocument, ServiceIntegration,
} from '@nexus/mock-data';
import { getDataSource, useDataSource, getDataSourceKind } from '../data-source';
import { useAsyncValue } from '../use-async-value';
import styles from './screens.module.css';

const GROUPS: { title: string; match: (id: string) => boolean }[] = [
  { title: 'Google', match: (id) => id.startsWith('google-') || id.startsWith('gmail') },
  { title: 'Яндекс', match: (id) => id.startsWith('yandex-') },
  { title: 'Соцсети и контент', match: (id) => id.startsWith('tiktok-') },
  { title: 'Маркетплейсы', match: (id) => /wildberries|ozon|avito|aliexpress/.test(id) },
  { title: 'Финансы и VPN', match: (id) => id.startsWith('sber') || id.startsWith('hiro') },
];

export function ConnectionsScreen() {
  const ds = useDataSource();
  const kind = useMemo(getDataSourceKind, []);
  const svc = ds.services;

  const catalog = useAsyncValue(
    () => svc == null
      ? Promise.resolve(null)
      : Promise.all([
        svc.list(),
        svc.calendarAgenda?.() ?? Promise.resolve([]),
        svc.pickedDocuments?.() ?? Promise.resolve([]),
      ]).then(([items, agenda, docs]) => ({ items, agenda, docs })),
    [svc],
  );

  const [previewDoc, setPreviewDoc] = useState<PickedDocument | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (id: string, fn: (id: string) => Promise<ServiceIntegration | null>) => {
    setBusy(id);
    try {
      await fn(id);
    } finally {
      // Refetch regardless — after a failed connect the cards must show the
      // real service state, not the optimistic busy frame.
      catalog.retry();
      setBusy(null);
    }
  };

  const items = catalog.value?.items ?? null;
  const agenda = catalog.value?.agenda ?? [];
  const docs = catalog.value?.docs ?? [];

  const cardState = (s: ServiceIntegration): ServiceConnectionState =>
    kind === 'mock' && s.state === 'connected' ? 'mock' : s.state;

  if (svc == null) {
    return (
      <div className={styles.page} data-screen="connections" aria-labelledby="connections-title" data-state="unavailable">
        <PanelHeader level="screen" divider={false} titleId="connections-title" title="Подключения" />
        <GlassPanel className={styles.panel} data-state="empty">
          <StatusBadge status="warning" label="Недоступно" />
          <p className={styles.emptyHint}>
            Каталог интеграций не реализован источником данных.
          </p>
        </GlassPanel>
      </div>
    );
  }

  return (
    <div className={styles.page} data-screen="connections">
      <PanelHeader level="screen" divider={false} titleId="connections-title" title={<>Подключения {kind === 'mock' && <span className={styles.selectSub}>· mock</span>}</>} />
      <p className={styles.disclaimer}>
        Web, API и seller-доступ — разные карточки: состояние одной не означает
        состояние другой. Пароли сервисов в NEXUS не вводятся; OAuth — только в
        системном браузере.
      </p>

      {catalog.failed && (
        <ErrorState variant="inline" title="Каталог не загрузился." onRetry={catalog.retry} retryLabel="Повторить" />
      )}
      {!catalog.failed && items == null && <LoadingState>Загрузка каталога…</LoadingState>}
      {GROUPS.map((g) => {
        const entries = (items ?? []).filter((s) => g.match(s.id));
        if (entries.length === 0) return null;
        return (
          <GlassPanel key={g.title} className={styles.panel}
            data-state={items == null ? 'loading' : 'ready'}
            data-testid={`conn-${g.title}`}>
            <h2 className={styles.panelTitle}>{g.title}</h2>
            {entries.map((s) => (
              <ServiceCard
                key={s.id}
                name={s.name}
                mode={s.mode}
                state={cardState(s)}
                reason={s.reason}
                scopes={s.scopes.length ? s.scopes : undefined}
                summary={s.summary}
                onOpen={s.webUrl ? () => window.open(s.webUrl, '_blank', 'noopener') : undefined}
                onConnect={
                  s.connectable && s.state !== 'connected'
                    ? () => act(s.id, svc.connect)
                    : undefined
                }
                onDisconnect={
                  s.state === 'connected'
                    ? () => act(s.id, svc.disconnect)
                    : undefined
                }
              />
            ))}

            {g.title === 'Google' && agenda.length > 0 && (
              <div data-testid="conn-agenda">
                <p className={styles.selectSub}>Повестка дня · Google Calendar · read-only · mock</p>
                {agenda.map((e) => (
                  <AgendaRow key={e.id} time={e.time} title={e.title}
                    details={e.visibility} source={e.source} />
                ))}
              </div>
            )}
            {g.title === 'Google' && docs.length > 0 && (
              <div data-testid="conn-docs">
                <p className={styles.selectSub}>Выбранные документы · Google Picker · mock</p>
                {docs.map((d) => (
                  <DocsItem key={d.docId} name={d.name} meta={d.meta}
                    onPreview={() => setPreviewDoc(d)}
                  />
                ))}
                <EmptyState
                  variant="inline"
                  title="Запись обратно недоступна"
                  reason="источник не предоставляет операцию сохранения документа"
                />
                {previewDoc != null && (
                  <div className={styles.card} data-testid="doc-preview">
                    <p className={styles.selectSub}>{previewDoc.name}</p>
                    <p>{previewDoc.content}</p>
                  </div>
                )}
              </div>
            )}
          </GlassPanel>
        );
      })}
      {busy != null && <LoadingState>Подключение…</LoadingState>}
    </div>
  );
}
