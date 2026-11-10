'use client';

/** Вкладка «Процесс» — голосовой контур (wave-7): микрофон → STT хоста,
 * TTS-озвучка ответов, линия записи. Выделено из runtime.tsx без смены
 * поведения; состояния и тексты verbatim. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunSummary } from '@nexus/mock-data';
import type { Ai2SttStatus } from '../../../integrations/ai2/contracts/voice';
import type { ProductDataSource } from '../../data-source';
import { runAnimationFrameWhileVisible } from '../../visible-interval';

export type ProcessVoiceOpts = {
  ds: ProductDataSource;
  speakerId: string | null | undefined;
  autoSpeak: boolean;
  task: string;
  setTask: (t: string) => void;
  submitting: boolean;
  run: RunSummary | null;
  answers: Record<string, string | null>;
  setAnswers: React.Dispatch<React.SetStateAction<Record<string, string | null>>>;
  /** Отправка распознанного текста прогоном (или в черновик, если прогон идёт). */
  onSubmit: (merged: string) => void;
};

export function useProcessVoice({
  ds, speakerId, autoSpeak, task, setTask, submitting, run, answers, setAnswers, onSubmit,
}: ProcessVoiceOpts) {
  const [stt, setStt] = useState<Ai2SttStatus | null>(null);
  const [micState, setMicState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  // Озвучка ответа: id пузыря, состояние паузы и позиция для полоски
  // воспроизведения под ответом (управляемая — пауза/seek/стоп).
  const [speaking, setSpeaking] = useState<{
    id: string; paused: boolean; pos: number; dur: number;
  } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const waveDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const waveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  // Сессионный кэш озвученных ответов: повторное «Слушать» отдаёт Blob
  // без запроса к хосту. Дисковый кэш сервера (tts_cache) — дurable-слой;
  // этот Map — чтобы вообще не было сетевого вызова на replay.
  const audioCacheRef = useRef<Map<string, { audio: Blob; mime: string }>>(new Map());
  const spokenRunsRef = useRef<Set<string>>(new Set());
  const runningSeenRef = useRef<Set<string>>(new Set());

  useEffect(() => () => {
    if (copiedTimerRef.current != null) window.clearTimeout(copiedTimerRef.current);
  }, []);

  useEffect(() => {
    if (ds.voice == null) {
      setStt({ supported: false, reason: 'голосовой seam не подключён в этом источнике данных' });
      return;
    }
    let live = true;
    ds.voice.stt().then(
      (s) => { if (live) setStt(s); },
      () => { if (live) setStt({ supported: false, reason: 'статус распознавания не получен от хоста' }); });
    return () => { live = false; };
  }, [ds]);

  const stopAudio = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (audioUrlRef.current != null) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setSpeaking(null);
  }, []);

  const speakText = useCallback(async (text: string, msgId: string) => {
    if (ds.voice == null || !text.trim()) return;
    try {
      const cacheKey = `${msgId}:${speakerId ?? 'default'}`;
      let blob = audioCacheRef.current.get(cacheKey);
      if (blob == null) {
        const s = await ds.voice.speak(text, speakerId ?? undefined);
        blob = { audio: s.audio, mime: s.mime };
        const cache = audioCacheRef.current;
        cache.set(cacheKey, blob);
        while (cache.size > 20) {
          const oldest = cache.keys().next().value;
          if (oldest == null) break;
          cache.delete(oldest);
        }
      } else {
        // LRU-touch: свежие записи вытесняются последними.
        audioCacheRef.current.delete(cacheKey);
        audioCacheRef.current.set(cacheKey, blob);
      }
      stopAudio();
      const el = new Audio();
      audioRef.current = el;
      audioUrlRef.current = URL.createObjectURL(blob.audio);
      el.src = audioUrlRef.current;
      el.ontimeupdate = () =>
        setSpeaking((p) => (p?.id === msgId ? { ...p, pos: el.currentTime } : p));
      el.ondurationchange = () =>
        setSpeaking((p) => (p?.id === msgId && Number.isFinite(el.duration) ? { ...p, dur: el.duration } : p));
      el.onended = stopAudio;
      setSpeaking({ id: msgId, paused: false, pos: 0, dur: 0 });
      await el.play();
      // duration часто известна только после первых кадров — подхватим сразу
      if (Number.isFinite(el.duration)) {
        setSpeaking((p) => (p?.id === msgId ? { ...p, dur: el.duration } : p));
      }
    } catch (e) {
      setSpeaking(null);
      setVoiceError(e instanceof Error ? e.message : 'Озвучка не прошла — хост не ответил.');
    }
  }, [ds, speakerId, stopAudio]);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (el == null) return;
    if (el.paused) {
      void el.play();
      setSpeaking((p) => (p ? { ...p, paused: false } : p));
    } else {
      el.pause();
      setSpeaking((p) => (p ? { ...p, paused: true } : p));
    }
  }, []);

  const seekAudio = useCallback((sec: number) => {
    const el = audioRef.current;
    if (el == null || !Number.isFinite(el.duration)) return;
    el.currentTime = Math.min(Math.max(0, sec), el.duration);
    setSpeaking((p) => (p ? { ...p, pos: el.currentTime } : p));
  }, []);

  // Clipboard: navigator.clipboard требует secure context (localhost — secure,
  // в WebView2 доступен); fallback — execCommand через временный textarea.
  // Оба пути сорвались — честная ошибка, а не молчание.
  const copyAnswer = useCallback(async (id: string, text: string) => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch { ok = false; }
    }
    if (ok) {
      setCopiedId(id);
      if (copiedTimerRef.current != null) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(() => {
        copiedTimerRef.current = null;
        setCopiedId((c) => (c === id ? null : c));
      }, 1500);
    } else {
      setVoiceError('Буфер обмена недоступен в этом окружении.');
    }
  }, []);

  // Mic capture → host STT → composer text. Permission errors surface
  // verbatim; MediaRecorder/webm is what the host decodes (PyAV).
  // SSR-safe (см. home.tsx): сервер без navigator → false, первая гидратация
  // обязана совпасть с серверным текстом; реальная проверка — после
  // монтирования, до неё micReason честно говорит «нет getUserMedia».
  const [micAvailable, setMicAvailable] = useState(false);
  useEffect(() => {
    setMicAvailable(
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices?.getUserMedia != null &&
      typeof MediaRecorder !== 'undefined',
    );
  }, []);
  const micReason = !micAvailable
    ? 'браузер не даёт микрофон (нет getUserMedia/MediaRecorder)'
    : stt == null
      ? 'проверка распознавания на хосте…'
      : !stt.supported
        ? (stt.reason ?? 'распознавание недоступно на хосте')
        : null;

  const stopWave = useCallback(() => {
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    void audioCtxRef.current?.close().catch(() => { });
    audioCtxRef.current = null;
    waveDataRef.current = null;
  }, []);

  // Линия звукозаписи: пока идёт запись, canvas вместо поля ввода рисует
  // форму сигнала с микрофона (getByteTimeDomainData). Нет анализатора —
  // одна честная средняя линия, не имитация пульса.
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
    const color = getComputedStyle(canvas).color || '#3FB950';
    const draw = () => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = color;
      g.lineJoin = 'round';
      if (analyser == null || data == null) {
        g.lineWidth = Math.max(1, dpr);
        g.beginPath();
        g.moveTo(0, h / 2);
        g.lineTo(w, h / 2);
        g.stroke();
        return; // плоская линия — без ложного «живого» сигнала
      }
      analyser.getByteTimeDomainData(data);
      g.lineWidth = 2 * dpr;
      g.beginPath();
      const step = w / data.length;
      for (let i = 0; i < data.length; i += 1) {
        const y = h / 2 + ((data[i] - 128) / 128) * (h / 2 - 2 * dpr);
        if (i === 0) g.moveTo(0, y); else g.lineTo(i * step, y);
      }
      g.stroke();
    };
    draw();
    return analyser == null || data == null ? undefined : runAnimationFrameWhileVisible(draw);
  }, [micState]);

  const toggleMic = useCallback(async () => {
    if (micState === 'recording') {
      recorderRef.current?.stop();
      return;
    }
    if (micReason != null || micState !== 'idle' || ds.voice == null) return;
    setVoiceError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setVoiceError('Нет доступа к микрофону — проверьте разрешение в браузере.');
      return;
    }
    micStreamRef.current = stream;
    // Осциллограмма записи: AnalyserNode на том же стриме, что пишет
    // MediaRecorder — линия рисует реальный входной сигнал, не имитацию.
    // Источник не подключается к destination (самопрослушки нет). Если
    // AudioContext недоступен — запись/STT работают без визуализации.
    try {
      const Ctx = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx != null) {
        const ctx = new Ctx();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
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
          const text = tr.text.trim();
          if (!text) {
            setVoiceError('Речь не распознана — запись тихая или пустая.');
            return;
          }
          // Голос = руки свободны: распознанный текст уходит прогоном сразу,
          // без клика по «Запустить». Типизированный черновик дописывается
          // в начало задачи (append-семантика прежнего ввода в композитор).
          const merged = task.trim() ? `${task.trim()} ${text}` : text;
          onSubmit(merged);
        },
        (e) => setVoiceError(e instanceof Error ? `Хост: ${e.message}` : 'Распознавание недоступно.'),
      ).finally(() => setMicState('idle'));
    };
    recorderRef.current = recorder;
    recorder.start();
    setMicState('recording');
  }, [ds, micReason, micState, task, stopWave, onSubmit]);

  // Terminal run → fetch the stored answer for its bubble, then auto-speak
  // it when enabled. Only runs observed running in this session qualify —
  // attaching to an old finished run never starts audio unprompted.
  useEffect(() => {
    if (run == null) return;
    if (run.status === 'running') {
      runningSeenRef.current.add(run.runId);
      return;
    }
    if (ds.getRunDetail == null || answers[run.runId] !== undefined) return;
    const runId = run.runId;
    let live = true;
    ds.getRunDetail(runId).then(
      (d) => {
        const answer = d?.result?.answer?.trim() || null;
        if (!live) return;
        setAnswers((prev) => ({ ...prev, [runId]: answer }));
        if (
          answer != null &&
          autoSpeak &&
          ds.voice != null &&
          runningSeenRef.current.has(runId) &&
          !spokenRunsRef.current.has(runId)
        ) {
          spokenRunsRef.current.add(runId);
          void speakText(answer, `a-${runId}`);
        }
      },
      () => {
        if (!live) return;
        setAnswers((prev) => ({ ...prev, [runId]: null }));
        if (autoSpeak) setVoiceError('Ответ не загружен — озвучивать нечего.');
      },
    );
    return () => { live = false; };
  }, [run?.runId, run?.status, ds, answers, autoSpeak, speakText]);

  useEffect(() => () => {
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    recorderRef.current?.stop();
    stopWave();
  }, [stopWave]);

  return {
    micState, voiceError, speaking, copiedId, waveCanvasRef, micReason,
    toggleMic, stopAudio, speakText, togglePlay, seekAudio, copyAnswer,
  };
}
