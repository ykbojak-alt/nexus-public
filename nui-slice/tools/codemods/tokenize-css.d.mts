/**
 * Типы для tools/codemods/tokenize-css.mjs (codemod «литерал → токен», ESM).
 */
export interface TokenizeRow {
  kind: 'color' | 'radius' | 'fontSize' | 'zIndex' | string;
  idx: number;
  lit: string;
  token: string | null;
  status: 'exact' | 'ambiguous' | 'unmatched';
  dist?: number;
}
export declare function loadTokenMap(): Map<string, string[]>;
export declare function transformCss(
  css: string,
  byValue: Map<string, string[]>,
): { css: string; report: TokenizeRow[] };
export declare function runCodemod(): {
  report: Array<Record<string, unknown>>;
  touched: Map<string, boolean>;
};
