'use client';

/** Приоритет Yury 16.10 — экран загрузки на старте приложения (`/`).
 *  Полоса прогресса отражает только реальные этапы:
 *    1. профиль оператора — чтение локального хранилища (флаг `loaded`);
 *    2. подключение к хосту AI-2 — живой probe (getCapabilities, иначе
 *       getMetrics); источник 'mock' → честный 'недоступно' (хоста нет);
 *    3. синхронизация данных — warmRuntime прогревает runtime seam'ы;
 *       каждый шаг показывает свой статус;
 *    4. готовность экрана — prefetch целевого маршрута отдан → replace.
 *  Выдуманных процентов нет: бар = доля завершившихся реальных шагов;
 *  пока ни один не settle — неопределённая анимация (ProgressBar без value).
 *  Переход: любой сохранённый профиль → /runtime/alice (AGENT-A —
 *  единственная ассистентка); профиля нет → /welcome. Сохранённые старые
 *  agentId не возвращают выбор ассистента: остальные экраны — субагенты. */
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { PERSONAS } from '@nexus/mock-data';
import { BootEmblem, BootFigure, BootProgress } from '@nexus/motion/boot-components';
import { getDataSource, useDataSource, getDataSourceConfigStatus, getDataSourceKind } from '../data-source';
import { isProfileComplete } from '../profile/profile-types';
import { useProfile } from '../profile/profile-store';
import { warmRuntime, WARM_STEPS, type WarmStatus } from '../runtime-warmup';
import styles from './screens.module.css';

// Статика: dev отдаёт /art/…, AI-2 хост монтирует бандл под /_nexus.
const ASSET_BASE =
  typeof document !== 'undefined' &&
    document.querySelector('script[src*="/_nexus/"], link[href*="/_nexus/"]')
    ? '/_nexus'
    : '';

type Stage = 'loading' | 'ok' | 'failed' | 'skipped';

const STAGE_LABEL: Record<Stage, string> = {
  loading: 'выполняется…',
  ok: 'готово',
  failed: 'нет данных',
  skipped: 'недоступно',
};

const STEP_STATUS_LABEL: Record<WarmStatus, string> = {
  loading: 'загрузка…',
  ok: 'готово',
  failed: 'нет данных',
  skipped: 'недоступно',
};

