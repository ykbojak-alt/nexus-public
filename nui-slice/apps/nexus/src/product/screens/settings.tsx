'use client';

import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import Link from 'next/link';
import { EmptyState, ErrorState, GlassPanel, LoadingState, PanelHeader } from '@nexus/ui';
import { SystemOverview } from '@nexus/patterns';
import type { PatternState } from '@nexus/patterns';
import { PERSONAS } from '@nexus/mock-data';
import { useDataSource, getDataSourceKind } from '../data-source';
import { useAsyncValue } from '../use-async-value';
import { createEmptyProfile, UI_LEVELS } from '../profile/profile-types';
import { saveProfile, updateProfile, useProfile } from '../profile/profile-store';
import { Ai2ClientKeySettings } from './settings-ai2-client-key';
import styles from './screens.module.css';

const THEME_IDS = ['nexus', 'alice', 'mech', 'forge', 'codex', 'arch', 'aurum-dark'] as const;
const DENSITIES = [
  { id: 'calm', label: 'Спокойная' },
  { id: 'standard', label: 'Стандартная' },
  { id: 'dense', label: 'Плотная' },
] as const;

/** Keyboard contract for the choice listboxes below — same as the agents
 * roster / oracle journal: arrows move DOM focus between [role="option"]
 * (horizontal rows listen to Left/Right too), Home/End to the edges,
 * Enter/Space stay native button activation. */
function choicesKeyDown(e: ReactKeyboardEvent<HTMLElement>) {
  const fwd = e.key === 'ArrowDown' || e.key === 'ArrowRight';
  const back = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
  if (!fwd && !back && e.key !== 'Home' && e.key !== 'End') return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'));
  if (items.length === 0) return;
  e.preventDefault();
  const cur = items.indexOf(document.activeElement as HTMLElement);
  const next = e.key === 'Home' ? 0
    : e.key === 'End' ? items.length - 1
      : cur < 0 ? (fwd ? 0 : items.length - 1)
        : (cur + (fwd ? 1 : -1) + items.length) % items.length;
  items[next].focus();
}

