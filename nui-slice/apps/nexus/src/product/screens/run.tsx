'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { GlassPanel, PanelHeader, RunTrajectory } from '@nexus/ui';
import { MessageGraph, RunDetailPanel } from '@nexus/patterns';
import type { PatternState } from '@nexus/patterns';
import type { AgentHandoff, RunDetail, RunSummary } from '@nexus/mock-data';
import type { Ai2Voice } from '../../integrations/ai2/contracts/voice';
import { isAi2ApiError } from '../../integrations/ai2/api/errors';
import { getDataSource, useDataSource } from '../data-source';
import { useAsyncValue } from '../use-async-value';
import { useProfile } from '../profile/profile-store';
import { HandoffBar } from './copilot-widgets';
import { messageGraphOf, toolCallsOf, type MessageGraphSource } from './runtime-ops';
import styles from './screens.module.css';

const VOICE_LS_KEY = 'nexus.voice.speaker';

/**
 * Run detail — /run?id=<runId>. Static-export safe: the id arrives as a
 * search param, never a route segment. When the active source does not
 * implement getRunDetail the screen says so plainly instead of faking data.
 */
export function RunScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const runId = params.get('id');
  const ds = useDataSource();
  const { profile } = useProfile();
  const supported = typeof ds.getRunDetail === 'function';

  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    if (!runId || !ds.getRunDetail) return;
    setLoadError(false);
    setNotFound(false);
    ds.getRunDetail(runId)
      .then((d) => {
        setDetail(d);
        setNotFound(d == null);
      })
      .catch(() => setLoadError(true));
  }, [ds, runId]);

  useEffect(load, [load]);

  // wave-XI W4: шкала вызовов из сохранённого трейса — только реальные
  // tool_call/tool_result/spawn события; пустой лог → честный текст.
  const trajectory = useMemo(
    () => (detail != null ? toolCallsOf(detail.events) : []),
    [detail],
  );

  const openRun = useCallback(
    (id: string) => router.push(`/run?id=${encodeURIComponent(id)}`),
    [router],
  );

  // Wave XI W3: HandoffBar под ответом агента — кнопки из спеки агента
  // (AgentSpec.handoffs, verbatim от хоста). send → новый прогон целевому
  // агенту; !send → черновик в композитор главной (sessionStorage).
  const [agentHandoffs, setAgentHandoffs] = useState<AgentHandoff[] | null>(null);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffError, setHandoffError] = useState('');
  useEffect(() => {
    const agent = detail?.run.agent;
    if (agent == null || (detail?.result?.answer ?? null) == null || typeof ds.listAgents !== 'function') {
      setAgentHandoffs(null);
      return;
    }
    let live = true;
    ds.listAgents()
      .then((rows) => {
        if (!live) return;
        const spec = rows.find((a) => a.name === agent);
        setAgentHandoffs(spec?.handoffs ?? []);
      })
      .catch(() => { if (live) setAgentHandoffs([]); });
    return () => { live = false; };
  }, [ds, detail]);

  const onHandoff = useCallback(async (h: AgentHandoff) => {
    if (handoffBusy) return;
    if (h.send) {
      setHandoffBusy(true);
      setHandoffError('');
      try {
        const registered = await ds.listAgents().catch(() => null);
        const agent = registered?.some((entry) => entry.name === h.agent) ? h.agent : undefined;
        const run = await ds.startRun({
          task: h.prompt,
          config: profile?.defaultPreset ?? 'baseline',
          ...(agent != null ? { agent } : {}),
          model: profile?.defaultModelId ?? null,
        });
        router.push(`/run?id=${encodeURIComponent(run.runId)}`);
      } catch (err) {
        setHandoffError(isAi2ApiError(err) ? err.message : 'Не удалось запустить продолжение — хост отклонил задачу.');
        setHandoffBusy(false);
      }
    } else {
      try { sessionStorage.setItem('nexus.composer.draft', h.prompt); } catch { /* приватный режим */ }
      router.push('/home');
    }
  }, [ds, handoffBusy, profile?.defaultModelId, profile?.defaultPreset, router]);

  // W3-07 context sources — which reads produced this run's context.
  // Sibling history comes from listRuns; files have no seam → honest
  // unavailable, never a fabricated link.
  const [history, setHistory] = useState<RunSummary[] | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);

  const loadHistory = useCallback(() => {
    if (detail == null) return;
    setHistoryFailed(false);
    ds.listRuns({ agent: detail.run.agent ?? null, limit: 6 })
      .then((runs) => setHistory(runs.filter((r) => r.runId !== detail.run.runId).slice(0, 5)))
      .catch(() => setHistoryFailed(true));
  }, [ds, detail]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const state: PatternState = !supported || !runId
    ? 'error'
    : loadError
      ? 'error'
      : notFound
        ? 'ready' // detail=null + ready → pattern renders honest not-found
        : detail == null
          ? 'loading'
          : 'ready';

  return (
    <div className={styles.page} data-screen="run" aria-labelledby="run-title">
      <PanelHeader level="screen" divider={false} titleId="run-title" title={`Прогон ${runId ?? ''}`} />
      <GlassPanel
        className={styles.panel}
        data-state={!runId ? 'error' : !supported ? 'unavailable' : state}
        data-testid="run-detail"
      >
        {!runId ? (
          <p className={styles.emptyHint}>Не указан идентификатор прогона.</p>
        ) : !supported ? (
          <p className={styles.emptyHint}>
            Детали прогона недоступны: активный источник данных не реализует getRunDetail.
          </p>
        ) : (
          <RunDetailPanel
            detail={notFound ? null : detail}
            state={state}
            onOpenRun={openRun}
            onBack={() => router.back()}
            title="Детали прогона"
          />
        )}
      </GlassPanel>
      {supported && runId && (
        <button type="button" className={styles.linkBtn} onClick={load}>
          Обновить
        </button>
      )}

      {detail != null && (
        <GlassPanel className={styles.panel} data-testid="run-trajectory-panel" data-state="ready">
          <h2 className={styles.panelTitle}>Траектория прогона</h2>
          <RunTrajectory
            calls={trajectory}
            emptyLabel={detail.events.length === 0
              ? 'Трейс прогона не сохранён — данных для шкалы нет.'
              : 'Вызовов инструментов в этом прогоне не было.'}
          />
        </GlassPanel>
      )}

      {detail != null && (
        <GlassPanel
          className={styles.panel}
          data-testid="run-context"
          data-state={historyFailed ? 'error' : history == null ? 'loading' : 'ready'}
        >
          <h2 className={styles.panelTitle}>Контекст прогона</h2>
          <ul className={styles.selectList}>
            <li className={styles.selectRow}>
              <span className={styles.selectMain}>
                <span>Агент</span>
                <span className={styles.selectSub}>{detail.run.agent ?? '— авто —'}</span>
              </span>
              {detail.run.agent != null && (
                <button type="button" className={styles.linkBtn} onClick={() => router.push('/agents')}>
                  Каталог агентов
                </button>
              )}
            </li>
            <li className={styles.selectRow}>
              <span className={styles.selectMain}>
                <span>Проект</span>
                <span className={styles.selectSub}>{detail.run.project ?? '—'}</span>
              </span>
              {detail.run.project != null && (
                <button type="button" className={styles.linkBtn} onClick={() => router.push('/memory')}>
                  Память проекта
                </button>
              )}
            </li>
            <li className={styles.selectRow} data-state="unavailable">
              <span className={styles.selectMain}>
                <span>Файлы прогона</span>
                <span className={styles.selectSub}>источник файлов не подключён к активному адаптеру</span>
              </span>
            </li>
            <li className={styles.selectRow} data-state={historyFailed ? 'error' : 'ready'}>
              <span className={styles.selectMain}>
                <span>История агента</span>
                {historyFailed ? (
                  <button type="button" className={styles.linkBtn} onClick={loadHistory}>
                    Не загрузилась — повторить
                  </button>
                ) : history == null ? (
                  <span className={styles.selectSub}>Загрузка…</span>
                ) : history.length === 0 ? (
                  <span className={styles.selectSub}>других прогонов нет</span>
                ) : (
                  <span className={styles.prefChoices}>
                    {history.map((r) => (
                      <button
                        key={r.runId}
                        type="button"
                        className={styles.linkBtn}
                        onClick={() => openRun(r.runId)}
                      >
                        {r.runId}
                      </button>
                    ))}
                  </span>
                )}
              </span>
            </li>
          </ul>
        </GlassPanel>
      )}

      {detail != null && (detail.result?.answer ?? null) != null && agentHandoffs != null && agentHandoffs.length > 0 && (
        <GlassPanel className={styles.panel} data-state="ready" data-testid="run-handoffs">
          <h2 className={styles.panelTitle}>Продолжить</h2>
          <HandoffBar handoffs={agentHandoffs} onPick={onHandoff} busy={handoffBusy} />
          {handoffError !== '' && <p className={styles.emptyHint} data-state="error">{handoffError}</p>}
        </GlassPanel>
      )}

      {detail != null && <RunFamily detail={detail} />}

      {detail != null && (detail.result?.answer ?? null) != null && (
        <VoicePanel text={detail.result?.answer ?? ''} />
      )}
    </div>
  );
}

