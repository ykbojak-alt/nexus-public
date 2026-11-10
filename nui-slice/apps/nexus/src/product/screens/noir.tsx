'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, EmptyState, ErrorState, GlassPanel, LoadingState, PanelHeader, StatusBadge } from '@nexus/ui';
import type { NoirClient } from '../../integrations/noir/api/client';
import { NoirApiError } from '../../integrations/noir/api/client';
import type {
  NoirDashboard,
  NoirMap,
  NoirSharedScene,
  NoirStore,
  NoirStoreItems,
  NoirStoryAccess,
  NoirStoryCurrent,
} from '../../integrations/noir/contracts/player';
import { getDataSource, useDataSource, getDataSourceKind } from '../data-source';
import styles from './screens.module.css';

type NoirTab = 'dashboard' | 'story' | 'map' | 'stores' | 'dossier';
const TABS: Array<{ id: NoirTab; label: string }> = [
  { id: 'dashboard', label: 'Дашборд' },
  { id: 'story', label: 'Сюжет' },
  { id: 'map', label: 'Карта' },
  { id: 'stores', label: 'Магазины' },
  { id: 'dossier', label: 'Досье' },
];
const TAB_IDS = TABS.map((t) => t.id);
const parseTab = (v: string | null): NoirTab => (TAB_IDS.includes(v as NoirTab) ? (v as NoirTab) : 'dashboard');

const fmtErr = (e: unknown): string =>
  e instanceof NoirApiError ? `${e.code}${e.message ? ` — ${e.message}` : ''}` : 'Запрос отклонён сервером.';

export function NoirScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = parseTab(params.get('tab'));
  const ds = useDataSource();
  const kind = useMemo(getDataSourceKind, []);
  const client = ds.noir;

  // Session — live needs real Telegram Mini App initData (HMAC-verified by
  // the host); the desktop cannot mint one, so the gate is an honest input,
  // not a fabricated login button. Desktop pairs via a one-time /link code;
  // initData is the Mini App path — both are server-verified credentials.
  const [credMode, setCredMode] = useState<'link' | 'initData'>('link');
  const [credential, setCredential] = useState('');
  const [session, setSession] = useState<{ token: string; expiresAt: string } | null>(null);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const player = useMemo<NoirClient | null>(
    () => (client && session ? client.withToken(session.token) : null),
    [client, session],
  );

  const login = async () => {
    if (!client || sessionBusy || !credential.trim()) return;
    setSessionBusy(true);
    setSessionError(null);
    try {
      const s = credMode === 'link'
        ? await client.session.createWithLinkCode(credential.trim())
        : await client.session.create(credential.trim());
      setSession({ token: s.sessionToken, expiresAt: s.expiresAt });
    } catch (e) {
      setSessionError(fmtErr(e));
    } finally {
      setSessionBusy(false);
    }
  };

  const gateState = client == null ? 'unavailable' : sessionBusy ? 'loading' : 'ready';
  return (
    <div className={styles.page} data-screen="noir" aria-labelledby="noir-title">
      <PanelHeader level="screen" divider={false} titleId="noir-title" title="NOIR // ERA ONE" />
      <p className={styles.disclaimer}>
        Игровая сессия выполняется на стороне хоста NOIR — NEXUS показывает только ответы сервера.
      </p>

      {client == null && (
        <GlassPanel className={styles.panel} data-state="unavailable" data-testid="noir-gate">
          <h2 className={styles.panelTitle}>Сессия NOIR</h2>
          <p className={styles.emptyHint}>
            Источник данных не подключён к хосту NOIR (адрес не настроен).
          </p>
        </GlassPanel>
      )}

      {client != null && session == null && (
        <GlassPanel className={styles.panel} data-state={gateState} data-testid="noir-gate">
          <h2 className={styles.panelTitle}>Сессия NOIR</h2>
          {kind === 'mock' && <StatusBadge status="info" label="DEMO" />}
          <p className={styles.emptyHint}>
            Привязка — одноразовым кодом из команды /link в боте (10 мин, сгорает при обмене)
            или initData из Mini App. Хост проверяет credential и выдаёт bearer-токен.
          </p>
          <div className={styles.formRow}>
            <select className={styles.select} value={credMode}
              onChange={(e) => { setCredMode(e.target.value as 'link' | 'initData'); setCredential(''); }}
              aria-label="Способ привязки">
              <option value="link">код /link</option>
              <option value="initData">initData (Mini App)</option>
            </select>
            <input
              className={styles.input}
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
              placeholder={credMode === 'link' ? 'XXXX-XXXX…' : 'Telegram initData…'}
              aria-label={credMode === 'link' ? 'Код привязки' : 'Telegram initData'}
            />
            <Button variant="primary" size="sm" onClick={login} disabled={!credential.trim() || sessionBusy}>
              {sessionBusy ? 'Подключение…' : 'Подключить'}
            </Button>
          </div>
          {sessionError && <p className={styles.error} role="alert">{sessionError}</p>}
        </GlassPanel>
      )}

      {player != null && (
        <>
          <div
            className={styles.tabBar}
            role="tablist"
            aria-label="Разделы NOIR"
            onKeyDown={(e) => {
              const idx = TAB_IDS.indexOf(tab);
              const next =
                e.key === 'ArrowRight' ? (idx + 1) % TAB_IDS.length
                  : e.key === 'ArrowLeft' ? (idx - 1 + TAB_IDS.length) % TAB_IDS.length
                    : e.key === 'Home' ? 0
                      : e.key === 'End' ? TAB_IDS.length - 1
                        : -1;
              if (next >= 0) {
                e.preventDefault();
                router.push(`/noir?tab=${TAB_IDS[next]}`);
              }
            }}
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                id={`noir-tab-${t.id}`}
                role="tab"
                aria-selected={tab === t.id}
                aria-controls={`noir-panel-${t.id}`}
                tabIndex={tab === t.id ? 0 : -1}
                className={styles.tab}
                data-active={tab === t.id ? 'true' : undefined}
                onClick={() => router.push(`/noir?tab=${t.id}`)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === 'dashboard' && <DashboardTab player={player} />}
          {tab === 'story' && <StoryTab player={player} />}
          {tab === 'map' && <MapTab player={player} />}
          {tab === 'stores' && <StoresTab player={player} />}
          {tab === 'dossier' && <DossierTab player={player} />}
        </>
      )}
    </div>
  );
}

