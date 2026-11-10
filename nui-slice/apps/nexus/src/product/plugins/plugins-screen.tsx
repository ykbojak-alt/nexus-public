/**
 * Экран «Плагины» (волна XVI, спека п.2.4): менеджер бандлов оболочки.
 * «Встроенные» — реестр реально загруженных плагинов PluginHost
 * (переключатель бандла и строк пишет локальный патч, как слой
 * cordis.patch.yml; изменение страницы — без перезагрузки).
 * Встроенные и локальные бандлы — локальный реестр оболочки + инвентарь
 * хоста W1 (`ds.neuPlugins` → /v1/neu/plugins); отсутствие seam не маскируем.
 * Страница настроек плагина — ?plugin=<id>: манифест, права, строки,
 * записи конфиг-слотов plugins.bundle.config/plugins.row.config.
 */
'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { EmptyState, ErrorState, GlassPanel, LoadingState, PanelHeader, PluginCard, PluginGroup, PluginStatusBadge, Switch, type PluginStatus } from '@nexus/ui';
import { getDataSource, useDataSource, getDataSourceKind } from '../data-source';
import { useAsyncValue } from '../use-async-value';
import { getPluginHost, usePluginStates, useSlotEntry, type PluginState } from './plugin-host';
import './builtin';
import type { NeuPluginEntry } from '../../integrations/ai2/contracts/neu-plugins';
import { maskSecrets } from '@nexus/ui';
import {
  preparePluginInstallSound,
  setPluginInstallNotificationPreference,
  usePluginInstallNotificationPreferences,
} from './plugin-install-notifications';
import styles from './plugins-screen.module.css';

const KNOWN_STATUSES: readonly string[] = ['active', 'failed', 'overridden', 'restart-required'];

function statusOf(s: string): PluginStatus | null {
  return (KNOWN_STATUSES as readonly string[]).includes(s) ? (s as PluginStatus) : null;
}

function auditText(value: string | null): string | null {
  if (value == null) return null;
  const masked = (maskSecrets({ value }) as { value: unknown }).value;
  return String(masked)
    .replace(/\b([A-Z0-9_.-]*(?:API_KEY|SECRET|TOKEN|PASSWORD|AUTHORIZATION|CREDENTIAL)[A-Z0-9_.-]*)\s*=\s*([^\s,;]+)/gi, '$1=***')
    .replace(/\bBearer\s+\S+/gi, 'Bearer ***');
}

function AuditTime({ ts }: { ts: number | null }) {
  return <time>{ts == null ? 'время неизвестно' : new Date(ts * 1000).toLocaleString('ru-RU')}</time>;
}