/** spawn-событие дочернего прогона несёт parent_run_id/handle verbatim —
 *  этот прогон был запущен субагентом. Нет события → нет пометки. */
function spawnInfoOf(detail: RunDetail): { handle: string | null } | null {
  const ev = detail.events.find((e) => e.type === 'spawn');
  if (ev == null) return null;
  const b = ev.body as { handle?: unknown; parent_run_id?: unknown } | null;
  return { handle: typeof b?.handle === 'string' ? b.handle : null };
}

/** wave-2 W3-1: семейство прогона — родительская ссылка + дети через
 *  listRuns({parent}) (проверенный хостовый wire `?parent=`). Только
 *  наблюдаемые поля: нет parent — нет строки, детей нет — честное «не было». */
function RunFamily({ detail }: { detail: RunDetail }) {
  const ds = useDataSource();
  const runId = detail.run.runId;
  const parent = detail.run.parent;
  const spawn = useMemo(() => spawnInfoOf(detail), [detail]);

  const children = useAsyncValue(
    () => ds.listRuns({ parent: runId, limit: 50 }),
    [ds, runId],
  );

  // R-W3.2: граф сообщений семьи — рёбра только из наблюдаемых
  // send_message-событий трейсов (корень + первые 10 детей через
  // getRunDetail). Нет ребер → честная строка «не наблюдалось».
  const [childDetails, setChildDetails] = useState<Map<string, RunDetail> | null>(null);
  useEffect(() => {
    const kids = children.value ?? [];
    if (kids.length === 0) { setChildDetails(new Map()); return; }
    if (typeof ds.getRunDetail !== 'function') { setChildDetails(null); return; }
    let live = true;
    const slice = kids.slice(0, 10);
    Promise.allSettled(slice.map((c) => ds.getRunDetail!(c.runId))).then((rs) => {
      if (!live) return;
      const m = new Map<string, RunDetail>();
      rs.forEach((r, i) => { if (r.status === 'fulfilled' && r.value != null) m.set(slice[i].runId, r.value); });
      setChildDetails(m);
    });
    return () => { live = false; };
  }, [ds, children.value]);

  const msgGraph = useMemo(() => {
    if (childDetails == null) return null;
    const sources: MessageGraphSource[] = [
      { runId, kind: 'root', status: detail.run.status, trace: detail.events },
      ...(children.value ?? [])
        .filter((c) => childDetails.has(c.runId))
        .map((c) => {
          const d = childDetails.get(c.runId)!;
          return { runId: c.runId, kind: 'sub' as const, status: c.status, handle: spawnInfoOf(d)?.handle ?? null, trace: d.events };
        }),
    ];
    return messageGraphOf(sources);
  }, [childDetails, children.value, detail, runId]);

  if (parent == null && spawn == null && (children.value ?? []).length === 0 && children.value != null) {
    return null; // ни родителя, ни детей — панель не показываем вовсе
  }

  return (
    <GlassPanel className={styles.panel} data-testid="run-family"
      data-state={children.failed ? 'error' : children.value == null ? 'loading' : 'ready'}>
      <h2 className={styles.panelTitle}>Семейство прогона</h2>
      <ul className={styles.selectList}>
        {spawn != null && (
          <li className={styles.selectRow}>
            <span className={styles.selectMain}>
              <span>Роль</span>
              <span className={styles.selectSub}>
                этот прогон — субагент{spawn.handle != null ? ` ${spawn.handle}` : ''}
              </span>
            </span>
          </li>
        )}
        {parent != null && (
          <li className={styles.selectRow}>
            <span className={styles.selectMain}>
              <span>Родитель</span>
              <Link className={styles.linkBtn} href={`/run?id=${parent}`}>{parent.slice(0, 12)}…</Link>
            </span>
          </li>
        )}
        <li className={styles.selectRow} data-state={children.failed ? 'error' : 'ready'}>
          <span className={styles.selectMain}>
            <span>Дочерние прогоны</span>
            {children.failed ? (
              <button type="button" className={styles.linkBtn} onClick={children.retry}>
                Не загрузились — повторить
              </button>
            ) : children.value == null ? (
              <span className={styles.selectSub}>Загрузка…</span>
            ) : children.value.length === 0 ? (
              <span className={styles.selectSub}>дочерних не было</span>
            ) : (
              <span className={styles.prefChoices} role="list" aria-label="Дочерние прогоны">
                {children.value.map((c) => (
                  <Link
                    key={c.runId}
                    className={styles.linkBtn}
                    href={`/run?id=${c.runId}`}
                    title={`${c.runId} · ${c.status}${c.agent != null ? ` · ${c.agent}` : ''}`}
                  >
                    {c.runId.slice(0, 12)}… · {c.status}
                  </Link>
                ))}
              </span>
            )}
          </span>
        </li>
      </ul>
      {(children.value ?? []).length > 0 && (
        childDetails == null ? (
          <p className={styles.selectSub}>Читаю трейсы семьи…</p>
        ) : msgGraph != null && msgGraph.edges.length > 0 ? (
          <MessageGraph data={msgGraph} title="Обмен сообщениями" width={560} height={280}
            data-testid="run-message-graph" />
        ) : (
          <p className={styles.selectSub} data-testid="run-message-empty">
            Сообщений между прогонами семьи не наблюдалось.
          </p>
        )
      )}
    </GlassPanel>
  );
}

