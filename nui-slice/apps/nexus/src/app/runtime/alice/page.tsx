import { preload } from 'react-dom';
import { AliceHomeRouteAdapter } from '../../../product/screens/alice-home-route-adapter';

/**
 * Алиас канонической главной `/home` (перенос 2026-10-29). Маршрут сохранён,
 * пока активный visual-target `alice-home-01` в манифесте ссылается на него;
 * после перевода target на `/home` маршрут можно снять.
 */
export default function AliceRuntimePage() {
  // Hero display face (Cormorant Garamond) — только на этом маршруте: заголовок
  // AGENT-A и statement в первом вьюпорте, без swap-перерисовки.
  preload('/fonts/cormorant-garamond-cyrillic-wght-normal.woff2', { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  preload('/fonts/cormorant-garamond-latin-wght-normal.woff2', { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  return <AliceHomeRouteAdapter />;
}
