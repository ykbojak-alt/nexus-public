'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, EmptyState, ErrorState, GlassPanel, LoadingState, PanelHeader } from '@nexus/ui';
import { PERSONAS, type UnrealSceneEvent, type UnrealSceneHostState } from '@nexus/mock-data';
import { getDataSource, getDataSourceMode, sourceModeLabel, useDataSource } from '../data-source';
import { greetingOf } from '../greeting';
import { useProfile, updateProfile } from '../profile/profile-store';
import { DEFAULT_OPERATOR_NAME } from '../profile/profile-types';
import { AssistantHero } from './assistant-hero';
import { SceneLaunchButton } from './scene-launch';
import { ModeSwitch } from './copilot-widgets';
import { isAi2ApiError } from '../../integrations/ai2/api/errors';
import styles from './forge.module.css';
import home from './home.module.css';

// Статика: dev отдаёт /art/…, AI-2 хост монтирует бандл под /_nexus.
const ASSET_BASE =
  typeof document !== 'undefined' &&
    document.querySelector('script[src*="/_nexus/"], link[href*="/_nexus/"]')
    ? '/_nexus'
    : '';

const STUDIO_STARTERS = [
  'Собери сцену по текущему плану и покажи структуру',
  'Проверь состояние сцены и перечисли, что в ней есть',
  'Подготовь сцену FORGE к показу — состав и камеры',
] as const;

const STATUS_LABEL: Record<UnrealSceneHostState['status'], string> = {
  'not-installed': 'UE не установлен',
  disconnected: 'UE не запущен',
  starting: 'UE запускается…',
  connected: 'UE · сцена открыта',
  stale: 'Сцена открыта · данные устарели',
  error: 'Ошибка сцены',
  unknown: 'Статус сцены неизвестен',
};

/**
 * IX V3-1/V3-2 — главный экран ROLE-2 по образцу ALICE (NUE1) и правому
 * окну MAIN: герой с образом, приветствие оператора, композитор задачи с
 * профилем, рабочая область студии. Никаких выдуманных чисел — всё, чего
 * нет в seam'ах, подписано «нет данных».
 */
