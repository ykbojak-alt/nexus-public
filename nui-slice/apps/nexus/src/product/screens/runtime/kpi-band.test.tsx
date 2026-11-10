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

// KPI-полоса /runtime — выделено из runtime.test.tsx (сплит wave-XVI).

describe('main-delta B.2 — KPI-полоса /runtime', () => {
  it('считает агентов/джобы/успех/длительность/стоимость из listRuns+listAgents verbatim', async () => {
    listAgents.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }] as never[]);
    const krun = (over: Record<string, unknown>) => ({
      runId: 'k', taskText: 'задача', config: 'baseline', status: 'done',
      stopReason: null, agent: null, parent: null, project: 'nexus',
      model: null, costUsd: null, createdAt: 100, finishedAt: null, ...over,
    });
    listRuns.mockResolvedValue([
      krun({ runId: 'k1', status: 'running' }),
      krun({ runId: 'k2', status: 'done', finishedAt: 160, costUsd: 0.5 }),
      krun({ runId: 'k3', status: 'error', finishedAt: 140, costUsd: 0.25 }),
    ]);
    render(<RuntimeScreen />);
    const band = await screen.findByTestId('runtime-kpi');
    expect(band.textContent).toContain('2'); // агенты
    expect(band.textContent).toContain('1 / 3'); // активные из выборки
    expect(band.textContent).toContain('50%'); // успех: 1 done из 2 finished
    expect(band.textContent).toContain('50с'); // ср. длительность (60+40)/2
    expect(band.textContent).toContain('$0.75'); // Σ cost
  });
});

