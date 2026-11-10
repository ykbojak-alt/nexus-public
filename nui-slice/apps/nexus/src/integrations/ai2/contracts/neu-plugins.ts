/**
 * Контракт инвентаря NEU-плагинов (панели/бандлы оболочки) по
 * docs/product/neu-plugin-host-contract.md (W1).
 *
 * GET  /v1/neu/plugins              → NeuPluginInventory
 * POST /v1/neu/plugins/{id}/toggle  {enabled}         → {plugin}
 * POST /v1/neu/plugins/{id}/rows/{rowId}/toggle {enabled} → {plugin}
 */

export type NeuPluginStatus = 'active' | 'disabled' | 'failed' | 'overridden' | 'restart-required';

export interface NeuPluginRow {
  rowId: string;
  slot: string;
  title: string | null;
  enabled: boolean;
}

export interface NeuPluginEntry {
  id: string;
  version: string | null;
  title: string | null;
  description: string | null;
  icon: string | null;
  /** Источник каталога, verbatim из хоста. */
  kind: 'builtin' | 'local' | (string & {});
  status: NeuPluginStatus | (string & {});
  enabled: boolean;
  overriddenBy: string | null;
  /** Ошибки и права verbatim; null означает, что хост не сообщил данные. */
  errors: string[] | null;
  permissions: string[] | null;
  contributes: Record<string, string[]> | null;
  rows: NeuPluginRow[] | null;
  clientEntry: string | null;
  clientHash: string | null;
  hasHostEntry: boolean | null;
}

export interface NeuPluginInventory {
  plugins: NeuPluginEntry[];
  recovery: boolean;
  sources: Array<{ source: string; path: string }>;
}
