'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState, ErrorState, GlassPanel, PanelHeader, StatusBadge, type NexusStatus } from '@nexus/ui';
import { PanelSkeleton } from '../skeleton-panel';
import styles from './screens.module.css';

/**
 * NUE-3: «Центр управления» переделан под дашборд Nexus Link.
 * Единственный живой источник — публичный статус-эндпоинт шлюза
 * (https://gateway.example.invalid/api/status, CORS *). Данные ai2
 * (миссии/прогоны/агенты) в этот экран не портируются — их разделы
 * остаются на Главной отдельно. Никаких фиктивных значений: при недоступности
 * эндпоинта экран честно показывает «нет данных Nexus Link» + retry.
 */

export const NEXUSLINK_STATUS_URL = 'https://gateway.example.invalid/api/status';
const NEXUSLINK_POLL_MS = 5000;
const FETCH_TIMEOUT_MS = 5000;

type GatewayState = 'loading' | 'online' | 'offline';

interface KeyHealthRow {
  key: string;
  provider: string;
  ready: boolean;
  benched: boolean;
  exhausted: boolean;
  nextReadyInS: number | null;
}

interface SlotHealthRow {
  slot: string;
  model: string;
  ready: number | null;
  benched: number | null;
  blocked: number | null;
  candidates: number | null;
  nextReadyInS: number | null;
  exhausted: boolean;
}

interface MetricRow {
  scope: string;
  ok: number;
  fail: number;
  avgMs: number | null;
  lastMs: number | null;
  ttfbAvg: number | null;
  lastTtfbMs: number | null;
  ageS: number | null;
  note: string;
}

interface BlacklistRow {
  entry: string;
  reason: string;
  ttlS: number;
}