function PluginInstallJournal() {
  const ds = useDataSource();
  const sdkAudit = ds.sdkAudit; // #418 (wave #418-2): stable sub-prop for useAsyncValue deps
  const audit = useAsyncValue(
    () => sdkAudit != null ? sdkAudit({ limit: 100 }) : Promise.resolve(null),
    [sdkAudit],
  );
  const rows = audit.value?.entries.filter((entry) =>
    entry.tool === 'plugin_manager.install_bundle'
    || entry.tool === 'plugin_manager.build_scripts_review',
  ) ?? null;

  return (
    <GlassPanel className={styles.installJournal} data-testid="plugin-install-journal" data-state={!ds.sdkAudit ? 'unavailable' : audit.failed ? 'error' : rows == null ? 'loading' : rows.length ? 'ready' : 'empty'}>
      <div className={styles.installJournalHead}>
        <div>
          <h2>Журнал подтверждений установки</h2>
          <p>Решения установки и проверки скриптов — из аудита хоста.</p>
        </div>
        {ds.sdkAudit != null && <button type="button" className={styles.rowsToggle} onClick={audit.retry}>Обновить</button>}
      </div>
      {ds.sdkAudit == null ? (
        <EmptyState variant="inline" title="Журнал недоступен" reason="источник не подключил audit seam" />
      ) : audit.failed ? (
        <ErrorState variant="inline" title="Хост не ответил на запрос журнала." />
      ) : rows == null ? (
        <LoadingState>Читаю журнал…</LoadingState>
      ) : rows.length === 0 ? (
        <EmptyState variant="inline" title="Записей подтверждений установки нет." />
      ) : (
        <ol className={styles.auditList}>
          {rows.map((entry) => (
            <li className={styles.auditRow} key={entry.id}>
              <div className={styles.auditHead}>
                <strong>{entry.tool === 'plugin_manager.install_bundle' ? 'Установка плагина' : 'Проверка скриптов'}</strong>
                <span data-decision={entry.decision}>
                  {entry.decision === 'allow' ? 'Разрешено' : entry.decision === 'deny' ? 'Отклонено' : entry.decision === 'defer' ? 'Отложено' : entry.decision}
                </span>
              </div>
              <div className={styles.auditMeta}>
                <AuditTime ts={entry.ts} />
                <span>Инициатор: {entry.initiator ?? entry.runId ?? 'нет данных'}</span>
                <span>Решил: {entry.actor ?? 'нет данных'}</span>
              </div>
              {entry.source != null && <p>Источник: {auditText(entry.source)}</p>}
              {entry.sha256 != null && <p>SHA-256: {entry.sha256}</p>}
              {entry.reason != null && <p>Причина: {auditText(entry.reason)}</p>}
            </li>
          ))}
        </ol>
      )}
    </GlassPanel>
  );
}

function PluginInstallNotificationSettings() {
  const prefs = usePluginInstallNotificationPreferences();
  return (
    <GlassPanel className={styles.installPrefs} data-testid="plugin-install-notification-settings">
      <h2>Уведомления об установке</h2>
      <div className={styles.prefRow}>
        <span>Бейдж в колокольчике</span>
        <Switch
          checked={prefs.badgeEnabled}
          onCheckedChange={(on) => setPluginInstallNotificationPreference('badgeEnabled', on)}
          aria-label="Бейдж подтверждений установки"
        />
      </div>
      <div className={styles.prefRow}>
        <span>Звук уведомления</span>
        <Switch
          checked={prefs.soundEnabled}
          onCheckedChange={(on) => {
            if (on) preparePluginInstallSound();
            setPluginInstallNotificationPreference('soundEnabled', on);
          }}
          aria-label="Звук подтверждений установки"
        />
      </div>
      <p className={styles.muted}>Сигнал зависит от разрешений браузера. Системное уведомление дополнительно отправляется только при включённых OS-уведомлениях и подключённом desktop host; карточки остаются в колокольчике.</p>
    </GlassPanel>
  );
}

/** Карточка встроенного плагина + строки contributes с переключателями. */
function BuiltinCard({ st }: { st: PluginState }) {
  const host = getPluginHost();
  const [open, setOpen] = useState(false);
  const { def, status, error } = st;
  const enabled = status === 'active';
  return (
    <div role="listitem">
      <PluginCard
        id={def.manifest.id}
        title={def.manifest.title}
        description={def.manifest.description}
        enabled={enabled}
        status={status === 'disabled' ? null : statusOf(status)}
        onToggle={(on) => host.setPluginEnabled(def.manifest.id, on)}
      />
      <div className={styles.rowArea}>
        <button
          type="button"
          className={styles.rowsToggle}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          Строки: {def.rows.length} {open ? '▴' : '▾'}
        </button>
        <Link className={styles.rowsToggle} href={`/plugins?plugin=${encodeURIComponent(def.manifest.id)}`}>
          Настройки ↗
        </Link>
        {open && (
          <ul className={styles.rowList}>
            {def.rows.map((r) => {
              const on = enabled && !host.isRowDisabled(def.manifest.id, r.rowId);
              return (
                <li key={r.rowId} className={styles.rowItem}>
                  <span className={styles.rowTitle}>{r.title}</span>
                  <span className={styles.rowSlot}>{r.slot}{r.key != null ? `:${r.key}` : ''}</span>
                  <Switch
                    checked={on}
                    disabled={!enabled}
                    onCheckedChange={(v) => host.setRowEnabled(def.manifest.id, r.rowId, v)}
                    aria-label={`Строка «${r.title}»: ${on ? 'включена' : 'выключена'}`}
                  />
                </li>
              );
            })}
          </ul>
        )}
        {status === 'failed' && error != null && (
          <p className={styles.diag} role="alert">Сбой активации: {error}</p>
        )}
      </div>
    </div>
  );
}

