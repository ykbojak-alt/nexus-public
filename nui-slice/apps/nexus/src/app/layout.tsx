import type { ReactNode } from 'react';
import { preload } from 'react-dom';
import '@nexus/tokens/generated/tokens.css';
import './fonts.css';
import './chrome.css';
// Глобальное фокус-кольцо (W2-131). @nexus/ui импортирует этот файл у себя,
// но в сборку приложения он не попадал: правила `[data-theme] …:focus-visible`
// не было ни в одном из 20 собранных CSS, фокус держался на UA-обводке
// (outline:auto) или гас module-правилами `outline:none`. Корневой layout —
// разрешённое место для глобального CSS (Next 11-css.md, Global CSS).
import '../../../../packages/ui/src/accessibility/focus-ring.css';
import { ApiToastProvider } from '../product/api-toast';
import { AppShell } from '../product/app-shell';
import { THEME_BOOTSTRAP_SCRIPT } from '../product/profile/theme-bootstrap';

export const metadata = {
  title: 'NEXUS',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Горячие гарнитуры — preload до первого кадра: font-display:swap даёт
  // мгновенный текст, но замена на веб-шрифт стреляет поздним перерисовом
  // (замеренный LCP-ре-пейнт ~3,3с на /runtime,/plugins). Кириллический и
  // латинский срезы Inter Tight покрывают весь UI-текст; Playfair cyrillic —
  // заголовки экранов. latin-ext (~90КБ) и моно-гарнитуры не грузим вперёд.
  // Вызов внутри рендера — preload действует только при активном диспетчере.
  preload('/fonts/inter-tight-cyrillic-wght-normal.woff2', { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  preload('/fonts/inter-tight-latin-wght-normal.woff2', { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  preload('/fonts/playfair-display-cyrillic-wght-normal.woff2', { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>
        <AppShell><ApiToastProvider>{children}</ApiToastProvider></AppShell>
      </body>
    </html>
  );
}