export function BootScreen() {
  const router = useRouter();
  const { profile, loaded } = useProfile();
  const ds = useDataSource();
  const sourceKind = getDataSourceKind();
  const configStatus = getDataSourceConfigStatus();
  const live = sourceKind === 'live';
  const [host, setHost] = useState<Stage>(live ? 'loading' : 'skipped');
  const [steps, setSteps] = useState<Record<string, WarmStatus> | null>(null);
  const [screenStage, setScreenStage] = useState<Stage>('loading');
  const started = useRef(false);
  const disposed = useRef(false);

  // Устаревший профиль может хранить arch/mech/codex, но они больше не
  // выбираются ассистентами: обычный старт всегда открывает AGENT-A
  const target = loaded && isProfileComplete(profile) ? '/runtime/alice' : '/welcome';

  useEffect(() => {
    // Сброс на каждый запуск эффекта: strict-mode двойной прогон
    // пересоздаёт cleanup, иначе внешний unmount оставил бы warm-
    // продолжение живым и оно утащило бы пользователя на target.
    disposed.current = false;
    if (loaded && !started.current) {
      started.current = true;
      const initial: Record<string, WarmStatus> = {};
      for (const s of WARM_STEPS) initial[s.key] = 'loading';
      setSteps(initial);

      if (live) {
        const probe = ds.getCapabilities != null ? ds.getCapabilities() : ds.getMetrics();
        void probe.then(
          () => { if (!disposed.current) setHost('ok'); },
          () => { if (!disposed.current) setHost('failed'); },
        );
      }

      void warmRuntime(ds, (key, status) => {
        if (disposed.current) return;
        setSteps((s) => (s == null ? s : { ...s, [key]: status }));
      }).then(() => {
        if (disposed.current) return;
        // Готовность экрана — наблюдаемый факт: prefetch цели отдан,
        // дальше replace уводит на целевой маршрут.
        router.prefetch?.(target);
        setScreenStage('ok');
        router.replace(target);
      });
    }
    return () => { disposed.current = true; };
  }, [loaded, ds, live, router, target]);

  const warmDone = steps == null ? 0 : Object.values(steps).filter((s) => s !== 'loading').length;
  const warmFailed = steps == null ? 0 : Object.values(steps).filter((s) => s === 'failed').length;
  const units = WARM_STEPS.length + 2; // профиль + хост + шаги синхронизации
  const done = warmDone + (loaded ? 1 : 0) + (host !== 'loading' ? 1 : 0);
  const pct = done === 0 ? null : Math.round((done / units) * 100);
  const syncStage: Stage = steps == null ? 'loading'
    : warmDone < WARM_STEPS.length ? 'loading'
      : warmFailed === WARM_STEPS.length ? 'failed' : 'ok';

  const stages: { key: string; label: string; state: Stage; note?: string }[] = [
    { key: 'profile', label: 'Профиль оператора', state: loaded ? 'ok' : 'loading' },
    {
      key: 'host', label: 'Подключение к хосту AI-2', state: host,
      note: configStatus === 'misconfigured'
        ? 'для live в web dev задайте NEXT_PUBLIC_AI2_BASE_URL'
        : !live ? 'мок-источник — хоста нет' : undefined,
    },
    {
      key: 'sync', label: 'Синхронизация данных', state: syncStage,
      note: steps != null ? `готово ${warmDone} из ${WARM_STEPS.length}${warmFailed > 0 ? ` · ошибок ${warmFailed}` : ''}` : undefined,
    },
    { key: 'screen', label: 'Готовность экрана', state: screenStage },
  ];

  // При готовом профиле на boot всегда показываем AGENT-A; старый
  // выбранный agentId не должен визуально возвращать persona picker.
  const figurePersona =
    loaded && isProfileComplete(profile)
      ? PERSONAS.find((p) => p.id === 'alice')
      : undefined;

  return (
    <div className={styles.page} data-state="ready" data-screen="boot">
      <BootEmblem>
        <h2 className={styles.heading}>NEXUS</h2>
      </BootEmblem>
      {figurePersona != null && (
        <figure className={styles.bootFigureWrap}>
          <BootFigure
            className={styles.bootFigure}
            src={`${ASSET_BASE}/art/agent-${figurePersona.id}.webp`}
            alt={`Образ ассистента ${figurePersona.name}`}
          />
          <figcaption className={styles.bootPersonaNote} data-testid="boot-persona-note">
            BOOTSTRAP-ONLY
          </figcaption>
        </figure>
      )}
      <p className={styles.disclaimer}>Загрузка среды — показываются только реальные этапы.</p>
      <div className={styles.warmPanel} role="status" aria-live="polite" data-testid="boot-progress">
        <div className={styles.warmHead}>
          <span className={styles.warmTitle}>Подготовка</span>
          <span className={styles.warmPct}>{pct == null ? '' : `${pct}%`}</span>
        </div>
        <BootProgress value={pct ?? undefined} label="Загрузка среды" />
        <ul className={styles.warmSteps}>
          {stages.map((s) => (
            <li key={s.key} className={styles.warmStep} data-state={s.state} data-testid={`boot-stage-${s.key}`}>
              <span className={styles.warmStepDot} aria-hidden="true" />
              <span className={styles.warmStepLabel}>{s.label}</span>
              <span className={styles.warmStepStatus}>
                {STAGE_LABEL[s.state]}{s.note != null ? ` · ${s.note}` : ''}
              </span>
            </li>
          ))}
        </ul>
        {steps != null && (
          <ul className={styles.warmSteps} aria-label="Этапы синхронизации">
            {WARM_STEPS.map((s) => {
              const st = steps[s.key] ?? 'loading';
              return (
                <li key={s.key} className={styles.warmStep} data-state={st}>
                  <span className={styles.warmStepDot} aria-hidden="true" />
                  <span className={styles.warmStepLabel}>{s.label}</span>
                  <span className={styles.warmStepStatus}>{STEP_STATUS_LABEL[st]}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
