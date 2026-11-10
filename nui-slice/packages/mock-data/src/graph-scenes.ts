import type { NexusGraphData } from '@nexus/patterns/graphs/types';

/**
 * neu-ux probe fixtures — plan-DAG и message-graph сцены. Узлы/рёбра
 * описывают те же данные, что дают trace-адаптеры (planGraphOf /
 * messageGraphOf): статусы verbatim из plan/task_step, рёбра из
 * depends_on и send_message. Никаких выдуманных вершин.
 */

/** Plan DAG fixture — 7 шагов с зависимостями (включая ромб check-условия). */
export const planDagGraph: NexusGraphData = {
  nodes: [
    { id: 's1', label: 'Собрать дерево документов', kind: 'step', status: 'done' },
    { id: 's2', label: 'Сверить реестр с деревом', kind: 'step', status: 'done' },
    { id: 's3', label: 'Восстановить DIGEST', kind: 'step', status: 'active' },
    { id: 's4', label: 'Применить патч', kind: 'step', status: 'pending' },
    { id: 's5', label: 'Проверка: diff читаем', kind: 'check', status: 'pending' },
    { id: 's6', label: 'Запросить запись на диск', kind: 'step', status: 'pending' },
    { id: 's7', label: 'Собрать итоговый ответ', kind: 'step', status: 'pending' },
  ],
  edges: [
    { from: 's1', to: 's2', kind: 'depends' },
    { from: 's2', to: 's3', kind: 'depends' },
    { from: 's3', to: 's4', kind: 'depends' },
    { from: 's3', to: 's5', kind: 'depends' },
    { from: 's4', to: 's6', kind: 'depends' },
    { from: 's5', to: 's6', kind: 'depends' },
    { from: 's6', to: 's7', kind: 'depends' },
  ],
};

/** Message-graph fixture — родительский прогон + два суб-агента,
 *  рёбра send_message verbatim (время + текст). */
export const familyMessageGraph: NexusGraphData = {
  nodes: [
    { id: 'run-1042', label: 'run-1042', kind: 'root', status: 'executing' },
    { id: 'run-9f4a', label: 'sub-1 · run-9f4a', kind: 'sub', status: 'done' },
    { id: 'run-7c2e', label: 'sub-2 · run-7c2e', kind: 'sub', status: 'executing' },
  ],
  edges: [
    { from: 'run-1042', to: 'run-9f4a', label: '01:21:43 · сверь дерево со списком', kind: 'message' },
    { from: 'run-9f4a', to: 'run-1042', label: '01:22:08 · дерево совпадает', kind: 'message' },
    { from: 'run-1042', to: 'run-7c2e', label: '01:22:40 · собери usage-метрики', kind: 'message' },
    { from: 'run-7c2e', to: 'run-1042', label: '01:23:02 · жду второй батч', kind: 'message' },
  ],
};