/** Shared fetch shell: panel-local data-state + honest retry. */
function usePanel<T>(player: NoirClient, load: (p: NoirClient) => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Latest-loader ref — inline arrow props would otherwise retrigger the
  // effect on every render.
  const loadRef = useRef(load);
  loadRef.current = load;
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    loadRef.current(player)
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(fmtErr(e)); setLoading(false); });
  }, [player]);
  useEffect(reload, [reload]);
  return { data, error, loading, reload };
}

function DashboardTab({ player }: { player: NoirClient }) {
  const { data: d, error, loading, reload } = usePanel(player, (p) => p.player.dashboard());
  const [busy, setBusy] = useState(false);
  const [actError, setActError] = useState<string | null>(null);
  const state = loading ? 'loading' : error ? 'error' : d ? 'ready' : 'empty';
  return (
    <GlassPanel className={styles.panel} data-state={state} data-testid="noir-dashboard">
      <h2 className={styles.panelTitle}>Дашборд</h2>
      {loading && <LoadingState>Загрузка дашборда…</LoadingState>}
      {error && <ErrorState variant="inline" title="Не удалось загрузить дашборд." onRetry={reload} retryLabel="Повторить" />}
      {d && (
        <>
          <dl className={styles.metaList} data-testid="noir-dashboard-data">
            <dt>Персонаж</dt><dd>{d.identity.name}{d.identity.alias ? ` «${d.identity.alias}»` : ''}{d.identity.role ? ` · ${d.identity.role}` : ''}</dd>
            <dt>Состояние</dt><dd>{d.runtime.state}{d.runtime.locationCode ? ` · ${d.runtime.locationCode}` : ''}</dd>
            <dt>Кошелёк</dt><dd>{d.wallet.credits} кр.</dd>
            <dt>Человечность / Heat</dt><dd>{d.character.humanity} / {d.character.eraHeat}</dd>
            <dt>Сюжет</dt><dd>{d.activeStory ? `${d.activeStory.storyCode} · ${d.activeStory.status}` : 'нет активного'}</dd>
            <dt>Смена</dt><dd>{d.activeWorkShift ? `идёт · конец ${d.activeWorkShift.estimatedEnd ?? 'н/д'}` : 'нет активной'}</dd>
            <dt>Запуск эры</dt><dd>{d.launch.state}{d.launch.isActive ? ' · активна' : ''}</dd>
          </dl>
          {d.runtime.gameStartedAt == null && (
            <div className={styles.formRow}>
              <Button variant="primary" size="sm" disabled={busy}
                onClick={async () => {
                  setBusy(true); setActError(null);
                  try { await player.actions.bootstrapGame(); reload(); }
                  catch (e) { setActError(fmtErr(e)); }
                  finally { setBusy(false); }
                }}>
                Начать игру
              </Button>
              {actError && <p className={styles.error} role="alert">{actError}</p>}
            </div>
          )}
        </>
      )}
    </GlassPanel>
  );
}

