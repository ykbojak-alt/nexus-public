'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { EmptyState, ErrorState, GlassPanel, LoadingState, PanelHeader, Sparkline } from '@nexus/ui';
import { KnowledgeGraph, MemoryBrowser, MemoryInspector, MemoryTemplate } from '@nexus/patterns';
import type { PatternState } from '@nexus/patterns';
import type { MemoryItem } from '@nexus/mock-data';
import { getDataSource, useDataSource, getDataSourceKind } from '../data-source';
import { useAsyncValue } from '../use-async-value';
import { AliceHero } from './alice-hero';
import styles from './screens.module.css';

// refs3: MEMORY/AGENT-A-эталон — hero + stat-strip + табы + плотная сетка.
const TABS = [
  { id: 'overview', label: 'Обзор' },
  { id: 'archive', label: 'Архив' },
  { id: 'timeline', label: 'Таймлайн' },
] as const;
type MemoryTab = (typeof TABS)[number]['id'];

function parseTab(v: string | null): MemoryTab {
  return (TABS as readonly { id: string }[]).some((t) => t.id === v) ? (v as MemoryTab) : 'overview';
}

/** Честный возраст записи — только из createdAt, без выдуманной точности. */
function ageLabel(createdAt: number, now: number): string {
  const s = Math.max(0, Math.floor((now - createdAt * 1000) / 1000));
  if (s < 60) return 'только что';
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
  return `${Math.floor(s / 86400)} дн назад`;
}