/** W1 voice — озвучка ответа прогона через TTS хоста (Fish Audio, голос
 *  AGENT-A на стороне ai2). Seam absent → `unavailable`; голоса
 *  приходят от хоста, недоступные отмечены, выбор не притворяется. */
function VoicePanel({ text }: { text: string }) {
  const ds = useDataSource();
  const seam = ds.voice;
  const [voices, setVoices] = useState<Ai2Voice[] | null>(null);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [voiceId, setVoiceId] = useState<string>(() =>
    (typeof localStorage !== 'undefined' && localStorage.getItem(VOICE_LS_KEY)) || '');
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<{ el: HTMLAudioElement; url: string } | null>(null);

  const loadVoices = useCallback(() => {
    if (seam == null) return;
    setVoicesError(null);
    seam.voices()
      .then((list) => {
        setVoices(list);
        setVoiceId((cur) => (list.some((v) => v.id === cur && v.available)
          ? cur
          : list.find((v) => v.available)?.id ?? ''));
      })
      .catch((e) => {
        setVoicesError(isAi2ApiError(e) ? e.message : 'Каталог голосов не загрузился');
        setVoices([]);
      });
  }, [seam]);

  useEffect(loadVoices, [loadVoices]);

  const stopAudio = useCallback(() => {
    const cur = audioRef.current;
    if (cur == null) return;
    cur.el.pause();
    URL.revokeObjectURL(cur.url);
    audioRef.current = null;
    setPlaying(false);
  }, []);

  // Object URL и элемент живут до конца воспроизведения/замены/размонтирования.
  useEffect(() => () => stopAudio(), [stopAudio]);

  const speak = async () => {
    if (seam == null || !text.trim() || busy) return;
    if (playing) { stopAudio(); return; }
    setBusy(true);
    setError(null);
    try {
      const s = await seam.speak(text, voiceId || undefined);
      const url = URL.createObjectURL(s.audio);
      const el = new Audio(url);
      audioRef.current = { el, url };
      el.addEventListener('ended', stopAudio);
      el.addEventListener('error', stopAudio);
      await el.play();
      setPlaying(true);
    } catch (e) {
      // Хост ответил сообщением — показываем его дословно (422/503).
      setError(isAi2ApiError(e) ? e.message : 'Синтез не выполнен — сервис отклонил запрос.');
      stopAudio();
    } finally {
      setBusy(false);
    }
  };

  const state = seam == null ? 'unavailable'
    : voicesError != null ? 'error'
      : voices == null ? 'loading'
        : busy ? 'loading' : 'ready';

  return (
    <GlassPanel className={styles.panel} data-state={state} data-testid="run-voice">
      <h2 className={styles.panelTitle}>Голос ответа</h2>
      {seam == null ? (
        <p className={styles.emptyHint}>
          Озвучка недоступна: активный источник данных не реализует voice (нужен live-хост ai2).
        </p>
      ) : voicesError != null ? (
        <p className={styles.emptyHint}>
          {voicesError}{' '}
          <button type="button" className={styles.linkBtn} onClick={loadVoices}>Повторить</button>
        </p>
      ) : voices == null ? (
        <p className={styles.emptyHint}>Запрос каталога голосов…</p>
      ) : voices.length === 0 ? (
        <p className={styles.emptyHint}>Хост не отдал ни одного голоса.</p>
      ) : (
        <>
          <div className={styles.prefRow}>
            <span className={styles.prefLabel}>Голос</span>
            <span className={styles.prefChoices}>
              {voices.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={styles.prefChoice}
                  disabled={!v.available}
                  title={v.available ? v.labelEn : `${v.labelEn} — движок/модель не установлены на хосте`}
                  data-selected={voiceId === v.id}
                  onClick={() => {
                    setVoiceId(v.id);
                    try { localStorage.setItem(VOICE_LS_KEY, v.id); } catch { /* приватный режим */ }
                  }}
                >
                  {v.label}
                </button>
              ))}
            </span>
          </div>
          <div className={styles.formRow}>
            <button
              type="button"
              className={styles.linkBtn}
              disabled={busy || voices.every((v) => !v.available)}
              onClick={() => void speak()}
            >
              {busy ? 'Синтез…' : playing ? 'Стоп' : 'Озвучить ответ'}
            </button>
          </div>
          {error != null && <p className={styles.emptyHint} data-state="error">{error}</p>}
        </>
      )}
    </GlassPanel>
  );
}
