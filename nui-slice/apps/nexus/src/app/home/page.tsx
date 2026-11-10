import { preload } from 'react-dom';
import { AliceHomeRouteAdapter } from '../../product/screens/alice-home-route-adapter';

/**
 * Canonical AGENT-A home. До 2026-10-29 Golden Home жил на служебном
 * `/runtime/alice`; теперь главная (`/home` — пункт «Главная» в рейле)
 * рендерит тот же адаптер. Служебный маршрут оставлен алиасом, пока
 * манифест `alice-home-01` ссылается на него как на target.
 */
export default function HomePage() {
  // Hero display face (Cormorant Garamond) — только на этом маршруте: заголовок
  // AGENT-A и statement в первом вьюпорте, без swap-перерисовки.
  preload('/fonts/cormorant-garamond-cyrillic-wght-normal.woff2', { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  preload('/fonts/cormorant-garamond-latin-wght-normal.woff2', { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  // UI-5: ключевой ассет первого вьюпорта (портрет hero) — не ждём
  // отрисовки, браузер качает его заранее.
  preload('/art/alice-main-hero.webp', { as: 'image', type: 'image/webp' });
  return <AliceHomeRouteAdapter />;
}