function StoryTab({ player }: { player: NoirClient }) {
  const list = usePanel(player, (p) => p.player.stories());
  const current = usePanel(player, (p) => p.player.storyCurrent());
  const [busy, setBusy] = useState(false);
  const [actError, setActError] = useState<string | null>(null);
  const [customText, setCustomText] = useState('');
  // Choice POST already returns the next scene — render it without an
  // extra GET; cleared when the server says the run ended/changed.
  const [sceneOverride, setSceneOverride] = useState<NoirStoryCurrent['scene']>(null);

  const scene = sceneOverride ?? current.data?.scene ?? null;
  const runActive = current.data?.active === true;
  const act = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setActError(null);
    try { await fn(); } catch (e) { setActError(fmtErr(e)); } finally { setBusy(false); }
  };
  const submitChoice = async (choiceIndex: number, text?: string) => {
    const runId = current.data?.runId;
    if (runId == null) return;
    await act(async () => {
      const r = await player.actions.storyChoice({ runId, choiceIndex, customText: text });
      setCustomText('');
      if (r.scene) setSceneOverride(r.scene);
      else { setSceneOverride(null); current.reload(); list.reload(); }
    });
  };

  return (
    <GlassPanel className={styles.panel} data-state={list.loading || current.loading ? 'loading' : 'ready'} data-testid="noir-story">
      <h2 className={styles.panelTitle}>Сюжет</h2>
      {(list.loading || current.loading) && <LoadingState>Загрузка сюжета…</LoadingState>}
      {list.error && <ErrorState variant="inline" title="Не удалось загрузить список сюжетов." onRetry={list.reload} retryLabel="Повторить" />}
      {current.error && <ErrorState variant="inline" title="Не удалось загрузить текущую сцену." onRetry={current.reload} retryLabel="Повторить" />}

      {scene && runActive && (
        <div data-testid="noir-scene">
          <h2 className={styles.panelTitle}>{scene.title}</h2>
          <p className={styles.emptyHint}>{scene.body}</p>
          <div className={styles.formRow} style={{ flexWrap: 'wrap' }}>
            {scene.choices.filter((c) => !c.custom).map((c) => (
              <Button key={c.choiceIndex} variant="secondary" size="sm" disabled={busy}
                onClick={() => submitChoice(c.choiceIndex)}>
                {c.label}
              </Button>
            ))}
          </div>
          {scene.choices.some((c) => c.custom) && (
            <div className={styles.formRow}>
              <input className={styles.input} value={customText} maxLength={2000}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="Свой вариант (до 2000 символов)…" aria-label="Свой вариант выбора" />
              <Button variant="primary" size="sm" disabled={busy || !customText.trim()}
                onClick={() => submitChoice(scene.choices.find((c) => c.custom)!.choiceIndex, customText.trim())}>
                Выбрать
              </Button>
            </div>
          )}
        </div>
      )}
      {current.data && !current.data.active && <EmptyState variant="inline" title="Активного прогона нет." />}

      {list.data && list.data.items.length > 0 && (
        <ul className={styles.selectList} aria-label="Доступные сюжеты">
          {list.data.items.map((s: NoirStoryAccess) => (
            <li key={s.code} className={styles.selectItem}>
              <span>{s.title ?? s.code} · {s.status ?? 'н/д'}</span>
              <Button variant="ghost" size="sm"
                disabled={busy || s.activeRunId != null || s.status !== 'AVAILABLE'}
                title={s.activeRunId != null ? 'Прогон уже активен' : s.status !== 'AVAILABLE' ? `Статус: ${s.status ?? 'н/д'}` : undefined}
                onClick={() => act(async () => { await player.actions.storyStart(s.code!); setSceneOverride(null); current.reload(); list.reload(); })}>
                Начать
              </Button>
            </li>
          ))}
        </ul>
      )}
      {list.data && list.data.items.length === 0 && <EmptyState variant="inline" title="Доступных сюжетов нет." />}
      {actError && <p className={styles.error} role="alert">{actError}</p>}
    </GlassPanel>
  );
}

