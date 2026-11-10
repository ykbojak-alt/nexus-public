/**
 * Типы для scripts/sync-ai2-static.mjs (скрипт синка статики, ESM).
 */
export interface SyncResult {
  target: string;
  source: string;
  dest: string;
  files: number;
  rscAliases: string[];
}
export declare function syncAi2Static(options?: {
  target?: string;
  source?: string;
}): Promise<SyncResult>;
export declare function validateTarget(target: string): string;
export declare function validateSource(source: string): string;
