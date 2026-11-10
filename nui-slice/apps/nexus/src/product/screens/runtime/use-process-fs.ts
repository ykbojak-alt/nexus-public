'use client';

/** Вкладка «Процесс» — регулятор доступа к ФС (fs-dispatch W3): режим,
 * корни из профиля, решения по заявкам через ds.fs. Выделено из runtime.tsx
 * без смены поведения. */
import { useCallback, useRef, useState } from 'react';
import type { ApprovalState } from '@nexus/ui';
import type { RunSummary } from '@nexus/mock-data';
import { isAi2ApiError } from '../../../integrations/ai2/api/errors';
import type { ProductDataSource } from '../../data-source';
import { updateProfile } from '../../profile/profile-store';
import type { UserProfile } from '../../profile/profile-types';

export function useProcessFs({
  ds, profile, run,
}: {
  ds: ProductDataSource;
  profile: UserProfile | null;
  run: RunSummary | null;
}) {
  const fsMode: 'read_write' | 'read_only' = profile?.fsMode === 'read_write' ? 'read_write' : 'read_only';
  const fsRoots = profile?.fsRoots ?? [];
  const [fsAddOpen, setFsAddOpen] = useState(false);
  const [fsPath, setFsPath] = useState('');
  const [fsAddErr, setFsAddErr] = useState<string | null>(null);
  const [fsAddBusy, setFsAddBusy] = useState(false);
  const [fsDecisions, setFsDecisions] = useState<Record<string, ApprovalState>>({});
  const [fsActionErr, setFsActionErr] = useState<string | null>(null);

  const addFsRoot = useCallback(async () => {
    const p = fsPath.trim();
    if (!p || ds.fs == null || fsAddBusy) return;
    if (fsRoots.some((r) => r.path === p)) {
      setFsAddErr('Этот корень уже в списке доступа.');
      return;
    }
    setFsAddBusy(true);
    setFsAddErr(null);
    try {
      const v = await ds.fs.validate(p);
      if (!v.ok) {
        setFsAddErr(v.reason ?? 'Хост отклонил путь без причины.');
        return;
      }
      const canon = v.path ?? p;
      const id = canon.split(/[\\/]/).filter(Boolean).pop() ?? `root-${fsRoots.length + 1}`;
      updateProfile({ fsRoots: [...fsRoots, { id, path: canon }] });
      setFsPath('');
      setFsAddOpen(false);
    } catch {
      setFsAddErr('Проверка пути недоступна — хост не ответил.');
    } finally {
      setFsAddBusy(false);
    }
  }, [ds, fsPath, fsRoots, fsAddBusy]);

  const decideFs = useCallback(async (requestId: string, decision: 'approve' | 'deny') => {
    const fs = ds.fs;
    if (fs == null) return;
    setFsActionErr(null);
    try {
      const r = decision === 'approve' ? await fs.approve(requestId) : await fs.deny(requestId);
      setFsDecisions((prev) => ({ ...prev, [requestId]: r.status }));
    } catch (e) {
      if (isAi2ApiError(e) && e.status === 410) {
        setFsDecisions((prev) => ({ ...prev, [requestId]: 'expired' }));
        return;
      }
      if (isAi2ApiError(e) && e.status === 409) {
        // Уже решена вне этого чата — перечитываем заявку за истинным
        // вердиктом; без ответа помечаем revoked (не притворяемся знанием).
        try {
          const list = await fs.requests({ runId: run?.runId });
          const found = list.find((x) => x.id === requestId);
          setFsDecisions((prev) => ({ ...prev, [requestId]: found?.status ?? 'revoked' }));
        } catch {
          setFsDecisions((prev) => ({ ...prev, [requestId]: 'revoked' }));
        }
        return;
      }
      setFsActionErr('Не удалось передать решение по заявке — повторите.');
    }
  }, [ds, run?.runId]);


  const [fsOpen, setFsOpen] = useState(false);
  const fsRef = useRef<HTMLDivElement | null>(null);

  return {
    fsMode, fsRoots, fsAddOpen, setFsAddOpen, fsPath, setFsPath,
    fsAddErr, setFsAddErr, fsAddBusy, fsDecisions, fsActionErr,
    addFsRoot, decideFs, fsOpen, setFsOpen, fsRef,
  };
}