function MapTab({ player }: { player: NoirClient }) {
  const { data: map, error, loading, reload } = usePanel(player, (p) => p.player.map());
  const [busy, setBusy] = useState(false);
  const [actError, setActError] = useState<string | null>(null);
  const state = loading ? 'loading' : error ? 'error' : map ? 'ready' : 'empty';
  return (
    <GlassPanel className={styles.panel} data-state={state} data-testid="noir-map">
      <h2 className={styles.panelTitle}>Карта</h2>
      {loading && <LoadingState>Загрузка карты…</LoadingState>}
      {error && <ErrorState variant="inline" title="Не удалось загрузить карту." onRetry={reload} retryLabel="Повторить" />}
      {map && (
        <>
          <p className={styles.emptyHint}>Текущая локация: {map.currentLocationTitle ?? 'н/д'}</p>
          {map.activeTravel && (
            <p className={styles.emptyHint}>
              В пути: {map.activeTravel.fromTitle} → {map.activeTravel.toTitle} · осталось {map.activeTravel.secondsLeft} с
            </p>
          )}
          {map.routes.length > 0 ? (
            <ul className={styles.selectList} aria-label="Маршруты">
              {map.routes.map((r) => (
                <li key={r.toCode} className={styles.selectItem}>
                  <span>{r.toTitle ?? r.toCode} · {r.travelSeconds} с</span>
                  <Button variant="ghost" size="sm" disabled={busy || !r.accessOk}
                    title={r.accessOk ? undefined : 'Доступ закрыт — сервер отклонит переезд'}
                    onClick={async () => {
                      setBusy(true); setActError(null);
                      try { await player.actions.travel(r.toCode!); reload(); }
                      catch (e) { setActError(fmtErr(e)); }
                      finally { setBusy(false); }
                    }}>
                    Ехать
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState variant="inline" title="Из текущей локации маршрутов нет." />
          )}
          {actError && <p className={styles.error} role="alert">{actError}</p>}
        </>
      )}
    </GlassPanel>
  );
}

function StoresTab({ player }: { player: NoirClient }) {
  const stores = usePanel(player, (p) => p.player.stores());
  const [openId, setOpenId] = useState<number | null>(null);
  const [items, setItems] = useState<NoirStoreItems | null>(null);
  const [itemsErr, setItemsErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actNote, setActNote] = useState('');

  const open = async (id: number) => {
    setOpenId(id);
    setItems(null);
    setItemsErr(null);
    try { setItems(await player.player.storeItems(id)); }
    catch (e) { setItemsErr(fmtErr(e)); }
  };

  return (
    <GlassPanel className={styles.panel} data-state={stores.loading ? 'loading' : stores.error ? 'error' : 'ready'} data-testid="noir-stores">
      <h2 className={styles.panelTitle}>Магазины</h2>
      {stores.loading && <LoadingState>Загрузка магазинов…</LoadingState>}
      {stores.error && <ErrorState variant="inline" title="Не удалось загрузить магазины." onRetry={stores.reload} retryLabel="Повторить" />}
      {stores.data && stores.data.stores.length === 0 && <EmptyState variant="inline" title="Магазинов в локации нет." />}
      {stores.data && stores.data.stores.length > 0 && (
        <ul className={styles.selectList} aria-label="Магазины">
          {stores.data.stores.map((s: NoirStore) => (
            <li key={s.id} className={styles.selectItem}>
              <span>{s.name ?? `Магазин #${s.id}`}{s.storeType ? ` · ${s.storeType}` : ''}</span>
              <Button variant="ghost" size="sm" onClick={() => open(s.id)}>Открыть</Button>
            </li>
          ))}
        </ul>
      )}
      {openId != null && (
        <div data-testid="noir-store-items">
          {items == null && !itemsErr && <LoadingState>Загрузка ассортимента…</LoadingState>}
          {itemsErr && <p className={styles.error} role="alert">{itemsErr}</p>}
          {items && (
            <>
              <p className={styles.emptyHint}>Баланс: {items.balance} кр.</p>
              <ul className={styles.selectList} aria-label="Ассортимент">
                {items.items.map((i) => (
                  <li key={i.code} className={styles.selectItem}>
                    <span>{i.name ?? i.code} · {i.price} кр. · осталось {i.quantity}</span>
                    <Button variant="ghost" size="sm" disabled={busy || i.quantity <= 0 || i.price > items.balance}
                      title={i.quantity <= 0 ? 'Нет в наличии' : i.price > items.balance ? 'Недостаточно средств' : undefined}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const r = await player.actions.buy(openId, { itemCode: i.code });
                          setItems(await player.player.storeItems(openId));
                          setActNote(`Куплено: ${r.item.name ?? r.item.code} · баланс ${r.balanceAfter} кр.`);
                        } catch (e) { setActNote(fmtErr(e)); }
                        finally { setBusy(false); }
                      }}>
                      Купить
                    </Button>
                  </li>
                ))}
              </ul>
              {actNote && <p className={styles.emptyHint} role="status">{actNote}</p>}
            </>
          )}
        </div>
      )}
    </GlassPanel>
  );
}

