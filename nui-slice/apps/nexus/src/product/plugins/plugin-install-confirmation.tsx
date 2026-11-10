'use client';

import { useState } from 'react';
import { ApprovalRequest, Button, GlassPanel, maskSecrets, StatusBadge, type ApprovalState, type NexusStatus } from '@nexus/ui';
import { getDataSource } from '../data-source';
import type { SdkConfirmDecision, SdkConfirmResult } from '../../integrations/ai2/contracts/sdk';
import type { NeuPluginEntry } from '../../integrations/ai2/contracts/neu-plugins';
import {
  updatePluginInstallNotice,
  type PluginInstallNotice,
} from './plugin-install-notifications';
import styles from './plugin-install-confirmation.module.css';

interface ScriptRow {
  name: string;
  command: string;
}

interface ScriptPackage {
  package: string;
  scripts: ScriptRow[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  return value
    .replace(/\b([A-Z0-9_.-]*(?:API_KEY|SECRET|TOKEN|PASSWORD|AUTHORIZATION|CREDENTIAL)[A-Z0-9_.-]*)\s*=\s*([^\s,;]+)/gi, '$1=***')
    .replace(/\bBearer\s+\S+/gi, 'Bearer ***');
}

function asStrings(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map(text).filter((v): v is string => v != null);
}

function scriptPackages(value: unknown): ScriptPackage[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((item) => {
    const pkg = record(item);
    if (pkg == null || !Array.isArray(pkg.scripts)) return [];
    const scripts = pkg.scripts.flatMap((script) => {
      const row = record(script);
      const name = text(row?.name);
      const command = text(row?.command);
      return name == null || command == null ? [] : [{ name, command }];
    });
    return [{ package: text(pkg.package) ?? 'пакет без имени', scripts }];
  });
}

function confirmationData(notice: PluginInstallNotice) {
  const root = record(maskSecrets(notice.confirmation.inputData));
  const inspection = record(root?.inspection);
  const manifest = record(inspection?.manifest);
  const scriptSource = notice.confirmation.tool === 'plugin_manager.build_scripts_review'
    ? root?.packages
    : inspection?.blockedBuildScripts;
  const packages = scriptPackages(scriptSource)
    ?? (notice.confirmation.tool === 'plugin_manager.install_bundle'
      && inspection != null
      && Object.prototype.hasOwnProperty.call(inspection, 'blockedBuildScripts')
      && inspection.blockedBuildScripts == null
      ? []
      : null);
  return {
    root,
    inspection,
    manifest,
    source: text(inspection?.source) ?? text(root?.source_path) ?? text(root?.source),
    title: text(inspection?.name) ?? text(manifest?.title) ?? text(manifest?.id),
    version: text(inspection?.version) ?? text(manifest?.version),
    permissions: asStrings(inspection?.permissions ?? manifest?.permissions),
    packages,
    sha256: text(inspection?.sha256) ?? text(root?.sha256),
    scriptsWillRun: root?.scriptsWillRun === true || inspection?.scriptsWillRun === true,
  };
}

function resolvedState(notice: PluginInstallNotice): {
  state: ApprovalState;
  label?: string;
} {
  if (notice.outcome === 'installed') return { state: 'approved', label: 'Подтверждено' };
  if (notice.outcome === 'error') return { state: 'denied', label: 'Ошибка установки' };
  if (notice.decision === 'deny') {
    const timedOut = notice.message?.toLowerCase().includes('таймаут') === true;
    return { state: timedOut ? 'expired' : 'denied', label: timedOut ? 'Время истекло' : 'Отклонено' };
  }
  if (notice.decision === 'allow') return { state: 'approved', label: 'Подтверждено' };
  return { state: 'pending' };
}

export function isPluginInstallConfirmation(tool: string): boolean {
  return tool === 'plugin_manager.install_bundle' || tool === 'plugin_manager.build_scripts_review';
}

export function PluginInstallConfirmation({
  notice,
  onDecide,
  onEnabled,
}: {
  notice: PluginInstallNotice;
  onDecide?: (decision: SdkConfirmDecision) => Promise<SdkConfirmResult>;
  onEnabled?: (entry: NeuPluginEntry) => void;
}) {
  const ds = getDataSource();
  const [sending, setSending] = useState<SdkConfirmDecision | 'enable' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enabledEntry, setEnabledEntry] = useState<NeuPluginEntry | null>(null);
  const data = confirmationData(notice);
  const final = resolvedState(notice);
  const buildReview = notice.confirmation.tool === 'plugin_manager.build_scripts_review';
  const scriptsNotExecutable = !buildReview || data.scriptsWillRun === false;
  const canDecide = onDecide != null && final.state === 'pending' && sending == null && scriptsNotExecutable;

