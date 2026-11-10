'use client';

/** Вкладка «Процесс» — боковые панели: лог файловых операций прогона и
 * инбокс заявок на запись. Выделено из runtime.tsx без смены поведения. */
import { GlassPanel } from '@nexus/ui';
import { fmtEventTime } from '../runtime-ops';
import type { ProcessTabCtx } from './use-process-tab';
import styles from '../screens.module.css';

export function ProcessSidePanels({ c }: { c: ProcessTabCtx }) {
  const { fsPaneOps, fsChildGroups, fsPaneRunId, pendingFsReqs, fsDecisions, decideFs } = c;
  return (
    <>
      {/* Боковое окно файловой активности — вне транскрипта чата, чтобы
          длинные пути не шумели диалог. Показывает fs-ops последнего
          прогона (живого или крайнего завершённого). */}
      <GlassPanel
        className={`${styles.panel} ${styles.fsPane}`}
        data-state={fsPaneOps.length > 0 || fsChildGroups.length > 0 ? 'ready' : 'empty'}
        data-testid="fs-pane"
        aria-label="Файловые операции прогона"
      >
        <h2 className={styles.fsPaneTitle}>
          файлы прогона
          {fsPaneRunId != null && <span className={styles.fsPaneRun}>{fsPaneRunId.slice(0, 8)}</span>}
        </h2>
        {fsPaneOps.length === 0 && fsChildGroups.length === 0 ? (
          <p className={styles.emptyHint}>
            {fsPaneRunId == null
              ? 'Прогонов ещё не было — файловые операции появятся здесь.'
              : 'Файловых операций не зафиксировано — прогон не обращался к файлам.'}
          </p>
        ) : (
          <div className={styles.fsPaneBody} data-testid="fs-log" role="list">
            {fsPaneOps.map((op) => (
              <span
                key={op.seq}
                role="listitem"
                className={styles.fsLogLine}
                data-err={op.isError || undefined}
                title={`${op.tool} → ${op.target}${op.reason != null ? ` · ${op.reason}` : ''}`}
              >
                <span className={styles.traceTime}>{fmtEventTime(op.ts)}</span>
                {op.verb} · {op.target}{op.isError ? ` · ошибка${op.reason != null ? `: ${op.reason}` : ''}` : ''}
              </span>
            ))}
            {fsChildGroups.map((g) => (
              <div key={g.id} role="listitem" className={styles.fsChildGroup}>
                <span className={styles.fsChildTitle}>
                  {g.handle != null ? `${g.handle} · ` : ''}{g.id.slice(0, 8)}
                </span>
                {g.ops.map((op) => (
                  <span
                    key={op.seq}
                    className={styles.fsLogLine}
                    data-err={op.isError || undefined}
                    title={`${op.tool} → ${op.target}${op.isError ? ' · ошибка' : ''}`}
                  >
                    <span className={styles.traceTime}>{fmtEventTime(op.ts)}</span>
                    {op.verb} · {op.target}{op.isError ? ' · ошибка' : ''}
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}
      </GlassPanel>

      {/* U-3: approval-inbox — все ожидающие заявки на запись по загруженным
          трейсам; решения — через тот же seam ds.fs.approve/deny. */}
      <GlassPanel
        className={`${styles.panel} ${styles.fsPane}`}
        data-state={pendingFsReqs.length > 0 ? 'ready' : 'empty'}
        data-testid="approval-inbox"
        aria-label="Ожидающие заявки на запись"
      >
        <h2 className={styles.fsPaneTitle}>
          заявки на запись
          {pendingFsReqs.length > 0 && <span className={styles.fsPaneRun}>{pendingFsReqs.length}</span>}
        </h2>
        {pendingFsReqs.length === 0 ? (
          <p className={styles.emptyHint}>нет ожидающих заявок</p>
        ) : (
          <div role="list">
            {pendingFsReqs.map((req) => {
              const st = fsDecisions[req.id] ?? 'pending';
              const decided = st !== 'pending';
              return (
                <div key={req.id} role="listitem" data-testid="inbox-request" data-state={st} className={styles.inboxRow}>
                  <span className={styles.inboxTarget} title={`${req.op} · ${req.size} Б · sha256 ${req.sha256}`}>
                    {req.runId.slice(0, 8)} · {req.op} · {req.root ? `${req.root}:${req.path}` : req.path}
                  </span>
                  {req.preview && <span className={styles.inboxPreview}>{req.preview.slice(0, 120)}</span>}
                  {decided ? (
                    <span className={styles.inboxState}>{st === 'approved' ? 'разрешено' : st === 'denied' ? 'отклонено' : st}</span>
                  ) : (
                    <span className={styles.inboxActions}>
                      <button type="button" className={styles.prefChoice} onClick={() => void decideFs(req.id, 'approve')}>Разрешить</button>
                      <button type="button" className={styles.prefChoice} onClick={() => void decideFs(req.id, 'deny')}>Отклонить</button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </GlassPanel>
    </>
  );
}
