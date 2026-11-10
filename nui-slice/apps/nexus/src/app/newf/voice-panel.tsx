'use client';

/**
 * VoicePanel — voice-loop UI для NEWF (#374), полировка #372.
 *
 * Встроенная (не плавающая) панель: рендерится гейтом в потоке shell,
 * не перекрывает терминалы. Открытие/закрытие — через VoiceUiContext
 * (кнопка в тулбаре/шапке экрана). Состояния recording/transcribing/error
 * видны в панели.
 *
 * Пути идут через мост (прокси /voice/*), чтобы static export :3322
 * обходил отсутствующий CORS у движка :8798 и не зависел от прямого адреса.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useVoiceUi } from '../../product/screens/voice-ui';
import styles from './voice-panel.module.css';

interface VoicePanelProps {
  /** Базовый URL моста (http://127.0.0.1:8471). Пусто → панель отключена. */
  bridgeBase?: string;
}

type MicState = 'idle' | 'recording' | 'transcribing';

const TTS_VOICE = 'olga';
const TTS_MODEL = 'qwen-base';
const STT_ENDPOINT = '/voice/v1/voice/stt';
const TTS_ENDPOINT = '/voice/v1/audio/speech';

function cleanBase(base: string): string {
  return base.replace(/\/$/, '');
}

export function VoicePanel({ bridgeBase }: VoicePanelProps) {
  const voiceUi = useVoiceUi();
  const active = Boolean(bridgeBase?.trim());
  const base = active ? cleanBase(bridgeBase!) : '';
  const open = voiceUi.open;

  const [text, setText] = useState('');
  const [micState, setMicState] = useState<MicState>('idle');
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sttStatus, setSttStatus] = useState<'unknown' | 'checking' | 'ok' | 'down'>('unknown');
  const [micAvailable, setMicAvailable] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setMicAvailable(
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices?.getUserMedia != null &&
      typeof MediaRecorder !== 'undefined',
    );
  }, []);

  const probeStt = useCallback(async () => {
    if (!base) return;
    try {
      const res = await fetch(base + STT_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Blob([], { type: 'application/octet-stream' }),
      });
      setSttStatus(res.status === 502 || res.status === 404 ? 'down' : 'ok');
    } catch {
      setSttStatus('down');
    }
  }, [base]);

  useEffect(() => {
    if (!base || !open) return;
    setSttStatus('checking');
    void probeStt();
    const t = setInterval(() => void probeStt(), 30000);
    return () => clearInterval(t);
  }, [base, probeStt, open]);

  const stopMic = useCallback(() => {
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => () => {
    stopMic();
    audioRef.current?.pause();
    audioRef.current = null;
  }, [stopMic]);

  const toggleMic = useCallback(async () => {
    if (micState === 'recording') {
      recorderRef.current?.stop();
      return;
    }
    if (!base || micState !== 'idle') return;
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Нет доступа к микрофону — проверьте разрешение в браузере.');
      return;
    }
    micStreamRef.current = stream;
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      stopMic();
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size === 0) { setMicState('idle'); return; }
      setMicState('transcribing');
      fetch(base + STT_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': blob.type || 'application/octet-stream' },
        body: blob,
      }).then(async (res) => {
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`STT ${res.status}: ${body.slice(0, 140)}`);
        }
        const js = await res.json() as { text?: unknown };
        const transcript = typeof js.text === 'string' ? js.text.trim() : '';
        if (!transcript) throw new Error('Речь не распознана — запись тихая или пустая.');
        setText(transcript);
      }).catch((e) => {
        setError(e instanceof Error ? e.message : 'Распознавание недоступно.');
      }).finally(() => {
        setMicState('idle');
      });
    };
    recorderRef.current = recorder;
    recorder.start();
    setMicState('recording');
  }, [base, micState, stopMic]);

  const speak = useCallback(async () => {
    const phrase = text.trim();
    if (!phrase || !base || speaking) return;
    setSpeaking(true);
    setError(null);
    try {
      const res = await fetch(base + TTS_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: TTS_MODEL, input: phrase, voice: TTS_VOICE, response_format: 'wav' }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`TTS ${res.status}: ${body.slice(0, 140)}`);
      }
      const blob = await res.blob();
      audioRef.current?.pause();
      await new Promise<void>((resolve) => {
        const audio = new Audio();
        audioRef.current = audio;
        audio.src = URL.createObjectURL(blob);
        audio.onended = () => { URL.revokeObjectURL(audio.src); audioRef.current = null; resolve(); };
        audio.onerror = () => { URL.revokeObjectURL(audio.src); audioRef.current = null; resolve(); };
        void audio.play();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Озвучка не прошла — хост не ответил.');
    } finally {
      setSpeaking(false);
    }
  }, [base, text, speaking]);

  const micLabel =
    micState === 'recording' ? 'Стоп' :
    micState === 'transcribing' ? '…' : 'Микрофон';
  const sttLabel =
    sttStatus === 'checking' ? 'STT…' :
    sttStatus === 'ok' ? 'STT live' :
    sttStatus === 'down' ? 'STT offline' : 'STT';

  if (!active) return null;
  if (!open) return null;

  return (
    <div className={styles.panel} role="dialog" aria-label="Голосовая панель" data-testid="newf-voice-panel">
      <div className={styles.header}>
        <span>Voice-loop</span>
        <span
          className={`${styles.status} ${sttStatus === 'ok' ? styles.statusOk : sttStatus === 'down' ? styles.statusWarn : ''}`}
          role="status"
        >
          {sttLabel}
        </span>
        <button type="button" className={styles.button} style={{ flex: '0 0 auto', padding: '2px 8px' }} onClick={() => voiceUi.setOpen(false)} aria-label="Свернуть">
          ✕
        </button>
      </div>

      <textarea
        className={styles.textarea}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Текст (распознанная речь или вручную)"
        aria-label="Текст для озвучки"
        data-testid="newf-voice-text"
      />

      <div className={styles.row}>
        <button
          type="button"
          className={`${styles.button} ${styles.mic} ${micState === 'recording' ? styles.micRecording : ''}`}
          onClick={() => void toggleMic()}
          disabled={micState === 'transcribing' || !micAvailable || !base}
          aria-label={
            micState === 'recording' ? 'Микрофон: остановить запись'
              : micState === 'transcribing' ? 'Микрофон: идёт распознавание'
                : 'Микрофон: начать запись'
          }
          aria-pressed={micState === 'recording'}
          title={!micAvailable ? 'Браузер не даёт микрофон' : undefined}
          data-testid="newf-voice-mic"
        >
          {micLabel}
        </button>
        <button type="button" className={styles.button} onClick={() => void speak()} disabled={speaking || !text.trim() || !base} aria-label="Озвучить текст" data-testid="newf-voice-speak">
          {speaking ? '…' : 'Озвучить'}
        </button>
      </div>

      {error && <div className={styles.error} role="alert" data-testid="newf-voice-error">{error}</div>}
      <div className={styles.note}>
        text→voice: локальный TTS Higgs/Olga · mic→text: Whisper/STT через мост
      </div>
    </div>
  );
}
