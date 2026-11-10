'use client';

/** Вкладка «Процесс» — SDK-подтверждения (волна XIV): GET-пул открытых
 * карточек прогона + синк уведомлений об установке плагинов. Выделено из
 * runtime.tsx без смены поведения. */
import { useCallback, useEffect, useState } from 'react';
import type { RunEventView, RunSummary } from '@nexus/mock-data';
import type { SdkConfirmation, SdkConfirmDecision } from '../../../integrations/ai2/contracts/sdk';
import { isAi2ApiError } from '../../../integrations/ai2/api/errors';
import type { ProductDataSource } from '../../data-source';
import { usePluginInstallNotices } from '../../plugins/plugin-install-notifications';
import { syncPluginInstallNoticesFromHost, syncPluginInstallNoticesFromTrace } from '../../plugins/plugin-install-sync';
import { runWhileDocumentVisible } from '../../visible-interval';

export function useProcessSdk({
  ds, run, traces,
}: {
  ds: ProductDataSource;
  run: RunSummary | null;
  traces: Record<string, RunEventView[]>;
}) {
  // Wave XIV — открытые SDK-подтверждения активного прогона:
  // GET /v1/sdk/runs/{id}/confirmations даёт requestedAt/state точнее трейса
  // после перезагрузки ленты. 503 (SDK выключен) / 404 — трейс остаётся
  // источником карточек, seam не мокается.
  const [sdkConfs, setSdkConfs] = useState<Record<string, SdkConfirmation[]>>({});
  // 503 (AI2_SDK_ENABLED off) — seam отсутствует: карточки read-only,
  // кнопки решений прячем, не вешаем заведомо-падающий POST.
  const [sdkSeamDown, setSdkSeamDown] = useState(false);

  const pluginInstallNotices = usePluginInstallNotices();
  useEffect(() => {
    for (const [runId, events] of Object.entries(traces)) {
      syncPluginInstallNoticesFromTrace(runId, events);
    }
    for (const [runId, confirmations] of Object.entries(sdkConfs)) {
      syncPluginInstallNoticesFromHost(runId, confirmations);
    }
  }, [traces, sdkConfs]);

  // Локальная пометка deferred по ответу POST — на случай, если событие
  // confirmation_deferred ещё не долетело, а GET карточку не отдал.
  const [deferredMarks, setDeferredMarks] = useState<Record<string, Set<string>>>({});
  useEffect(() => {
    if (run == null || ds.listToolConfirmations == null) return;
    const runId = run.runId;
    let live = true;
    setSdkSeamDown(false);
    const load = () => ds.listToolConfirmations!(runId)
      .then((rows) => { if (live) setSdkConfs((p) => ({ ...p, [runId]: rows })); })
      .catch((err) => { // SDK off / прогона нет — карточки только из трейса
        const unavailable = isAi2ApiError(err)
          ? err.status === 503 || err.code === 'service_unavailable'
          : /service_unavailable|503/i.test(String(err));
        if (live && unavailable) setSdkSeamDown(true);
      });
    load();
    const stopPolling = runWhileDocumentVisible(load, 10_000);
    return () => { live = false; stopPolling(); };
  }, [ds, run?.runId, run?.status]);

  // Решение карточки: POST …/confirmations/{callId} через seam. defer →
  // локальная пометка deferred сразу по ответу {resolved:false}; финальный
  // allow/deny добирается событием tool_confirmation_resolved из трейса.
  const decideToolConf = useCallback(async (
    runId: string, callId: string, decision: SdkConfirmDecision, reason?: string,
  ) => {
    const r = await ds.respondToolConfirmation!(runId, callId, decision, reason);
    if (decision === 'defer' && r?.resolved === false) {
      setSdkConfs((p) => ({
        ...p,
        [runId]: (p[runId] ?? []).map((c) => (c.callId === callId ? { ...c, state: 'deferred' } : c)),
      }));
      setDeferredMarks((p) => {
        const s = new Set(p[runId] ?? []);
        s.add(callId);
        return { ...p, [runId]: s };
      });
    }
    return r;
  }, [ds]);

  return { sdkConfs, deferredMarks, pluginInstallNotices, decideToolConf, sdkSeamDown };
}
