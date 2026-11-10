// Общий харнесс runtime-экрана: моки next/navigation и data-source,
// seam-флаги и сброс состояния. Выделено из runtime.test.tsx при сплите
// экрана (wave-XVI) — поведение тестов не меняется.
import { cleanup } from '@testing-library/react';
import { useMemo } from 'react';
import { afterEach, beforeEach, vi } from 'vitest';
import { resetWarmRuntime } from '../../runtime-warmup';
import type { HandoffLink, PresenceEntry } from '@nexus/patterns';

export const navSearch = { raw: 'tab=process' };
vi.mock('next/navigation', () => ({
  usePathname: () => '/runtime',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navSearch.raw),
}));

export const startRun = vi.fn();
export const cancelRun = vi.fn();
export const listRuns = vi.fn();
export const listApprovals = vi.fn();
export const respondApproval = vi.fn();
export const previewRunPlan = vi.fn();
export const getRunControls = vi.fn();
export const pauseRun = vi.fn();
export const resumeRun = vi.fn();
export const replayRun = vi.fn();
export const checkpointRun = vi.fn();
export const retryRun = vi.fn();
export const streamRun = vi.fn(
  (_runId?: string, _cb?: {
    onEvent: (e: unknown) => void;
    onEnd: (s: string) => void;
    onGap?: (p: boolean) => void;
    onDelta?: (text: string) => void;
  }) =>
    () => { },
);
export const getRunDetail = vi.fn();
export const voiceStt = vi.fn(() => Promise.resolve({ supported: true, reason: null }));
export const voiceTranscribe = vi.fn();
export const voiceSpeak = vi.fn();
export const fsValidate = vi.fn();
export const fsRequests = vi.fn(() => Promise.resolve([] as { id: string; status: string }[]));
export const fsApprove = vi.fn();
export const fsDeny = vi.fn();
// runtime-wave2 A2/B5: overview + scene-chip seams.
export const listPresence = vi.fn(() => Promise.resolve([] as PresenceEntry[]));
export const listHandoffs = vi.fn(() => Promise.resolve([] as HandoffLink[]));
export const getUsage = vi.fn();
export const getMetrics = vi.fn();
export const listModels = vi.fn(() => Promise.resolve([]));
export const sceneGetState = vi.fn();
export const getChatCompactionStatus = vi.fn();
export const chatCompact = vi.fn();
export const getChatHistory = vi.fn();
// Default mirrors the live adapter when the executor declares no window —
// a bare vi.fn() would return undefined and break the typed Promise seam.
export const getChatCompactionConfig = vi.fn(() => Promise.resolve({
  windowTokens: null as number | null,
  reserveTokens: 16000,
  keepTokens: 15000,
  thresholdTokens: null as number | null,
}));
export const busListSessions = vi.fn();
export const busDelegateTask = vi.fn();
export const busGetDelegation = vi.fn();
// Волна XII/XIV: ответ на SDK-подтверждение + список открытых карточек —
// seam'ы опциональны (за AI2_SDK_ENABLED на хосте).
export const respondToolConfirmation = vi.fn();
export const listToolConfirmations = vi.fn(() => Promise.resolve([] as unknown[]));
// Optional-seam toggles: absent seam → UI must render `unavailable`/hidden,
// never fabricate. Tests flip them before render.
export const seams = { plan: false, controls: false, detail: false, voice: false, fs: false, scene: false, bus: false, confirm: false, compaction: false, history: false };
export const listPresets = vi.fn(() => Promise.resolve([]));
export const listAgents = vi.fn(() => Promise.resolve([]));
const HARN_DS = () => ({
    listPresets,
    listAgents,
    listRuns,
    startRun,
    cancelRun,
    streamRun,
    listApprovals,
    respondApproval,
    ...(seams.plan ? { previewRunPlan } : {}),
    ...(seams.controls ? { getRunControls, pauseRun, resumeRun, replayRun, checkpointRun, retryRun } : {}),
    ...(seams.detail ? { getRunDetail } : {}),
    ...(seams.voice ? { voice: { stt: voiceStt, transcribe: voiceTranscribe, speak: voiceSpeak } } : {}),
    ...(seams.fs ? { fs: { validate: fsValidate, requests: fsRequests, approve: fsApprove, deny: fsDeny } } : {}),
    ...(seams.scene ? { unrealScene: { getState: sceneGetState } } : {}),
    ...(seams.bus ? { bus: { listSessions: busListSessions, delegateTask: busDelegateTask, getDelegation: busGetDelegation } } : {}),
    ...(seams.confirm ? { respondToolConfirmation, listToolConfirmations } : {}),
    ...(seams.compaction ? { getChatCompactionStatus, chatCompact, getChatCompactionConfig } : {}),
    ...(seams.history ? { getChatHistory } : {}),
    listPresence,
    listHandoffs,
    getUsage,
    getMetrics,
    listModels,
  });