  const decide = async (decision: SdkConfirmDecision) => {
    if (onDecide == null || sending != null) return;
    setSending(decision);
    setError(null);
    try {
      const result = await onDecide(decision);
      if (decision === 'defer' && result.resolved === false) {
        updatePluginInstallNotice(notice.runId, notice.confirmation.callId, { decision: 'defer' }, 'deferred');
      } else if (decision === 'allow' || decision === 'deny') {
        updatePluginInstallNotice(notice.runId, notice.confirmation.callId, {
          decision,
          message: decision === 'deny' ? 'Отклонено пользователем' : null,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(null);
    }
  };

  const enableNow = async () => {
    if (ds.neuPlugins == null || notice.pluginId == null || sending != null) return;
    setSending('enable');
    setError(null);
    try {
      const entry = await ds.neuPlugins.setEnabled(notice.pluginId, true);
      setEnabledEntry(entry);
      updatePluginInstallNotice(notice.runId, notice.confirmation.callId, { enabledNow: entry.enabled });
      onEnabled?.(entry);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(null);
    }
  };

  const status: { kind: NexusStatus; label: string } | null = notice.outcome === 'installed'
    ? { kind: 'complete', label: enabledEntry?.enabled || notice.enabledNow ? 'Включён' : 'Установлен, выключен' }
    : notice.outcome === 'error'
      ? { kind: 'error', label: 'Ошибка установки' }
      : final.state === 'pending'
        ? notice.confirmation.state === 'deferred'
          ? { kind: 'warning', label: 'Отложено' }
          : { kind: 'waiting', label: 'Ждёт решения' }
        : { kind: final.state === 'expired' ? 'offline' : final.state === 'approved' ? 'complete' : 'error', label: final.label ?? 'Завершено' };

  const detail = (
    <div className={styles.details}>
      <dl className={styles.facts}>
        <dt>Название</dt><dd>{data.title ?? 'нет данных'}</dd>
        <dt>Источник</dt><dd>{data.source ?? 'нет данных'}</dd>
        <dt>Версия</dt><dd>{data.version ?? 'нет данных'}</dd>
        <dt>Права</dt><dd>{data.permissions == null ? 'нет данных' : data.permissions.length ? data.permissions.join(', ') : 'не запрошены'}</dd>
      </dl>
      {data.packages == null ? (
        <p className={styles.muted}>Скрипты сборки: нет данных.</p>
      ) : data.packages.length === 0 ? (
        <p className={styles.muted}>Скрипты сборки не обнаружены.</p>
      ) : (
        <div className={styles.scripts}>
          <strong>Заблокированные скрипты сборки</strong>
          {data.packages.map((pkg, index) => (
            <div className={styles.package} key={`${pkg.package}-${index}`}>
              <span>{pkg.package}</span>
              {pkg.scripts.map((script) => (
                <code key={`${script.name}:${script.command}`}>{script.name}: {script.command}</code>
              ))}
            </div>
          ))}
          <p className={styles.muted}>
            {data.scriptsWillRun === false
              ? 'Скрипты не исполняются хостом. Подтверждение разрешает только продолжить копирование.'
              : 'Нет подтверждения, что скрипты останутся заблокированными; решение отключено.'}
          </p>
        </div>
      )}
      {data.sha256 != null && <p className={styles.hash}>SHA-256 · {data.sha256}</p>}
      {notice.message != null && <p className={styles.message}>{text(notice.message)}</p>}
    </div>
  );

  return (
    <GlassPanel className={styles.card} data-testid="plugin-install-confirmation" data-state={notice.outcome ?? final.state}>
      <div className={styles.heading}>
        <h3>{buildReview ? 'Проверка скриптов сборки' : 'Запрос установки плагина'}</h3>
        {status != null && <StatusBadge status={status.kind} label={status.label} />}
      </div>
      <ApprovalRequest
        title={data.title ?? (buildReview ? 'Локальный плагин' : 'Агент запрашивает установку локального плагина')}
        action={buildReview ? 'Подтверждение заблокированных скриптов' : 'Установка локального плагина'}
        target={data.source ?? undefined}
        detail={detail}
        state={final.state}
        resolvedLabel={final.label}
        approveLabel={sending === 'allow' ? 'Отправляю…' : 'Разрешить'}
        rejectLabel={sending === 'deny' ? 'Отправляю…' : 'Отклонить'}
        approveDisabled={!canDecide}
        rejectDisabled={!canDecide}
        onApprove={() => void decide('allow')}
        onReject={() => void decide('deny')}
      />
      {final.state === 'pending' && (
        <div className={styles.deferRow}>
          <Button
            variant="secondary"
            size="sm"
            disabled={!canDecide || notice.confirmation.state === 'deferred'}
            onClick={() => void decide('defer')}
          >
            {sending === 'defer' ? 'Отправляю…' : notice.confirmation.state === 'deferred' ? 'Отложено' : 'Отложить'}
          </Button>
          {onDecide == null
            ? <span className={styles.muted}>Маршрут подтверждения недоступен — только чтение.</span>
            : !scriptsNotExecutable
              ? <span className={styles.error}>Хост не подтвердил блокировку скриптов; решение недоступно.</span>
              : null}
        </div>
      )}
      {notice.outcome === 'installed' && notice.pluginId != null && !notice.enabledNow && enabledEntry?.enabled !== true && (
        <div className={styles.enableRow}>
          <p>Установка завершена. Плагин оставлен выключенным до отдельного решения.</p>
          <Button
            variant="primary"
            size="sm"
            disabled={ds.neuPlugins == null || sending != null}
            onClick={() => void enableNow()}
          >
            {sending === 'enable' ? 'Включаю…' : 'Включить сейчас'}
          </Button>
          {ds.neuPlugins == null && <span className={styles.muted}>Переключатель хоста недоступен.</span>}
        </div>
      )}
      {error != null && <p className={styles.error} role="alert">Хост не ответил: {text(error)}</p>}
    </GlassPanel>
  );
}