export function ForgeScreen() {
  const router = useRouter();
  const ds = useDataSource();
  const { profile } = useProfile();
  const persona = PERSONAS.find((p) => p.id === 'forge');
  const name = persona?.name ?? 'ROLE-2';

  const [task, setTask] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [artFailed, setArtFailed] = useState(false);
  const [scene, setScene] = useState<UnrealSceneHostState | null>(null);
  const [sceneDown, setSceneDown] = useState(false);
  const [seamMissing, setSeamMissing] = useState(false);
  const [sceneEvents, setSceneEvents] = useState<UnrealSceneEvent[]>([]);
  const [eventsState, setEventsState] = useState<'loading' | 'ready' | 'error' | 'unavailable'>('loading');
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => { setHour(new Date().getHours()); }, []);

  useEffect(() => {
    const seam = ds.unrealScene;
    if (seam == null) {
      setSeamMissing(true);
      setEventsState('unavailable');
      return;
    }
    let live = true;
    seam.getState()
      .then((s) => { if (live) { setScene(s); setSceneDown(false); } })
      .catch(() => { if (live) setSceneDown(true); });
    const unsub = seam.subscribe?.((s) => { if (live) setScene(s); });
    let offEvents: (() => void) | undefined;
    if (seam.subscribeEvents == null) {
      setEventsState('unavailable');
    } else {
      try {
        offEvents = seam.subscribeEvents((e) => {
          if (live) setSceneEvents((prev) => [e, ...prev].slice(0, 6));
        });
        setEventsState('ready');
      } catch {
        setEventsState('error');
      }
    }
    return () => { live = false; unsub?.(); offEvents?.(); };
  }, [ds]);

  const submit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = task.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setError('');
    try {
      const run = await ds.startRun({
        task: prompt,
        config: profile?.defaultPreset ?? 'baseline',
        model: profile?.defaultModelId ?? null,
        ...(profile?.useMemory === true
          ? { useMemory: true, project: profile?.memoryProject?.trim() || 'ai2' }
          : {}),
      });
      router.push(`/runtime?run=${encodeURIComponent(run.runId)}`);
    } catch (err) {
      setError(isAi2ApiError(err) ? `Не удалось запустить задачу: ${err.message}` : 'Не удалось запустить задачу. Проверьте подключение к рантайму и повторите попытку.');
      setBusy(false);
    }
  }, [busy, ds, profile?.defaultModelId, profile?.defaultPreset, profile?.memoryProject, profile?.useMemory, router, task]);

  const sceneBadge = scene == null || sceneDown ? null : sourceModeLabel(scene.source ?? 'unknown');
  const sceneTitle = sceneDown
    ? 'Мост сцены не ответил'
    : seamMissing
      ? 'Мост сцены недоступен'
      : scene != null
        ? STATUS_LABEL[scene.status]
        : 'Читаю состояние сцены…';
  const sceneAssistant = scene?.activeAssistant != null
    ? PERSONAS.find((p) => p.id === scene.activeAssistant)?.name ?? scene.activeAssistant
    : null;

  return (
    <div className={styles.forge} data-screen="forge" aria-labelledby="forge-title">
      <header className={styles.header}>
        <div>
          <span className={styles.brand}>FORGE</span>
          <span className={styles.project}>Студия создания сред</span>
        </div>
        <nav aria-label="Разделы ROLE-2">
          <Link aria-current="page" href="/forge">Студия</Link>
          <Link href="/runtime">Задачи</Link>
          <Link href="/runtime?tab=scene">Сцена</Link>
        </nav>
        <div className={styles.headerActions}>
          <SceneLaunchButton persona="forge" />
          <Link className={styles.openRuntime} href="/runtime?tab=scene">Состояние сцены ↗</Link>
        </div>
      </header>

      {/* IX/X V3: герой по образцу ALICE — общий AssistantHero, тот же
          контракт рамки/токенов и честный пусто-стейт без монограммы. */}
      <AssistantHero
        assistant="forge"
        mode={persona?.description ?? 'Инженер: архитектура, крупные задачи, оркестрация.'}
      >
        <div className={home.greeting}>
          <h1 id="forge-title">{hour != null ? `${greetingOf(hour)}, ` : null}{profile?.name || DEFAULT_OPERATOR_NAME}.</h1>
          <div className={home.motto}>
            <span>Проектировать миры.<br /></span>
            <span>Собирать сцены.<br /></span>
            <span>Доводить до кадра.<br /></span>
          </div>
        </div>
      </AssistantHero>

      <GlassPanel className={home.composerPanel}>
        <form onSubmit={submit} className={home.composer}>
          <label className={home.visuallyHidden} htmlFor="forge-task">Опишите задачу для {name}</label>
          <textarea id="forge-task" value={task} onChange={(e) => setTask(e.target.value)} placeholder={`Задача для ${name}…`} rows={2} />
          <div className={home.composerFooter}>
            <ModeSwitch
              value={profile?.composerMode ?? 'agent'}
              disabled={busy}
              onChange={(mode) => updateProfile({ composerMode: mode })}
            />
            <span>Агент: {name}</span>
            <Button type="submit" disabled={!task.trim() || busy}>{busy ? 'Запускаю…' : 'Запустить задачу'} <span aria-hidden="true">↗</span></Button>
          </div>
        </form>
        {error && <p className={home.error} role="alert">{error}</p>}
        <div className={home.starterChips} role="group" aria-label="Стартеры промптов">
          {STUDIO_STARTERS.map((s) => (
            <button key={s} type="button" className={home.starterChip} disabled={busy} title={s} onClick={() => setTask(s)}>{s}</button>
          ))}
        </div>
      </GlassPanel>

      <p className={styles.eyebrow}>СТУДИЯ СОЗДАНИЯ СРЕД</p>
      <PanelHeader
        level="section"
        headingLevel={2}
        divider={false}
        titleId="forge-workspace-title"
        title="Рабочая область"
        actions={(
          <span className={styles.demo} data-testid="forge-scene-badge">
            {sceneTitle}{sceneBadge != null ? ` · ${sceneBadge}` : ''}
          </span>
        )}
      />

      <div className={styles.workspace}>
        <section className={styles.viewport} aria-label="Предпросмотр сцены: демонстрационный 2D-эскиз">
          <div className={styles.viewportTools}><button type="button" aria-label="Выбрать объект">↖</button><button type="button" aria-label="Переместить объект">✣</button><button type="button" aria-label="Повернуть камеру">◉</button><span>Эскиз сцены · 2D-предпросмотр</span><button type="button" aria-label="Развернуть предпросмотр">⛶</button></div>
          {!artFailed && (
            <img
              className={styles.sceneArt}
              src={`${ASSET_BASE}/art/forge-city.webp`}
              alt="Небесный город на закате — вьюпорт ROLE-2"
              loading="lazy"
              onError={() => setArtFailed(true)}
            />
          )}
          <svg className={styles.scene} viewBox="0 0 1000 620" role="img" aria-label="Схематичный силуэт футуристического города на закате">
            <defs><linearGradient id="sky" x2="0" y2="1"><stop stopColor="#252a44" /><stop offset=".56" stopColor="#9e7057" /><stop offset="1" stopColor="#d8a267" /></linearGradient><linearGradient id="ground" x2="0" y2="1"><stop stopColor="#423a3b" /><stop offset="1" stopColor="#151a23" /></linearGradient><radialGradient id="sun"><stop stopColor="#ffe6b0" stopOpacity=".9" /><stop offset="1" stopColor="#f2b972" stopOpacity="0" /></radialGradient></defs>
            <rect width="1000" height="620" fill="url(#sky)" /><circle cx="500" cy="270" r="190" fill="url(#sun)" /><path d="M0 455 95 402 150 445 222 350 275 428 360 315 405 430 475 285 515 430 586 342 660 430 735 300 790 425 860 350 925 426 1000 375V620H0Z" fill="#242a36" opacity=".94" /><path d="M0 510 115 462 170 490 245 420 300 488 385 394 435 500 510 376 557 493 630 415 704 502 778 374 835 490 904 430 1000 480V620H0Z" fill="url(#ground)" />
            <g fill="#111923" stroke="#d8ad72" strokeOpacity=".55" strokeWidth="2"><path d="M458 428 478 190 500 140 520 190 544 428Z" /><path d="M350 448 365 260 390 218 413 448Z" /><path d="M590 448 606 235 630 190 650 448Z" /><path d="M270 470 282 325 300 294 318 470Z" /><path d="M690 470 705 320 724 285 743 470Z" /><path d="M165 493 177 376 192 352 208 493Z" /><path d="M805 492 817 370 833 342 850 492Z" /></g>
            <g stroke="#e8bd7d" strokeWidth="2" opacity=".9"><path d="M500 140v-32m0 0 8 14h-16z" /><path d="M390 218v-22m0 0 6 10h-12z" /><path d="M630 190v-25m0 0 7 12h-14z" /></g>
            <path d="M0 545Q250 478 500 540T1000 527" fill="none" stroke="#d3a368" strokeWidth="3" opacity=".7" /><ellipse cx="500" cy="550" rx="145" ry="31" fill="none" stroke="#e2b776" strokeWidth="3" opacity=".7" /><ellipse cx="500" cy="550" rx="75" ry="16" fill="none" stroke="#e2b776" strokeWidth="2" opacity=".5" />
          </svg>
          <div className={styles.sceneFoot}><span><i /> Предпросмотр макета</span><span>2D-эскиз · сохранение недоступно</span></div>
        </section>

        <aside className={styles.inspector} aria-label="Параметры проекта">
          <GlassPanel className={styles.panel} data-testid="forge-environment">
            <div className={styles.panelHead}><h2>Среда</h2></div>
            {/* XIII W3: блок «Среда» эталона закрывается реальным
                UnrealSceneHostState (§моста); Lighting/слайдеров у хоста
                нет — они не выдумываются. */}
            {seamMissing ? (
              <EmptyState variant="inline" title="Нет данных — мост сцены недоступен в этом окружении." />
            ) : sceneDown ? (
              <EmptyState variant="inline" title="Мост сцены не ответил на запрос состояния." />
            ) : scene == null ? (
              <LoadingState>Читаю состояние сцены…</LoadingState>
            ) : (
              <>
                <div className={styles.setting}><span>Статус</span><strong>{STATUS_LABEL[scene.status]}{sceneBadge != null ? ` · ${sceneBadge}` : ''}</strong></div>
                <div className={styles.setting}><span>Карта</span><strong>{scene.activeMap ?? 'не сообщена'}</strong></div>
                <div className={styles.setting}><span>Ассистент сцены</span><strong>{sceneAssistant ?? 'не сообщён'}</strong></div>
                <div className={styles.setting}><span>Протокол моста</span><strong>{scene.protocolVersion != null ? `v${scene.protocolVersion}` : '—'}</strong></div>
                {scene.reason != null && (
                  <div className={styles.setting}><span>Причина</span><strong>{scene.reason}</strong></div>
                )}
                <div className={styles.setting}>
                  <span>Обновлено</span>
                  <strong>{scene.lastUpdated != null ? new Date(scene.lastUpdated * 1000).toLocaleTimeString('ru-RU') : 'не сообщено'}</strong>
                </div>
              </>
            )}
          </GlassPanel>
          <GlassPanel className={styles.panel} data-testid="forge-layers">
            <div className={styles.panelHead}><h2>Слои сцены</h2></div>
            <EmptyState variant="inline" title="Нет данных — контракт моста не предоставляет каталог слоёв активной сцены." />
          </GlassPanel>
          <GlassPanel className={styles.assist}><span className={styles.eyebrow}>ПОМОЩНИК FORGE</span><p>Опишите, что хотите изменить в сцене.</p><Link href="/runtime">Передать задачу агенту ↗</Link></GlassPanel>
        </aside>
      </div>

      <section className={styles.timeline} aria-label="Последовательность событий сцены" data-testid="forge-timeline"
        data-state={eventsState === 'ready' && sceneEvents.length === 0 ? 'empty' : eventsState}>
        <div className={styles.timelineHead}>
          <h2>Последовательность</h2>
          <span>События текущей сессии · живой поток моста</span>
        </div>
        {eventsState === 'loading' ? (
          <LoadingState>Подключаю поток событий сцены…</LoadingState>
        ) : eventsState === 'unavailable' ? (
          <EmptyState variant="inline" title="Нет данных — источник не предоставляет поток unreal-scene.event." />
        ) : eventsState === 'error' ? (
          <ErrorState variant="inline" title="Не удалось подключить поток событий сцены." />
        ) : sceneEvents.length === 0 ? (
          <EmptyState variant="inline" title="Событий пока нет — новых событий этой сессии не поступало." />
        ) : (
          <ul className={styles.layerList} aria-label="События сцены">
            {sceneEvents.map((e, i) => (
              <li key={`${e.ts ?? 'x'}-${i}`}>
                <span className={styles.layerIcon} aria-hidden="true">◈</span>
                <span>
                  {e.type}
                  {e.assistant != null ? ` · ${PERSONAS.find((p) => p.id === e.assistant)?.name ?? e.assistant}` : ''}
                  {e.map != null ? ` · ${e.map}` : ''}
                  <small>{e.ts != null ? new Date(e.ts * 1000).toLocaleTimeString('ru-RU') : 'время не сообщено'}</small>
                </span>
                <i aria-hidden="true" />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