vi.mock('../../data-source', () => ({
  getDataSourceKind: () => 'live',
  getDataSource: () => HARN_DS(),
  // #418 (wave #418-2): mount-gated hook. In tests it resolves to the seam
  // built from the same module-scope builders getDataSource uses. useMemo
  // keeps it stable across re-renders so useAsyncValue([ds]) deps don't
  // refetch-loop (the real hook also returns a stable source).
  useDataSource: () => useMemo(HARN_DS, []),
}));

beforeEach(() => {
  // Chat transcript is mirrored to sessionStorage — clear between tests so
  // one test's conversation can't leak into the next.
  globalThis.sessionStorage?.clear();
  resetWarmRuntime();
  listPresets.mockResolvedValue([]);
  listAgents.mockResolvedValue([]);
  listRuns.mockResolvedValue([]);
  listApprovals.mockResolvedValue([]);
  respondApproval.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  navSearch.raw = 'tab=process';
  seams.plan = false;
  seams.controls = false;
  seams.detail = false;
  seams.voice = false;
  seams.fs = false;
  seams.scene = false;
  seams.bus = false;
  seams.confirm = false;
  seams.compaction = false;
  seams.history = false;
  getChatHistory.mockReset();
  busListSessions.mockReset();
  busDelegateTask.mockReset();
  busGetDelegation.mockReset();
  respondToolConfirmation.mockReset();
  listToolConfirmations.mockReset();
  listToolConfirmations.mockResolvedValue([]);
  listPresence.mockReset();
  listPresence.mockResolvedValue([]);
  listHandoffs.mockReset();
  listHandoffs.mockResolvedValue([]);
  getUsage.mockReset();
  getMetrics.mockReset();
  listModels.mockReset();
  listModels.mockResolvedValue([]);
  sceneGetState.mockReset();
  getChatCompactionStatus.mockReset();
  getChatCompactionStatus.mockResolvedValue(null);
  chatCompact.mockReset();
  getChatCompactionConfig.mockReset();
  getChatCompactionConfig.mockResolvedValue({
    windowTokens: null, reserveTokens: 16000, keepTokens: 15000, thresholdTokens: null,
  });
  fsValidate.mockReset();
  fsRequests.mockReset();
  fsRequests.mockResolvedValue([]);
  fsApprove.mockReset();
  fsDeny.mockReset();
  voiceStt.mockClear();
  voiceTranscribe.mockReset();
  voiceSpeak.mockReset();
  getRunDetail.mockReset();
  getRunDetail.mockResolvedValue(null);
  startRun.mockReset();
  cancelRun.mockReset();
  listPresets.mockReset();
  listAgents.mockReset();
  listRuns.mockReset();
  listApprovals.mockReset();
  respondApproval.mockReset();
  previewRunPlan.mockReset();
  getRunControls.mockReset();
  pauseRun.mockReset();
  resumeRun.mockReset();
  replayRun.mockReset();
  checkpointRun.mockReset();
  retryRun.mockReset();
  streamRun.mockReset();
  streamRun.mockImplementation(() => () => { });
});
