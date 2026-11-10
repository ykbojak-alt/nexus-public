'use client';

// Ленивая половина plugin-install-notifications: парсинг событий/подтверждений
// идёт через runtime-ops (тяжёлый модуль). Вызывающие грузят этот файл через
// динамический import(), чтобы runtime-ops не попадал в shared-бандл каркаса.

import type { SdkConfirmation } from '../../integrations/ai2/contracts/sdk';
import type { RunEventView } from '@nexus/mock-data';
import {
  confirmationDeferredOf,
  toolConfirmationOf,
  toolConfirmationResolutionOf,
} from '../screens/runtime-ops';
import {
  getPluginInstallNotices,
  publishPluginInstallRun,
  type PluginInstallNotice,
} from './plugin-install-notifications';

const INSTALL_TOOL = 'plugin_manager.install_bundle';
const BUILD_TOOL = 'plugin_manager.build_scripts_review';

function isInstallTool(tool: string): boolean {
  return tool === INSTALL_TOOL || tool === BUILD_TOOL;
}

function obj(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function syncRun(runId: string, events: readonly RunEventView[]): PluginInstallNotice[] {
  const byCall = new Map<string, PluginInstallNotice>();
  const previousByCall = new Map(
    getPluginInstallNotices().filter((notice) => notice.runId === runId)
      .map((notice) => [notice.confirmation.callId, notice]),
  );
  const resolutions = new Map<string, { decision: 'allow' | 'deny'; message: string | null }>();
  let outcome: PluginInstallNotice['outcome'] = null;
  let outcomeMessage: string | null = null;
  let pluginId: string | null = null;

  for (const event of events) {
    const body = obj(event.body);
    if (event.type === 'tool_confirmation' || event.type === 'confirmation_requested') {
      const confirmation = toolConfirmationOf(event.body);
      if (confirmation == null || !isInstallTool(confirmation.tool)) continue;
      const prev = byCall.get(confirmation.callId);
      byCall.set(confirmation.callId, {
        runId,
        confirmation: prev == null
          ? (confirmation.requestedAt == null && event.ts ? { ...confirmation, requestedAt: event.ts } : confirmation)
          : { ...prev.confirmation, ...confirmation, inputData: confirmation.inputData ?? prev.confirmation.inputData },
        decision: prev?.decision ?? null,
        message: prev?.message ?? null,
        outcome: prev?.outcome ?? null,
        pluginId: prev?.pluginId ?? null,
        enabledNow: prev?.enabledNow ?? false,
      });
    } else if (event.type === 'confirmation_deferred') {
      const deferred = confirmationDeferredOf(event.body);
      const prev = deferred == null ? null : byCall.get(deferred.callId);
      if (prev != null) {
        byCall.set(deferred!.callId, {
          ...prev,
          confirmation: { ...prev.confirmation, state: 'deferred' },
          decision: 'defer',
        });
      }
    } else if (event.type === 'tool_confirmation_resolved') {
      const resolved = toolConfirmationResolutionOf(event.body);
      if (resolved != null) {
        resolutions.set(resolved.callId, {
          decision: resolved.decision === 'approved' ? 'allow' : 'deny',
          message: resolved.message,
        });
      }
    } else if (event.type === 'plugin_install_completed') {
      outcome = 'installed';
      pluginId = typeof body?.plugin_id === 'string' ? body.plugin_id : null;
    } else if (event.type === 'plugin_install_failed') {
      outcome = 'error';
      outcomeMessage = typeof body?.reason === 'string' ? body.reason : null;
    }
  }

  return [...byCall.values()].map((notice) => {
    const resolution = resolutions.get(notice.confirmation.callId);
    const previous = previousByCall.get(notice.confirmation.callId);
    return {
      ...notice,
      decision: resolution?.decision ?? notice.decision ?? previous?.decision ?? null,
      message: resolution?.message ?? notice.message ?? previous?.message ?? outcomeMessage,
      outcome: notice.confirmation.tool === INSTALL_TOOL
        ? outcome ?? previous?.outcome ?? null
        : null,
      pluginId: notice.confirmation.tool === INSTALL_TOOL
        ? pluginId ?? previous?.pluginId ?? null
        : null,
      enabledNow: previous?.enabledNow ?? false,
    };
  });
}

export function syncPluginInstallNoticesFromTrace(runId: string, events: readonly RunEventView[]): void {
  publishPluginInstallRun(runId, syncRun(runId, events));
}

export function syncPluginInstallNoticesFromHost(runId: string, confirmations: readonly SdkConfirmation[]): void {
  const next = confirmations.flatMap((confirmation) => {
    const view = toolConfirmationOf(confirmation);
    return view != null && isInstallTool(view.tool)
      ? [{
          runId,
          confirmation: view,
          decision: view.state === 'deferred' ? 'defer' as const : null,
          message: null,
          outcome: null,
          pluginId: null,
          enabledNow: false,
        }]
      : [];
  });
  const previous = getPluginInstallNotices().filter((notice) => notice.runId === runId);
  const byCall = new Map(previous.map((notice) => [notice.confirmation.callId, notice]));
  const currentIds = new Set(next.map((notice) => notice.confirmation.callId));
  const stillRelevant = next.map((notice) => ({
    ...byCall.get(notice.confirmation.callId),
    ...notice,
    confirmation: {
      ...byCall.get(notice.confirmation.callId)?.confirmation,
      ...notice.confirmation,
      inputData: notice.confirmation.inputData
        ?? byCall.get(notice.confirmation.callId)?.confirmation.inputData,
    },
  }));
  const completed = previous.filter((notice) =>
    !currentIds.has(notice.confirmation.callId)
    && (notice.decision != null || notice.outcome != null),
  );
  publishPluginInstallRun(runId, [...stillRelevant, ...completed]);
}
