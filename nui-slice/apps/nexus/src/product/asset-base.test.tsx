// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * База ассетов определяется тегом, который AI-2 ставит рядом с бандлом.
 * Модуль читает её на загрузке, поэтому каждая проверка пересобирает
 * модуль после изменения DOM (F1: арт /runtime/alice шёл мимо /_nexus).
 */
async function load() {
  vi.resetModules();
  return import('./asset-base');
}

describe('asset-base', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it('без монтирования /_nexus отдаёт пути от корня', async () => {
    const { artAsset, artAssetUrl } = await load();
    expect(artAsset('alice-home-extended.png')).toBe('/art/alice-home-extended.png');
    expect(artAssetUrl('a.webp')).toBe('url("/art/a.webp")');
  });

  it('в бандле под /_nexus префикс попадает и в script, и в link', async () => {
    document.head.innerHTML = '<script src="/_nexus/chunk.js"></script>';
    const { ASSET_BASE, artAsset } = await load();
    expect(ASSET_BASE).toBe('/_nexus');
    expect(artAsset('a.webp')).toBe('/_nexus/art/a.webp');

    document.head.innerHTML = '<link href="/_nexus/entry.css" rel="stylesheet">';
    expect((await load()).ASSET_BASE).toBe('/_nexus');
  });
});
