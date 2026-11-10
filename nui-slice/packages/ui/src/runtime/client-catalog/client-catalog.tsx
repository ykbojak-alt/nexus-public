import type { ReactNode } from 'react';
import { ServiceCard, type ServiceCardProps, type ServiceAccessMode, ACCESS_MODE_LABELS } from '../service-card/service-card';
import { EmptyState } from '../../feedback/empty-state/empty-state';
import { UnavailableState } from '../../feedback/unavailable-state/unavailable-state';
import { LoadingState } from '../../feedback/loading-state/loading-state';
import type { GlassTone } from '../../surfaces/glass-bars/glass-surface';
import styles from '../runtime.module.css';

/** One catalog entry — a provider reached through a specific access path.
 *  A provider may legitimately appear several times with different `mode`. */
export interface RuntimeClientEntry extends ServiceCardProps {
  /** Stable key from the adapter inventory. */
  id: string;
  /** Provider grouping key, verbatim (e.g. 'Instagram'). Used when
   *  `groupBy="provider"`. */
  provider?: string;
}

export type RuntimeCatalogState = 'loading' | 'ready' | 'unavailable';

export type RuntimeClientGroupBy = 'none' | 'mode' | 'provider';

/** Fixed group order — adapters pick a mode, never invent new access paths. */
const MODE_GROUP_ORDER: ServiceAccessMode[] = ['web', 'api', 'native-app', 'business-api'];

export interface RuntimeClientCatalogProps {
  className?: string;
  /** Inventory rows — verbatim from the runtime adapter; empty is honest. */
  clients: RuntimeClientEntry[];
  /** 'unavailable' — the inventory source itself is down; renders
   *  UnavailableState instead of an empty grid. Default 'ready'. */
  state?: RuntimeCatalogState;
  /** Verbatim reason from the adapter when state='unavailable'. */
  unavailableReason?: string;
  /** Hint — when the inventory may return / what to do. */
  unavailableHint?: string;
  /** Heading for the honest empty state. */
  emptyTitle?: string;
  /** Honest reason the list is empty («ни один клиент не настроен»). */
  emptyReason?: string;
  /** 'mode' — sections per access path; 'provider' — sections per provider
   *  name; 'none' — flat list. Default 'mode'. */
  groupBy?: RuntimeClientGroupBy;
  /** Persona tint for state primitives via [data-persona]. */
  tone?: GlassTone;
  'aria-label'?: string;
  /** Extra cards that are not provider services — e.g. agentic clients
   *  (QwenClientCard). Rendered after the grouped grid, inside the region. */
  children?: ReactNode;
}

interface Group {
  key: string;
  title: string;
  items: RuntimeClientEntry[];
}

function groupClients(clients: RuntimeClientEntry[], groupBy: RuntimeClientGroupBy): Group[] {
  if (groupBy === 'none') {
    return [{ key: 'all', title: '', items: clients }];
  }
  const buckets = new Map<string, RuntimeClientEntry[]>();
  for (const c of clients) {
    const key = groupBy === 'mode' ? c.mode : (c.provider ?? c.name);
    const list = buckets.get(key) ?? [];
    list.push(c);
    buckets.set(key, list);
  }
  if (groupBy === 'mode') {
    return MODE_GROUP_ORDER.filter((m) => buckets.has(m))
      .map((m) => ({ key: m, title: ACCESS_MODE_LABELS[m], items: buckets.get(m)! }));
  }
  return [...buckets.entries()].map(([key, items]) => ({ key, title: key, items }));
}

/** Runtime Clients catalog (wave C): a truthful list of provider access
 *  paths. Each card keeps access mode separate from connection state; the
 *  catalog itself has honest loading/unavailable/empty states — an empty
 *  grid never masquerades as "everything fine". */
export function RuntimeClientCatalog({
  className, clients, state = 'ready', unavailableReason, unavailableHint,
  emptyTitle = 'Клиенты не подключены', emptyReason,
  groupBy = 'mode', tone, 'aria-label': ariaLabel = 'Каталог клиентов',
  children,
}: RuntimeClientCatalogProps) {
  if (state === 'loading') {
    return (
      <div className={className} data-testid="runtime-client-catalog" data-state="loading">
        <LoadingState tone={tone}>Загружаю список клиентов…</LoadingState>
      </div>
    );
  }
  if (state === 'unavailable') {
    return (
      <div className={className} data-testid="runtime-client-catalog" data-state="unavailable">
        <UnavailableState title="Каталог клиентов недоступен" reason={unavailableReason}
          hint={unavailableHint} tone={tone} />
      </div>
    );
  }
  if (clients.length === 0) {
    return (
      <div className={className} data-testid="runtime-client-catalog" data-state="empty">
        <EmptyState title={emptyTitle} reason={emptyReason} tone={tone} icon="status.offline" />
      </div>
    );
  }
  const groups = groupClients(clients, groupBy);
  return (
    <div className={[styles.clientCatalog, className].filter(Boolean).join(' ')}
      data-testid="runtime-client-catalog" data-state="ready" role="region" aria-label={ariaLabel}>
      {groups.map((g) => (
        <section key={g.key} className={styles.clientGroup} aria-label={g.title || undefined}>
          {g.title !== '' && <h4 className={styles.clientGroupTitle}>{g.title}</h4>}
          <ul className={styles.clientList}>
            {g.items.map((entry) => (
              <li key={entry.id} className={styles.clientItem}>
                <ServiceCard {...entry} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {children}
    </div>
  );
}
