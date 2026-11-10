'use client';

/**
 * NUE-1 — вкладка «Nexus Deck» в разделе Runtime.
 *
 * ФИНАЛЬНОЕ РЕШЕНИЕ owner: Deck НЕ встраивается как терминальный грид.
 * Deck = ОТДЕЛЬНОЕ скачиваемое приложение (NUE-каталог, манифест программ
 * id=deck) + мост к нему. Вкладка — честная заготовка:
 *  - заголовок «Nexus Deck»;
 *  - app-карточка из манифеста программ (PROGRAMS_MANIFEST, id=deck):
 *    статус/версия/артефакт — verbatim из манифеста;
 *  - мост-статус: живой createCoreBridge() (/api/core/* + SSE) —
 *    показываем «мост жив/не ответил» без выдуманных терминалов.
 *
 * Честность: никаких mock-данных. Артефакт не выдан → «артефакт ещё не
 * опубликован»; мост не отвечает → «ядро не ответило». Ничего не фабрикуем.
 */

import { useEffect, useMemo, useState } from 'react';
import { EmptyState, GlassPanel, LoadingState, StatusBadge } from '@nexus/ui';
import { createCoreBridge, type NewfBridge } from './newf-live';
import { PROGRAMS_MANIFEST } from '../programs/manifest';
import styles from './screens.module.css';

export interface DeckTabProps {
  /** Инъекция для тестов/демо; по умолчанию createCoreBridge() → same-origin /api/core. */
  bridge?: NewfBridge;
  /** Базовый URL core (если bridge не передан). */
  base?: string;
}

type BridgeState = 'checking' | 'ok' | 'offline';

export function DeckTab({ bridge, base }: DeckTabProps) {
  const core = useMemo(() => bridge ?? createCoreBridge(base), [bridge, base]);
  const deck = useMemo(
    () => PROGRAMS_MANIFEST.programs.find((p) => p.id === 'deck') ?? null,
    [],
  );

  const [bridgeState, setBridgeState] = useState<BridgeState>('checking');

  useEffect(() => {
    let live = true;
    if (core.terminalsSummary == null) {
      setBridgeState('offline');
      return;
    }
    core.terminalsSummary()
      .then(() => { if (live) setBridgeState('ok'); })
      .catch(() => { if (live) setBridgeState('offline'); });
    return () => { live = false; };
  }, [core]);

  return (
    <div className={styles.panelStack} data-state="ready" data-testid="tab-deck">
      <GlassPanel className={styles.panel} data-testid="deck-header">
        <h3 className={styles.panelTitle}>Nexus Deck</h3>
        <p className={styles.panelNote}>
          Deck — отдельное скачиваемое приложение терминального рантайма
          (NUE-каталог), не вкладка веб-клиента. Мост к ядру — существующий
          same-origin createCoreBridge() (/api/core/* через прокси Caddy :4436).
        </p>
      </GlassPanel>

      {deck == null ? (
        <GlassPanel className={styles.panel} data-state="empty">
          <EmptyState
            variant="inline"
            title="Запись deck отсутствует в манифесте программ."
          />
        </GlassPanel>
      ) : (
        <GlassPanel className={styles.panel} data-testid="deck-app-card">
          <div className={styles.panelHead}>
            <h3 className={styles.panelTitle}>{deck.nexusName}</h3>
            <StatusBadge
              status={deck.status === 'downloadable' ? 'complete' : 'info'}
              label={deck.status === 'downloadable' ? 'СКАЧАТЬ' : deck.status.toUpperCase()}
            />
          </div>
          <p className={styles.panelNote}>{deck.desc}</p>
          <div className={styles.rows}>
            <span className={styles.rowText}>
              Версия: {deck.version ?? '—'}
            </span>
            <span className={styles.rowText}>
              {deck.artifactUrl != null
                ? `Артефакт: ${deck.artifactUrl}`
                : 'Артефакт ещё не опубликован (owner) — скачивание недоступно.'}
            </span>
            {deck.sizeBytes != null && (
              <span className={styles.rowText}>
                Размер: {deck.sizeBytes} Б
              </span>
            )}
            {deck.sha256 != null && (
              <span className={styles.rowText}>
                SHA-256: {deck.sha256.slice(0, 16)}…
              </span>
            )}
          </div>
        </GlassPanel>
      )}

      <GlassPanel className={styles.panel} data-state={bridgeState} data-testid="deck-bridge">
        <div className={styles.panelHead}>
          <h3 className={styles.panelTitle}>Мост к ядру (nexus-core)</h3>
          {bridgeState === 'checking' && <LoadingState>Проверяю мост…</LoadingState>}
          {bridgeState === 'ok' && <StatusBadge status="online" label="МОСТ ЖИВ" />}
          {bridgeState === 'offline' && <StatusBadge status="offline" label="ЯДРО НЕ ОТВЕТИЛО" />}
        </div>
        <p className={styles.panelNote}>
          {bridgeState === 'ok'
            ? 'Ядро отвечает — терминалы и панели доступны в приложении Deck.'
            : bridgeState === 'offline'
              ? 'Ядро не ответило — терминалы недоступны. Проверьте запуск nexus-core.'
              : 'Живые терминалы в веб-клиенте не портируется: Deck — отдельное приложение.'}
        </p>
      </GlassPanel>
    </div>
  );
}
