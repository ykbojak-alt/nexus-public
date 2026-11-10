/**
 * Voice contract — GET /v1/voice/voices + POST /v1/voice/tts (W1 voice,
 * server app.py voice section, engine ai2/voice.py).
 *
 * TTS is cloud: the host renders the voice with Fish Audio (the AGENT-A
 * voice), so the text leaves the host and a provider key is required.
 * `available` is the server's own verdict per voice (provider key present) —
 * the shell lists what the host reports, never fabricates a voice. When the
 * seam is off (`capabilities.features.voice.supported === false`) the reason
 * string is the host's, rendered verbatim.
 *
 * Wire snake_case → public camelCase happens in the client, as elsewhere.
 */

export interface Ai2Voice {
  /** Voice id accepted by POST /v1/voice/tts (`voice` field). */
  id: string;
  /** Engine that renders this voice: fish (cloud Fish Audio). */
  engine: string;
  /** RU display label from the host (verbatim). */
  label: string;
  /** EN display label from the host (verbatim). */
  labelEn: string;
  /** Host verdict: the voice can be rendered (provider key present). */
  available: boolean;
  /** Host's own reason when unavailable (e.g. missing provider key); rendered verbatim. */
  reason: string | null;
}

/** Host STT status block in GET /v1/voice/voices (wave-7 — faster-whisper). */
export interface Ai2SttStatus {
  supported: boolean;
  /** Host's own reason string when unsupported; rendered verbatim. */
  reason: string | null;
  /** e.g. 'faster-whisper:base:cpu' — present only when supported. */
  model?: string;
}

/** GET /v1/voice/voices response (public shape after client mapping). */
export interface Ai2VoiceCatalog {
  voices: Ai2Voice[];
  /** Server default voice id (env AI2_VOICE_SPEAKER). */
  defaultVoice: string;
  /** Container formats this host can emit, preferred first. */
  formats: string[];
  defaultFormat: string;
  /** Speech-to-text availability on the same host. */
  stt: Ai2SttStatus;
}

/** POST /v1/voice/stt response — local faster-whisper transcription. */
export interface Ai2Transcript {
  text: string;
  /** Detected/pinned language code; null when the host did not report one. */
  language: string | null;
  languageProbability: number;
  durationS: number;
  /** Engine descriptor reported by the host, e.g. 'faster-whisper:base:cpu'. */
  model: string | null;
}

/** POST /v1/voice/tts request body (wire snake_case at the boundary). */
export interface Ai2TtsInput {
  text: string;
  /** Voice id from the catalog; omitted → server default. */
  voice?: string;
  /** 'ogg' | 'wav'; omitted → host default format. */
  format?: string;
}

/** POST /v1/voice/tts response (public shape). */
export interface Ai2Speech {
  /** Base64-encoded audio container; decode → Blob for playback. */
  audioB64: string;
  /** audio/ogg | audio/wav — matches the emitted container. */
  mime: string;
  /** Decoded audio size in bytes (host-reported). */
  bytes: number;
  /** Voice actually used (post default-resolution). */
  voice: string;
  /** Request text length accepted by the synthesizer. */
  chars: number;
  /** Host verdict: bytes came from the on-disk TTS cache, not a fresh
   *  synthesis. Reported verbatim — the shell never infers it. */
  cached?: boolean;
}
