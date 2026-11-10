'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button, EmptyState, ErrorState, GlassPanel, LoadingState, NexusThemeProvider, Sparkline } from '@nexus/ui';
import { PERSONAS, type RunSummary, type SystemMetrics } from '@nexus/mock-data';
import { getDataSource, useDataSource } from '../data-source';
import { greetingOf } from '../greeting';
import { useProfile } from '../profile/profile-store';
import { DEFAULT_OPERATOR_NAME } from '../profile/profile-types';
import { AssistantHero } from './assistant-hero';
import { RuntimeEcho, useRuntimeEcho } from './runtime-echo';
import { SceneLaunchButton } from './scene-launch';
import { ModeSwitch } from './copilot-widgets';
import { isAi2ApiError } from '../../integrations/ai2/api/errors';
import { updateProfile } from '../profile/profile-store';
import { runWhileDocumentVisible } from '../visible-interval';
import asst from './assistant-screen.module.css';
import styles from './home.module.css';

// Статика: dev отдаёт /art/…, AI-2 хост монтирует бандл под /_nexus.
const ASSET_BASE =
  typeof document !== 'undefined' &&
    document.querySelector('script[src*="/_nexus/"], link[href*="/_nexus/"]')
    ? '/_nexus'
    : '';

export type AssistantId = 'arch' | 'mech' | 'codex';

interface AssistantCopy {
  /** Подзаголовок под именем — роль персоны (статичный текст, не данные). */
  brief: string;
  /** Слоган-строки в hero — статичный текст персоны. */
  motto: readonly string[];
  /** Вкладки-навигация экрана — реальные разделы владельца. */
  tabs: readonly { label: string; href: string }[];
  /** Быстрые действия — ссылки на реальные экраны. */
  shortcuts: readonly { icon: string; title: string; text: string; href: string }[];
  /** Стартеры промптов — вставляют текст в композитор без отправки. */
  starters: readonly string[];
}

/** VII V1.3 — рабочие экраны субагентов на общей геометрии домашнего:
 *  та же сетка hero/композитор/действия/рейл, свой data-theme и арт.
 *  Никаких выдуманных цифр — живые только seam'ы (runs, metrics). */
const COPY: Record<AssistantId, AssistantCopy> = {
  arch: {
    brief: 'Архивариус: память, канон, прослеживаемость.',
    motto: ['Помнить источники.', 'Сохранять канон.', 'Находить связи.'],
    tabs: [
      { label: 'Память', href: '/memory' },
      { label: 'Библиотека', href: '/library' },
      { label: 'Агенты', href: '/agents' },
    ],
    shortcuts: [
      { icon: '⌕', title: 'Искать в памяти', text: 'База знаний', href: '/memory' },
      { icon: '▤', title: 'Открыть архив', text: 'Библиотека материалов', href: '/library' },
      { icon: '◉', title: 'Связи агентов', text: 'Кто кому передал задачу', href: '/agents' },
      { icon: '⌁', title: 'Прогоны', text: 'История и результаты', href: '/runtime' },
    ],
    starters: [
      'Найди в памяти всё по текущему проекту и сведи в отчёт',
      'Проследи, откуда взялось это решение, и покажи цепочку источников',
      'Сверь черновик с каноном и выпиши расхождения',
    ],
  },
  mech: {
    brief: 'Исполнитель: процессы, диагностика, каналы.',
    motto: ['Держать процессы.', 'Видеть нагрузку.', 'Чинить честно.'],
    tabs: [
      { label: 'Nexus Deck', href: '/runtime' },
      { label: 'Локальный агент', href: '/local-agent' },
      { label: 'Nexus Link', href: '/mission-control' },
    ],
    shortcuts: [
      { icon: '▶', title: 'Рантайм', text: 'Задачи и прогоны', href: '/runtime' },
      { icon: '⛭', title: 'Локальный агент', text: 'Воркер и операции', href: '/local-agent' },
      { icon: '◈', title: 'Состояние системы', text: 'Миссии и телеметрия', href: '/mission-control' },
      { icon: '▣', title: 'Модели', text: 'Расход и лимиты', href: '/models' },
    ],
    starters: [
      'Собери диагностику по активным прогонам и процессам',
      'Проверь нагрузку хоста и предложи, что можно снять',
      'Найди зависший прогон и опиши, на чём он встал',
    ],
  },
  codex: {
    brief: 'Точечные правки и ревизии существующего кода.',
    motto: ['Читать diff точно.', 'Править минимально.', 'Проверять регрессии.'],
    tabs: [
      { label: 'Модели', href: '/models' },
      { label: 'Память', href: '/memory' },
      { label: 'Рантайм', href: '/runtime' },
    ],
    shortcuts: [
      { icon: '✎', title: 'Запустить ревизию', text: 'Новый прогон', href: '/runtime' },
      { icon: '⌕', title: 'Память решений', text: 'Контекст ревизий', href: '/memory' },
      { icon: '▣', title: 'Модели', text: 'Выбор движка', href: '/models' },
      { icon: '◉', title: 'Агенты', text: 'Спеки и роли', href: '/agents' },
    ],
    starters: [
      'Сделай ревизию последнего изменения и выпиши риски',
      'Найди место, где ломается типизация, и предложи точечный патч',
      'Проверь регрессии по последним прогонам',
    ],
  },
};

