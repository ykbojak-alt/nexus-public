'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AssistantCard, Button, EmptyState, ErrorState, GlassPanel, GlassSurface, Sparkline } from '@nexus/ui';
import { PanelSkeleton } from '../skeleton-panel';
import { PERSONAS, type AgentSpec, type MemoryItem, type RunSummary, type SystemMetrics } from '@nexus/mock-data';
import type { PresenceEntry } from '@nexus/patterns';
import { useDataSource } from '../data-source';
import { greetingOf } from '../greeting';
import { PROC_STATE_LABEL } from '../proc-state-label';
import { useProfile, updateProfile } from '../profile/profile-store';
import { DEFAULT_OPERATOR_NAME } from '../profile/profile-types';
import type { Ai2Capabilities, Ai2Feature } from '../../integrations/ai2/contracts/capabilities';
import { isAi2ApiError } from '../../integrations/ai2/api/errors';
import { AgentSessionsPanel } from './agent-sessions';
import { AliceHero } from './alice-hero';
import { ModeSwitch } from './copilot-widgets';
import { SlotMount } from '../plugins/slot-mount';
import { RuntimeEcho, useRuntimeEcho } from './runtime-echo';
import { runAnimationFrameWhileVisible, runWhileDocumentVisible } from '../visible-interval';
import styles from './home.module.css';