/** Карточка локального (хостового) бандла — статусы verbatim от W1. */
function LocalCard({ entry, onChanged }: { entry: NeuPluginEntry; onChanged: () => void }) {
  const ds = getDataSource();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const enabled = entry.enabled;

  const toggle = async (on: boolean) => {
    if (ds.neuPlugins == null || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await ds.neuPlugins.setEnabled(entry.id, on);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="listitem">
      <PluginCard
        id={entry.id}
        title={entry.title ?? entry.id}
        description={entry.description}
        enabled={enabled}
        status={statusOf(entry.status)}
        onToggle={ds.neuPlugins != null ? (on) => void toggle(on) : undefined}
      />
      <button
        type="button"
        className={styles.rowsToggle}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Строки: {entry.rows?.length ?? 'нет данных'} {open ? '▴' : '▾'}
      </button>
      <Link className={styles.rowsToggle} href={`/plugins?plugin=${encodeURIComponent(entry.id)}`}>
        Настройки ↗
      </Link>
      {open && entry.rows != null && (
        <ul className={styles.rowList}>
          {entry.rows.map((row) => (
            <HostRow key={row.rowId} entry={entry} row={row} onChanged={onChanged} />
          ))}
        </ul>
      )}
      {entry.errors?.map((error, i) => <p key={i} className={styles.diag}>Диагностика хоста: {error}</p>)}
      {entry.overriddenBy != null && <p className={styles.diag}>Переопределён источником: {entry.overriddenBy}</p>}
      {entry.status === 'skipped' && (
        <p className={styles.diag} role="status" data-state="skipped">
          Хост пропустил загрузку этого плагина.
        </p>
      )}
      {err != null && <p className={styles.diag} role="alert">{err}</p>}
      {busy && <p className={styles.diag}>Пишу патч…</p>}
    </div>
  );
}

function HostRow({
  entry,
  row,
  onChanged,
}: {
  entry: NeuPluginEntry;
  row: NonNullable<NeuPluginEntry['rows']>[number];
  onChanged: () => void;
}) {
  const ds = getDataSource();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = async (enabled: boolean) => {
    if (ds.neuPlugins == null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await ds.neuPlugins.setRowEnabled(entry.id, row.rowId, enabled);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className={styles.rowItem}>
      <span className={styles.rowTitle}>{row.title ?? row.rowId}</span>
      <span className={styles.rowSlot}>{row.slot}</span>
      <Switch
        checked={entry.enabled && row.enabled}
        disabled={!entry.enabled || busy || ds.neuPlugins == null}
        onCheckedChange={(v) => void toggle(v)}
        aria-label={`Строка «${row.title ?? row.rowId}»: ${row.enabled ? 'включена' : 'выключена'}`}
      />
      {error != null && <span className={styles.diag} role="alert">{error}</span>}
    </li>
  );
}

/** Страница настроек плагина — факты манифеста + строки + конфиг-слоты. */
function PluginDetail({
  id,
  local,
  onChanged,
}: {
  id: string;
  local: NeuPluginEntry[] | null;
  onChanged: () => void;
}) {
  const host = getPluginHost();
  const builtin = host.plugin(id);
  const remote = local?.find((p) => p.id === id) ?? null;
  const bundleCfg = useSlotEntry<Record<string, never>>('plugins.bundle.config', id);

  if (builtin == null && remote == null) {
    return (
      <EmptyState
        title="Плагин не найден"
        body={`Идентификатор «${id}» отсутствует и в реестре встроенных, и в инвентаре хоста.`}
      />
    );
  }

  const title = builtin?.def.manifest.title ?? remote!.title;
  return (
    <GlassPanel className={styles.detail} data-testid="plugin-detail">
      <div className={styles.detailHead}>
        <h2>{title}</h2>
        <Link href="/plugins" className={styles.backLink}>← Все плагины</Link>
      </div>
      {builtin != null ? (
        <>
          <dl className={styles.kv}>
            <dt>Идентификатор</dt><dd>{builtin.def.manifest.id}</dd>
            <dt>Версия</dt><dd>{builtin.def.manifest.version}</dd>
            <dt>Описание</dt><dd>{builtin.def.manifest.description || '—'}</dd>
            <dt>Права</dt>
            <dd>{builtin.def.manifest.permissions.length > 0
              ? builtin.def.manifest.permissions.join(', ')
              : 'не запрошены'}</dd>
            <dt>Статус</dt>
            <dd><PluginStatusBadge status={statusOf(builtin.status) ?? 'active'} />{builtin.status === 'disabled' && <span className={styles.muted}> выключен патчем</span>}</dd>
            {builtin.error != null && (<><dt>Диагностика</dt><dd>{builtin.error}</dd></>)}
          </dl>
          <h3 className={styles.rowsHead}>Строки contributes</h3>
          <ul className={styles.rowList}>
            {builtin.def.rows.map((r) => {
              const on = builtin.status === 'active' && !host.isRowDisabled(builtin.def.manifest.id, r.rowId);
              return (
                <li key={r.rowId} className={styles.rowItem}>
                  <span className={styles.rowTitle}>{r.title}</span>
                  <span className={styles.rowSlot}>{r.slot}{r.key != null ? `:${r.key}` : ''}</span>
                  <Switch
                    checked={on}
                    disabled={builtin.status !== 'active'}
                    onCheckedChange={(v) => host.setRowEnabled(builtin.def.manifest.id, r.rowId, v)}
                    aria-label={`Строка «${r.title}»`}
                  />
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <>
          <dl className={styles.kv}>
            <dt>Идентификатор</dt><dd>{remote!.id}</dd>
            <dt>Версия</dt><dd>{remote!.version ?? '—'}</dd>
            <dt>Описание</dt><dd>{remote!.description ?? '—'}</dd>
            <dt>Источник</dt><dd>{remote!.kind}</dd>
            <dt>Права</dt><dd>{remote!.permissions == null ? 'нет данных' : remote!.permissions.length ? remote!.permissions.join(', ') : 'не запрошены'}</dd>
            <dt>Статус</dt><dd>{remote!.status}</dd>
            {remote!.overriddenBy != null && (<><dt>Переопределён</dt><dd>{remote!.overriddenBy}</dd></>)}
            {remote!.errors?.map((error, i) => (<Fragment key={i}><dt>Диагностика</dt><dd>{error}</dd></Fragment>))}
          </dl>
          <h3 className={styles.rowsHead}>Строки contributes</h3>
          {remote!.rows == null ? (
            <p className={styles.muted}>Нет данных о строках у хоста.</p>
          ) : (
            <ul className={styles.rowList}>
              {remote!.rows.map((row) => (
                <HostRow key={row.rowId} entry={remote!} row={row} onChanged={onChanged} />
              ))}
            </ul>
          )}
        </>
      )}
      {bundleCfg != null ? (
        <div className={styles.cfgArea}>Конфигурация бандла — слот plugins.bundle.config.</div>
      ) : (
        <p className={styles.muted}>Собственной страницы настроек у бандла нет (слот plugins.bundle.config пуст).</p>
      )}
    </GlassPanel>
  );
}

export function PluginsScreen() {
  const ds = useDataSource();
  const dsKind = useMemo(getDataSourceKind, []);
  const params = useSearchParams();
  const detailId = params.get('plugin');
  const builtinStates = usePluginStates();
  const neuPlugins = ds.neuPlugins; // #418 (wave #418-2): stable sub-prop for useAsyncValue deps
  const seamAvailable = neuPlugins != null;
  const local = useAsyncValue(
    () => (neuPlugins != null ? neuPlugins.list() : Promise.resolve(null)),
    [neuPlugins],
  );

  const hostRows = local.value?.plugins ?? null;
  const hostBuiltins = hostRows?.filter((p) => p.kind === 'builtin') ?? null;
  const localRows = hostRows?.filter((p) => p.kind === 'local') ?? null;
  const inventoryState = !seamAvailable
    ? 'skipped'
    : local.failed
      ? 'failed'
      : hostRows == null
        ? 'loading'
        : local.value?.recovery === true
          ? 'recovery'
          : hostRows.length === 0
            ? 'idle'
            : 'ready';

  if (detailId != null) {
    return (
      <div className={styles.page} data-screen="plugins">
        <PluginDetail id={detailId} local={localRows} onChanged={local.retry} />
      </div>
    );
  }

  return (
    <div className={styles.page} data-screen="plugins" aria-labelledby="plugins-title" data-testid="plugins-screen">
      <PanelHeader
        level="screen"
        divider={false}
        titleId="plugins-title"
        title="Плагины"
        subtitle="Панели и блоки оболочки собираются из слотов. Встроенные бандлы переключаются локальным патчем профиля; локальные — по маршрутам хоста."
      />
      <div data-testid="plugins-manager">

      {local.value?.recovery === true && (
        <div className={styles.recoveryBanner} role="status" aria-live="polite"
          data-testid="plugin-recovery-state" data-state="recovery">
          <strong>Режим восстановления активен</strong>
          <p>Хост сообщил, что бандлы отключены для восстановления.</p>
        </div>
      )}

      <PluginGroup
        title="Встроенные"
        count={builtinStates.length + (hostBuiltins?.length ?? 0)}
        emptyLabel="Встроенных плагинов не зарегистрировано."
      >
        {builtinStates.map((st) => <BuiltinCard key={st.def.manifest.id} st={st} />)}
        {hostBuiltins?.map((p) => <LocalCard key={`${p.id}:${p.kind}`} entry={p} onChanged={local.retry} />)}
      </PluginGroup>

      <div className={styles.inventoryState} data-testid="plugin-inventory-state" data-state={inventoryState}>
        <PluginGroup
          title="Локальные"
          count={localRows?.length ?? null}
          emptyLabel={
            !seamAvailable
              ? 'Нет данных — источник не подключён к инвентарю плагинов хоста.'
              : undefined
          }
        >
          {seamAvailable ? (
            local.failed ? (
              <div role="listitem"><ErrorState
                title="Хост не ответил"
                body="Инвентарь локальных плагинов не получен."
                action={<button type="button" onClick={local.retry}>Повторить</button>}
              /></div>
            ) : localRows == null ? (
              <div role="listitem"><LoadingState>Читаю инвентарь…</LoadingState></div>
            ) : localRows.length === 0 ? (
              <div role="listitem"><EmptyState variant="inline" title="Локальных плагинов нет — хост вернул пустой инвентарь." /></div>
            ) : (
              localRows.map((p) => <LocalCard key={p.id} entry={p} onChanged={local.retry} />)
            )
          ) : null}
        </PluginGroup>
      </div>

      <PluginInstallNotificationSettings />
      <PluginInstallJournal />

      <GlassPanel className={styles.installNote}>
        <h2>Установка</h2>
        <p className={styles.muted}>
          Установка сторонних бандлов — только из локального пути и только человеком
          (п.2.4/2.6 спеки): маршрут установки объявляет хост W1. Агенты плагины
          не устанавливают. Источник данных: {dsKind === 'live' ? 'live-хост' : 'mock-контур'}.
        </p>
      </GlassPanel>
      </div>
    </div>
  );
}
