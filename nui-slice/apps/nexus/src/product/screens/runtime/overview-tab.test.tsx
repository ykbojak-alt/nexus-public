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

// Вкладка «Обзор» — выделено из runtime.test.tsx (сплит wave-XVI).

describe('runtime-wave2 A2 — вкладка «Обзор»', () => {
  const usageFixture = {
    period: '2026-10', runsTotal: 13, runsSucceeded: 10, runsFailed: 3,
    runsCancelled: 0, runsTimeout: 0, runsRunning: 0, costUsd: 0.038063,
    breakdown: [{ config: 'sentence', runs: 8, costUsd: 0.02 }],
  };
  const metricsFixture = {
    cpuPct: 75, ramPct: 69.1, diskPct: 73.6, gpuPct: null, uptimeS: 9023,
    counters: { modelCalls: 77, toolCalls: 31, tokensIn: 1000, tokensOut: 2000, costUsd: 0.038 },
    health: [], freshness: { state: 'live' as const, label: 'live' },
  };
  const runFixture = {
    runId: 'run-ov1', taskText: 'Активный прогон', config: 'sentence', status: 'running' as const,
    stopReason: null, agent: 'scout', parent: null, project: 'nexus',
    model: null, costUsd: null, createdAt: 100, finishedAt: null,
  };

  it('рендерит KPI и панели только из реальных seam-данных', async () => {
    navSearch.raw = 'tab=overview';
    listPresence.mockResolvedValue([
      { agent: 'scout', state: 'running', task: 'собирает', runId: 'run-ov1' },
      { agent: 'idle-2', state: 'ready', task: '', runId: null },
    ] as never[]);
    listRuns.mockResolvedValue([runFixture] as never[]);
    listAgents.mockResolvedValue([
      { name: 'scout', description: null, config: 'sentence', capabilities: ['compute'], maxCostUsd: 0.1 },
      { name: 'ghost', description: null, config: null, capabilities: [], maxCostUsd: null },
    ] as never[]);
    getUsage.mockResolvedValue(usageFixture as never);
    getMetrics.mockResolvedValue(metricsFixture as never);
    listModels.mockResolvedValue([{ id: 'm1', label: 'Model One' }] as never[]);

    render(<RuntimeScreen />);
    const tab = await screen.findByTestId('tab-overview');

    // KPI: 1 активный агент из 2 процессов; 1 активный прогон; успех и расход из usage.
    await waitFor(() => expect(tab.textContent).toContain('из 2 процессов'));
    expect(tab.textContent).toContain('77%'); // 10/13
    expect(tab.textContent).toContain('$0.038');
    expect(tab.textContent).toContain('2026-10');

    // Агенты: scout → статус процесса verbatim, ghost → честное «нет прогонов».
    const agentsPanel = within(tab).getByTestId('overview-agents');
    await within(agentsPanel).findByText('scout');
    expect(within(agentsPanel).getByText('идёт')).toBeTruthy();
    expect(within(agentsPanel).getByText('нет прогонов')).toBeTruthy();

    // Нагрузка: GPU=null у хоста → «нет данных», не ноль.
    expect(within(tab).getByText(/CPU · 75%/)).toBeTruthy();
    expect(within(tab).getByText(/GPU · нет данных/)).toBeTruthy();

    // Модели: каталог + breakdown из usage.
    expect(within(tab).getByText('1 моделей в каталоге')).toBeTruthy();
    expect(within(tab).getByText(/sentence · 8 прогонов/)).toBeTruthy();

    // Подтверждения: fs-seam отсутствует → unavailable, не «пусто».
    const approvals = within(tab).getByTestId('overview-approvals');
    expect(approvals.getAttribute('data-state')).toBe('unavailable');
    expect(within(approvals).getByText(/fs-seam у источника отсутствует/)).toBeTruthy();
  });

  it('пустой хост → честные empty-состояния без нулей и выдумок', async () => {
    navSearch.raw = 'tab=overview';
    getUsage.mockResolvedValue({
      ...usageFixture, runsTotal: 0, runsSucceeded: 0, costUsd: 0, breakdown: [],
    } as never);
    getMetrics.mockResolvedValue({ ...metricsFixture, cpuPct: null, ramPct: null, diskPct: null } as never);
    render(<RuntimeScreen />);
    const tab = await screen.findByTestId('tab-overview');
    await waitFor(() => expect(within(tab).getByText('Нет активных прогонов — управлять нечем.')).toBeTruthy());
    expect(within(tab).getByText('Реестр агентов пуст.')).toBeTruthy();
    expect(within(tab).getByText('Каталог моделей пуст.')).toBeTruthy();
    expect(within(tab).getByText(/CPU · нет данных/)).toBeTruthy();
    // usage.runsTotal=0 → успех «—», не 0%.
    const kpi = within(tab).getByRole('group', { name: 'Сводка обзора' });
    expect(kpi.textContent).not.toContain('0%');
  });

  it('fs-seam есть → pending-заявки с approve/deny', async () => {
    navSearch.raw = 'tab=overview';
    seams.fs = true;
    getUsage.mockResolvedValue(usageFixture as never);
    getMetrics.mockResolvedValue(metricsFixture as never);
    fsRequests.mockResolvedValue([
      { id: 'fsr-1', runId: 'run-ov1', root: 'D:/work', path: 'out.txt', op: 'write', size: 12, sha256: 'ab', preview: 'hello', status: 'pending' },
    ] as never[]);
    fsApprove.mockResolvedValue({ id: 'fsr-1', status: 'approved' } as never);
    render(<RuntimeScreen />);
    const tab = await screen.findByTestId('tab-overview');
    const approvals = within(tab).getByTestId('overview-approvals');
    await within(approvals).findByText(/run-ov1 · write · D:\/work:out\.txt/);
    fireEvent.click(within(approvals).getByRole('button', { name: 'Разрешить' }));
    await within(approvals).findByText('разрешено');
    expect(fsApprove).toHaveBeenCalledWith('fsr-1');
  });

  it('Job Control: активный прогон, прогресс из plan-шагов, пауза по controls', async () => {
    navSearch.raw = 'tab=overview';
    seams.controls = true;
    seams.detail = true;
    getUsage.mockResolvedValue(usageFixture as never);
    getMetrics.mockResolvedValue(metricsFixture as never);
    listRuns.mockResolvedValue([runFixture] as never[]);
    getRunControls.mockResolvedValue({
      paused: false,
      pause: { available: true, reason: null },
      resume: { available: false, reason: 'не на паузе' },
      replay: { available: true, reason: null },
      checkpoint: { available: false, reason: 'нет' },
      retry: { available: false, reason: 'прогон активен' },
    });
    pauseRun.mockResolvedValue({
      paused: true,
      pause: { available: false, reason: 'уже на паузе' },
      resume: { available: true, reason: null },
      replay: { available: true, reason: null },
      checkpoint: { available: false, reason: 'нет' },
      retry: { available: false, reason: 'прогон активен' },
    });
    getRunDetail.mockResolvedValue({
      run: runFixture,
      result: null,
      events: [
        { seq: 1, ts: 1, type: 'plan', body: { steps: [{ id: 's1', step: 'первый' }, { id: 's2', step: 'второй' }] } },
        { seq: 2, ts: 2, type: 'task_step', body: { step_id: 's1', status: 'done' } },
      ],
    } as never);
    render(<RuntimeScreen />);
    const tab = await screen.findByTestId('tab-overview');
    const jc = within(tab).getByTestId('overview-jobcontrol');
    await within(jc).findByTestId('job-control');
    // Прогресс 1/2 = 50% — из событий, не выдуман.
    await waitFor(() => expect(jc.querySelector('[role="progressbar"]')).toBeTruthy());
    const pauseBtn = within(jc).getByRole('button', { name: 'Пауза' }) as HTMLButtonElement;
    expect(pauseBtn.disabled).toBe(false);
    fireEvent.click(pauseBtn);
    await waitFor(() => expect(pauseRun).toHaveBeenCalledWith('run-ov1'));
  });
});