interface NexusLinkSnapshot {
  version: string;
  ok: boolean;
  port: number | null;
  uptimeS: number | null;
  tokenSet: boolean;
  providers: number | null;
  slots: number | null;
  keys: KeyHealthRow[];
  slotRows: SlotHealthRow[];
  metrics: MetricRow[];
  blacklist: BlacklistRow[];
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function count(value: unknown): number {
  return Math.max(0, Math.floor(numeric(value) ?? 0));
}

function string(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Разбор ответа /api/status. ok!==true — отклоняем как недостоверный. */
function parseSnapshot(input: unknown): NexusLinkSnapshot {
  const root = record(input);
  if (!root || root.ok !== true) throw new Error('Ответ /api/status не содержит ok=true.');

  const keys = array(root.keys_health).flatMap((raw): KeyHealthRow[] => {
    const row = record(raw);
    const provider = string(row?.provider).trim();
    if (!row || !provider) return [];
    return [{
      key: string(row.key),
      provider,
      ready: row.ready === true,
      benched: row.benched === true,
      exhausted: row.exhausted === true,
      nextReadyInS: numeric(row.next_ready_in_s),
    }];
  });

  const slotRows = array(root.slots_health ?? root.slot_health).flatMap((raw): SlotHealthRow[] => {
    const row = record(raw);
    if (!row) return [];
    const slot = string(row.slot).trim();
    const model = string(row.model).trim();
    const label = slot || model;
    if (!label) return [];
    return [{
      slot: label,
      model,
      ready: numeric(row.ready),
      benched: numeric(row.benched),
      blocked: numeric(row.blocked),
      candidates: numeric(row.candidates),
      nextReadyInS: numeric(row.next_ready_in_s),
      exhausted: row.exhausted === true,
    }];
  });

  const metrics = array(root.metrics).flatMap((raw): MetricRow[] => {
    const row = record(raw);
    if (!row) return [];
    return [{
      scope: string(row.scope),
      ok: count(row.ok),
      fail: count(row.fail),
      avgMs: numeric(row.avg_ms),
      lastMs: numeric(row.last_ms),
      ttfbAvg: numeric(row.ttfb_avg),
      lastTtfbMs: numeric(row.last_ttfb_ms),
      ageS: numeric(row.age_s),
      note: string(row.note),
    }];
  });

  const blacklist = array(root.blacklist).flatMap((raw): BlacklistRow[] => {
    const row = record(raw);
    if (!row) return [];
    return [{
      entry: string(row.entry),
      reason: string(row.reason),
      ttlS: count(row.ttl_s),
    }];
  });

  return {
    version: string(root.version, '—'),
    ok: root.ok === true,
    port: numeric(root.port),
    uptimeS: numeric(root.uptime_s),
    tokenSet: root.token_set === true,
    providers: numeric(root.providers),
    slots: numeric(root.slots),
    keys,
    slotRows,
    metrics,
    blacklist,
  };
}

function fmtUptime(uptimeS: number): string {
  const d = Math.floor(uptimeS / 86400);
  const h = Math.floor((uptimeS % 86400) / 3600);
  const m = Math.floor((uptimeS % 3600) / 60);
  if (d > 0) return `${d} д ${h} ч`;
  if (h > 0) return `${h} ч ${m} мин`;
  return `${m} мин`;
}

function fmtLatency(ms: number | null): string {
  if (ms == null) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} с` : `${ms} мс`;
}

function fmtElapsed(seconds: number | null): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${Math.floor(seconds)} с назад`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} мин назад`;
  return `${Math.floor(seconds / 3600)} ч назад`;
}

function ageLabel(at: number | null): string {
  if (at == null) return '—';
  return fmtElapsed(Math.max(0, Math.floor((Date.now() - at) / 1000)));
}

function fmtTtl(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)} с`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} мин`;
  return `${Math.floor(seconds / 3600)} ч`;
}

/** Опасная причина из note/blacklist → безопасная классификация. */
function safeReason(reason: string): string {
  const value = reason.toLowerCase();
  if (value.includes('429') || value.includes('rate')) return 'лимит частоты';
  if (value.includes('401') || value.includes('403') || value.includes('auth') || value.includes('key')) return 'ошибка ключа / авторизации';
  if (value.includes('402') || value.includes('quota') || value.includes('billing')) return 'квота / оплата';
  if (value.includes('404')) return 'маршрут модели недоступен';
  if (value.includes('400')) return 'upstream отклонил запрос';
  return reason ? 'сбой upstream' : 'причина недоступна';
}

function blacklistKind(entry: string): string {
  if (entry.startsWith('key|')) return 'ключ временно заблокирован';
  if (entry.startsWith('model|')) return 'маршрут модели временно заблокирован';
  return 'временная блокировка';
}

function scopeParts(scope: string): { provider: string; model: string } {
  const [provider, model] = scope.split('|');
  return {
    provider: provider?.trim() || 'upstream',
    model: model?.trim() || 'телеметрия модели',
  };
}

function slotTone(slot: SlotHealthRow): NexusStatus {
  if (slot.exhausted || (slot.ready === 0 && slot.benched === 0 && (slot.blocked ?? 0) === 0)) return 'error';
  if (slot.ready === 0) return 'waiting';
  return 'complete';
}

function slotSummary(slot: SlotHealthRow): string {
  const parts: string[] = [];
  if (slot.ready !== null) parts.push(`${slot.ready} готово`);
  if (slot.benched !== null) parts.push(`${slot.benched} benched`);
  if (slot.blocked !== null) parts.push(`${slot.blocked} blocked`);
  if (slot.candidates !== null) parts.push(`${slot.candidates} кандидатов`);
  if (slot.nextReadyInS !== null && slot.nextReadyInS > 0) parts.push(`след. через ${fmtTtl(slot.nextReadyInS)}`);
  return parts.join(' · ') || 'детали доступности отсутствуют';
}

function useNexusLinkStatus(pollMs: number) {
  const [state, setState] = useState<GatewayState>('loading');
  const [snapshot, setSnapshot] = useState<NexusLinkSnapshot | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const busyRef = useRef(false);

  useEffect(() => {
    let closed = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;

    const poll = async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(NEXUSLINK_STATUS_URL, {
          method: 'GET',
          mode: 'cors',
          credentials: 'omit',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const next = parseSnapshot(await response.json());
        if (!closed) {
          setSnapshot(next);
          setLastSuccessAt(Date.now());
          setState('online');
          setError(null);
        }
      } catch (cause) {
        if (!closed) {
          setState('offline');
          setError(cause instanceof Error ? cause.message : 'Сетевая ошибка или CORS');
        }
      } finally {
        window.clearTimeout(timeout);
        busyRef.current = false;
        if (!closed) timer = window.setTimeout(() => void poll(), pollMs);
      }
    };

    void poll();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      controller?.abort();
    };
  }, [pollMs, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return { state, snapshot, lastSuccessAt, error, retry };
}

export function MissionControlScreen({ pollMs = NEXUSLINK_POLL_MS }: { pollMs?: number }) {
  const { state, snapshot, lastSuccessAt, error, retry } = useNexusLinkStatus(pollMs);
  const online = state === 'online';
  const offline = state === 'offline';

  const requestCount = snapshot != null
    ? snapshot.metrics.reduce((total, row) => total + row.ok + row.fail, 0)
    : 0;

  const sortedMetrics = useMemo(() => {
    if (snapshot == null) return [];
    return [...snapshot.metrics].sort((a, b) => (b.ok + b.fail) - (a.ok + a.fail));
  }, [snapshot]);

  const providerRows = useMemo(() => {
    if (snapshot == null) return [];
    const grouped = new Map<string, { total: number; ready: number; benched: number; exhausted: number }>();
    for (const key of snapshot.keys) {
      const counts = grouped.get(key.provider) ?? { total: 0, ready: 0, benched: 0, exhausted: 0 };
      counts.total += 1;
      if (key.ready) counts.ready += 1;
      if (key.benched) counts.benched += 1;
      if (key.exhausted) counts.exhausted += 1;
      grouped.set(key.provider, counts);
    }
    return [...grouped.entries()].map(([name, counts]) => ({ name, ...counts }));
  }, [snapshot]);

  return (
    <div className={styles.page} data-screen="nexus-link" aria-labelledby="nexus-link-title">
      <PanelHeader level="screen" divider={false} titleId="nexus-link-title" title="Nexus Link" />

      {state === 'loading' && snapshot == null && (
        <div className={styles.panelStack}>
          <GlassPanel className={styles.panel}>
            <PanelSkeleton hint="Подключение к Nexus Link…" />
          </GlassPanel>
        </div>
      )}

      {offline && snapshot == null && (
        <div className={styles.panelStack}>
          <GlassPanel className={styles.panel}>
            <ErrorState
              variant="panel"
              title="Nexus Link недоступен"
              body="Нет данных Nexus Link — статус-эндпоинт не ответил."
              onRetry={retry}
              retryLabel="Повторить"
            />
            <p className={styles.emptyHint}>
              Эндпоинт: {NEXUSLINK_STATUS_URL} · {error ?? 'запрос не завершился'}
            </p>
          </GlassPanel>
        </div>
      )}

      {snapshot != null && (
        <>
          <p className={styles.pageIntro} data-testid="nx-status-line">
            {online ? (
              <>
                Nexus Link онлайн · v{snapshot.version} · порт {snapshot.port ?? '—'} ·{' '}
                {snapshot.tokenSet ? 'ключи заданы' : 'ключи НЕ заданы'} ·{' '}
                обновлено {ageLabel(lastSuccessAt)}
              </>
            ) : (
              <>
                Nexus Link не отвечает — показан последний успешный снимок · {error ?? ''} ·{' '}
                обновлено {ageLabel(lastSuccessAt)}
              </>
            )}
          </p>

          <div className={styles.kpiRow} aria-label="Сводка Nexus Link">
            <GlassPanel className={styles.kpiCard} data-state={snapshot.ok ? 'ready' : 'error'} data-testid="kpi-ok">
              <span className={styles.kpiLabel}>Статус</span>
              <span className={styles.kpiValue}>
                <StatusBadge status={snapshot.ok ? 'complete' : 'error'} label={snapshot.ok ? 'НОРМА' : 'СБОЙ'} />
              </span>
              <span className={styles.kpiSub}>{online ? 'живой ответ' : 'последний снимок'}</span>
            </GlassPanel>
            <GlassPanel className={styles.kpiCard} data-state="ready" data-testid="kpi-version">
              <span className={styles.kpiLabel}>Версия</span>
              <span className={styles.kpiValue}>{snapshot.version}</span>
              <span className={styles.kpiSub}>шлюз Nexus Link</span>
            </GlassPanel>
            <GlassPanel className={styles.kpiCard} data-state="ready" data-testid="kpi-uptime">
              <span className={styles.kpiLabel}>Аптайм</span>
              <span className={styles.kpiValue}>{snapshot.uptimeS != null ? fmtUptime(snapshot.uptimeS) : '—'}</span>
              <span className={styles.kpiSub}>непрерывной работы</span>
            </GlassPanel>
            <GlassPanel className={styles.kpiCard} data-state="ready" data-testid="kpi-providers">
              <span className={styles.kpiLabel}>Провайдеры</span>
              <span className={styles.kpiValue}>{snapshot.providers ?? '—'}</span>
              <span className={styles.kpiSub}>{snapshot.keys.length} ключей в реестре</span>
            </GlassPanel>
            <GlassPanel className={styles.kpiCard} data-state="ready" data-testid="kpi-slots">
              <span className={styles.kpiLabel}>Слоты</span>
              <span className={styles.kpiValue}>{snapshot.slots ?? '—'}</span>
              <span className={styles.kpiSub}>{requestCount} запросов в выборке метрик</span>
            </GlassPanel>
            <GlassPanel className={styles.kpiCard} data-state={snapshot.tokenSet ? 'ready' : 'warning'} data-testid="kpi-token">
              <span className={styles.kpiLabel}>Ключи</span>
              <span className={styles.kpiValue}>
                <StatusBadge status={snapshot.tokenSet ? 'complete' : 'warning'} label={snapshot.tokenSet ? 'ЗАДАНЫ' : 'НЕ ЗАДАНЫ'} />
              </span>
              <span className={styles.kpiSub}>token_set из статуса</span>
            </GlassPanel>
          </div>

          <h2 className={styles.sectionTitle}>Провайдеры</h2>
          <GlassPanel className={styles.panel} data-testid="providers-panel">
            {providerRows.length === 0 ? (
              <p className={styles.emptyHint}>Детали провайдеров в ответе отсутствуют.</p>
            ) : (
              <div className={styles.rows}>
                {providerRows.map((p) => (
                  <div className={styles.row} key={p.name} data-testid={`provider-${p.name}`}>
                    <span className={styles.rowLabel}>{p.name}</span>
                    <span className={styles.rowMeta}>
                      {p.ready}/{p.total} готово · {p.benched} benched
                      {p.exhausted > 0 ? ` · ${p.exhausted} exhausted` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </GlassPanel>

          <h2 className={styles.sectionTitle}>Ключи</h2>
          <GlassPanel className={styles.panel} data-testid="keys-panel">
            {snapshot.keys.length === 0 ? (
              <p className={styles.emptyHint}>Реестр ключей пуст — статус не выдумывается.</p>
            ) : (
              <div className={styles.rows}>
                {snapshot.keys.map((k) => (
                  <div className={styles.row} key={k.key} data-testid={`key-${k.key}`}>
                    <StatusBadge
                      status={k.exhausted ? 'error' : k.benched ? 'waiting' : k.ready ? 'complete' : 'info'}
                      label={k.exhausted ? 'exhausted' : k.benched ? 'benched' : k.ready ? 'готов' : 'неизвестно'}
                    />
                    <span className={styles.rowLabel}>{k.key}</span>
                    <span className={styles.rowMeta}>
                      {k.provider}
                      {k.nextReadyInS != null && k.nextReadyInS > 0 ? ` · след. через ${fmtTtl(k.nextReadyInS)}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </GlassPanel>

          <h2 className={styles.sectionTitle}>Слоты</h2>
          <GlassPanel className={styles.panel} data-testid="slots-panel">
            {snapshot.slotRows.length === 0 ? (
              <p className={styles.emptyHint}>Детали доступности слотов в ответе отсутствуют.</p>
            ) : (
              <div className={styles.rows}>
                {snapshot.slotRows.map((s) => (
                  <div className={styles.row} key={s.slot} data-state={slotTone(s)} data-testid={`slot-${s.slot}`}>
                    <StatusBadge status={slotTone(s)} label={slotTone(s) === 'complete' ? 'готов' : slotTone(s) === 'waiting' ? 'waiting' : 'blocked'} />
                    <span className={styles.rowLabel}>{s.slot}</span>
                    <span className={styles.rowMeta}>
                      {s.model ? `${s.model} · ` : ''}{slotSummary(s)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </GlassPanel>

          <h2 className={styles.sectionTitle}>Метрики по областям</h2>
          <GlassPanel className={styles.panel} data-testid="metrics-panel">
            {sortedMetrics.length === 0 ? (
              <p className={styles.emptyHint}>Трафика ещё не было — счётчики появятся после первого запроса.</p>
            ) : (
              <div className={styles.rows}>
                {sortedMetrics.map((m, index) => {
                  const { provider, model } = scopeParts(m.scope);
                  return (
                    <div className={styles.row} key={`${m.scope}-${index}`} data-testid={`metric-${index}`}>
                      <span className={styles.rowLabel}>
                        {provider} · {model}
                      </span>
                      <span className={styles.rowMeta}>
                        {m.ok} ok · {m.fail} ошибок · avg {fmtLatency(m.avgMs)} · ttfb {fmtLatency(m.ttfbAvg)} ·{' '}
                        посл. {fmtLatency(m.lastMs)} · {fmtElapsed(m.ageS)}
                      </span>
                      {m.note && <span className={styles.rowText}>⚠ {safeReason(m.note)}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </GlassPanel>

          {snapshot.blacklist.length > 0 && (
            <>
              <h2 className={styles.sectionTitle}>Blacklist</h2>
              <GlassPanel className={styles.panel} data-testid="blacklist-panel">
                <div className={styles.rows}>
                  {snapshot.blacklist.map((b, index) => (
                    <div className={styles.row} key={`${b.entry}-${index}`}>
                      <StatusBadge status="error" label="заблокировано" />
                      <span className={styles.rowLabel}>{blacklistKind(b.entry)}</span>
                      <span className={styles.rowMeta}>
                        {safeReason(b.reason)} · TTL {fmtTtl(b.ttlS)}
                      </span>
                    </div>
                  ))}
                </div>
              </GlassPanel>
            </>
          )}

          <p className={styles.emptyHint}>
            Источник: {NEXUSLINK_STATUS_URL} · только чтение, без учётных данных · обновление каждые {pollMs / 1000} с · текущий снимок {ageLabel(lastSuccessAt)}
          </p>
        </>
      )}
    </div>
  );
}
