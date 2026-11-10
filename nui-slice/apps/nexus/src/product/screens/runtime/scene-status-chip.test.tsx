// @vitest-environment jsdom
import {
  busDelegateTask, busGetDelegation, busListSessions, checkpointRun, fsApprove,
  fsDeny, fsRequests, fsValidate, getMetrics, getRunControls, getRunDetail,
  getUsage, listAgents, listApprovals, listModels, listPresence, listRuns,
  listToolConfirmations, navSearch, pauseRun, previewRunPlan, replayRun,
  respondApproval, respondToolConfirmation, resumeRun, retryRun,
  sceneGetState, seams, startRun, streamRun, voiceSpeak, voiceStt,
  voiceTranscribe,
} from './test-harness';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeScreen } from '../runtime';

// Чип состояния UE-сцены в шапке — выделено из runtime.test.tsx (сплит wave-XVI).

describe('runtime-wave2 B5 — чип состояния UE-сцены', () => {
  it('seam отсутствует → чип UNKNOWN, без выдуманного состояния', async () => {
    render(<RuntimeScreen />);
    const chip = await screen.findByTestId('scene-chip');
    expect(chip.textContent).toContain('НЕИЗВЕСТНО');
  });

  it('мост сообщает stale → чип STALE; mock-источник → DEMO', async () => {
    seams.scene = true;
    sceneGetState.mockResolvedValue({
      status: 'stale', source: 'live', reason: 'данные старше порога', lastUpdated: 1700000000, protocolVersion: 1, activeAssistant: null, activeMap: null,
    });
    render(<RuntimeScreen />);
    const chip = await screen.findByTestId('scene-chip');
    await waitFor(() => expect(chip.textContent).toContain('STALE'));
  });

  it('источник mock → чип DEMO поверх любого статуса', async () => {
    seams.scene = true;
    sceneGetState.mockResolvedValue({
      status: 'connected', source: 'mock', reason: null, lastUpdated: null, protocolVersion: null, activeAssistant: null, activeMap: null,
    });
    render(<RuntimeScreen />);
    const chip = await screen.findByTestId('scene-chip');
    await waitFor(() => expect(chip.textContent).toContain('DEMO'));
    expect(chip.textContent).not.toContain('LIVE');
  });
});

