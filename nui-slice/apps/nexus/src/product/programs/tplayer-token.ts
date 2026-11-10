'use client';

/**
 * Токен TPlayer (ENGINE контур) — same-origin прокси /api/tplayer → :8786.
 * Серверный прокси требует заголовок X-Nexus-TPlayer (token-auth включён).
 * Токен хранится локально в localStorage `nexus.tplayer.token`; поле в
 * Профиле (Настройки) синкается сюда при обращении к экрану TPlayer.
 */
const TPLAYER_TOKEN_STORAGE_KEY = 'nexus.tplayer.token';

export function getTPlayerToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(TPLAYER_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setTPlayerToken(value: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) window.localStorage.setItem(TPLAYER_TOKEN_STORAGE_KEY, value);
    else window.localStorage.removeItem(TPLAYER_TOKEN_STORAGE_KEY);
  } catch {
    // приватный режим / quota — токен не обязателен для каталога archive.org
  }
}

export function syncTPlayerTokenFromProfile(profileToken: string | null | undefined): void {
  if (profileToken) setTPlayerToken(profileToken);
}
