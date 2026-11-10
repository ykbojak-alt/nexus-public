import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV === 'development';

/**
 * Static export for the AI-2 desktop host (Task 17).
 * Asset URLs are rebased to the host mount `/_nexus` by
 * `scripts/sync-ai2-static.mjs` at copy time — Next's own path-form
 * `assetPrefix` crashes the Next 16.4.0 build on Windows
 * ("Missing parameter name at 2", both Turbopack and webpack).
 *
 * dev (#373): `output: 'export'` в `next dev` (Turbopack) ломает клиентскую
 * гидрацию (React-hydrate не выполняется: fiber=0, клики мёртвые). Поэтому
 * output:'export' применяется только к production-сборке (`next build` / 
 * `scripts/build-export.mjs`); в dev он отключается, чтобы hydrate работал.
 */
const nextConfig: NextConfig = {
  ...(isDev ? {} : { output: 'export' }),
  reactStrictMode: true,
  ...(isDev ? {} : { experimental: { agentUpgrade: 'security' } }),
  // Статический экспорт не несёт /_next/image-оптимизатор — src отдаём как есть.
  images: { unoptimized: true },
  // Dev: ai2-хост не отдаёт CORS-заголовков, поэтому live-запросы проксируем
  // same-origin через dev-сервер. В статическом экспорте секция не действует.
  ...(isDev
    ? {
        rewrites: async () => [
          { source: '/v1/:path*', destination: 'http://127.0.0.1:8123/v1/:path*' },
        ],
      }
    : {}),
};

export default nextConfig;
