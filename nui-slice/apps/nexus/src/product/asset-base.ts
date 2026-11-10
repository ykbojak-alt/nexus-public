/**
 * База публичных ассетов. Dev и static-экспорт отдают `/art/…` от корня,
 * AI-2 монтирует бандл под `/_nexus` — определяется по тегу, который хост
 * вставляет рядом с бандлом.
 */
export const ASSET_BASE =
  typeof document !== 'undefined' &&
    document.querySelector('script[src*="/_nexus/"], link[href*="/_nexus/"]')
    ? '/_nexus'
    : '';

/** Путь к файлу из `public/art` (имя без ведущего слэша). */
export const artAsset = (name: string): string => `${ASSET_BASE}/art/${name}`;

/** Путь к уже собранному url() для CSS-переменной. */
export const artAssetUrl = (name: string): string => `url("${artAsset(name)}")`;
