'use client';

import { useEffect, useState } from 'react';

export type Persona = (typeof import('@nexus/mock-data/personas'))['PERSONAS'][number];

let personasPromise: Promise<typeof import('@nexus/mock-data/personas')> | null = null;
const loadPersonas = () => (personasPromise ??= import('@nexus/mock-data/personas'));

/**
 * Ленивый каталог персон (perf XVI W1): фикстуры `@nexus/mock-data` не
 * должны попадать в shared-бандл `/_not-found` через eager-граф app-shell.
 * До первого ответа хук возвращает null — потребитель показывает тот же
 * дефолт, что при отсутствии id в каталоге.
 */
export function usePersonas(): readonly Persona[] | null {
  const [list, setList] = useState<readonly Persona[] | null>(null);
  useEffect(() => {
    let alive = true;
    void loadPersonas().then((m) => {
      if (alive) setList(m.PERSONAS);
    });
    return () => {
      alive = false;
    };
  }, []);
  return list;
}
