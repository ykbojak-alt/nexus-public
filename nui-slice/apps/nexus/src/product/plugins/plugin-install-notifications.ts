'use client';

import { useSyncExternalStore } from 'react';
import type { ToolConfirmationView } from '../screens/runtime-ops';

const STORAGE_KEY = 'nexus.plugin-install-notifications.v1';
const MAX_NOTICES = 40;

export interface PluginInstallNotice {
  runId: string;
  confirmation: ToolConfirmationView;
  decision: 'allow' | 'deny' | 'defer' | null;
  message: string | null;
  outcome: 'installed' | 'error' | null;
  pluginId: string | null;
  enabledNow: boolean;
}

export interface PluginInstallNotificationPreferences {
  soundEnabled: boolean;
  badgeEnabled: boolean;
}

const DEFAULT_PREFERENCES: PluginInstallNotificationPreferences = {
  soundEnabled: false,
  badgeEnabled: true,
};
const EMPTY_NOTICES: PluginInstallNotice[] = [];

let notices: PluginInstallNotice[] = [];
let noticesSnapshot = notices;
let preferenceSnapshot: PluginInstallNotificationPreferences | null = null;
let audioContext: AudioContext | null = null;
const listeners = new Set<() => void>();

const emit = () => {
  noticesSnapshot = notices;
  for (const listener of listeners) listener();
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPluginInstallNotices(): PluginInstallNotice[] {
  return noticesSnapshot;
}

export function usePluginInstallNotices(): PluginInstallNotice[] {
  return useSyncExternalStore(subscribe, getPluginInstallNotices, () => EMPTY_NOTICES);
}

/** Публикует снимок уведомлений прогона. Используется plugin-install-sync —
 *  тяжёлый парсинг (runtime-ops) живёт там, чтобы не тянуть его в shared-бандл. */
export function publishPluginInstallRun(runId: string, nextRun: PluginInstallNotice[]): void {
  notices = [
    ...notices.filter((notice) => notice.runId !== runId),
    ...nextRun,
  ].slice(-MAX_NOTICES);
  emit();
}

export function updatePluginInstallNotice(
  runId: string,
  callId: string,
  patch: Partial<Pick<PluginInstallNotice, 'decision' | 'message' | 'outcome' | 'pluginId' | 'enabledNow'>>,
  state?: string,
): void {
  notices = notices.map((notice) => notice.runId === runId && notice.confirmation.callId === callId
    ? {
        ...notice,
        ...patch,
        confirmation: state == null ? notice.confirmation : { ...notice.confirmation, state },
      }
    : notice);
  emit();
}

function readPreferences(): PluginInstallNotificationPreferences {
  if (preferenceSnapshot != null) return preferenceSnapshot;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw != null) {
      const stored = JSON.parse(raw) as Partial<PluginInstallNotificationPreferences>;
      preferenceSnapshot = {
        soundEnabled: stored.soundEnabled === true,
        badgeEnabled: stored.badgeEnabled !== false,
      };
      return preferenceSnapshot;
    }
  } catch { /* storage may be blocked; in-memory defaults remain usable */ }
  preferenceSnapshot = DEFAULT_PREFERENCES;
  return preferenceSnapshot;
}

export function getPluginInstallNotificationPreferences(): PluginInstallNotificationPreferences {
  return typeof window === 'undefined' ? DEFAULT_PREFERENCES : readPreferences();
}

export function usePluginInstallNotificationPreferences(): PluginInstallNotificationPreferences {
  return useSyncExternalStore(
    subscribe,
    getPluginInstallNotificationPreferences,
    () => DEFAULT_PREFERENCES,
  );
}

export function setPluginInstallNotificationPreference(
  key: keyof PluginInstallNotificationPreferences,
  value: boolean,
): void {
  const current = getPluginInstallNotificationPreferences();
  preferenceSnapshot = { ...current, [key]: value };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferenceSnapshot));
  } catch { /* preference continues for this page lifetime */ }
  emit();
}

export function preparePluginInstallSound(): void {
  if (typeof window === 'undefined') return;
  try {
    const Constructor = window.AudioContext
      ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Constructor == null) return;
    audioContext ??= new Constructor();
    if (audioContext.state === 'suspended') void audioContext.resume().catch(() => undefined);
  } catch { /* browser may deny audio; the notification badge still works */ }
}

export function playPluginInstallSound(): void {
  if (typeof window === 'undefined' || audioContext == null || audioContext.state !== 'running') return;
  try {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, now);
    oscillator.frequency.setValueAtTime(660, now + 0.09);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.19);
  } catch { /* sound is optional and never blocks a confirmation */ }
}

export function pendingPluginInstallNoticeCount(list = noticesSnapshot): number {
  return list.filter((notice) =>
    notice.outcome == null
    && notice.decision !== 'deny'
    && notice.confirmation.state !== 'resolved',
  ).length;
}

export function activeRunIdFromLocation(): string | null {
  if (typeof window === 'undefined' || window.location.pathname !== '/runtime') return null;
  const value = new URLSearchParams(window.location.search).get('run');
  return value == null || value === '' ? null : value;
}