export function SettingsScreen() {
  const ds = useDataSource();
  const dsKind = useMemo(getDataSourceKind, []);
  const { profile, persisted } = useProfile();
  const metrics = useAsyncValue(() => ds.getMetrics(), [ds]);
  const agentSpecs = useAsyncValue(() => ds.listAgents(), [ds]);
  // OpenCode integration (opencode-integration-spec.md): честный seam.
  // При отсутствии сервиса/URL — seam undefined → honest unavailable,
  // мок не имитирует живой OpenCode.
  const ocInfo = useAsyncValue(() => (ds.opencode ? ds.opencode.info() : Promise.resolve(null)), [ds]);
  const ocSessions = useAsyncValue(() => (ds.opencode ? ds.opencode.listSessions() : Promise.resolve(null)), [ds]);
  const ocModels = useAsyncValue(() => (ds.opencode ? ds.opencode.listModels() : Promise.resolve(null)), [ds]);
  const ocMcp = useAsyncValue(() => (ds.opencode ? ds.opencode.listMcpServers() : Promise.resolve(null)), [ds]);
  const ocCommands = useAsyncValue(() => (ds.opencode ? ds.opencode.listCommands() : Promise.resolve(null)), [ds]);
  // Wave-7: voice catalog + STT status for the Runtime defaults panel —
  // absent seam resolves to null and renders honest unavailable.
  const voiceCatalog = useAsyncValue(
    () => (ds.voice == null ? Promise.resolve(null) : Promise.all([ds.voice.voices(), ds.voice.stt()])),
    [ds],
  );
  const [confirmReset, setConfirmReset] = useState(false);

  const sysState: PatternState =
    metrics.failed ? 'error' : metrics.value == null ? 'loading' : 'ready';
  const listState = (r: { value: unknown[] | null; failed: boolean }): PatternState =>
    r.failed ? 'error' : r.value == null ? 'loading' : r.value.length ? 'ready' : 'empty';

  return (
    <div className={styles.page} data-screen="settings" aria-labelledby="settings-title">
      <PanelHeader level="screen" divider={false} titleId="settings-title" title="Настройки" />
      <div className={styles.twoCol}>
        <GlassPanel className={styles.panel} data-state="ready" data-testid="settings-profile">
          <h2 className={styles.panelTitle}>Профиль</h2>
          <p className={styles.emptyHint}>
            Локальные предпочтения — {persisted ? 'сохраняются в браузере' : 'не сохраняются (хранилище недоступно)'}.
            Сетевых вызовов нет: сервер остаётся источником истины для рантайма.
          </p>
          <div className={styles.prefRow}>
            <label className={styles.prefLabel} htmlFor="profile-name">Имя</label>
            <input
              id="profile-name"
              className={styles.input}
              type="text"
              value={profile?.name ?? ''}
              placeholder="Имя оператора"
              onChange={(e) => updateProfile({ name: e.target.value })}
            />
          </div>
          <div className={styles.prefRow}>
            <span className={styles.prefLabel}>Персона</span>
            <span className={styles.prefChoices} role="listbox" aria-label="Персона" onKeyDown={choicesKeyDown}>
              {PERSONAS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={profile?.agentId === p.id}
                  className={styles.prefChoice}
                  data-selected={profile?.agentId === p.id}
                  onClick={() => updateProfile({ agentId: p.id, themeId: p.id })}
                >
                  {p.name}
                </button>
              ))}
            </span>
          </div>
          <div className={styles.prefRow}>
            <span className={styles.prefLabel}>Тема</span>
            <span className={styles.prefChoices} role="listbox" aria-label="Тема" onKeyDown={choicesKeyDown}>
              {THEME_IDS.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="option"
                  aria-selected={profile?.themeId === t}
                  className={styles.prefChoice}
                  data-selected={profile?.themeId === t}
                  onClick={() => updateProfile({ themeId: t })}
                >
                  {t}
                </button>
              ))}
            </span>
          </div>
          <div className={styles.prefRow}>
            <span className={styles.prefLabel}>Плотность</span>
            <span className={styles.prefChoices} role="listbox" aria-label="Плотность" onKeyDown={choicesKeyDown}>
              {DENSITIES.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  role="option"
                  aria-selected={profile?.density === d.id}
                  className={styles.prefChoice}
                  data-selected={profile?.density === d.id}
                  onClick={() => updateProfile({ density: d.id })}
                >
                  {d.label}
                </button>
              ))}
            </span>
          </div>
          <div className={styles.prefRow}>
            <span className={styles.prefLabel}>Уровень интерфейса</span>
            <span className={styles.prefChoices} role="listbox" aria-label="Уровень интерфейса" onKeyDown={choicesKeyDown}>
              {UI_LEVELS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  role="option"
                  aria-selected={(profile?.uiLevel ?? 'professional') === l.id}
                  className={styles.prefChoice}
                  data-selected={(profile?.uiLevel ?? 'professional') === l.id}
                  onClick={() => updateProfile({ uiLevel: l.id })}
                >
                  {l.label}
                </button>
              ))}
            </span>
          </div>
          <p className={styles.emptyHint}>
            Уровень меняет навигацию и детализацию Runtime — задачи, прогоны и разрешения общие.
            Командный уровень показывает командное пространство только при подключённом backend.
          </p>
          <div className={styles.prefRow}>
            <span className={styles.prefLabel}>OS-уведомления</span>
            <span className={styles.prefChoices}>
              <button
                type="button"
                className={styles.prefChoice}
                data-selected={profile?.osNotifications === true}
                aria-pressed={profile?.osNotifications === true}
                onClick={() => updateProfile({ osNotifications: profile?.osNotifications !== true })}
              >
                {profile?.osNotifications === true ? 'Включены' : 'Выключены'}
              </button>
            </span>
          </div>
          <p className={styles.emptyHint}>Предпочтение применяется, когда хост поддерживает OS-уведомления.</p>
          <div className={styles.prefRow}>
            <span className={styles.prefLabel}>Операторский ключ (RAE)</span>
            <span className={styles.prefChoices}>
              <input
                className={styles.input}
                type="password"
                placeholder="X-Nexus-Op токен"
                value={profile?.raeOpToken ?? ''}
                onChange={(e) => updateProfile({ raeOpToken: e.target.value })}
                aria-describedby="op-token-hint"
              />
            </span>
          </div>
          <p id="op-token-hint" className={styles.emptyHint}>
            Ключ для POST /api/rae/approve|reject через Caddy (заголовок X-Nexus-Op). Хранится локально в localStorage nexus.opToken.
          </p>
          <div className={styles.prefRow}>
            <span className={styles.prefLabel}>Токен TPlayer (ENGINE)</span>
            <span className={styles.prefChoices}>
              <input
                className={styles.input}
                type="password"
                placeholder="X-Nexus-TPlayer токен"
                value={profile?.tplayerToken ?? ''}
                onChange={(e) => updateProfile({ tplayerToken: e.target.value })}
                aria-describedby="tplayer-token-hint"
              />
            </span>
          </div>
          <p id="tplayer-token-hint" className={styles.emptyHint}>
            Ключ для /api/tplayer/* через Caddy (заголовок X-Nexus-TPlayer, прокси к engine :8786). Хранится локально в localStorage nexus.tplayer.token.
          </p>
          <Ai2ClientKeySettings />
          <div className={styles.prefRow}>
            <span className={styles.prefLabel}>Сброс</span>
            <span className={styles.prefChoices}>
              <button
                type="button"
                className={styles.prefChoice}
                onClick={() => {
                  if (!confirmReset) { setConfirmReset(true); return; }
                  setConfirmReset(false);
                  saveProfile(createEmptyProfile());
                }}
              >
                {confirmReset ? 'Подтвердить сброс профиля' : 'Сбросить профиль'}
              </button>
              {confirmReset && (
                <button type="button" className={styles.prefChoice} onClick={() => setConfirmReset(false)}>
                  Отмена
                </button>
              )}
            </span>
          </div>
        </GlassPanel>
        <GlassPanel className={styles.panel} data-state={sysState} data-testid="settings-system">
          {metrics.failed ? (
            <ErrorState variant="inline" title="Метрики не загрузились." onRetry={metrics.retry} retryLabel="Повторить" />
          ) : (
            <SystemOverview metrics={metrics.value} state={sysState} />
          )}
        </GlassPanel>
        <GlassPanel className={styles.panel} data-state={ocInfo.failed ? 'error' : ocInfo.value == null ? (ds.opencode ? 'loading' : 'unavailable') : 'ready'} data-testid="settings-opencode">
          <h2 className={styles.panelTitle}>OpenCode</h2>
          {!ds.opencode ? (
            <EmptyState variant="inline" title="Нет данных" body="источник не подключён к сервису OpenCode — seam отсутствует (URL не задан или сервис недоступен). Данные не имитируются." />
          ) : ocInfo.failed ? (
            <ErrorState variant="inline" title="Сервис OpenCode не ответил." onRetry={ocInfo.retry} retryLabel="Повторить" />
          ) : ocInfo.value == null ? (
            <LoadingState>Читаю статус сервиса…</LoadingState>
          ) : (
            <div className={styles.ocKv}>
              <div className={styles.ocKvRow}><span className={styles.ocKvKey}>Версия</span><span className={styles.ocKvVal}>{ocInfo.value.version}</span></div>
              <div className={styles.ocKvRow}><span className={styles.ocKvKey}>Состояние</span><span className={styles.ocKvVal}>{ocInfo.value.healthy ? 'работает' : 'недоступен'}</span></div>
              <div className={styles.ocKvRow}><span className={styles.ocKvKey}>Сессии</span><span className={styles.ocKvVal}>{ocSessions.value == null ? '—' : ocSessions.value.length}</span></div>
              <div className={styles.ocKvRow}><span className={styles.ocKvKey}>Модели</span><span className={styles.ocKvVal}>{ocModels.value == null ? '—' : ocModels.value.length}</span></div>
              <div className={styles.ocKvRow}><span className={styles.ocKvKey}>MCP-серверы</span><span className={styles.ocKvVal}>{ocMcp.value == null ? '—' : ocMcp.value.length}</span></div>
              <div className={styles.ocKvRow}><span className={styles.ocKvKey}>Команды</span><span className={styles.ocKvVal}>{ocCommands.value == null ? '—' : ocCommands.value.length}</span></div>
            </div>
          )}
          <p className={styles.emptyHint}><Link href="/opencode">Открыть экран OpenCode →</Link></p>
        </GlassPanel>
      </div>
      {/* Wave-7: everything the Runtime chat composer applies lives here —
          the screen itself stays a clean chat surface (Dola-analog). */}
      <GlassPanel className={styles.panel} data-state={listState(agentSpecs)} data-testid="settings-runtime">
        <h2 className={styles.panelTitle}>Runtime</h2>
        <p className={styles.emptyHint}>
          Здесь задаются локальные агент, голос и память по умолчанию для новых прогонов.
        </p>
        <div className={styles.prefRow}>
          <label className={styles.prefLabel} htmlFor="runtime-agent">Агент по умолчанию</label>
          <select
            id="runtime-agent"
            className={styles.select}
            value={profile?.defaultRunAgent ?? ''}
            disabled={agentSpecs.value == null}
            onChange={(e) => updateProfile({ defaultRunAgent: e.target.value || null })}
          >
            <option value="">— авто —</option>
            {(agentSpecs.value ?? []).map((a) => (
              <option key={a.name} value={a.name}>{a.name}</option>
            ))}
          </select>
        </div>
        <div className={styles.prefRow}>
          <label className={styles.prefLabel} htmlFor="runtime-voice">Голос AGENT-A</label>
          <select
            id="runtime-voice"
            className={styles.select}
            value={profile?.voiceSpeakerId ?? ''}
            disabled={voiceCatalog.value == null}
            title={ds.voice == null ? 'Голосовой seam недоступен в этом источнике данных' : undefined}
            onChange={(e) => updateProfile({ voiceSpeakerId: e.target.value || null })}
          >
            <option value="">по умолчанию хоста</option>
            {(voiceCatalog.value?.[0] ?? []).map((v) => (
              <option key={v.id} value={v.id} disabled={!v.available}>
                {v.label}{v.available ? '' : ` — ${v.reason ?? 'недоступен на хосте'}`}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.prefRow}>
          <span className={styles.prefLabel}>Озвучивать ответы</span>
          <span className={styles.prefChoices}>
            <button
              type="button"
              className={styles.prefChoice}
              data-selected={profile?.voiceAutoSpeak === true}
              aria-pressed={profile?.voiceAutoSpeak === true}
              disabled={ds.voice == null}
              onClick={() => updateProfile({ voiceAutoSpeak: profile?.voiceAutoSpeak !== true })}
            >
              {profile?.voiceAutoSpeak === true ? 'Включена' : 'Выключена'}
            </button>
          </span>
        </div>
        {/* M2: project-memory defaults for new runs. The flag stays off
            until the host corpus is seeded (task M1) — a memory_search
            granted against an empty project only confuses the model. */}
        <div className={styles.prefRow}>
          <span className={styles.prefLabel}>Память проекта</span>
          <span className={styles.prefChoices}>
            <button
              type="button"
              className={styles.prefChoice}
              data-selected={profile?.useMemory === true}
              aria-pressed={profile?.useMemory === true}
              onClick={() => updateProfile({ useMemory: profile?.useMemory !== true })}
            >
              {profile?.useMemory === true ? 'Включена' : 'Выключена'}
            </button>
          </span>
        </div>
        {profile?.useMemory === true && (
          <div className={styles.prefRow}>
            <label className={styles.prefLabel} htmlFor="runtime-memory-project">Проект памяти</label>
            <input
              id="runtime-memory-project"
              className={styles.input}
              type="text"
              value={profile?.memoryProject ?? ''}
              placeholder="ai2"
              onChange={(e) => updateProfile({ memoryProject: e.target.value })}
            />
          </div>
        )}
        <p className={styles.emptyHint}>
          {profile?.useMemory === true
            ? dsKind === 'mock'
              ? 'mock: память не используется — флаг записывается в прогон, инструмент не вызывается.'
              : 'Прогон получит инструмент memory_search по документам проекта; при пустом проекте ответы без памяти.'
            : 'Память выключена — прогон не получит memory_search (корпус документов сидится на хосте).'}
        </p>
        <p className={styles.emptyHint}>
          {ds.voice == null
            ? 'Голосовой seam не подключён — ввод и озвучка недоступны в этом источнике.'
            : voiceCatalog.value == null
              ? 'Каталог голосов загружается…'
              : `Распознавание речи: ${voiceCatalog.value[1].supported
                ? `поддержано (${voiceCatalog.value[1].model ?? 'хост'})`
                : voiceCatalog.value[1].reason ?? 'недоступно на хосте'}.`}
        </p>
      </GlassPanel>
    </div>
  );
}