export function MemoryScreen() {
  const ds = useDataSource();
  const sourceKind = useMemo(getDataSourceKind, []);
  const mockSource = sourceKind === 'mock';
  const params = useSearchParams();
  const router = useRouter();
  const tab = parseTab(params.get('tab'));
  const projects = useAsyncValue(() => ds.listProjects?.() ?? Promise.resolve([]), [ds]);
  const [project, setProject] = useState<string | null>(null);
  const items = useAsyncValue(() => ds.listMemory(project ?? undefined), [ds, project]);
  const structure = useAsyncValue(() => ds.getMemoryStructure(), [ds]);
  const graph = useAsyncValue(() => ds.getMemoryGraph(), [ds]);
  // ?q= — переход из командной палитры: экран сразу в режиме поиска.
  const qParam = params.get('q');
  const [query, setQuery] = useState<string | null>(qParam);
  useEffect(() => {
    if (qParam != null) setQuery(qParam);
  }, [qParam]);
  const searching = query != null;
  const hits = useAsyncValue(
    () => (query == null ? Promise.resolve([]) : ds.searchMemory(query, project ?? undefined)),
    [ds, query, project],
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dayFilter, setDayFilter] = useState<string | null>(null);
  // Состояние вкладок сохраняется: панель монтируется при первом открытии
  // и дальше прячется — локальный стейт списка/инспектора не сгорает.
  const [visited, setVisited] = useState<ReadonlySet<MemoryTab>>(() => new Set([tab]));
  useEffect(() => {
    setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab)));
  }, [tab]);

  const state: PatternState =
    items.failed ? 'error' : items.value == null ? 'loading' : 'ready';
  // Temporal layers derived from the items themselves (createdAt → UTC day) —
  // structure.perDay is a server aggregate on a different basis and may not
  // align item-for-item; filtering by real item days stays honest.
  const dayLayers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of items.value ?? []) {
      const day = new Date(m.createdAt * 1000).toISOString().slice(0, 10);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [items.value]);
  const baseList = searching ? hits.value : items.value;
  const baseFailed = searching ? hits.failed : items.failed;
  const list = dayFilter == null ? baseList : baseList?.filter(
    (m) => new Date(m.createdAt * 1000).toISOString().slice(0, 10) === dayFilter,
  );
  const listState: PatternState =
    baseFailed ? 'error' : state !== 'ready' && !searching ? state : list == null ? 'loading' : list.length === 0 ? 'empty' : 'ready';
  const graphState: PatternState = graph.failed ? 'error' : graph.value == null ? 'loading' : 'ready';
  const selected = items.value?.find((m) => m.id === selectedId) ?? null;

  // Entry default: newest item selected — inspector and graph ring start
  // populated; selection stays in sync across list and graph.
  useEffect(() => {
    if (selectedId == null && items.value != null && items.value.length > 0) setSelectedId(items.value[0].id);
  }, [items.value, selectedId]);

  // refs3 INSIGHTS-рейл: только дериваты наблюдаемых данных — свежесть,
  // плотность дня, топ-источник, разрыв покрытия. Ничего не выдумываем.
  const insights = useMemo(() => {
    const list = items.value ?? [];
    const newest = list.reduce<MemoryItem | null>(
      (acc, m) => (acc == null || m.createdAt > acc.createdAt ? m : acc), null);
    const daySeries = [...dayLayers].reverse().map(([, count]) => count);
    const dense = dayLayers.reduce<[string, number] | null>(
      (acc, d) => (acc == null || d[1] > acc[1] ? d : acc), null);
    const topSource = (structure.value?.sources ?? []).reduce<{ name: string; count: number } | null>(
      (acc, s) => (acc == null || s.count > acc.count ? s : acc), null);
    let gapDays = 0;
    if (dayLayers.length > 1) {
      const first = Date.parse(`${dayLayers[dayLayers.length - 1][0]}T00:00:00Z`);
      const last = Date.parse(`${dayLayers[0][0]}T00:00:00Z`);
      gapDays = Math.max(0, Math.round((last - first) / 86400000) + 1 - dayLayers.length);
    }
    return { newest, daySeries, dense, topSource, gapDays };
  }, [items.value, dayLayers, structure.value]);

  const now = Date.now();
  const setTab = (t: MemoryTab) => router.push(`/memory?tab=${t}`);

  const onGraphSelect = (id: string) => {
    const m = /^m-(\d+)$/.exec(id);
    if (m) setSelectedId(Number(m[1]));
  };

  const openInArchive = (id: number) => {
    setSelectedId(id);
    setDayFilter(null);
    setQuery(null);
    setTab('archive');
  };

  const pane = (t: MemoryTab, node: ReactNode) => (
    <div
      key={t}
      role="tabpanel"
      id={`memory-panel-${t}`}
      aria-labelledby={`memory-tab-${t}`}
      tabIndex={0}
      hidden={tab !== t}
    >
      {node}
    </div>
  );

  return (
    <div className={styles.page} data-screen="memory" aria-labelledby="memory-title">
      <AliceHero
        mode="ПАМЯТЬ · КОНТЕКСТ · НЕПРЕРЫВНОСТЬ"
        chips={TABS.map((t) => ({ id: t.id, label: t.label }))}
        onChip={(chip) => setTab(chip.id as MemoryTab)}
      >
        <PanelHeader level="screen" divider={false} titleId="memory-title" title="Память" />
        <p className={styles.pageIntro}>
          Непрерывность контекста: записи, слои и связи проекта — по факту источника.
        </p>
      </AliceHero>
      {projects.failed && (
        <ErrorState variant="inline" title="Проекты не загрузились." onRetry={projects.retry} retryLabel="Повторить" />
      )}
      {(projects.value?.length ?? 0) > 0 && (
        <div className={styles.prefRow}>
          <span className={styles.prefLabel}>Проект <span className={styles.selectSub}>(из выборки)</span></span>
          <span className={styles.prefChoices}>
            <button
              type="button"
              className={styles.prefChoice}
              data-selected={project == null}
              onClick={() => setProject(null)}
            >
              все
            </button>
            {projects.value!.map((p) => (
              <button
                key={p}
                type="button"
                className={styles.prefChoice}
                data-selected={project === p}
                onClick={() => setProject(p)}
              >
                {p}
              </button>
            ))}
          </span>
        </div>
      )}
      {notice && <p className={styles.emptyHint} role="status">{notice}</p>}

      <div className={styles.kpiRow} data-testid="memory-kpi" role="group" aria-label="Сводка памяти">
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Записей</span>
          <span className={styles.kpiValue}>{items.value?.length ?? '—'}</span>
          <span className={styles.kpiSub}>{project ? `в проекте ${project}` : 'в выборке'}</span>
          <Sparkline className={styles.kpiSpark} data={insights.daySeries} width={120} height={24}
            label={`Записей по дням — ${insights.daySeries.length} точек`} />
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Источников</span>
          <span className={styles.kpiValue}>{structure.value?.sources.length ?? '—'}</span>
          <span className={styles.kpiSub}>
            {insights.topSource ? `основной: ${insights.topSource.name} · ${insights.topSource.count}` : 'нет данных'}
          </span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Граф</span>
          <span className={styles.kpiValue}>{graph.value?.nodes.length ?? '—'}</span>
          <span className={styles.kpiSub}>
            {graph.value ? `узлов · связей ${graph.value.edges.length}` : 'нет данных'}
          </span>
        </div>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Свежесть</span>
          <span className={styles.kpiValue}>
            {insights.newest ? ageLabel(insights.newest.createdAt, now) : '—'}
          </span>
          <span className={styles.kpiSub}>последняя запись</span>
        </div>
      </div>

      <div
        className={styles.tabBar}
        role="tablist"
        aria-label="Память"
        onKeyDown={(e) => {
          const idx = TABS.findIndex((t) => t.id === tab);
          const next =
            e.key === 'ArrowRight' ? (idx + 1) % TABS.length
              : e.key === 'ArrowLeft' ? (idx - 1 + TABS.length) % TABS.length
                : e.key === 'Home' ? 0
                  : e.key === 'End' ? TABS.length - 1
                    : -1;
          if (next >= 0) {
            e.preventDefault();
            setTab(TABS[next].id);
          }
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`memory-tab-${t.id}`}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`memory-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={styles.tab}
            data-active={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {visited.has('overview') && pane('overview', (
        <div className={styles.memoryOverview}>
          <GlassPanel className={styles.panel} data-state={graphState} data-testid="memory-graph-panel">
            <h2 className={styles.panelTitle}>Семантический граф</h2>
            {graph.failed ? (
              <ErrorState variant="inline" title="Граф не загрузился." onRetry={graph.retry} retryLabel="Повторить" />
            ) : graph.value == null ? (
              <LoadingState>Загрузка графа…</LoadingState>
            ) : (
              <>
                <KnowledgeGraph
                  data={{ ...graph.value, state: 'ready', freshness: 'live' }}
                  title="Структура памяти"
                  description="Проект → источники/дни → записи"
                  width={640}
                  height={300}
                  selectedId={selectedId != null ? `m-${selectedId}` : undefined}
                  onSelectNode={onGraphSelect}
                />
                <p className={styles.graphFoot}>Структура построена по выборке источника.</p>
              </>
            )}
          </GlassPanel>
          <div className={styles.stack}>
            <GlassPanel className={styles.panel} data-state={state} data-testid="memory-insights">
              <h2 className={styles.panelTitle}>Сигналы памяти</h2>
              {items.failed ? (
                <ErrorState variant="inline" title="Записи не загрузились." onRetry={items.retry} retryLabel="Повторить" />
              ) : items.value == null ? (
                <LoadingState>Загрузка записей…</LoadingState>
              ) : items.value.length === 0 ? (
                <EmptyState variant="inline" title="Записей нет" body="сигналы не вычисляются." />
              ) : (
                <ul className={styles.insightList}>
                  {insights.newest && (
                    <li className={styles.insight}>
                      <span className={styles.insightTitle}>Свежая запись · {ageLabel(insights.newest.createdAt, now)}</span>
                      <span className={styles.insightSub}>{insights.newest.text}</span>
                    </li>
                  )}
                  {insights.dense && (
                    <li className={styles.insight}>
                      <span className={styles.insightTitle}>Плотный день · {insights.dense[1]} записей</span>
                      <span className={styles.insightSub}>{insights.dense[0]}</span>
                    </li>
                  )}
                  {insights.topSource && (
                    <li className={styles.insight}>
                      <span className={styles.insightTitle}>Основной источник · {insights.topSource.count}</span>
                      <span className={styles.insightSub}>{insights.topSource.name}</span>
                    </li>
                  )}
                  <li className={styles.insight}>
                    <span className={styles.insightTitle}>Покрытие · {dayLayers.length} дн с записями</span>
                    <span className={styles.insightSub}>
                      {insights.gapDays > 0 ? `разрыв ${insights.gapDays} дн без записей` : 'без разрывов в диапазоне'}
                    </span>
                  </li>
                </ul>
              )}
            </GlassPanel>
            <GlassPanel className={styles.panel} data-state={state}>
              <h2 className={styles.panelTitle}>Недавние записи</h2>
              {items.value == null ? (
                <LoadingState>Загрузка записей…</LoadingState>
              ) : (
                <ul className={styles.recallList}>
                  {items.value.slice(0, 3).map((m) => (
                    <li key={m.id}>
                      <button type="button" className={styles.recallItem} onClick={() => openInArchive(m.id)}>
                        <span className={styles.insightTitle}>{m.text}</span>
                        <span className={styles.insightSub}>{m.project} · {ageLabel(m.createdAt, now)}</span>
                      </button>
                    </li>
                  ))}
                  {items.value.length === 0 && <li className={styles.emptyHint}>Записей нет.</li>}
                </ul>
              )}
            </GlassPanel>
          </div>
        </div>
      ))}

      {visited.has('archive') && pane('archive', (
        <div className={styles.memoryArch}>
          <GlassPanel className={styles.panel} data-state={state} data-testid="memory-layers">
            <h2 className={styles.panelTitle}>Слои</h2>
            {items.failed ? (
              <ErrorState variant="inline" title="Записи не загрузились." onRetry={items.retry} retryLabel="Повторить" />
            ) : (
              <>
                <div className={styles.prefChoices} role="group" aria-label="Слой по дню">
                  <button
                    type="button"
                    className={styles.prefChoice}
                    data-selected={dayFilter == null}
                    onClick={() => setDayFilter(null)}
                  >
                    Все{structure.value != null ? ` · ${structure.value.total}` : ''}
                  </button>
                  {dayLayers.map(([day, count]) => (
                    <button
                      key={day}
                      type="button"
                      className={styles.prefChoice}
                      data-selected={dayFilter === day}
                      onClick={() => setDayFilter(day)}
                    >
                      {day} · {count}
                    </button>
                  ))}
                </div>
                {(structure.value?.sources?.length ?? 0) > 0 && (
                  <>
                    <h2 className={styles.panelTitle}>Источники</h2>
                    <ul className={styles.layerList}>
                      {structure.value!.sources!.map((s) => (
                        <li key={s.name} className={styles.layerRow}>
                          <span>{s.name}</span>
                          <span className={styles.selectSub}>{s.count}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </GlassPanel>
          <div className={styles.stack}>
            {/* Граф один на экране — живёт во вкладке «Обзор»; selection
                синхронизирован с этим списком через общий selectedId. */}
            <GlassPanel className={styles.panel} data-state={listState} data-testid="memory-browser">
              {baseFailed ? (
                <ErrorState
                  variant="inline"
                  title={searching ? 'Поиск не удался.' : 'Записи не загрузились.'}
                  onRetry={searching ? hits.retry : items.retry}
                  retryLabel="Повторить"
                />
              ) : (
                <MemoryBrowser
                  items={list ?? []}
                  state={listState}
                  query={query}
                  onSearch={setQuery}
                  structure={structure.value}
                  freshness="live"
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              )}
            </GlassPanel>
          </div>
          <div className={styles.stack} data-testid="memory-inspector">
            <GlassPanel className={styles.panel} data-state={items.failed ? 'error' : items.value == null ? 'loading' : 'ready'}>
              <MemoryInspector
                item={selected}
                onDelete={mockSource ? (id) => {
                  // Mock-only mutation; live ProductDataSource has no delete seam yet.
                  items.set((cur) => cur?.filter((m: MemoryItem) => m.id !== id) ?? cur);
                  setSelectedId(null);
                  setNotice(`Запись #${id} удалена (mock).`);
                } : undefined}
              />
              {!mockSource && (
                <p role="status" data-state="unavailable">
                  Удаление недоступно: активный источник не предоставляет операцию удаления памяти.
                </p>
              )}
            </GlassPanel>
            <GlassPanel className={styles.panel} data-state={mockSource ? 'ready' : 'unavailable'} data-testid="memory-template">
              {mockSource ? (
                <MemoryTemplate
                  project={project ?? items.value?.[0]?.project ?? 'nexus'}
                  onSave={(text) => {
                    // Mock-only mutation; live ProductDataSource has no add seam yet.
                    const id = (items.value?.[0]?.id ?? 900) + 1;
                    const createdAt = Math.floor(Date.now() / 1000);
                    items.set((cur) => [
                      { id, project: project ?? items.value?.[0]?.project ?? 'nexus', text, createdAt },
                      ...(cur ?? []),
                    ]);
                    setNotice(`Запись #${id} сохранена (mock). Редактирование не поддерживается API.`);
                  }}
                />
              ) : (
                <EmptyState
                  variant="inline"
                  title="Создание записей недоступно"
                  reason="активный источник не предоставляет операцию сохранения памяти"
                />
              )}
            </GlassPanel>
          </div>
        </div>
      ))}

      {visited.has('timeline') && pane('timeline', (
        <GlassPanel className={styles.panel} data-state={state} data-testid="memory-timeline">
          <h2 className={styles.panelTitle}>Записи по дням</h2>
          {items.failed ? (
            <ErrorState variant="inline" title="Записи не загрузились." onRetry={items.retry} retryLabel="Повторить" />
          ) : items.value == null ? (
            <LoadingState>Загрузка записей…</LoadingState>
          ) : dayLayers.length === 0 ? (
            <EmptyState variant="inline" title="Записей нет" body="таймлайн пуст." />
          ) : (
            <ol className={styles.timeline}>
              {dayLayers.map(([day, count]) => {
                const max = Math.max(1, ...dayLayers.map(([, c]) => c));
                return (
                  <li key={day} className={styles.timelineDay}>
                    <div className={styles.timelineHead}>
                      <span>{day}</span>
                      <span className={styles.selectSub}>{count} записей</span>
                    </div>
                    <div className={styles.timelineBar} role="img"
                      aria-label={`${day}: ${count} записей`}
                      style={{ width: `${Math.max(4, (count / max) * 100)}%` }} />
                    <ul className={styles.timelineItems}>
                      {(items.value ?? [])
                        .filter((m) => new Date(m.createdAt * 1000).toISOString().slice(0, 10) === day)
                        .map((m) => (
                          <li key={m.id}>
                            <button type="button" className={styles.recallItem} onClick={() => openInArchive(m.id)}>
                              <span className={styles.insightTitle}>{m.text}</span>
                              <span className={styles.insightSub}>
                                {new Date(m.createdAt * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} · {m.project}
                              </span>
                            </button>
                          </li>
                        ))}
                    </ul>
                  </li>
                );
              })}
            </ol>
          )}
        </GlassPanel>
      ))}
    </div>
  );
}