/** epoch s → «N мин назад»; null → «—» (формат copilot-widgets). */
function agoLabel(ts: number | null): string {
  if (ts == null || !Number.isFinite(ts)) return '—';
  const sec = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (sec < 60) return 'только что';
  if (sec < 3600) return `${Math.floor(sec / 60)} мин назад`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} ч назад`;
  return `${Math.floor(sec / 86400)} д назад`;
}

/** main7: чипы-действия над композитором — вставляют шаблон без отправки. */
const ACTION_CHIPS = [
  { label: 'Исследование', hint: 'Проведи исследование: ' },
  { label: 'Анализ', hint: 'Проанализируй: ' },
  { label: 'План', hint: 'Составь план: ' },
  { label: 'Создание', hint: 'Создай: ' },
  { label: 'Автоматизация', hint: 'Автоматизируй: ' },
  { label: 'Обзор', hint: 'Сделай обзор: ' },
] as const;

/** main7 «Предложено для вас» — сценарные карточки заполняют композитор. */
const SUGGESTED_CARDS = [
  { icon: '⌕', title: 'Глубокое исследование', text: 'Многошаговый разбор темы со сводкой источников.', prompt: 'Проведи глубокое исследование темы: ' },
  { icon: '▤', title: 'Стратегический брифинг', text: 'Краткая сводка для решения по текущему контексту.', prompt: 'Подготовь стратегический брифинг по: ' },
  { icon: '◫', title: 'Моделирование сценариев', text: 'Сравнение вариантов развития и их последствий.', prompt: 'Смоделируй сценарии: ' },
  { icon: '✦', title: 'Создание контента', text: 'Черновик текста, поста или документа по тезисам.', prompt: 'Создай черновик: ' },
] as const;

/** main7: орбитальные подписи у героини — декоративная ось арта
    (те же шесть глаголов, что у чипов композитора). */
const ORBIT_LABELS = ['Исследовать', 'Анализировать', 'Планировать', 'Создавать', 'Автоматизировать', 'Обозревать'] as const;

/**
 * XV W3 — состояние KPI-плитки учёта (задача W1 23).
 * `absent` — seam'а нет в источнике (mock/app), `error` — хост ответил
 * отказом (503 без AI2_SDK_ENABLED): плитка показывает «нет данных»,
 * причину — в `title`, цифры не выдумываются.
 */
type KpiPart<T> =
  | { kind: 'loading' }
  | { kind: 'absent' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; value: T };

/** Сумма непустых значений; всё null → null («нет данных», не 0). */
function sumOrNull(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v != null);
  return nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0);
}

/** Текст плитки + причина в title (verbatim от хоста, не переформулируем). */
function kpiView(part: KpiPart<number | null>, fmt: (n: number) => string): { text: string; title?: string } {
  if (part.kind === 'loading') return { text: '…' };
  if (part.kind === 'absent') return { text: 'нет данных', title: 'Источник учёта не подключён' };
  if (part.kind === 'error') return { text: 'нет данных', title: part.message };
  return part.value == null
    ? { text: 'нет данных', title: 'Хост не отдал суммы учёта' }
    : { text: fmt(part.value) };
}

// Статика: dev отдаёт /art/…, AI-2 хост монтирует бандл под /_nexus.
const ASSET_BASE =
  typeof document !== 'undefined' &&
    document.querySelector('script[src*="/_nexus/"], link[href*="/_nexus/"]')
    ? '/_nexus'
    : '';

/** Арт персоны для карточки ассистента — тот же арт-манифест, что на
 *  /welcome (V1); без ассета AssistantCard рисует
 *  монограмму, не выдуманный портрет. */
const PERSONA_ART: Partial<Record<string, { src: string; alt: string }>> = {
  arch: { src: '/art/agent-arch.webp', alt: 'Образ субагента A.R.C.H.' },
  mech: { src: '/art/agent-mech.webp', alt: 'Образ субагента M.E.C.H.' },
  alice: { src: '/art/agent-alice.webp', alt: 'Образ ассистента AGENT-A' },
  codex: { src: '/art/agent-codex.webp', alt: 'Образ субагента ROLE-1' },
  forge: { src: '/art/agent-forge.webp', alt: 'Образ субагента ROLE-2' },
};

/** Волна XI→XIV: «Последние окна» шины переехали во вкладку bus на
 *  /runtime — вся визуальная и функциональная часть шины там. */

export type HomeScreenAsyncState<T> = { state: 'loading' } | { state: 'error' } | { state: 'ready'; value: T };
type AsyncState<T> = HomeScreenAsyncState<T>;

/** Live HomeScreen state/callbacks exposed to a route-owned view adapter. */
export interface HomeScreenAliceRouteModel {
  task: string;
  setTask: (value: string) => void;
  busy: boolean;
  error: string | null;
  startTask: () => void;
  agentName: string;
  operatorName: string;
  greeting: string;
  runningCount: number | null;
  metrics: AsyncState<SystemMetrics>;
  recentRuns: AsyncState<RunSummary[]>;
  /** Повторный запрос списка прогонов после ошибки первичной загрузки. */
  retryRuns: () => void;
  latencyMs: number | null;
  cpuTrail: readonly number[];
  /** Ряды Память/Диск из тех же опросов метрик — три гряды «Потока активности». */
  ramTrail: readonly number[];
  diskTrail: readonly number[];
  /** Voice seam of the connected source; disabled with a verbatim reason. */
  voice: {
    enabled: boolean;
    active: boolean;
    reason: string | null;
    onToggle: () => void;
  };
  actions: readonly { label: string; hint: string }[];
}

/** A.2: стартеры промптов — UI-шаблоны, вставляют текст без отправки. */
const PROMPT_STARTERS = [
  'Разбери последний прогон и объясни, где он остановился',
  'Составь план миграции и оцени риски по шагам',
  'Найди в знаниях всё про текущий проект и сведи в отчёт',
] as const;

/** #53: подписи состояний процесса — серверный словарь /v1/processes.
 *  Карта вынесена в ../proc-state-label (общая с rail-agents/dialogs). */

/** X V3-3a: карта feature-ключей хоста → экран и подпись по-русски. Ключи —
 *  внутренний словарь контракта (англ.), подписи пользователю — русские. */
const FEATURE_CHIPS: readonly {
  key: string;
  label: string;
  href: string;
}[] = [
  { key: 'runPlanPreview', label: 'План прогона', href: '/runtime' },
  { key: 'runCheckpoints', label: 'Контрольные точки', href: '/runtime' },
  { key: 'runPauseResume', label: 'Пауза/возобновление', href: '/runtime' },
  { key: 'runCancel', label: 'Отмена прогона', href: '/runtime' },
  { key: 'sseStream', label: 'Поток прогона', href: '/runtime' },
  { key: 'webhooks', label: 'Вебхуки', href: '/connections' },
  { key: 'worker', label: 'Воркер', href: '/local-agent' },
  { key: 'approvals', label: 'Подтверждения', href: '/runtime' },
] as const;

export function HomeScreen({
  renderAliceRoute,
}: {
  renderAliceRoute?: (model: HomeScreenAliceRouteModel) => ReactNode;
} = {}) {
  const router = useRouter();
  const ds = useDataSource(); // #418 (wave #418-2): mount-gated
  const { profile } = useProfile();
  // Черновик подхватывается mount-эффектом ниже, а не в первом рендере:
  // sessionStorage в lazy-init даёт клиенту data-state="typing" там, где SSR отдал
  // «idle» — React 19 латит расхождение перезаписью атрибутов и роняет оверлей.
  const [task, setTask] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // #418 (wave #418-2): profile-driven text in greeting/heading only after mount
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Эхо рантайма в hero-пузыре: запуск задачи больше не уводит на /runtime —
  // поток событий и черновик ответа раскрываются здесь же, на главной.
  const echo = useRuntimeEcho(ds);
  // #418 (wave #418-2): agent/assistant only resolve post-mount — SSR has
  // profile=null (agent undefined → 'ЭЛИС' fallback), client first frame has
  // real profile → real persona name → text mismatch.
  // Старый профиль может содержать id прежнего ассистента; главная всегда
  // представляет единственную ассистентку среды — AGENT-A
  const assistant = PERSONAS.find((item) => item.id === 'alice') ?? null;

  // Wave XI: handoff send:false с экрана прогона кладёт черновик сюда
  // (sessionStorage `nexus.composer.draft`) — подхватываем один раз.
  useEffect(() => {
    try {
      const draft = sessionStorage.getItem('nexus.composer.draft');
      if (draft != null && draft.trim() !== '') {
        setTask(draft);
        sessionStorage.removeItem('nexus.composer.draft');
      }
    } catch { /* приватный режим — черновика нет */ }
  }, []);

  // Персистентность черновика композитора (W3-159): набранный текст
  // переживает смену экрана/перезагрузку вкладки. Debounce-save на ввод,
  // очистка после отправки.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (task.trim() !== '') sessionStorage.setItem('nexus.composer.draft', task);
        else sessionStorage.removeItem('nexus.composer.draft');
      } catch { /* приватный режим */ }
    }, 400);
    return () => clearTimeout(t);
  }, [task]);

  // Chat bubble state — in-memory dialog shown above composer after submit
  type ChatMessage = { role: 'user' | 'alice' | 'error'; text: string; ts: number };
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const scrollChatToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, []);

  const addChatMessage = useCallback((message: ChatMessage) => {
    setChatMessages((prev) => [...prev, message]);
    // Scroll after render
    setTimeout(scrollChatToBottom, 0);
  }, [scrollChatToBottom]);

  const clearChat = useCallback(() => {
    setChatMessages([]);
    setChatOpen(false);
  }, []);

  const toggleChat = useCallback(() => {
    setChatOpen((open) => !open);
  }, []);

  const startTaskAndOpenChat = useCallback(async () => {
    const prompt = task.trim();
    if (!prompt || busy) return;

    // Add user message and open chat
    addChatMessage({ role: 'user', text: prompt, ts: Date.now() });
    setChatOpen(true);

    // Show "thinking" state
    const thinkingId = `thinking-${Date.now()}`;
    addChatMessage({ role: 'alice', text: 'AGENT-A думает…', ts: Date.now() });

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
      echo.start(run.runId, run.status, prompt);
      setRunsTick((tick) => tick + 1);
      try { sessionStorage.removeItem('nexus.composer.draft'); } catch { /* приватный режим */ }
      setTask('');

      // Replace thinking message with actual response when run completes
      // The echo will handle the streaming response
    } catch (err) {
      setError(isAi2ApiError(err) ? `Не удалось запустить задачу: ${err.message}` : 'Не удалось запустить задачу. Проверьте подключение к рантайму и повторите попытку.');
      // Replace thinking with error
      setChatMessages((prev) => prev.map((m) =>
        m.text === 'AGENT-A думает…' ? { role: 'error', text: `Ошибка: ${isAi2ApiError(err) ? err.message : 'Неизвестная ошибка'}`, ts: Date.now() } : m
      ));
    } finally {
      setBusy(false);
    }
  }, [task, busy, ds, profile, echo, addChatMessage]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void startTaskAndOpenChat();
  }

  // main7 «Отклик»: реальный RTT запроса getMetrics, не изображённый «320 ms».
  const [rttMs, setRttMs] = useState<number | null>(null);
  // main7 «Сегодня»: дата клиентская — читаем в effect, чтобы первый
  // рендер на SSR и в браузере совпадал (паттерн Clock в app-shell).
  const [todayLabel, setTodayLabel] = useState<string | null>(null);
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => {
    setTodayLabel(new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }));
    setHour(new Date().getHours());
  }, []);
  // A.6: клиентский накопитель cpu% — честно пустой на старте, точка
  // добавляется при каждом опросе метрик (30 с), максимум 60 точек.
  const [cpuTrail, setCpuTrail] = useState<number[]>([]);
  // Те же три реальных ряда копятся для «Потока активности» (три гряды):
  // память и диск — из того же ответа /v1/metrics, без интерполяции.
  const [ramTrail, setRamTrail] = useState<number[]>([]);
  const [diskTrail, setDiskTrail] = useState<number[]>([]);
  // VII V1.2 (NUE1): KPI-полоса, оркестрация, память и правый рейл —
  // всё только из наблюдаемых seam'ов; seam упал/отсутствует → честный
  // блок «нет данных», никаких цифр с картинки-эталона.
  const [activeRun, setActiveRun] = useState<AsyncState<RunSummary | null>>({ state: 'loading' });
  const [runningCount, setRunningCount] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<AsyncState<SystemMetrics>>({ state: 'loading' });
  const [metricsAt, setMetricsAt] = useState<number | null>(null);
  const [presence, setPresence] = useState<AsyncState<PresenceEntry[]>>({ state: 'loading' });
  const [specs, setSpecs] = useState<AsyncState<AgentSpec[]>>({ state: 'loading' });
  const [recentRuns, setRecentRuns] = useState<AsyncState<RunSummary[]>>({ state: 'loading' });
  const [memory, setMemory] = useState<AsyncState<MemoryItem[]>>({ state: 'loading' });
  // listProjects опционален: отсутствие seam ≠ ошибка → отдельный флаг.
  const [projects, setProjects] = useState<string[] | null>(null);
  const [projectsMissing, setProjectsMissing] = useState(false);
  // X V3-3a: чипы возможностей композитора — verbatim из getCapabilities()
  // (features.supported + reason/via от хоста). Seam'а нет → блока нет.
  const [features, setFeatures] = useState<Ai2Capabilities['features'] | null>(null);
  const [featuresDown, setFeaturesDown] = useState(false);
  // Список прогонов обновляется не только на монтировании: после запуска
  // задачи и терминального события SSE «Сегодня» на /runtime/alice иначе
  // остаётся снимком на момент открытия маршрута.
  const [runsTick, setRunsTick] = useState(0);
  useEffect(() => {
    let alive = true;
    ds.listRuns({ limit: 20 }).then(
      (runs) => {
        if (!alive) return;
        const running = runs.filter((r) => r.status === 'running');
        setActiveRun({ state: 'ready', value: running[0] ?? null });
        setRunningCount(running.length);
        setRecentRuns({ state: 'ready', value: runs });
      },
      () => {
        if (!alive) return;
        setActiveRun({ state: 'error' });
        setRecentRuns({ state: 'error' });
      },
    );
    return () => { alive = false; };
  }, [ds, runsTick]);
  const retryRuns = useCallback(() => setRunsTick((tick) => tick + 1), []);
  const echoStatus = echo.live?.status;
  useEffect(() => {
    if (echoStatus != null && echoStatus !== 'running') setRunsTick((tick) => tick + 1);
  }, [echoStatus]);
  useEffect(() => {
    let alive = true;
    ds.listPresence().then(
      (rows) => { if (alive) setPresence({ state: 'ready', value: rows }); },
      () => { if (alive) setPresence({ state: 'error' }); },
    );
    ds.listAgents().then(
      (rows) => { if (alive) setSpecs({ state: 'ready', value: rows }); },
      () => { if (alive) setSpecs({ state: 'error' }); },
    );
    ds.listMemory().then(
      (rows) => { if (alive) setMemory({ state: 'ready', value: rows }); },
      () => { if (alive) setMemory({ state: 'error' }); },
    );
    if (ds.listProjects == null) {
      setProjectsMissing(true);
    } else {
      ds.listProjects().then(
        (rows) => { if (alive) setProjects(rows); },
        () => { if (alive) setProjectsMissing(true); },
      );
    }
    if (ds.getCapabilities != null) {
      ds.getCapabilities().then(
        (c) => { if (alive) setFeatures(c.features); },
        () => { if (alive) setFeaturesDown(true); },
      );
    }
    const poll = () => {
      const t0 = performance.now();
      ds.getMetrics().then(
        (m) => {
          if (!alive) return;
          setRttMs(Math.round(performance.now() - t0));
          setMetrics({ state: 'ready', value: m });
          setMetricsAt(Date.now());
          if (m.cpuPct != null) setCpuTrail((t) => [...t.slice(-59), m.cpuPct!]);
          if (m.ramPct != null) setRamTrail((t) => [...t.slice(-59), m.ramPct!]);
          if (m.diskPct != null) setDiskTrail((t) => [...t.slice(-59), m.diskPct!]);
        },
        () => { if (alive) setMetrics({ state: 'error' }); },
      );
    };
    poll();
    const stopPolling = runWhileDocumentVisible(poll, 3_330);
    return () => { alive = false; stopPolling(); };
  }, [ds]);

  // Listen-карта (ref-parity P-1): микрофон → ds.voice.transcribe → текст
  // в композитор. Seam/voice отсутствует → честный disabled + причина.
  // Волна — реальный сигнал микрофона через AnalyserNode, не имитация.
  const [stt, setStt] = useState<{ supported: boolean; reason: string | null } | null>(null);
  useEffect(() => {
    if (ds.voice == null) return;
    let alive = true;
    ds.voice.stt().then(
      (s) => { if (alive) setStt({ supported: s.supported, reason: s.reason }); },
      () => { if (alive) setStt({ supported: false, reason: 'статус распознавания не получен' }); },
    );
    return () => { alive = false; };
  }, [ds]);
  // SSR-safe: при статик-экспорте сервер рендерит без navigator → false, и
  // первая клиентская гидратация обязана дать тот же текст (иначе #418 на
  // listenReason и title кнопки). Реальная проверка — после монтирования.
  const [micAvailable, setMicAvailable] = useState(false);
  useEffect(() => {
    setMicAvailable(
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices?.getUserMedia != null &&
      typeof MediaRecorder !== 'undefined',
    );
  }, []);
  const listenReason = ds.voice == null
    ? 'голосовой seam не подключён у источника'
    : !micAvailable
      ? 'браузер не даёт микрофон (нет getUserMedia/MediaRecorder)'
      : stt == null
        ? 'проверка распознавания на хосте…'
        : !stt.supported
          ? (stt.reason ?? 'распознавание недоступно на хосте')
          : null;
  const [micState, setMicState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const waveDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const waveCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const stopWave = useCallback(() => {
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    void audioCtxRef.current?.close().catch(() => { });
    audioCtxRef.current = null;
    waveDataRef.current = null;
  }, []);

  useEffect(() => () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder != null) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      if (recorder.state !== 'inactive') recorder.stop();
    }
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    stopWave();
  }, [stopWave]);

  useEffect(() => {
    if (micState !== 'recording') return;
    const canvas = waveCanvasRef.current;
    if (canvas == null) return;
    const analyser = analyserRef.current;
    const data = waveDataRef.current;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    const g = canvas.getContext('2d');
    if (g == null) return;
    const w = canvas.width;
    const h = canvas.height;
    const color = getComputedStyle(canvas).color || '#c9a45c';
    const draw = () => {
      g.clearRect(0, 0, w, h);
      if (analyser == null || data == null) {
        g.strokeStyle = color;
        g.lineWidth = Math.max(1, dpr);
        g.beginPath();
        g.moveTo(0, h / 2);
        g.lineTo(w, h / 2);
        g.stroke();
        return;
      }
      analyser.getByteTimeDomainData(data);
      const bars = 24;
      const step = Math.max(1, Math.floor(data.length / bars));
      const bw = w / bars;
      g.fillStyle = color;
      for (let i = 0; i < bars; i += 1) {
        let amp = 0;
        for (let j = 0; j < step; j += 1) amp = Math.max(amp, Math.abs(data[i * step + j] - 128) / 128);
        const bh = Math.max(2, amp * h);
        g.fillRect(i * bw + bw * 0.2, (h - bh) / 2, bw * 0.6, bh);
      }
    };
    draw();
    return analyser == null || data == null ? undefined : runAnimationFrameWhileVisible(draw);
  }, [micState]);

  const toggleListen = useCallback(async () => {
    if (micState === 'recording') {
      recorderRef.current?.stop();
      return;
    }
    if (listenReason != null || micState !== 'idle' || ds.voice == null) return;
    setVoiceError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setVoiceError('Нет доступа к микрофону — проверьте разрешение в браузере.');
      return;
    }
    micStreamRef.current = stream;
    try {
      const Ctx = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx != null) {
        const ctx = new Ctx();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.75;
        ctx.createMediaStreamSource(stream).connect(analyser);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
        waveDataRef.current = new Uint8Array(analyser.fftSize);
      }
    } catch { /* визуализация опциональна */ }
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      stopWave();
      stream.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      recorderRef.current = null;
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size === 0) { setMicState('idle'); return; }
      setMicState('transcribing');
      ds.voice!.transcribe(blob).then(
        (tr) => {
          setMicState('idle');
          const text = tr.text.trim();
          if (!text) {
            setVoiceError('Речь не распознана — запись тихая или пустая.');
            return;
          }
          setTask((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
        },
        () => {
          setMicState('idle');
          setVoiceError('Распознавание не удалось — хост не ответил.');
        },
      );
    };
    recorderRef.current = recorder;
    setMicState('recording');
    recorder.start();
  }, [ds, listenReason, micState, stopWave]);

  // Озвучка ответа модели в пузыре пользователя: тот же голосовой seam,
  // что у «Слушать ответ» на /runtime — speak() → Blob → <audio>. Второй
  // клик останавливает; текста нет → кнопка честно недоступна с причиной.
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsUrlRef = useRef<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const stopSpeak = useCallback(() => {
    ttsAudioRef.current?.pause();
    ttsAudioRef.current = null;
    if (ttsUrlRef.current != null) {
      URL.revokeObjectURL(ttsUrlRef.current);
      ttsUrlRef.current = null;
    }
    setSpeaking(false);
  }, []);
  useEffect(() => () => stopSpeak(), [stopSpeak]);

  const speakAnswer = useCallback(async () => {
    const body = echo.answer?.body;
    if (speaking) { stopSpeak(); return; }
    if (ds.voice == null || body == null || body.trim() === '') return;
    try {
      const s = await ds.voice.speak(body, profile?.voiceSpeakerId ?? undefined);
      const el = new Audio();
      ttsAudioRef.current = el;
      ttsUrlRef.current = URL.createObjectURL(s.audio);
      el.src = ttsUrlRef.current;
      el.onended = () => stopSpeak();
      setSpeaking(true);
      await el.play();
    } catch (e) {
      stopSpeak();
      setVoiceError(e instanceof Error ? e.message : 'Озвучка не прошла — хост не ответил.');
    }
  }, [ds, echo.answer, profile?.voiceSpeakerId, speaking, stopSpeak]);

  const speakReason = ds.voice == null
    ? 'голосовой seam не подключён у источника'
    : echo.answer == null
      ? 'ответ ещё не сформулирован — озвучивать нечего'
      : null;

  // VII V1.2 (NUE1) — KPI-полоса: только вычисления над живыми seam'ами.
  // Нет значения → плитка честно показывает «нет данных».
  const workingAgents =
    presence.state === 'ready'
      ? presence.value.filter((p) => p.state === 'running' || p.state === 'blocked').length
      : null;
  const doneRuns = recentRuns.state === 'ready' ? recentRuns.value.filter((r) => r.status === 'done') : null;
  const avgDurationS =
    doneRuns == null
      ? null
      : (() => {
        const spans = doneRuns
          .filter((r) => r.finishedAt != null && r.finishedAt > r.createdAt)
          .map((r) => r.finishedAt! - r.createdAt);
        return spans.length > 0 ? Math.round(spans.reduce((a, b) => a + b, 0) / spans.length) : null;
      })();
  const systemHealth =
    metrics.state === 'ready'
      ? metrics.value.health.some((h) => h.status === 'error')
        ? 'Требует внимания'
        : metrics.value.health.some((h) => h.status === 'warn')
          ? 'Есть замечания'
          : 'В норме'
      : null;

  // XV W3 — учёт хоста (задача W1 23): токены/стоимость по ассистентам
  // (GET /v1/sdk/usage/assistants) и число сессий агента (GET /v1/sdk/sessions).
  // Нет seam'а → «нет данных»; 503 (AI2_SDK_ENABLED выключен) → «нет данных»
  // с причиной verbatim в title. Нулей-заглушек не рисуем.
  const [usageTokens, setUsageTokens] = useState<KpiPart<number | null>>({ kind: 'loading' });
  const [usageCost, setUsageCost] = useState<KpiPart<number | null>>({ kind: 'loading' });
  const [sessionCount, setSessionCount] = useState<KpiPart<number | null>>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    const fail = (e: unknown) => (e instanceof Error ? e.message : 'Хост не ответил.');

    const usageSeam = ds.sdkAssistantUsage;
    if (usageSeam == null) {
      setUsageTokens({ kind: 'absent' });
      setUsageCost({ kind: 'absent' });
    } else {
      usageSeam()
        .then((u) => {
          if (!live) return;
          const rows = u.assistants;
          // Пусто → «нет данных»: нулевой расход не доказан, его не показываем.
          const tokens = rows.length === 0 ? null : sumOrNull(rows.map(
            (r) => (r.inputTokens == null && r.outputTokens == null ? null : (r.inputTokens ?? 0) + (r.outputTokens ?? 0)),
          ));
          const cost = rows.length === 0 ? null : sumOrNull(rows.map((r) => r.totalCostUsd));
          setUsageTokens({ kind: 'ready', value: tokens });
          setUsageCost({ kind: 'ready', value: cost });
        })
        .catch((e) => {
          if (!live) return;
          setUsageTokens({ kind: 'error', message: fail(e) });
          setUsageCost({ kind: 'error', message: fail(e) });
        });
    }

    const sessionsSeam = ds.sdkSessions;
    if (sessionsSeam == null) {
      setSessionCount({ kind: 'absent' });
    } else {
      sessionsSeam.list({ limit: 100 })
        .then((rows) => { if (live) setSessionCount({ kind: 'ready', value: rows.length }); })
        .catch((e) => { if (live) setSessionCount({ kind: 'error', message: fail(e) }); });
    }
    return () => { live = false; };
  }, [ds]);

  const tokensView = kpiView(usageTokens, (n) => n.toLocaleString('ru-RU'));
  const costView = kpiView(usageCost, (n) => `${n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} $`);
  const sessionsView = kpiView(sessionCount, (n) => n.toLocaleString('ru-RU'));

  // #53: карточка «Уведомления» правой колонки — те же наблюдаемые seam'ы,
  // что у колокольчика верхнего бара: ожидающие заявки (опциональный seam)
  // + последние завершённые прогоны. -1 = seam заявок отсутствует.
  const [notices, setNotices] = useState<AsyncState<{ approvals: number | null; done: RunSummary[] }>>({ state: 'loading' });
  useEffect(() => {
    let alive = true;
    const poll = () => {
      const approvalsP = ds.listApprovals != null
        ? ds.listApprovals({ status: 'pending' }).then((r) => r.length).catch(() => null)
        : Promise.resolve(null);
      Promise.all([approvalsP, ds.listRuns({ limit: 6 }).catch(() => null)]).then(([appr, runs]) => {
        if (!alive) return;
        if (runs == null) { setNotices({ state: 'error' }); return; }
        setNotices({
          state: 'ready',
          value: { approvals: appr, done: runs.filter((r) => r.finishedAt != null).slice(0, 3) },
        });
      });
    };
    poll();
    const stopPolling = runWhileDocumentVisible(poll, 45_000);
    return () => { alive = false; stopPolling(); };
  }, [ds]);

  // #53: карточка «Голос» — состояние голосового seam'а (voices + stt выше).
  // Тёмная панель по решению Yury (тёмные только поиск/композер/плеер).
  const [voiceCount, setVoiceCount] = useState<number | null>(null);
  const [voiceDown, setVoiceDown] = useState(false);
  useEffect(() => {
    // voices() — часть seam'а не обязательна: у источника без каталога
    // плитка честно покажет «нет данных», а не отвалится по исключению.
    if (ds.voice == null || typeof ds.voice.voices !== 'function') return;
    let alive = true;
    ds.voice.voices().then(
      (v) => { if (alive) setVoiceCount(v.length); },
      () => { if (alive) setVoiceDown(true); },
    );
    return () => { alive = false; };
  }, [ds]);

  async function startTask() {
    const prompt = task.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setError('');
    try {
      // Отправляем только поля, поддерживаемые RunIn; agent выбирается
      // хостом, а режим композитора остаётся локальной настройкой UI.
      const run = await ds.startRun({
        task: prompt,
        config: profile?.defaultPreset ?? 'baseline',
        model: profile?.defaultModelId ?? null,
        ...(profile?.useMemory === true
          ? { useMemory: true, project: profile?.memoryProject?.trim() || 'ai2' }
          : {}),
      });
      echo.start(run.runId, run.status, prompt);
      setRunsTick((tick) => tick + 1);
      try { sessionStorage.removeItem('nexus.composer.draft'); } catch { /* приватный режим */ }
      setTask('');
      setBusy(false);
    } catch (err) {
      setError(isAi2ApiError(err) ? `Не удалось запустить задачу: ${err.message}` : 'Не удалось запустить задачу. Проверьте подключение к рантайму и повторите попытку.');
      setBusy(false);
    }
  }

  const LegacyHomeHeading = renderAliceRoute == null ? 'h1' : 'h2';
  const legacyContent = (
    <div
      className={styles.home}
      data-screen="home"
      data-chat-active={echo.live != null ? 'true' : undefined}
      aria-labelledby="home-title"
    >
      <div className={styles.layout}>
        <section className={styles.mainColumn}>
          {/* main7: заголовок ALICE + слоган + motto слева, фигурный
              портрет героини справа (колонки перевёрнуты в CSS), шесть
              орбитальных подписей у края — декоративная ось арта.
              h1 остаётся приветствием (контракт теста A.5), крупный
              кегль — span с классом heroTitle. */}
          <AliceHero
            mode="Персональный интеллект"
            portrait={{ src: `${ASSET_BASE}/art/alice-main-hero.webp`, alt: 'Образ AGENT-A', variant: 'figure' }}
          >
            <div className={styles.greeting}>
              <span className={styles.heroTitle}>AGENT-A</span>
              <p className={styles.heroSub}>Ваш интеллектуальный рантайм.</p>
              {/* Default /home сохраняет h1; в раскрытой secondary-секции
                  Alice route этот заголовок становится h2 после hero h1. */}
              <LegacyHomeHeading id="home-title" className={echo.live == null ? styles.greetingH : styles.visuallyHidden}>{hour != null ? `${greetingOf(hour)}, ` : null}{mounted ? (profile?.name || DEFAULT_OPERATOR_NAME) : DEFAULT_OPERATOR_NAME}.</LegacyHomeHeading>
              {echo.live == null ? (
                <>
                  <p>
                    {assistant?.name ?? 'ЭЛИС'} готова помочь с вашей задачей.
                    {runningCount != null && runningCount > 0 && ` · ${runningCount} ${runningCount === 1 ? 'прогон активен' : 'прогонов активно'}`}
                  </p>
                  <div className={styles.motto}>Думать глубже.<br />Видеть дальше.<br />Создавать новое.</div>
                </>
              ) : (
                <span className={styles.chatIdentity} role="status">
                  Диалог с AGENT-A · {echo.live.status === 'running' ? 'работаю над задачей' : 'задача завершена'}
                </span>
              )}
            </div>
            {echo.live == null && (
              <div className={styles.orbitLabels} aria-hidden="true">
                {ORBIT_LABELS.map((label) => <span key={label}>{label}</span>)}
              </div>
            )}
          </AliceHero>

          {chatOpen && chatMessages.length > 0 && (
            <div className={styles.chatBubble} role="log" aria-live="polite" aria-label="Диалог с AGENT-A">
              <div className={styles.chatBubbleHeader}>
                <span className={styles.chatBubbleTitle}>Диалог с AGENT-A</span>
                <button
                  type="button"
                  className={styles.chatBubbleCollapse}
                  onClick={toggleChat}
                  aria-label="Свернуть диалог"
                  title="Свернуть"
                >
                  –
                </button>
                <button
                  type="button"
                  className={styles.chatBubbleClose}
                  onClick={clearChat}
                  aria-label="Закрыть и очистить диалог"
                  title="Закрыть и очистить"
                >
                  ×
                </button>
              </div>
              <div className={styles.chatBubbleBody}>
                {chatMessages.map((msg, idx) => (
                  <div key={idx} className={`${styles.chatBubbleMessage} ${styles[`chatBubbleMessage_${msg.role}`]}`}>
                    <span className={styles.chatBubbleRole}>{msg.role === 'user' ? 'Вы' : msg.role === 'alice' ? 'AGENT-A' : 'Ошибка'}</span>
                    <span className={styles.chatBubbleText}>{msg.text}</span>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            </div>
          )}

          <GlassPanel className={styles.composerPanel}>
            {/* main7: шесть чипов-действий над полем ввода — вставляют
                шаблон без отправки, как раньше hero-чипы. */}
            <div className={styles.actionChips} role="group" aria-label="Действия">
              {ACTION_CHIPS.map((chip) => (
                <button key={chip.label} type="button" className={styles.actionChip}
                  disabled={busy} onClick={() => setTask(chip.hint)}>
                  {chip.label}
                </button>
              ))}
            </div>
            <form onSubmit={submit} className={styles.composer}>
              <label className={styles.visuallyHidden} htmlFor="alice-task">Опишите задачу для ЭЛИС</label>
              <textarea id="alice-task" value={task} onChange={(event) => setTask(event.target.value)} placeholder="С чего начнём? Опишите задачу…" rows={2} />
              <div className={styles.composerFooter}>
                <ModeSwitch
                  value={mounted ? (profile?.composerMode ?? 'agent') : 'agent'}
                  disabled={busy}
                  onChange={(mode) => updateProfile({ composerMode: mode })}
                />
                <span>Агент: {assistant?.name ?? 'по умолчанию'}</span>
                {/* Микрофон: запись → transcribe → текст в композитор.
                    Индикация: idle / recording (pulse) / transcribing (spinner).
                    Disabled + reason когда voice-seam или mic отсутствуют. */}
                <button
                  type="button"
                  className={styles.composerMic}
                  data-mic={micState}
                  disabled={listenReason != null || micState !== 'idle'}
                  title={
                    listenReason ??
                    (micState === 'recording' ? 'Запись идёт — клик для остановки' : 'Записать задачу голосом')
                  }
                  aria-label={
                    listenReason != null
                      ? `Голос недоступен: ${listenReason}`
                      : micState === 'recording'
                        ? 'Остановить запись'
                        : micState === 'transcribing'
                          ? 'Распознавание…'
                          : 'Записать задачу голосом'
                  }
                  onClick={() => void toggleListen()}
                >
                  {micState === 'recording'
                    ? <><span className={styles.micPulse} aria-hidden="true" />Запись…</>
                    : micState === 'transcribing'
                      ? <>⏳ Распознавание…</>
                      : <>🎙 Голос</>}
                </button>
                {/* Озвучка ответа модели — та же функция, что «Слушать
                    ответ» на /runtime; иконка ▶ verbatim оттуда. */}
                <button
                  type="button"
                  className={styles.composerVoice}
                  disabled={speakReason != null}
                  title={speakReason ?? 'Озвучить ответ AGENT-A (голос — в Настройках → Runtime)'}
                  aria-label="Прослушать ответ голосом"
                  onClick={() => void speakAnswer()}
                >
                  {speaking ? '⏸ Стоп' : '▶ Слушать ответ'}
                </button>
                <Button type="submit" disabled={!task.trim() || busy}>{busy ? 'Запускаю…' : 'Запустить задачу'} <span aria-hidden="true">↗</span></Button>
              </div>
            </form>
            {error && <ErrorState variant="inline" title={error} />}
            <details className={styles.composerExtras}>
              <summary>Инструменты, шаблоны и возможности</summary>
              {/* Инструменты показываются только по запросу, чтобы основной
                  композитор соответствовал main7; состояния/действия те же. */}
              <div className={styles.starterChips} role="group" aria-label="Инструменты">
                <button
                  type="button"
                  className={styles.starterChip}
                  disabled={listenReason != null || micState !== 'idle'}
                  title={listenReason ?? 'Записать задачу голосом'}
                  onClick={() => void toggleListen()}
                >
                  Голос{listenReason != null ? ' · недоступно' : ''}
                </button>
                <Link className={styles.starterChip} href="/memory">Память</Link>
                {ds.generateImage != null ? (
                  <Link className={styles.starterChip} href="/media">Изображения</Link>
                ) : (
                  <span className={styles.starterChip} aria-disabled="true" title="Генерация изображений недоступна у источника">Изображения · нет данных</span>
                )}
                <span className={styles.starterChip} aria-disabled="true" title="Эндпоинта загрузки файлов у хоста нет">Файлы · нет данных</span>
              </div>
              <div className={styles.starterChips} role="group" aria-label="Шаблоны задач">
                {PROMPT_STARTERS.map((s) => (
                  <button key={s} type="button" className={styles.starterChip}
                    disabled={busy} onClick={() => setTask(s)}>
                    {s}
                  </button>
                ))}
              </div>
              {/* Возможности verbatim из GET /v1/capabilities. */}
              {features != null && !featuresDown && (
                <div className={styles.starterChips} role="group" aria-label="Возможности рантайма" data-testid="capability-chips">
                  {FEATURE_CHIPS.map(({ key, label, href }) => {
                    const f: Ai2Feature | undefined = features[key];
                    if (f == null) return null;
                    return f.supported ? (
                      <Link key={key} className={styles.starterChip} href={href} title={f.via ?? 'Поддерживается хостом'}>{label}</Link>
                    ) : (
                      <span key={key} className={styles.starterChip} aria-disabled="true" title={f.reason ?? 'Не поддерживается хостом'}>{label} · нет данных</span>
                    );
                  })}
                </div>
              )}
            </details>
          </GlassPanel>
          {echo.live != null && <RuntimeEcho echo={echo} onSpeak={() => void speakAnswer()} speaking={speaking} />}

          {/* XVI: «Слушаю» — запись keyed-слота home.widgets встроенного
              плагина nexus.home-widgets (JSX verbatim вынесен в
              builtin-home-widgets; отключение строки снимает блок). */}
          <SlotMount
            slot="home.widgets"
            entry="listen"
            props={{ micState, listenReason, voiceError, waveCanvasRef, onToggle: () => void toggleListen() }}
          />

          {/* main7 «Предложено для вас»: четыре сценарные карточки —
              статический каталог (не данные хоста); клик заполняет
              композитор шаблоном, отправка — только вручную. Активных
              агентов с живым присутствием показывает блок Linked Agents
              в рельсе оболочки (та же выдача listPresence). */}
          <section className={styles.suggestGrid} aria-label="Предложено для вас">
            {SUGGESTED_CARDS.map((card) => (
              <button key={card.title} type="button" className={styles.suggestCard}
                disabled={busy} onClick={() => setTask(card.prompt)}>
                <span className={styles.shortcutIcon} aria-hidden="true">{card.icon}</span>
                <strong>{card.title}</strong>
                <small>{card.text}</small>
                <i className={styles.suggestArrow} aria-hidden="true">↗</i>
              </button>
            ))}
          </section>

          {/* main7 нижний ряд: граф знаний / недавние диалоги / снимки
              памяти — только реальные seam'ы; нет источника → честный
              empty с причиной. */}
          <div className={styles.trioGrid}>
            <GlassPanel className={styles.infoPanel} data-state={memory.state} data-testid="home-knowledge">
              <div className={styles.panelHead}><h2>Граф знаний</h2><Link href="/memory">Открыть память ↗</Link></div>
              <div className={styles.kgOrb} aria-hidden="true"><i /><i /><i /></div>
              {memory.state === 'ready' ? (
                <p className={styles.railNote}>Записей памяти в окне: {memory.value.length}.</p>
              ) : memory.state === 'error' ? (
                <ErrorState variant="inline" title="Нет данных" body="память недоступна." />
              ) : (
                <PanelSkeleton hint="Читаю память…" />
              )}
              <EmptyState variant="inline" title="Связей графа нет" reason="эндпоинт графа у хоста не подключён" />
            </GlassPanel>
            <GlassPanel className={styles.infoPanel} data-state={recentRuns.state} data-testid="home-conversations">
              <div className={styles.panelHead}><h2>Недавние диалоги</h2><Link href="/runtime?tab=history">Все ↗</Link></div>
              {recentRuns.state === 'ready' ? (
                recentRuns.value.length > 0 ? (
                  <ul className={styles.convoList}>
                    {recentRuns.value.slice(0, 3).map((r) => (
                      <li key={r.runId}>
                        <Link href={`/runtime?run=${encodeURIComponent(r.runId)}`}>
                          <span>{r.taskText || r.runId}</span>
                          <small>{agoLabel(r.createdAt)} · {PROC_STATE_LABEL[r.status] ?? r.status}</small>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState variant="inline" title="Прогонов пока нет." />
                )
              ) : recentRuns.state === 'error' ? (
                <ErrorState variant="inline" title="Нет данных" body="список прогонов недоступен." />
              ) : (
                <PanelSkeleton hint="Читаю прогоны…" />
              )}
            </GlassPanel>
            <GlassPanel className={styles.infoPanel} data-state={memory.state} data-testid="home-memory">
              <div className={styles.panelHead}><h2>Снимки памяти</h2><Link href="/memory">Все ↗</Link></div>
              {memory.state === 'ready' ? (
                memory.value.length > 0 ? (
                  <ul className={styles.activity}>
                    {memory.value.slice(0, 3).map((m) => (
                      <li key={m.id}><i />{m.text.length > 90 ? `${m.text.slice(0, 90)}…` : m.text}<small>{m.project} · {agoLabel(m.createdAt)}</small></li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState variant="inline" title="Память пуста" body="записей пока нет." />
                )
              ) : memory.state === 'error' ? (
                <ErrorState variant="inline" title="Нет данных" body="память недоступна." />
              ) : (
                <PanelSkeleton hint="Читаю память…" />
              )}
            </GlassPanel>
          </div>

          {/* VII V1.2 (NUE1) → XXI: полоса KPI свернута под main7 — её
              места в раскладке нет, но данные остаются по запросу. Агенты
              в работе — /v1/processes (running|blocked); завершённые —
              /v1/runs done; среднее время — finishedAt−createdAt;
              состояние — /v1/health verbatim-слова. Промах → «нет данных». */}
          <details className={styles.kpiDetails}>
            <summary>Показатели</summary>
            <section className={styles.kpiBand} aria-label="Показатели">
              <div className={styles.kpi} data-state={presence.state}>
                <span className={styles.kpiLabel}>Агенты в работе</span>
                <strong>{presence.state === 'ready' ? workingAgents : presence.state === 'error' ? 'нет данных' : '…'}</strong>
              </div>
              <div className={styles.kpi} data-state={recentRuns.state}>
                <span className={styles.kpiLabel}>Завершённые прогоны</span>
                <strong>{doneRuns != null ? doneRuns.length : recentRuns.state === 'error' ? 'нет данных' : '…'}</strong>
              </div>
              <div className={styles.kpi} data-state={recentRuns.state}>
                <span className={styles.kpiLabel}>Среднее время прогона</span>
                <strong>
                  {recentRuns.state === 'error'
                    ? 'нет данных'
                    : avgDurationS == null
                      ? 'нет данных'
                      : avgDurationS >= 60
                        ? `${Math.floor(avgDurationS / 60)} мин ${avgDurationS % 60} с`
                        : `${avgDurationS} с`}
                </strong>
              </div>
              <div className={styles.kpi} data-state={metrics.state}>
                <span className={styles.kpiLabel}>Состояние системы</span>
                <strong>{systemHealth ?? (metrics.state === 'error' ? 'нет данных' : '…')}</strong>
              </div>
              {/* XV W3: учёт хоста — токены, стоимость, сессии агента. */}
              <div className={styles.kpi} data-state={usageTokens.kind} data-testid="kpi-tokens" title={tokensView.title}>
                <span className={styles.kpiLabel}>Токены · учёт</span>
                <strong>{tokensView.text}</strong>
              </div>
              <div className={styles.kpi} data-state={usageCost.kind} data-testid="kpi-cost" title={costView.title}>
                <span className={styles.kpiLabel}>Стоимость · учёт</span>
                <strong>{costView.text}</strong>
              </div>
              <div className={styles.kpi} data-state={sessionCount.kind} data-testid="kpi-sessions" title={sessionsView.title ?? 'До 100 последних сессий хоста'}>
                <span className={styles.kpiLabel}>Сессии агента</span>
                <strong>{sessionsView.text}</strong>
              </div>
            </section>
          </details>

          <div className={styles.lowerGrid}>
            {/* VII V1.2 (NUE1) → XVI: «Оркестрация» и «Ход работы» — записи
                keyed-слота home.widgets плагина nexus.home-widgets. */}
            <SlotMount slot="home.widgets" entry="orchestration" props={{ presence, specs }} />
            <SlotMount slot="home.widgets" entry="workflow" />
          </div>
        </section>

        <aside className={styles.rail} aria-label="Сводка рабочего пространства">
          {/* #53 (лист «Главная», «SYSTEM STATUS»): орб — декоративные
              кольца (aria-hidden), мини-бары и строка здоровья — только
              реальные проценты/компоненты из getMetrics (/v1/metrics +
              /v1/health). Полупрозрачный трек — по стеклянной механике. */}
          <GlassPanel className={styles.railPanel} data-state={metrics.state} data-testid="home-sysstatus">
            <h2>Состояние системы</h2>
            <div className={styles.statusOrbWrap} aria-hidden="true">
              <i className={styles.statusOrb} /><i className={styles.statusOrb} /><i className={styles.statusOrb} />
            </div>
            {metrics.state === 'ready' ? (
              <>
                {systemHealth != null && <p className={styles.railStatus}><i /> {systemHealth}</p>}
                {/* main7: строки «Активные прогоны» и «Отклик» — реальные
                    счётчик прогонов и RTT метрик; null → «нет данных». */}
                <p className={styles.railStatus}>Активных прогонов: {runningCount != null ? runningCount : 'нет данных'}</p>
                <p className={styles.railStatus}>Отклик метрик: {rttMs != null ? `${rttMs} мс` : 'нет данных'}</p>
                {([
                  ['CPU', metrics.value.cpuPct],
                  ['Память', metrics.value.ramPct],
                  ['Диск', metrics.value.diskPct],
                ] as const).map(([label, pct]) => (
                  <div className={styles.miniBar} key={label}>
                    <span>{label}</span>
                    <b className={styles.miniTrack}>
                      {pct != null && <i style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />}
                    </b>
                    <strong>{pct != null ? `${pct}%` : 'нет данных'}</strong>
                  </div>
                ))}
                {/* A.6: sparkline cpu% из клиентского накопителя — точка
                    каждые 30 с опроса; домен 0–100 фиксирован (auto-scale
                    врал бы на ровном следе); на старте честно «нет истории». */}
                {cpuTrail.length > 1 ? (
                  <Sparkline className={styles.sparkline} data={cpuTrail} width={120} height={28}
                    domain={[0, 100]}
                    label={`Нагрузка CPU за последние ${Math.round(cpuTrail.length * 3.33)} секунд`} />
                ) : (
                  <p className={styles.railNote}>История CPU накапливается — первая точка через 30 с.</p>
                )}
                {metricsAt != null && (
                  <p className={styles.railNote} data-testid="home-metrics-age">
                    Обновлено {(() => {
                      const sec = Math.max(0, Math.round((Date.now() - metricsAt) / 1000));
                      return sec < 60 ? `${sec} с назад` : agoLabel(Math.floor(metricsAt / 1000));
                    })()}
                  </p>
                )}
              </>
            ) : metrics.state === 'error' ? (
              <ErrorState variant="inline" title="Метрики недоступны" />
            ) : (
              <PanelSkeleton hint="Читаю метрики…" />
            )}
            <Link href="/models">Настроить ресурсы <span>↗</span></Link>
          </GlassPanel>
          {/* main7 «Сегодня»: расписания/планировщика у хоста нет
              (контракт W1) → честный empty с причиной; дата — клиентская,
              hydration-безопасная. */}
          <GlassPanel className={styles.railPanel} data-testid="home-today">
            <h2>Сегодня</h2>
            <p className={styles.railStatus}><i /> {todayLabel ?? '—'}</p>
            <EmptyState variant="inline" title="Нет данных" body="расписания и планировщика у хоста нет." />
          </GlassPanel>
          {/* Карточка ассистента — имя, образ и состояние из профиля
              (не из выдуманной телеметрии). Ассистент един — AGENT-A,
              экрана смены нет. */}
          <GlassPanel className={styles.railPanel} data-testid="home-assistant">
            <h2>Ассистент</h2>
            {assistant != null ? (
              <AssistantCard
                name={assistant.name}
                subtitle={assistant.description}
                tags={assistant.focus}
                art={PERSONA_ART[assistant.id] != null
                  ? { src: `${ASSET_BASE}${PERSONA_ART[assistant.id]!.src}`, alt: PERSONA_ART[assistant.id]!.alt }
                  : undefined}
                status="active"
                statusLabel="Активна"
                selected
              />
            ) : (
              <p className={styles.railStatus}>Ассистент среды — AGENT-A</p>
            )}
          </GlassPanel>
          {/* VII V1.4 → XVI: «Запуск сцены» — запись home.widgets/scene. */}
          <SlotMount slot="home.widgets" entry="scene" />
          <GlassPanel className={styles.railPanel} data-state={activeRun.state}>
            <h2>Сейчас</h2>
            {activeRun.state === 'ready' && activeRun.value != null ? (
              <>
                <p className={styles.railStatus}><i /> Прогон идёт</p>
                <p className={styles.railTask}>{activeRun.value.taskText}</p>
                <Link href={`/runtime?run=${encodeURIComponent(activeRun.value.runId)}`}>Открыть прогон <span>↗</span></Link>
              </>
            ) : activeRun.state === 'ready' ? (
              <>
                <EmptyState variant="inline" title="Активных прогонов нет" />
                <Link href="/runtime">Посмотреть процесс <span>↗</span></Link>
              </>
            ) : activeRun.state === 'error' ? (
              <ErrorState variant="inline" title="Состояние рантайма недоступно" />
            ) : (
              <PanelSkeleton hint="Читаю состояние…" />
            )}
          </GlassPanel>
          {/* #53 (лист «Главная»): «Уведомления» — ожидающие заявки
              (опциональный seam listApprovals) и последние завершённые
              прогоны. Seam отсутствует/упал → «нет данных», не 0. */}
          <GlassPanel className={styles.railPanel} data-state={notices.state} data-testid="home-notices">
            <h2>Уведомления</h2>
            {notices.state === 'loading' ? (
              <PanelSkeleton hint="Читаю события…" />
            ) : notices.state === 'error' ? (
              <ErrorState variant="inline" title="Нет данных" body="события недоступны." />
            ) : (
              <>
                <p className={styles.railStatus}>
                  {notices.value.approvals == null
                    ? 'Заявки на действия: нет данных — seam не подключён.'
                    : notices.value.approvals === 0
                      ? 'Заявок, ждущих решения, нет.'
                      : `Заявок ждёт решения: ${notices.value.approvals}.`}
                </p>
                {notices.value.done.length > 0 && (
                  <ul className={styles.activity}>
                    {notices.value.done.map((r) => (
                      <li key={r.runId}><i />{r.taskText || r.runId} · {r.status}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
            <Link href="/runtime?tab=bus">Открыть шину событий <span>↗</span></Link>
          </GlassPanel>
          {/* #53: «Голос» — тёмный блок (решение Yury: тёмные только
              поиск/композер/плеер). Статусы реальные: голоса из voice seam,
              распознавание из stt() выше, состояние микрофона локальное. */}
          <GlassSurface variant="card" tone="alice" className={styles.railPanel} data-state={ds.voice == null ? 'unavailable' : voiceDown ? 'error' : 'ready'} data-testid="home-voice">
            <h2>Голос</h2>
            {ds.voice == null ? (
              <EmptyState variant="inline" title="Нет данных" body="голосового контура у источника нет." />
            ) : voiceDown ? (
              <ErrorState variant="inline" title="Голосовой контур не отвечает." />
            ) : (
              <>
                <p className={styles.railStatus}>Голосов: {voiceCount != null ? voiceCount : 'нет данных'}</p>
                {/* Причину verbatim держит «Слушаю»-карта — здесь без
                    дублирования текста хоста. */}
                <p className={styles.railStatus}>
                  Распознавание: {stt == null ? 'проверяется…' : stt.supported ? 'доступно' : 'недоступно'}
                </p>
                <p className={styles.railStatus}>
                  {micState === 'recording' ? 'Идёт запись — нажмите «Слушаю», чтобы завершить.'
                    : micState === 'transcribing' ? 'Распознаю запись…'
                      : voiceError ?? 'Микрофон в режиме ожидания.'}
                </p>
              </>
            )}
          </GlassSurface>
          {/* VII V1.2 (NUE1): правая колонка эталона — Контекст / Задачи и
              план / Выводы. Контекст — производный seam listProjects; у
              источника без него панель говорит «нет данных». Выводы —
              эндпоинта артефактов у хоста нет → честный блок. */}
          <GlassPanel className={styles.railPanel} data-state={projectsMissing ? 'unavailable' : projects == null ? 'loading' : 'ready'}>
            <h2>Контекст</h2>
            {projectsMissing ? (
              <EmptyState variant="inline" title="Нет данных" body="источник не отдаёт список проектов." />
            ) : projects == null ? (
              <PanelSkeleton hint="Читаю проекты…" />
            ) : projects.length === 0 ? (
              <EmptyState variant="inline" title="Проектов пока нет." />
            ) : (
              /* X V3-3b: выбор проекта памяти — живой listProjects; клик
                 сохраняет memoryProject в профиль (влияет на startRun
                 и фильтр /memory). Это честный аналог переключателя
                 workspace эталона — данных большего у хоста нет. */
              <ul className={styles.activity}>
                {projects.slice(0, 4).map((p) => {
                  // #418 (wave #418-2): memoryProject from profile only post-mount;
                  // SSR has profile=null → 'ai2' default; stored value applies after
                  // mounted=true so the first committed frame matches SSR byte-for-byte.
                  const active = mounted && (profile?.memoryProject ?? 'ai2') === p;
                  return (
                    <li key={p}>
                      <button
                        type="button"
                        className={styles.projectPick}
                        aria-pressed={active}
                        title={active ? 'Проект памяти выбран' : 'Сделать проектом памяти'}
                        onClick={() => updateProfile({ memoryProject: p })}
                      >
                        <i />{p}{active ? ' · выбран' : ''}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </GlassPanel>
          {/* «Задачи и план» (последние прогоны) — home.widgets/recent.
              «Последние окна» шины вынесены в Runtime bus и rightbar.tabs/windows. */}
          <SlotMount slot="home.widgets" entry="recent" props={{ recentRuns }} />
          <GlassPanel className={styles.railPanel} data-state="unavailable">
            <h2>Выводы</h2>
            <EmptyState variant="inline" title="Нет данных" body="эндпоинт артефактов у хоста не подключён." />
          </GlassPanel>
          {/* XIV W3: «Сессии агента» — Claude Agent SDK сессии (kind:'sdk'),
              своя панель: список/возобновление/ветка/переименование/архив.
              Не путать с окнами шины сверху. */}
          <AgentSessionsPanel />
          <p className={styles.railNote}>Данные и действия показываются по фактическому состоянию подключённого рантайма.</p>
        </aside>
      </div>
    </div>
  );

  if (renderAliceRoute == null) return legacyContent;

  return renderAliceRoute({
    task,
    setTask,
    busy,
    error: error || null,
    startTask: () => { void startTask(); },
    agentName: assistant?.name ?? 'по умолчанию',
    // #418 (wave #418-2): SSR renders defaults; profile values apply post-mount
    operatorName: mounted ? (profile?.name || DEFAULT_OPERATOR_NAME) : DEFAULT_OPERATOR_NAME,
    greeting: hour == null
      ? 'Ваш интеллектуальный рантайм.'
      : `${greetingOf(hour)}, ${mounted ? (profile?.name || DEFAULT_OPERATOR_NAME) : DEFAULT_OPERATOR_NAME}.`,
    runningCount,
    metrics,
    recentRuns,
    retryRuns,
    latencyMs: rttMs,
    cpuTrail,
    ramTrail,
    diskTrail,
    voice: {
      enabled: speakReason == null,
      active: speaking,
      reason: speakReason,
      onToggle: () => { void speakAnswer(); },
    },
    actions: ACTION_CHIPS,
  });
}