function DossierTab({ player }: { player: NoirClient }) {
  const inv = usePanel(player, (p) => p.player.inventory());
  const eco = usePanel(player, (p) => p.player.economy());
  const scene = usePanel(player, (p) => p.player.scene());
  const loading = inv.loading || eco.loading || scene.loading;
  return (
    <GlassPanel className={styles.panel} data-state={loading ? 'loading' : 'ready'} data-testid="noir-dossier">
      <h2 className={styles.panelTitle}>Досье</h2>
      {loading && <LoadingState>Загрузка досье…</LoadingState>}
      {inv.data && (
        <>
          <h2 className={styles.panelTitle}>Инвентарь</h2>
          {inv.data.items.length === 0 && inv.data.implants.length === 0
            ? <EmptyState variant="inline" title="Инвентарь пуст." />
            : (
              <ul className={styles.selectList} aria-label="Инвентарь">
                {inv.data.items.map((i, k) => <li key={k} className={styles.selectItem}><span>{i.name} ×{i.quantity} · {i.rarity}</span></li>)}
                {inv.data.implants.map((i, k) => <li key={`imp-${k}`} className={styles.selectItem}><span>имплант {i.itemCode} · слот {i.slotCode}</span></li>)}
              </ul>
            )}
        </>
      )}
      {eco.data && (
        <>
          <h2 className={styles.panelTitle}>Экономика</h2>
          <p className={styles.emptyHint}>Баланс {eco.data.balance} кр. · заработано {eco.data.earned} · потрачено {eco.data.spent}</p>
        </>
      )}
      {scene.data && (scene.data as NoirSharedScene).active && (
        <>
          <h2 className={styles.panelTitle}>Общая сцена</h2>
          <p className={styles.emptyHint}>
            {(scene.data as NoirSharedScene).locationName ?? '—'} · участников: {(scene.data as NoirSharedScene).participants?.length ?? 0}
          </p>
        </>
      )}
    </GlassPanel>
  );
}
