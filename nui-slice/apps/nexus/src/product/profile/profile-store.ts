'use client';

import { useSyncExternalStore } from 'react';
import { createEmptyProfile, isProfileComplete, PROFILE_STORAGE_KEY } from './profile-types';
import type { UserProfile } from './profile-types';

/**
 * Browser-local profile store (page-maps §7): user-only preferences.
 * The server is never touched — runtime data stays server-side truth.
 * When localStorage is unavailable the profile lives in memory and the
 * store reports persisted=false so the UI can warn (SC-WEL-3).
 */

let profile: UserProfile | null = null;
let persisted = true;
let loaded = false;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

/**
 * Чтение хранилища различает три исхода: «профиля нет», «хранилище
 * недоступно» (приватный режим, заблокированные cookie — тогда UI обязан
 * предупредить, SC-WEL-3) и «профиль есть». Битый JSON — хранилище
 * доступно, профиля просто нет.
 */
function readStorage(): { profile: UserProfile | null; available: boolean } {
  let raw: string | null;
  try {
    raw = globalThis.localStorage?.getItem(PROFILE_STORAGE_KEY) ?? null;
  } catch {
    return { profile: null, available: false };
  }
  if (!raw) return { profile: null, available: true };
  try {
    const parsed = JSON.parse(raw) as UserProfile;
    return { profile: { ...createEmptyProfile(), ...parsed }, available: true };
  } catch {
    return { profile: null, available: true };
  }
}

export function loadProfile(): UserProfile | null {
  if (!loaded) {
    const r = readStorage();
    profile = r.profile;
    // Раньше чтение проглатывало ошибку хранилища и persisted оставался
    // true — UI не предупреждал, что профиль не переживёт перезагрузку.
    persisted = r.available;
    loaded = true;
  }
  return profile;
}

/** Returns true when the profile was written to durable storage. */
export function saveProfile(next: UserProfile): boolean {
  profile = next;
  loaded = true;
  try {
    globalThis.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(next));
    persisted = true;
  } catch {
    persisted = false;
  }
  notify();
  return persisted;
}

export function updateProfile(patch: Partial<UserProfile>): boolean {
  const base = profile ?? createEmptyProfile();
  return saveProfile({ ...base, ...patch });
}

function subscribe(fn: () => void): () => void {
  loadProfile();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot(): UserProfile | null {
  return profile;
}

function getPersistedSnapshot(): boolean {
  return persisted;
}

function getLoadedSnapshot(): boolean {
  return loaded;
}

/** Test hook — resets module state between cases (storage untouched — tests clear it themselves). */
export function resetProfileStore(): void {
  profile = null;
  persisted = true;
  loaded = false;
}

export function useProfile(): {
  profile: UserProfile | null;
  persisted: boolean;
  complete: boolean;
  /** true once the first localStorage read has run — distinguishes
   *  "no stored profile" (loaded && profile===null) from "not read yet". */
  loaded: boolean;
} {
  const p = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const ok = useSyncExternalStore(subscribe, getPersistedSnapshot, () => true);
  const l = useSyncExternalStore(subscribe, getLoadedSnapshot, () => false);
  return { profile: p, persisted: ok, complete: isProfileComplete(p), loaded: l };
}
