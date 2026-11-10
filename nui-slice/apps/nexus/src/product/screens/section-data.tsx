'use client';

/** Волна XII — экран-обзор раздела Data (NUE1): живые блоки раздела —
 *  каталог подключений (ds.services) и состояние каналов Telegram /
 *  Instagram. Seam'ы опциональны: отсутствие → «недоступно», ошибка →
 *  verbatim-сообщение, без выдуманных строк. Подэкраны: /connections,
 *  /telegram, /instagram. */
import Link from 'next/link';
import { EmptyState, ErrorState, GlassPanel, LoadingState, PanelHeader, StatusBadge, type NexusStatus } from '@nexus/ui';
import { useDataSource } from '../data-source';
import { useAsyncValue } from '../use-async-value';
import { HonestEmpty } from './honest-empty';
import styles from './screens.module.css';

/** Словарь состояний подключения — verbatim-строки контракта в RU-подписи. */
const CONN_STATE: Record<string, { status: NexusStatus; label: string }> = {
  'connected': { status: 'online', label: 'подключено' },
  'read-only': { status: 'online', label: 'только чтение' },
  'not-connected': { status: 'offline', label: 'не подключено' },
  'opening': { status: 'executing', label: 'открывается' },
  'needs-review': { status: 'warning', label: 'нужна проверка' },
  'needs-permission': { status: 'warning', label: 'нужно разрешение' },
  'write-confirmation-required': { status: 'warning', label: 'ждёт подтверждения' },
  'rate-limited': { status: 'warning', label: 'лимит запросов' },
  'region-unavailable': { status: 'warning', label: 'недоступно в регионе' },
  'revoked': { status: 'error', label: 'отозвано' },
  'error': { status: 'error', label: 'ошибка' },
  'mock': { status: 'info', label: 'mock' },
};

function connBadge(state: string) {
  return CONN_STATE[state] ?? { status: 'offline' as const, label: state };
}