type AsyncState<T> = { state: 'loading' } | { state: 'error' } | { state: 'ready'; value: T };

export function AssistantScreen({ id }: { id: AssistantId }) {
  const ds = useDataSource();
  const { profile } = useProfile();
  const copy = COPY[id];
  const persona = PERSONAS.find((p) => p.id === id);
  const theme = persona?.themeId ?? 'nexus';
  const name = persona?.name ?? id.toUpperCase();

  // �����⥭⭮��� �୮���� (W3-159): ����⠭������� �� ����஢����.
  // Lazy-init � sessionStorage, ��� SSR/hydration �� �ࢥ� ⥪�� �ࢥ�� ��⠭�������
  // (controlled input �ࢥ�� ���Reset �� ����஢���� �� hydration-race).
  const [task, setTask] = useState(() => {
    try {
      const draft = (typeof window !== 'undefined') ? sessionStorage.getItem(`nexus.composer.draft.${id}`) : null;
      return (draft != null && draft.trim() !== '') ? draft : '';
    } catch { return ''; }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hour, setHour] = useState<number | null>(null);
  // Эхо рантайма в hero-пузыре: запуск задачи не уводит на /runtime.
  const echo = useRuntimeEcho(ds);
  // Персистентность черновика (W3-159): восстановление при монтировании.
  useEffect(() => {
    try {
      const draft = sessionStorage.getItem(`nexus.composer.draft.${id}`);
      if (draft != null && draft.trim() !== '') setTask(draft);
    } catch { /* приватный режим */ }
  }, [id]);
  // Debounce-save на ввод.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (task.trim() !== '') sessionStorage.setItem(`nexus.composer.draft.${id}`, task);
        else sessionStorage.removeItem(`nexus.composer.draft.${id}`);
      } catch { /* приватный режим */ }
    }, 400);
    return () => clearTimeout(t);
  }, [task, id]);

  useEffect(() => {
    setHour(new Date().getHours());
  }, []);

  // Правый рейл — те же наблюдаемые seam'ы, что на домашнем экране:
  // активный прогон (listRuns) и метрики хоста (getMetrics), poll 30 с.
  const [activeRun, setActiveRun] = useState<AsyncState<RunSummary | null>>({ state: 'loading' });
  const [metrics, setMetrics] = useState<AsyncState<SystemMetrics>>({ state: 'loading' });
  const [cpuTrail, setCpuTrail] = useState<number[]>([]);
  useEffect(() => {
    let alive = true;
    ds.listRuns({ limit: 10 }).then(
      (runs) => {
        if (!alive) return;
        setActiveRun({ state: 'ready', value: runs.find((r) => r.status === 'running') ?? null });
      },
      () => { if (alive) setActiveRun({ state: 'error' }); },
    );
    const poll = () => {
      ds.getMetrics().then(
        (m) => {
          if (!alive) return;
          setMetrics({ state: 'ready', value: m });
          if (m.cpuPct != null) setCpuTrail((t) => [...t.slice(-59), m.cpuPct!]);
        },
        () => { if (alive) setMetrics({ state: 'error' }); },
      );
    };
    poll();
    const stopPolling = runWhileDocumentVisible(poll, 30_000);
    return () => { alive = false; stopPolling(); };
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
      // Не router.push: эхо прогона раскрывается в hero-пузыре на месте,
      // /runtime остаётся явной ссылкой в эхе.
      echo.start(run.runId, run.status);
      try { sessionStorage.removeItem(`nexus.composer.draft.${id}`); } catch { /* приватный режим */ }
      setTask('');
      setBusy(false);
    } catch (err) {
      setError(isAi2ApiError(err) ? `Не удалось запустить задачу: ${err.message}` : 'Не удалось запустить задачу. Проверьте подключение к рантайму и повторите попытку.');
      setBusy(false);
    }
  }, [busy, ds, echo.start, profile?.defaultModelId, profile?.defaultPreset, profile?.memoryProject, profile?.useMemory, task]);

  return (
    // Свой стиль персоны: вложенный data-theme меняет палитру только этого
    // экрана, геометрия (сетка/рейл/панели) — общая с домашним экраном.
    <NexusThemeProvider theme={theme} className={asst.assistantTheme}>
      <div className={styles.home} data-screen={`assistant-${id}`} aria-labelledby={`${id}-title`}>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>{name} · СУБАГЕНТ NEXUS</span>
          </div>
          <nav aria-label={`Разделы ${name}`} className={styles.tabs}>
            {copy.tabs.map((t, i) => (
              <Link key={t.href + t.label} aria-current={i === 0 ? 'page' : undefined} href={t.href}>{t.label}</Link>
            ))}
          </nav>
        </header>

        <div className={styles.layout}>
          <section className={styles.mainColumn}>
            {/* X V3-1: общий AssistantHero — та же рамка/токены, что у ALICE;
                арт не грузится → честный EmptyState «Образ … в подготовке»,
                монограммы-подмены в компоненте нет. */}
            <AssistantHero assistant={id} mode={copy.brief} fullWidth={echo.live != null}>
              <div className={styles.greeting} data-echo={echo.live != null ? 'true' : undefined}>
                <h1 id={`${id}-title`} className={echo.live == null ? undefined : styles.visuallyHidden}>
                  {hour == null ? 'Здравствуйте' : greetingOf(hour)}, {profile?.name || DEFAULT_OPERATOR_NAME}.
                </h1>
                {echo.live == null ? (
                  <div className={styles.motto}>
                    {copy.motto.map((line) => <span key={line}>{line}<br /></span>)}
                  </div>
                ) : (
                  <RuntimeEcho echo={echo} />
                )}
              </div>
            </AssistantHero>

            <GlassPanel className={styles.composerPanel}>
              <form onSubmit={submit} className={styles.composer}>
                <label className={styles.visuallyHidden} htmlFor={`${id}-task`}>Опишите задачу для {name}</label>
                <textarea id={`${id}-task`} value={task} onChange={(e) => setTask(e.target.value)} placeholder={`Задача для ${name}…`} rows={2} />
                <div className={styles.composerFooter}>
                  <div className={asst.assistantModeSwitch} data-testid="assistant-mode-switch">
                    <ModeSwitch
                      value={profile?.composerMode ?? 'agent'}
                      disabled={busy}
                      onChange={(mode) => updateProfile({ composerMode: mode })}
                    />
                  </div>
                  <span>Агент: {name}</span>
                  <Button type="submit" disabled={!task.trim() || busy}>{busy ? 'Запускаю…' : 'Запустить задачу'} <span aria-hidden="true">↗</span></Button>
                </div>
              </form>
              {error && <ErrorState variant="inline" title={error} />}
              <div className={styles.starterChips} role="group" aria-label="Стартеры промптов">
                {copy.starters.map((s) => (
                  <button key={s} type="button" className={styles.starterChip} disabled={busy} title={s} onClick={() => setTask(s)}>{s}</button>
                ))}
              </div>
            </GlassPanel>

            <GlassPanel className={styles.composerPanel}>
              <SceneLaunchButton persona={id} />
            </GlassPanel>

            <section className={styles.shortcutGrid} aria-label="Быстрые действия">
              {copy.shortcuts.map((item) => (
                <Link className={styles.shortcut} href={item.href} key={item.title}>
                  <span className={styles.shortcutIcon} aria-hidden="true">{item.icon}</span>
                  <strong>{item.title}</strong><small>{item.text}</small>
                </Link>
              ))}
            </section>
          </section>

          <aside className={styles.rail} aria-label={`Сводка ${name}`}>
            <GlassPanel className={`${styles.railPanel} ${asst.assistantRailPanel}`} data-state={activeRun.state} data-testid="assistant-rail-panel">
              <h2>Сейчас</h2>
              {activeRun.state === 'ready' && activeRun.value != null ? (
                <>
                  <p className={styles.railStatus}><i /> Прогон идёт</p>
                  <p className={styles.railTask}>{activeRun.value.taskText}</p>
                  <Link href={`/runtime?run=${encodeURIComponent(activeRun.value.runId)}`}>Открыть прогон <span>↗</span></Link>
                </>
              ) : activeRun.state === 'ready' ? (
                <EmptyState variant="inline" title="Активных прогонов нет" />
              ) : activeRun.state === 'error' ? (
                <ErrorState variant="inline" title="Состояние рантайма недоступно" />
              ) : (
                <LoadingState>Читаю состояние…</LoadingState>
              )}
            </GlassPanel>
            <GlassPanel className={`${styles.railPanel} ${asst.assistantRailPanel}`} data-state={metrics.state} data-testid="assistant-rail-panel">
              <h2>Ресурсы</h2>
              {metrics.state === 'ready' ? (
                <>
                  <div className={styles.resource}><span>CPU</span><strong>{metrics.value.cpuPct != null ? `${metrics.value.cpuPct}%` : '—'}</strong></div>
                  <div className={styles.resource}><span>Память</span><strong>{metrics.value.ramPct != null ? `${metrics.value.ramPct}%` : '—'}</strong></div>
                  <div className={styles.resource}><span>Диск</span><strong>{metrics.value.diskPct != null ? `${metrics.value.diskPct}%` : '—'}</strong></div>
                  {cpuTrail.length > 1 ? (
                    <Sparkline className={styles.sparkline} data={cpuTrail} width={120} height={28}
                      domain={[0, 100]}
                      label={`Нагрузка CPU за последние ${cpuTrail.length * 30} секунд`} />
                  ) : (
                    <p className={styles.railNote}>История CPU накапливается — первая точка через 30 с.</p>
                  )}
                </>
              ) : metrics.state === 'error' ? (
                <ErrorState variant="inline" title="Метрики недоступны" />
              ) : (
                <LoadingState>Читаю метрики…</LoadingState>
              )}
            </GlassPanel>
            <GlassPanel className={`${styles.railPanel} ${asst.assistantRailPanel}`} data-testid="assistant-rail-panel">
              <h2>Профиль</h2>
              {persona?.focus != null && persona.focus.length > 0 ? (
                <ul className={styles.activity}>
                  {persona.focus.map((f) => <li key={f}><i />{f}</li>)}
                </ul>
              ) : (
                <EmptyState variant="inline" title="Нет данных" />
              )}
              <p className={styles.railNote}>{persona?.roleNote}</p>
            </GlassPanel>
          </aside>
        </div>
      </div>
    </NexusThemeProvider>
  );
}
