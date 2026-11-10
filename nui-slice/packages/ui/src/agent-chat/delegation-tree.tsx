import { StatusBadge, type NexusStatus } from '../feedback/status-badge/status-badge';
import styles from './agent-chat.module.css';

/** Данные делегации из хоста. Поддерживает оба реально используемых ключа
 *  связи: tool parentCallId и SDK parentRunId; не выводит связь из порядка. */
export interface DelegationItem {
  id: string;
  parentCallId?: string | null;
  parentRunId?: string | null;
  label?: string | null;
  agent?: string | null;
  state?: string | null;
  durationMs?: number | null;
  summary?: string | null;
}

export interface DelegationTreeProps {
  className?: string;
  items: DelegationItem[];
  emptyLabel?: string;
}

interface DelegationNode {
  item: DelegationItem;
  parentId: string | null;
  children: DelegationNode[];
  note?: string;
}

const STATE_VIEW: Record<string, { status: NexusStatus; label: string }> = {
  sent: { status: 'waiting', label: 'Запущена' },
  running: { status: 'executing', label: 'Выполняется' },
  answered: { status: 'complete', label: 'Ответ получен' },
  failed: { status: 'error', label: 'Ошибка' },
  cancelled: { status: 'offline', label: 'Отменена' },
};

/** Формирует дерево по parentCallId/parentRunId. Осиротевшие элементы
 *  остаются видимыми в корне с пометкой; циклическая связь разрывается,
 *  чтобы не потерять данные и не зациклить рендер. */
export function delegationTree(items: DelegationItem[]): DelegationNode[] {
  const nodes = new Map<string, DelegationNode>();
  const parentById = new Map<string, string | null>();
  for (const item of items) {
    const parentId = item.parentCallId ?? item.parentRunId ?? null;
    nodes.set(item.id, { item, parentId, children: [] });
    parentById.set(item.id, parentId);
  }

  const roots: DelegationNode[] = [];
  for (const node of nodes.values()) {
    const { parentId } = node;
    if (parentId == null) {
      roots.push(node);
      continue;
    }
    const parent = nodes.get(parentId);
    if (parent == null) {
      node.note = `Родитель вне списка: ${parentId}`;
      roots.push(node);
      continue;
    }

    const seen = new Set([node.item.id]);
    let cursor: string | null = parentId;
    let cycle = false;
    while (cursor != null) {
      if (seen.has(cursor)) { cycle = true; break; }
      seen.add(cursor);
      cursor = parentById.get(cursor) ?? null;
    }
    if (cycle) {
      node.note = 'Циклическая связь родителя — элемент показан отдельно';
      roots.push(node);
    } else {
      parent.children.push(node);
    }
  }
  return roots;
}

function durationLabel(ms: number | null | undefined) {
  if (ms == null) return 'Длительность: нет данных';
  return `Длительность: ${ms < 1000 ? `${Math.round(ms)} мс` : `${(ms / 1000).toFixed(1).replace('.', ',')} с`}`;
}

function TreeNode({ node }: { node: DelegationNode }) {
  const { item, children, note } = node;
  const view = item.state != null
    ? STATE_VIEW[item.state] ?? { status: 'info' as const, label: item.state }
    : { status: 'info' as const, label: 'Нет данных' };
  const title = item.label ?? item.id;
  const row = (
    <>
      <span className={styles.delegationMain}>
        <span className={styles.delegationTitle}>{title}</span>
        <span className={styles.delegationMeta}>
          {item.agent != null ? `Агент: ${item.agent}` : 'Агент: нет данных'}
          {' · '}
          {durationLabel(item.durationMs)}
        </span>
      </span>
      <StatusBadge status={view.status} label={view.label} />
    </>
  );

  return (
    <li className={styles.delegationItem} data-delegation-id={item.id} data-state={item.state ?? 'unavailable'}>
      {children.length > 0 ? (
        <details className={styles.delegationDetails}>
          <summary
            className={styles.delegationSummary}
            tabIndex={0}
            aria-label={`Делегация ${title}, ${view.label}`}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              const details = event.currentTarget.closest('details');
              if (details == null) return;
              event.preventDefault();
              details.open = !details.open;
            }}
          >
            <span className={styles.delegationChevron} aria-hidden="true">›</span>
            {row}
          </summary>
          {item.summary != null && <p className={styles.delegationSummaryText}>{item.summary}</p>}
          <ul className={styles.delegationChildren} aria-label={`Дочерние задачи: ${title}`}>
            {children.map((child) => <TreeNode key={child.item.id} node={child} />)}
          </ul>
        </details>
      ) : (
        <div className={styles.delegationLeaf}>
          <span className={styles.delegationLeafMark} aria-hidden="true">└</span>
          {row}
        </div>
      )}
      {children.length === 0 && item.summary != null && (
        <p className={styles.delegationSummaryText}>{item.summary}</p>
      )}
      {note != null && <p className={styles.delegationNote} role="note">{note}</p>}
    </li>
  );
}

/** Дерево делегаций в ленте агента. Раскрытие — нативный details/summary,
 *  доступный клавиатурой; пустые связи не заменяются искусственными узлами. */
export function DelegationTree({
  className, items, emptyLabel = 'Делегаций нет',
}: DelegationTreeProps) {
  const roots = delegationTree(items);
  if (roots.length === 0) {
    return <p className={[styles.delegationEmpty, className].filter(Boolean).join(' ')} data-state="empty">{emptyLabel}</p>;
  }
  return (
    <ul className={[styles.delegationList, className].filter(Boolean).join(' ')}
      aria-label="Дерево делегаций" data-testid="delegation-tree" data-state="ready">
      {roots.map((node) => <TreeNode key={node.item.id} node={node} />)}
    </ul>
  );
}