export function DataScreen() {
  const ds = useDataSource(); // #418 (wave #418-2): mount-gated
  const svc = ds.services ?? null;
  const tg = ds.telegram ?? null;
  const ig = ds.instagram ?? null;

  const catalog = useAsyncValue(
    () => (svc == null ? Promise.resolve(null) : svc.list()),
    [svc],
  );
  const tgState = useAsyncValue(
    () => (tg == null ? Promise.resolve(null) : tg.getState()),
    [tg],
  );
  const igWeb = useAsyncValue(
    () => (ig?.web == null ? Promise.resolve(null) : ig.web.getState()),
    [ig],
  );
  const igApi = useAsyncValue(
    () => (ig?.api == null ? Promise.resolve(null) : ig.api.getState()),
    [ig],
  );

  const catalogState = svc == null ? 'unavailable'
    : catalog.failed ? 'error' : catalog.value == null ? 'loading' : 'ready';
  const connected = (catalog.value ?? []).filter((s) => s.state === 'connected' || s.state === 'read-only');

  return (
    <div className={styles.page} data-screen="data" aria-labelledby="data-title">
      <PanelHeader level="screen" divider={false} titleId="data-title" title="Data" />
      <p className={styles.pageIntro}>
        Подключения и каналы данных — реальные состояния из seam'ов.{' '}
        <Link href="/connections">Подключения</Link> · <Link href="/telegram">Telegram</Link> · <Link href="/instagram">Instagram</Link>
      </p>

      <div className={styles.kpiRow} role="group" aria-label="Сводка раздела Data">
        <GlassPanel className={`${styles.panel} ${styles.kpiCard}`} data-state={catalogState} data-testid="data-kpi-connections">
          <span className={styles.kpiLabel}>Подключений</span>
          <span className={styles.kpiValue}>
            {catalog.value != null ? connected.length.toLocaleString('ru-RU') : '—'}
          </span>
          <span className={styles.kpiLabel}>
            {catalog.value != null ? `в каталоге: ${catalog.value.length}` : svc == null ? 'seam отсутствует' : 'нет данных'}
          </span>
        </GlassPanel>
        <GlassPanel className={`${styles.panel} ${styles.kpiCard}`} data-testid="data-kpi-telegram"
          data-state={tg == null ? 'unavailable' : tgState.failed ? 'error' : tgState.value == null ? 'loading' : 'ready'}>
          <span className={styles.kpiLabel}>Telegram</span>
          <span className={styles.kpiValue}>
            {tgState.value != null ? tgState.value.status : '—'}
          </span>
          <span className={styles.kpiLabel}>
            {tg == null ? 'seam отсутствует' : tgState.value != null ? `шаг: ${tgState.value.authStep}` : 'нет данных'}
          </span>
        </GlassPanel>
        <GlassPanel className={`${styles.panel} ${styles.kpiCard}`} data-testid="data-kpi-instagram"
          data-state={ig == null ? 'unavailable' : igWeb.failed || igApi.failed ? 'error' : 'ready'}>
          <span className={styles.kpiLabel}>Instagram</span>
          <span className={styles.kpiValue}>
            {igApi.value != null ? igApi.value.status : igWeb.value != null ? igWeb.value.state : '—'}
          </span>
          <span className={styles.kpiLabel}>
            {ig == null ? 'seam отсутствует' : `web: ${igWeb.value?.state ?? 'нет данных'}`}
          </span>
        </GlassPanel>
      </div>

      <GlassPanel className={styles.panel} data-state={catalogState} data-testid="data-catalog">
        <h3 className={styles.panelTitle}>Каталог подключений</h3>
        {svc == null ? (
          <HonestEmpty label="Нет данных" subtitle="каталог подключений у источника отсутствует" />
        ) : catalog.failed ? (
          <ErrorState variant="inline" title="Каталог не загрузился." onRetry={catalog.retry} retryLabel="Повторить" />
        ) : catalog.value == null ? (
          <LoadingState>Читаю каталог…</LoadingState>
        ) : catalog.value.length === 0 ? (
          <HonestEmpty label="Нет данных" subtitle="Каталог пуст — ни одной интеграции не объявлено." />
        ) : (
          <ul role="list" aria-label="Подключения">
            {catalog.value.map((s) => {
              const b = connBadge(s.state);
              return (
                <li key={s.id} role="listitem" data-testid={`data-conn-${s.id}`}>
                  {s.name} <StatusBadge status={b.status} label={b.label} />
                  {s.reason != null && <span className={styles.emptyHint}> — {s.reason}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </GlassPanel>

      <div className={styles.twoCol}>
        <GlassPanel className={styles.panel} data-testid="data-telegram"
          data-state={tg == null ? 'unavailable' : tgState.failed ? 'error' : tgState.value == null ? 'loading' : 'ready'}>
          <h3 className={styles.panelTitle}>Telegram</h3>
          {tg == null ? (
            <HonestEmpty label="Нет данных" subtitle="адаптер Telegram не подключён" />
          ) : tgState.failed ? (
            <ErrorState variant="inline" title="Состояние не загрузилось." onRetry={tgState.retry} retryLabel="Повторить" />
          ) : tgState.value == null ? (
            <LoadingState>Читаю состояние…</LoadingState>
          ) : (
            <p className={styles.emptyHint}>
              статус: {tgState.value.status} · шаг: {tgState.value.authStep}
              {tgState.value.error != null ? ` · ${tgState.value.error}` : ''}
            </p>
          )}
        </GlassPanel>
        <GlassPanel className={styles.panel} data-testid="data-instagram"
          data-state={ig == null ? 'unavailable' : igWeb.failed || igApi.failed ? 'error' : 'ready'}>
          <h3 className={styles.panelTitle}>Instagram</h3>
          {ig == null ? (
            <HonestEmpty label="Нет данных" subtitle="адаптер Instagram не подключён" />
          ) : igWeb.failed || igApi.failed ? (
            <ErrorState variant="inline" title="Состояние не загрузилось." onRetry={igWeb.failed ? igWeb.retry : igApi.retry} retryLabel="Повторить" />
          ) : (
            <p className={styles.emptyHint}>
              web: {igWeb.value?.state ?? 'нет данных'} · api: {igApi.value?.status ?? 'нет данных'}
              {igApi.value?.account != null ? ` · ${igApi.value.account.handle}` : ''}
              {igApi.value?.error != null ? ` · ${igApi.value.error}` : ''}
            </p>
          )}
        </GlassPanel>
      </div>
    </div>
  );
}
