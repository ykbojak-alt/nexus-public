// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProfile, isProfileComplete, PROFILE_STORAGE_KEY } from './profile-types';
import { loadProfile, resetProfileStore, saveProfile, updateProfile, useProfile } from './profile-store';

describe('profile-store', () => {
  beforeEach(() => {
    resetProfileStore();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('starts with no profile', () => {
    expect(loadProfile()).toBeNull();
  });

  it('persists to localStorage and reads back', () => {
    const p = { ...createEmptyProfile(), name: 'Оператор', themeId: 'forge' };
    expect(saveProfile(p)).toBe(true);
    resetProfileStore();
    const loaded = loadProfile();
    expect(loaded?.name).toBe('Оператор');
    expect(loaded?.themeId).toBe('forge');
  });

  it('keeps defaults for fields absent in stored json', () => {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ name: 'X' }));
    const loaded = loadProfile();
    expect(loaded?.density).toBe('standard');
    expect(loaded?.favoritePrompts).toEqual([]);
    // Wave-7 runtime defaults — profiles written before the fields existed.
    expect(loaded?.defaultRunAgent).toBeNull();
    expect(loaded?.voiceSpeakerId).toBeNull();
    expect(loaded?.voiceAutoSpeak).toBe(false);
    // M2 memory defaults — ON: corpus seeded (M1) + live run verified (M3).
    expect(loaded?.useMemory).toBe(true);
    expect(loaded?.memoryProject).toBe('ai2');
  });

  it('persists runtime/voice preferences via updateProfile', () => {
    updateProfile({ defaultRunAgent: 'coder', voiceSpeakerId: 'fish', voiceAutoSpeak: true });
    const loaded = loadProfile();
    expect(loaded?.defaultRunAgent).toBe('coder');
    expect(loaded?.voiceSpeakerId).toBe('fish');
    expect(loaded?.voiceAutoSpeak).toBe(true);
  });

  it('persists memory preferences via updateProfile (M2)', () => {
    updateProfile({ useMemory: true, memoryProject: 'corp-docs' });
    const loaded = loadProfile();
    expect(loaded?.useMemory).toBe(true);
    expect(loaded?.memoryProject).toBe('corp-docs');
  });

  it('updateProfile merges into empty base', () => {
    updateProfile({ name: 'Y' });
    expect(loadProfile()?.name).toBe('Y');
  });

  it('falls back to memory profile when storage throws, reports persisted=false', () => {
    vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(saveProfile({ ...createEmptyProfile(), name: 'Z' })).toBe(false);
    expect(loadProfile()?.name).toBe('Z');
  });

  it('недоступное хранилище при чтении: профиль в памяти, persisted=false', () => {
    // Приватный режим / заблокированные cookie: getItem бросает, а не
    // возвращает null — UI обязан знать, что профиль не переживёт reload.
    vi.spyOn(globalThis.localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    resetProfileStore();
    expect(loadProfile()).toBeNull();
    const { result } = renderHook(() => useProfile());
    expect(result.current.persisted).toBe(false);
    expect(result.current.profile).toBeNull();
  });

  it('битый JSON в хранилище — хранилище доступно, профиля нет', () => {
    localStorage.setItem(PROFILE_STORAGE_KEY, '{не json');
    resetProfileStore();
    expect(loadProfile()).toBeNull();
    const { result } = renderHook(() => useProfile());
    expect(result.current.persisted).toBe(true);
  });

  it('isProfileComplete requires a non-empty name', () => {
    expect(isProfileComplete(null)).toBe(false);
    expect(isProfileComplete(createEmptyProfile())).toBe(false);
    expect(isProfileComplete({ ...createEmptyProfile(), name: '  ' })).toBe(false);
    expect(isProfileComplete({ ...createEmptyProfile(), name: 'Op' })).toBe(true);
  });
});
