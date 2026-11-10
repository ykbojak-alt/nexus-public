/**
 * Telegram contract — /v1/telegram/* (W1, telegram-runtime-window-contract).
 *
 * Typed boundary: the host adapter owns TDLib + app credentials
 * (AI2_TG_API_ID/AI2_TG_API_HASH); the shell sees only DTOs and the verbatim
 * status vocabulary. When the native library or credentials are absent the
 * host reports `status: 'unavailable'` with its own reason string — the
 * screen renders it verbatim, never fabricates a connected state.
 *
 * Auth is a host-driven machine: the shell submits exactly one field per
 * `startAuth` call, chosen by the current `auth_step` — phone → code →
 * password → connected. Values are consumed at the boundary and never
 * logged or stored client-side.
 *
 * Wire snake_case → public camelCase happens in the client, as elsewhere.
 */

/** Adapter status vocabulary — verbatim, mirrors host `TelegramState`. */
export type Ai2TelegramStatus =
  | 'disconnected' | 'authorizing' | 'connected' | 'reconnecting'
  | 'locked' | 'unavailable' | 'error';

export type Ai2TelegramAuthStep = 'none' | 'phone' | 'code' | 'password';

/** GET /v1/telegram/status (public shape after client mapping). */
export interface Ai2TelegramState {
  status: Ai2TelegramStatus;
  authStep: Ai2TelegramAuthStep;
  /** Host verbatim error/reason text, secret-free. */
  error: string | null;
}

export interface Ai2TelegramChat {
  chatId: string;
  title: string;
  lastText: string;
  lastTs: number;
  unread: number;
}

export interface Ai2TelegramMessage {
  messageId: string;
  chatId: string;
  fromMe: boolean;
  text: string;
  ts: number;
}

/** POST /v1/telegram/auth — one field per call, chosen by auth_step. */
export interface Ai2TelegramAuthInput {
  phone?: string;
  code?: string;
  password?: string;
}
